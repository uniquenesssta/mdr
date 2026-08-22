//! Document-store public entry and current orchestration shell.
//!
//! R11-03 owns stable DTO, validation, and path-layout boundaries; R11-04 owns atomic file IO
//! primitives in `repository`; R11-05 owns snapshot A/B slot selection, R11-06 owns snapshot
//! hashing/metadata construction/parsing, and R11-07 owns snapshot write ordering and two-slot
//! loading, all in `snapshot`; R11-08 owns journal entry encoding/append and R11-09 owns journal
//! replay/recovery, both in `journal`. Indexing, command wiring, and store orchestration remain
//! here until their dedicated Stage 11 atomics.

mod journal;
mod paths;
mod repository;
mod snapshot;
mod types;
mod validation;

pub(crate) use types::{
    DocumentChunk, DocumentManifest, LoadedDocument, NativeHeading, SaveDocumentRequest,
    SaveDocumentResponse, SearchDocumentRequest, SearchDocumentResponse,
};
use journal::{
    append_journal, apply_transactions, recover_from_journal_replay, recover_from_snapshot_notes,
    replay_journal,
};
use paths::{document_directory, journal_path};
use repository::{
    abort_snapshot_upload, append_snapshot_chunk, begin_snapshot_upload, ensure_dir,
    take_snapshot_upload,
};
use snapshot::{fnv1a64, load_active_snapshot, write_snapshot};
use types::JournalEntry;
use validation::{safe_document_id, validate_save_versions};

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, State};

const SNAPSHOT_ENTRY_LIMIT: u32 = 24;
const SNAPSHOT_BYTE_LIMIT: u64 = 2 * 1024 * 1024;
const INDEX_CHECKPOINT_BYTES: usize = 64 * 1024;

#[derive(Default)]
pub struct DocumentStore {
    inner: Arc<Mutex<HashMap<String, StoredDocument>>>,
}

#[derive(Clone, Debug, Default)]
struct StoredDocument {
    title: String,
    content: String,
    version: u64,
    updated_at: u64,
    journal_entries: u32,
    journal_bytes: u64,
    snapshot_slot: Option<char>,
    recovered: bool,
    recovery_message: Option<String>,
    index: Option<DocumentIndex>,
}

#[derive(Clone, Debug, Default)]
struct DocumentIndex {
    checkpoints: Vec<IndexCheckpoint>,
    headings: Vec<NativeHeading>,
    utf16_length: usize,
    line_count: usize,
    non_whitespace_count: usize,
}

#[derive(Clone, Debug)]
struct IndexCheckpoint {
    byte_offset: usize,
    utf16_offset: usize,
}

fn document_root(app: &AppHandle, document_id: &str) -> Result<PathBuf, String> {
    let safe = safe_document_id(document_id)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法获取应用数据目录：{err}"))?;
    let root = document_directory(&app_data_dir, &safe);
    ensure_dir(&root)?;
    Ok(root)
}

fn heading_id(line: usize, level: u8, text: &str) -> String {
    format!("native-h-{line}-{level}-{}", fnv1a64(text.as_bytes()))
}

fn parse_atx_heading(line: &str) -> Option<(u8, String)> {
    let trimmed = line.trim_start();
    let level = trimmed.chars().take_while(|ch| *ch == '#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let remainder = &trimmed[level..];
    if remainder.chars().next().is_some_and(|ch| !ch.is_whitespace()) {
        return None;
    }
    let text = remainder
        .trim()
        .trim_end_matches('#')
        .trim()
        .to_string();
    if text.is_empty() {
        return None;
    }
    Some((level as u8, text))
}

fn fence_marker(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start();
    let marker = trimmed.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let count = trimmed.chars().take_while(|ch| *ch == marker).count();
    if count >= 3 { Some((marker, count)) } else { None }
}

fn build_document_index(content: &str) -> DocumentIndex {
    let mut checkpoints = vec![IndexCheckpoint {
        byte_offset: 0,
        utf16_offset: 0,
    }];
    let mut utf16_offset = 0usize;
    let mut non_whitespace_count = 0usize;
    let mut next_checkpoint = INDEX_CHECKPOINT_BYTES;

    for (byte_offset, ch) in content.char_indices() {
        if byte_offset >= next_checkpoint {
            checkpoints.push(IndexCheckpoint {
                byte_offset,
                utf16_offset,
            });
            next_checkpoint = byte_offset.saturating_add(INDEX_CHECKPOINT_BYTES);
        }
        utf16_offset += ch.len_utf16();
        if !ch.is_whitespace() {
            non_whitespace_count += 1;
        }
    }
    if checkpoints.last().map(|item| item.byte_offset) != Some(content.len()) {
        checkpoints.push(IndexCheckpoint {
            byte_offset: content.len(),
            utf16_offset,
        });
    }

    let mut headings = Vec::new();
    let mut line_number = 1usize;
    let mut line_start_utf16 = 0usize;
    let mut active_fence: Option<(char, usize)> = None;
    for raw_line in content.split_inclusive('\n') {
        let line = raw_line.trim_end_matches('\n').trim_end_matches('\r');
        if let Some((marker, count)) = fence_marker(line) {
            match active_fence {
                Some((active_marker, active_count)) if active_marker == marker && count >= active_count => {
                    active_fence = None;
                }
                None => active_fence = Some((marker, count)),
                _ => {}
            }
        } else if active_fence.is_none() {
            if let Some((level, text)) = parse_atx_heading(line) {
                headings.push(NativeHeading {
                    id: heading_id(line_number, level, &text),
                    level,
                    text,
                    line: line_number,
                    position: line_start_utf16,
                });
            }
        }
        line_start_utf16 += raw_line.encode_utf16().count();
        line_number += 1;
    }

    DocumentIndex {
        checkpoints,
        headings,
        utf16_length: utf16_offset,
        line_count: content.bytes().filter(|byte| *byte == b'\n').count() + 1,
        non_whitespace_count,
    }
}

fn ensure_document_index(document: &mut StoredDocument) -> &DocumentIndex {
    if document.index.is_none() {
        document.index = Some(build_document_index(&document.content));
    }
    document.index.as_ref().expect("document index initialized")
}

fn index_utf16_to_byte(content: &str, index: &DocumentIndex, target: usize) -> Result<usize, String> {
    if target > index.utf16_length {
        return Err("搜索位置超过文档长度".into());
    }
    let checkpoint_index = index
        .checkpoints
        .partition_point(|checkpoint| checkpoint.utf16_offset <= target)
        .saturating_sub(1);
    let checkpoint = &index.checkpoints[checkpoint_index];
    let mut utf16 = checkpoint.utf16_offset;
    for (relative, ch) in content[checkpoint.byte_offset..].char_indices() {
        if utf16 == target {
            return Ok(checkpoint.byte_offset + relative);
        }
        let width = ch.len_utf16();
        if utf16 + width > target {
            return Err("搜索位置落在代理字符中间".into());
        }
        utf16 += width;
    }
    if utf16 == target { Ok(content.len()) } else { Err("搜索位置超过文档长度".into()) }
}

fn index_byte_to_utf16(content: &str, index: &DocumentIndex, target: usize) -> Result<usize, String> {
    if target > content.len() || !content.is_char_boundary(target) {
        return Err("搜索结果不是有效 UTF-8 边界".into());
    }
    let checkpoint_index = index
        .checkpoints
        .partition_point(|checkpoint| checkpoint.byte_offset <= target)
        .saturating_sub(1);
    let checkpoint = &index.checkpoints[checkpoint_index];
    Ok(checkpoint.utf16_offset + content[checkpoint.byte_offset..target].encode_utf16().count())
}

fn load_document_from_disk(root: &Path) -> Result<Option<StoredDocument>, String> {
    let loaded = load_active_snapshot(root);
    let recovery_notes = loaded.notes;
    let Some(mut document) = loaded.document else {
        if !recovery_notes.is_empty() {
            return Err("后台文档的两个快照均无法通过完整性校验".into());
        }
        return Ok(None);
    };

    let journal = journal_path(root);
    if journal.exists() {
        let bytes = fs::read(&journal).map_err(|err| format!("无法读取增量日志：{err}"))?;
        let replay = replay_journal(&mut document, &bytes, recovery_notes);
        recover_from_journal_replay(root, &mut document, &bytes, replay)?;
    } else {
        recover_from_snapshot_notes(root, &mut document, &recovery_notes)?;
    }

    Ok(Some(document))
}

fn load_or_default(root: &Path) -> Result<StoredDocument, String> {
    Ok(load_document_from_disk(root)?.unwrap_or_default())
}

fn save_document_inner(
    root: &Path,
    cache: &mut HashMap<String, StoredDocument>,
    request: SaveDocumentRequest,
) -> Result<SaveDocumentResponse, String> {
    let key = safe_document_id(&request.document_id)?;
    if !cache.contains_key(&key) {
        cache.insert(key.clone(), load_or_default(root)?);
    }
    let document = cache.get_mut(&key).ok_or("无法初始化文档存储")?;

    let is_full_reset = request.full_content.is_some();
    validate_save_versions(
        document.version,
        request.base_version,
        request.next_version,
        is_full_reset,
    )?;

    if let Some(content) = request.full_content {
        document.content = content;
        document.index = None;
        document.version = request.next_version.max(document.version.saturating_add(1));
        document.title = request.title;
        document.updated_at = request.updated_at;
        write_snapshot(root, document)?;
        document.journal_entries = 0;
        document.journal_bytes = 0;
        return Ok(SaveDocumentResponse {
            document_id: request.document_id,
            version: document.version,
            content_bytes: document.content.len(),
            snapshot_created: true,
            journal_entries: 0,
        });
    }

    let entry = JournalEntry {
        base_version: request.base_version,
        next_version: request.next_version,
        title: request.title,
        updated_at: request.updated_at,
        transactions: request.transactions,
    };
    apply_transactions(&mut document.content, &entry.transactions)?;
    document.index = None;
    document.version = entry.next_version;
    document.title = entry.title.clone();
    document.updated_at = entry.updated_at;
    let appended = append_journal(root, &entry)?;
    document.journal_entries += 1;
    document.journal_bytes += appended;

    let should_snapshot = request.force_snapshot
        || document.journal_entries >= SNAPSHOT_ENTRY_LIMIT
        || document.journal_bytes >= SNAPSHOT_BYTE_LIMIT;
    if should_snapshot {
        write_snapshot(root, document)?;
        document.journal_entries = 0;
        document.journal_bytes = 0;
    }

    Ok(SaveDocumentResponse {
        document_id: request.document_id,
        version: document.version,
        content_bytes: document.content.len(),
        snapshot_created: should_snapshot,
        journal_entries: document.journal_entries,
    })
}

#[tauri::command]
pub async fn save_document_state(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    request: SaveDocumentRequest,
) -> Result<SaveDocumentResponse, String> {
    let root = document_root(&app, &request.document_id)?;
    let inner = store.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cache = inner.lock().map_err(|_| "文档存储锁已损坏".to_string())?;
        save_document_inner(&root, &mut cache, request)
    })
    .await
    .map_err(|err| format!("后台保存任务失败：{err}"))?
}

#[tauri::command]
pub async fn begin_document_snapshot_upload(
    app: AppHandle,
    document_id: String,
    upload_id: String,
) -> Result<(), String> {
    let root = document_root(&app, &document_id)?;
    tauri::async_runtime::spawn_blocking(move || begin_snapshot_upload(&root, &upload_id))
        .await
        .map_err(|err| format!("后台初始化分段快照失败：{err}"))?
}

#[tauri::command]
pub async fn append_document_snapshot_chunk(
    app: AppHandle,
    document_id: String,
    upload_id: String,
    chunk: String,
) -> Result<(), String> {
    let root = document_root(&app, &document_id)?;
    tauri::async_runtime::spawn_blocking(move || append_snapshot_chunk(&root, &upload_id, &chunk))
        .await
        .map_err(|err| format!("后台写入分段快照失败：{err}"))?
}

#[tauri::command]
pub async fn commit_document_snapshot_upload(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    mut request: SaveDocumentRequest,
    upload_id: String,
) -> Result<SaveDocumentResponse, String> {
    let root = document_root(&app, &request.document_id)?;
    let inner = store.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if request.full_content.is_some() {
            return Err("分段快照提交不能同时包含完整正文".into());
        }
        let content = take_snapshot_upload(&root, &upload_id)?;
        request.full_content = Some(content);
        let mut cache = inner.lock().map_err(|_| "文档存储锁已损坏".to_string())?;
        save_document_inner(&root, &mut cache, request)
    })
    .await
    .map_err(|err| format!("后台提交分段快照失败：{err}"))?
}

#[tauri::command]
pub async fn abort_document_snapshot_upload(
    app: AppHandle,
    document_id: String,
    upload_id: String,
) -> Result<(), String> {
    let root = document_root(&app, &document_id)?;
    tauri::async_runtime::spawn_blocking(move || abort_snapshot_upload(&root, &upload_id))
        .await
        .map_err(|err| format!("后台清理分段快照失败：{err}"))?
}

#[tauri::command]
pub async fn load_document_state(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    document_id: String,
) -> Result<Option<LoadedDocument>, String> {
    let root = document_root(&app, &document_id)?;
    let key = safe_document_id(&document_id)?;
    let inner = store.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cache = inner.lock().map_err(|_| "文档存储锁已损坏".to_string())?;
        if !cache.contains_key(&key) {
            if let Some(document) = load_document_from_disk(&root)? {
                cache.insert(key.clone(), document);
            }
        }
        Ok(cache.get_mut(&key).map(|document| {
            let recovered = document.recovered;
            let recovery_message = document.recovery_message.take();
            document.recovered = false;
            LoadedDocument {
                document_id,
                title: document.title.clone(),
                content: document.content.clone(),
                version: document.version,
                updated_at: document.updated_at,
                recovered,
                recovery_message,
            }
        }))
    })
    .await
    .map_err(|err| format!("后台读取任务失败：{err}"))?
}

#[tauri::command]
pub async fn load_document_manifest(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    document_id: String,
) -> Result<Option<DocumentManifest>, String> {
    let root = document_root(&app, &document_id)?;
    let key = safe_document_id(&document_id)?;
    let inner = store.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cache = inner.lock().map_err(|_| "文档存储锁已损坏".to_string())?;
        if !cache.contains_key(&key) {
            if let Some(document) = load_document_from_disk(&root)? {
                cache.insert(key.clone(), document);
            }
        }
        let Some(document) = cache.get_mut(&key) else {
            return Ok(None);
        };
        let recovered = document.recovered;
        let recovery_message = document.recovery_message.take();
        document.recovered = false;
        let index = ensure_document_index(document).clone();
        Ok(Some(DocumentManifest {
            document_id,
            title: document.title.clone(),
            version: document.version,
            updated_at: document.updated_at,
            content_bytes: document.content.len(),
            text_length: index.utf16_length,
            line_count: index.line_count,
            non_whitespace_count: index.non_whitespace_count,
            headings: index.headings,
            recovered,
            recovery_message,
        }))
    })
    .await
    .map_err(|err| format!("后台索引任务失败：{err}"))?
}

#[tauri::command]
pub async fn read_document_chunk(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    document_id: String,
    byte_offset: usize,
    max_bytes: usize,
) -> Result<Option<DocumentChunk>, String> {
    let root = document_root(&app, &document_id)?;
    let key = safe_document_id(&document_id)?;
    let inner = store.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cache = inner.lock().map_err(|_| "文档存储锁已损坏".to_string())?;
        if !cache.contains_key(&key) {
            if let Some(document) = load_document_from_disk(&root)? {
                cache.insert(key.clone(), document);
            }
        }
        let Some(document) = cache.get(&key) else {
            return Ok(None);
        };
        let total_bytes = document.content.len();
        if byte_offset > total_bytes || !document.content.is_char_boundary(byte_offset) {
            return Err("文档分段读取位置无效".into());
        }
        let requested = max_bytes.clamp(16 * 1024, 2 * 1024 * 1024);
        let mut end = byte_offset.saturating_add(requested).min(total_bytes);
        while end > byte_offset && !document.content.is_char_boundary(end) {
            end -= 1;
        }
        if end == byte_offset && byte_offset < total_bytes {
            end = document.content[byte_offset..]
                .char_indices()
                .nth(1)
                .map(|(relative, _)| byte_offset + relative)
                .unwrap_or(total_bytes);
        }
        Ok(Some(DocumentChunk {
            document_id,
            byte_offset,
            next_byte_offset: end,
            total_bytes,
            content: document.content[byte_offset..end].to_string(),
            done: end >= total_bytes,
        }))
    })
    .await
    .map_err(|err| format!("后台分段读取任务失败：{err}"))?
}

#[tauri::command]
pub async fn search_document_state(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    request: SearchDocumentRequest,
) -> Result<Option<SearchDocumentResponse>, String> {
    if request.query.is_empty() {
        return Ok(None);
    }
    let root = document_root(&app, &request.document_id)?;
    let key = safe_document_id(&request.document_id)?;
    let inner = store.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cache = inner.lock().map_err(|_| "文档存储锁已损坏".to_string())?;
        if !cache.contains_key(&key) {
            if let Some(document) = load_document_from_disk(&root)? {
                cache.insert(key.clone(), document);
            }
        }
        let Some(document) = cache.get_mut(&key) else {
            return Ok(None);
        };
        let index = ensure_document_index(document).clone();
        let start = request.from.min(index.utf16_length);
        let start_byte = index_utf16_to_byte(&document.content, &index, start)?;
        let mut wrapped = false;
        let found_byte = document.content[start_byte..]
            .find(&request.query)
            .map(|relative| start_byte + relative)
            .or_else(|| {
                if request.wrap && start_byte > 0 {
                    wrapped = true;
                    document.content[..start_byte].find(&request.query)
                } else {
                    None
                }
            });
        let Some(found_byte) = found_byte else {
            return Ok(None);
        };
        let from = index_byte_to_utf16(&document.content, &index, found_byte)?;
        let to = from + request.query.encode_utf16().count();
        Ok(Some(SearchDocumentResponse {
            from,
            to,
            wrapped,
            version: document.version,
        }))
    })
    .await
    .map_err(|err| format!("后台搜索任务失败：{err}"))?
}

#[tauri::command]
pub async fn delete_document_state(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    document_id: String,
) -> Result<(), String> {
    let root = document_root(&app, &document_id)?;
    let key = safe_document_id(&document_id)?;
    let inner = store.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cache = inner.lock().map_err(|_| "文档存储锁已损坏".to_string())?;
        cache.remove(&key);
        if root.exists() {
            fs::remove_dir_all(root).map_err(|err| format!("无法删除文档快照：{err}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|err| format!("后台删除任务失败：{err}"))?
}

#[cfg(test)]
mod tests {
    use super::paths::snapshot_paths;
    use super::types::{DocumentTransaction, TextChange};
    use super::*;
    use std::fs::OpenOptions;
    use std::io::Write;

    #[test]
    fn builds_sparse_index_and_ignores_fenced_headings() {
        let content = "# 标题😀\n正文\n```md\n# 代码标题\n```\n## 第二节\n";
        let index = build_document_index(content);
        assert_eq!(index.line_count, 7);
        assert_eq!(index.headings.len(), 2);
        assert_eq!(index.headings[0].line, 1);
        assert_eq!(index.headings[1].line, 6);
        assert_eq!(index.utf16_length, content.encode_utf16().count());
        let emoji_byte = content.find('😀').unwrap();
        let emoji_utf16 = index_byte_to_utf16(content, &index, emoji_byte).unwrap();
        assert_eq!(index_utf16_to_byte(content, &index, emoji_utf16).unwrap(), emoji_byte);
    }


    fn test_root(name: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("markdown-editor-{name}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn stored(content: &str, version: u64) -> StoredDocument {
        StoredDocument {
            title: "测试.md".into(),
            content: content.into(),
            version,
            updated_at: version,
            journal_entries: 0,
            journal_bytes: 0,
            snapshot_slot: None,
            recovered: false,
            recovery_message: None,
            index: None,
        }
    }

    #[test]
    fn repairs_truncated_journal_after_last_valid_transaction() {
        let root = test_root("journal-recovery");
        let mut document = stored("甲乙", 1);
        write_snapshot(&root, &mut document).unwrap();
        let entry = JournalEntry {
            base_version: 1,
            next_version: 2,
            title: "测试.md".into(),
            updated_at: 2,
            transactions: vec![DocumentTransaction {
                changes: vec![TextChange {
                    from: 2,
                    to: 2,
                    insert: "丙".into(),
                }],
            }],
        };
        append_journal(&root, &entry).unwrap();
        OpenOptions::new()
            .append(true)
            .open(journal_path(&root))
            .unwrap()
            .write_all(b"{\"baseVersion\":2")
            .unwrap();

        let loaded = load_document_from_disk(&root).unwrap().unwrap();
        assert_eq!(loaded.content, "甲乙丙");
        assert_eq!(loaded.version, 2);
        assert!(loaded.recovered);
        assert!(fs::read(journal_path(&root)).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn falls_back_to_other_snapshot_slot_when_latest_is_corrupt() {
        let root = test_root("snapshot-recovery");
        let mut document = stored("旧内容", 1);
        write_snapshot(&root, &mut document).unwrap();
        document.content = "新内容".into();
        document.version = 2;
        write_snapshot(&root, &mut document).unwrap();
        let (latest_content, _) = snapshot_paths(&root, 'b');
        fs::write(latest_content, "损坏").unwrap();

        let loaded = load_document_from_disk(&root).unwrap().unwrap();
        assert_eq!(loaded.content, "旧内容");
        assert_eq!(loaded.version, 1);
        assert!(loaded.recovered);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn saves_million_character_snapshot_from_chunks() {
        let root = test_root("million-character-snapshot");
        let upload_id = "upload_million";
        begin_snapshot_upload(&root, upload_id).unwrap();
        let chunk = "中".repeat(100_000);
        for _ in 0..10 {
            append_snapshot_chunk(&root, upload_id, &chunk).unwrap();
        }
        let content = take_snapshot_upload(&root, upload_id).unwrap();
        assert_eq!(content.encode_utf16().count(), 1_000_000);

        let request = SaveDocumentRequest {
            document_id: "doc_million".into(),
            title: "百万字.md".into(),
            base_version: 0,
            next_version: 1,
            full_content: Some(content),
            transactions: Vec::new(),
            updated_at: 1,
            force_snapshot: true,
        };
        let mut cache = HashMap::new();
        let response = save_document_inner(&root, &mut cache, request).unwrap();
        assert_eq!(response.version, 1);
        assert_eq!(response.content_bytes, 3_000_000);

        let loaded = load_document_from_disk(&root).unwrap().unwrap();
        assert_eq!(loaded.content.encode_utf16().count(), 1_000_000);
        assert_eq!(loaded.version, 1);
        fs::remove_dir_all(root).unwrap();
    }
}

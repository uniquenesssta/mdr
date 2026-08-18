use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::Write,
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHeading {
    id: String,
    level: u8,
    text: String,
    line: usize,
    position: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextChange {
    from: usize,
    to: usize,
    insert: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTransaction {
    changes: Vec<TextChange>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentRequest {
    document_id: String,
    title: String,
    base_version: u64,
    next_version: u64,
    full_content: Option<String>,
    #[serde(default)]
    transactions: Vec<DocumentTransaction>,
    updated_at: u64,
    #[serde(default)]
    force_snapshot: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentResponse {
    document_id: String,
    version: u64,
    content_bytes: usize,
    snapshot_created: bool,
    journal_entries: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedDocument {
    document_id: String,
    title: String,
    content: String,
    version: u64,
    updated_at: u64,
    recovered: bool,
    recovery_message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentManifest {
    document_id: String,
    title: String,
    version: u64,
    updated_at: u64,
    content_bytes: usize,
    text_length: usize,
    line_count: usize,
    non_whitespace_count: usize,
    headings: Vec<NativeHeading>,
    recovered: bool,
    recovery_message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChunk {
    document_id: String,
    byte_offset: usize,
    next_byte_offset: usize,
    total_bytes: usize,
    content: String,
    done: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDocumentRequest {
    document_id: String,
    query: String,
    #[serde(default)]
    from: usize,
    #[serde(default = "default_true")]
    wrap: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDocumentResponse {
    from: usize,
    to: usize,
    wrapped: bool,
    version: u64,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct JournalEntry {
    base_version: u64,
    next_version: u64,
    title: String,
    updated_at: u64,
    transactions: Vec<DocumentTransaction>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotMeta {
    version: u64,
    title: String,
    updated_at: u64,
    content_bytes: usize,
    content_hash: String,
}

fn safe_document_id(document_id: &str) -> Result<String, String> {
    let safe: String = document_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
        .take(160)
        .collect();
    if safe.is_empty() {
        return Err("文档标识无效".into());
    }
    Ok(safe)
}

fn document_root(app: &AppHandle, document_id: &str) -> Result<PathBuf, String> {
    let safe = safe_document_id(document_id)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法获取应用数据目录：{err}"))?
        .join("documents")
        .join(safe);
    fs::create_dir_all(&root).map_err(|err| format!("无法创建文档存储目录：{err}"))?;
    Ok(root)
}

fn fnv1a64(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
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

fn write_temp_file(path: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let temp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|value| value.to_str()).unwrap_or("data")
    ));
    let mut file = File::create(&temp).map_err(|err| format!("无法创建临时文件：{err}"))?;
    file.write_all(bytes)
        .map_err(|err| format!("无法写入临时文件：{err}"))?;
    file.sync_all()
        .map_err(|err| format!("无法同步临时文件：{err}"))?;
    Ok(temp)
}

fn replace_file(temp: &Path, target: &Path) -> Result<(), String> {
    match fs::rename(temp, target) {
        Ok(()) => Ok(()),
        Err(first_error) => {
            if target.exists() {
                fs::remove_file(target)
                    .map_err(|err| format!("无法替换旧快照：{err}"))?;
                fs::rename(temp, target)
                    .map_err(|err| format!("无法提交快照（首次错误：{first_error}；重试错误：{err}）"))
            } else {
                Err(format!("无法提交快照：{first_error}"))
            }
        }
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = write_temp_file(path, bytes)?;
    replace_file(&temp, path)
}

fn utf16_to_byte_index(text: &str, target: usize) -> Result<usize, String> {
    if target == 0 {
        return Ok(0);
    }
    let mut utf16 = 0usize;
    for (byte_index, ch) in text.char_indices() {
        if utf16 == target {
            return Ok(byte_index);
        }
        let width = ch.len_utf16();
        if utf16 + width > target {
            return Err("文本修改位置落在代理字符中间".into());
        }
        utf16 += width;
    }
    if utf16 == target {
        Ok(text.len())
    } else {
        Err("文本修改位置超过文档长度".into())
    }
}

fn apply_transactions(content: &mut String, transactions: &[DocumentTransaction]) -> Result<(), String> {
    for transaction in transactions {
        let mut changes = transaction.changes.clone();
        changes.sort_by(|left, right| right.from.cmp(&left.from));
        for change in changes {
            if change.to < change.from {
                return Err("文本修改范围无效".into());
            }
            let from = utf16_to_byte_index(content, change.from)?;
            let to = utf16_to_byte_index(content, change.to)?;
            if to < from {
                return Err("文本修改范围无效".into());
            }
            content.replace_range(from..to, &change.insert);
        }
    }
    Ok(())
}

fn snapshot_paths(root: &Path, slot: char) -> (PathBuf, PathBuf) {
    (
        root.join(format!("snapshot-{slot}.md")),
        root.join(format!("snapshot-{slot}.json")),
    )
}

fn read_snapshot(root: &Path, slot: char) -> Option<StoredDocument> {
    let (content_path, meta_path) = snapshot_paths(root, slot);
    let meta: SnapshotMeta = serde_json::from_slice(&fs::read(meta_path).ok()?).ok()?;
    let content = fs::read_to_string(content_path).ok()?;
    if content.len() != meta.content_bytes || fnv1a64(content.as_bytes()) != meta.content_hash {
        return None;
    }
    Some(StoredDocument {
        title: meta.title,
        content,
        version: meta.version,
        updated_at: meta.updated_at,
        journal_entries: 0,
        journal_bytes: 0,
        snapshot_slot: Some(slot),
        recovered: false,
        recovery_message: None,
        index: None,
    })
}

fn journal_path(root: &Path) -> PathBuf {
    root.join("changes.jsonl")
}

fn snapshot_upload_path(root: &Path, upload_id: &str) -> Result<PathBuf, String> {
    Ok(root.join(format!("snapshot-upload-{}.tmp", safe_document_id(upload_id)?)))
}

fn begin_snapshot_upload(root: &Path, upload_id: &str) -> Result<(), String> {
    let path = snapshot_upload_path(root, upload_id)?;
    let file = File::create(path).map_err(|err| format!("无法创建分段快照：{err}"))?;
    file.sync_all()
        .map_err(|err| format!("无法初始化分段快照：{err}"))
}

fn append_snapshot_chunk(root: &Path, upload_id: &str, chunk: &str) -> Result<(), String> {
    let path = snapshot_upload_path(root, upload_id)?;
    let mut file = OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|err| format!("无法打开分段快照：{err}"))?;
    file.write_all(chunk.as_bytes())
        .map_err(|err| format!("无法写入分段快照：{err}"))
}

fn take_snapshot_upload(root: &Path, upload_id: &str) -> Result<String, String> {
    let path = snapshot_upload_path(root, upload_id)?;
    let content = fs::read_to_string(&path).map_err(|err| format!("无法读取分段快照：{err}"))?;
    fs::remove_file(path).map_err(|err| format!("无法清理分段快照：{err}"))?;
    Ok(content)
}

fn abort_snapshot_upload(root: &Path, upload_id: &str) -> Result<(), String> {
    let path = snapshot_upload_path(root, upload_id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|err| format!("无法清理分段快照：{err}"))?;
    }
    Ok(())
}

fn load_document_from_disk(root: &Path) -> Result<Option<StoredDocument>, String> {
    let a_exists = {
        let (content, meta) = snapshot_paths(root, 'a');
        content.exists() || meta.exists()
    };
    let b_exists = {
        let (content, meta) = snapshot_paths(root, 'b');
        content.exists() || meta.exists()
    };
    let snapshot_a = read_snapshot(root, 'a');
    let snapshot_b = read_snapshot(root, 'b');
    let mut recovery_notes = Vec::new();
    if a_exists && snapshot_a.is_none() {
        recovery_notes.push("A 槽快照校验失败".to_string());
    }
    if b_exists && snapshot_b.is_none() {
        recovery_notes.push("B 槽快照校验失败".to_string());
    }

    let mut document = match (snapshot_a, snapshot_b) {
        (Some(left), Some(right)) => {
            if left.version >= right.version { left } else { right }
        }
        (Some(document), None) | (None, Some(document)) => document,
        (None, None) => {
            if a_exists || b_exists {
                return Err("后台文档的两个快照均无法通过完整性校验".into());
            }
            return Ok(None);
        }
    };

    let journal = journal_path(root);
    if journal.exists() {
        let bytes = fs::read(&journal).map_err(|err| format!("无法读取增量日志：{err}"))?;
        let mut valid_journal = Vec::new();
        let mut cursor = 0usize;
        let mut stale_entries = false;
        while cursor < bytes.len() {
            let relative_end = bytes[cursor..]
                .iter()
                .position(|byte| *byte == b'\n')
                .map(|offset| cursor + offset)
                .unwrap_or(bytes.len());
            let raw = &bytes[cursor..relative_end];
            cursor = if relative_end < bytes.len() { relative_end + 1 } else { bytes.len() };
            if raw.iter().all(|byte| byte.is_ascii_whitespace()) {
                continue;
            }
            let line = match std::str::from_utf8(raw) {
                Ok(line) => line.trim_end_matches('\r'),
                Err(_) => {
                    recovery_notes.push("增量日志尾部包含无效 UTF-8 数据".to_string());
                    break;
                }
            };
            let entry: JournalEntry = match serde_json::from_str(line) {
                Ok(entry) => entry,
                Err(_) => {
                    recovery_notes.push("增量日志包含未完整写入的记录".to_string());
                    break;
                }
            };
            if entry.next_version <= document.version {
                stale_entries = true;
                continue;
            }
            if entry.base_version != document.version {
                recovery_notes.push("增量日志版本链不连续".to_string());
                break;
            }

            let mut next_content = document.content.clone();
            if let Err(error) = apply_transactions(&mut next_content, &entry.transactions) {
                recovery_notes.push(format!("增量日志文本范围无效：{error}"));
                break;
            }
            document.content = next_content;
            document.version = entry.next_version;
            document.title = entry.title;
            document.updated_at = entry.updated_at;
            document.journal_entries += 1;
            valid_journal.extend_from_slice(line.as_bytes());
            valid_journal.push(b'\n');
        }
        document.journal_bytes = valid_journal.len() as u64;

        if !recovery_notes.is_empty() {
            document.recovered = true;
            document.recovery_message = Some(format!(
                "检测到存储异常，已恢复到版本 {}：{}",
                document.version,
                recovery_notes.join("；")
            ));
            // 将已经验证的连续增量折叠为新快照，并清空损坏尾部，避免后续保存
            // 继续追加到无法重放的日志之后。
            write_snapshot(root, &mut document)?;
            document.journal_entries = 0;
            document.journal_bytes = 0;
        } else if stale_entries || valid_journal != bytes {
            write_atomic(&journal, &valid_journal)?;
        }
    } else if !recovery_notes.is_empty() {
        document.recovered = true;
        document.recovery_message = Some(format!(
            "检测到存储异常，已从可用快照恢复到版本 {}：{}",
            document.version,
            recovery_notes.join("；")
        ));
        write_snapshot(root, &mut document)?;
    }

    Ok(Some(document))
}

fn next_snapshot_slot(current: Option<char>) -> char {
    if current == Some('a') { 'b' } else { 'a' }
}

fn write_snapshot(root: &Path, document: &mut StoredDocument) -> Result<(), String> {
    // 始终写入非当前槽位。这样写入中断时，当前完整快照仍可与
    // 尚未清空的增量日志一起恢复，不能简单按版本奇偶覆盖当前槽。
    let slot = next_snapshot_slot(document.snapshot_slot);
    let (content_path, meta_path) = snapshot_paths(root, slot);
    let meta = SnapshotMeta {
        version: document.version,
        title: document.title.clone(),
        updated_at: document.updated_at,
        content_bytes: document.content.len(),
        content_hash: fnv1a64(document.content.as_bytes()),
    };
    write_atomic(&content_path, document.content.as_bytes())?;
    let meta_bytes = serde_json::to_vec(&meta).map_err(|err| format!("无法序列化快照信息：{err}"))?;
    write_atomic(&meta_path, &meta_bytes)?;
    document.snapshot_slot = Some(slot);
    write_atomic(&journal_path(root), b"")?;
    Ok(())
}

fn append_journal(root: &Path, entry: &JournalEntry) -> Result<u64, String> {
    let mut encoded = serde_json::to_vec(entry).map_err(|err| format!("无法序列化增量日志：{err}"))?;
    encoded.push(b'\n');
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(journal_path(root))
        .map_err(|err| format!("无法打开增量日志：{err}"))?;
    file.write_all(&encoded)
        .map_err(|err| format!("无法写入增量日志：{err}"))?;
    file.sync_data()
        .map_err(|err| format!("无法同步增量日志：{err}"))?;
    Ok(encoded.len() as u64)
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
    if !is_full_reset && request.base_version != document.version {
        return Err(format!(
            "VERSION_MISMATCH:{}:{}",
            document.version, request.base_version
        ));
    }
    if request.next_version <= request.base_version && !is_full_reset {
        return Err("文档版本未前进".into());
    }

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
    use super::*;

    #[test]
    fn alternates_snapshot_slots_without_overwriting_current_snapshot() {
        assert_eq!(next_snapshot_slot(None), 'a');
        assert_eq!(next_snapshot_slot(Some('a')), 'b');
        assert_eq!(next_snapshot_slot(Some('b')), 'a');
    }

    #[test]
    fn applies_utf16_changes_for_chinese_and_emoji() {
        let mut content = "甲😀乙".to_string();
        let transactions = vec![DocumentTransaction {
            changes: vec![TextChange {
                from: 1,
                to: 3,
                insert: "中".into(),
            }],
        }];
        apply_transactions(&mut content, &transactions).unwrap();
        assert_eq!(content, "甲中乙");
    }

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

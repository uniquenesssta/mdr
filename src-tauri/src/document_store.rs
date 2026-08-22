//! Document-store public entry and current orchestration shell.
//!
//! R11-03 owns stable DTO, validation, and path-layout boundaries; R11-04 owns atomic file IO
//! primitives in `repository`; R11-05 owns snapshot A/B slot selection, R11-06 owns snapshot
//! hashing/metadata construction/parsing, and R11-07 owns snapshot write ordering and two-slot
//! loading, all in `snapshot`; R11-08 owns journal entry encoding/append and R11-09 owns journal
//! replay/recovery, both in `journal`; R11-10 owns document index construction and heading
//! detection and R11-11 owns UTF-16/byte mapping and search, both in `index`; R11-12 owns safe
//! UTF-8 boundary chunk reading and R11-13 owns the upload-session lifecycle, both in `chunks`.
//! Command wiring and store orchestration remain here until their dedicated Stage 11 atomics.

mod chunks;
mod index;
mod journal;
mod paths;
mod repository;
mod snapshot;
mod types;
mod validation;

pub(crate) use types::{
    DocumentChunk, DocumentManifest, LoadedDocument, SaveDocumentRequest, SaveDocumentResponse,
    SearchDocumentRequest, SearchDocumentResponse,
};
use chunks::{
    abort_snapshot_upload, append_snapshot_chunk, begin_snapshot_upload, read_chunk,
    take_snapshot_upload,
};
use index::{ensure_document_index, search_document_content, DocumentIndex};
use journal::{
    append_journal, apply_transactions, recover_from_journal_replay, recover_from_snapshot_notes,
    replay_journal,
};
use paths::{document_directory, journal_path};
use repository::ensure_dir;
use snapshot::{load_active_snapshot, write_snapshot};
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
        let chunk = read_chunk(&document.content, byte_offset, max_bytes)?;
        Ok(Some(DocumentChunk {
            document_id,
            byte_offset,
            next_byte_offset: chunk.next_byte_offset,
            total_bytes: chunk.total_bytes,
            content: chunk.content,
            done: chunk.done,
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
        let Some(found) = search_document_content(
            &document.content,
            &index,
            &request.query,
            request.from,
            request.wrap,
        )?
        else {
            return Ok(None);
        };
        Ok(Some(SearchDocumentResponse {
            from: found.from,
            to: found.to,
            wrapped: found.wrapped,
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

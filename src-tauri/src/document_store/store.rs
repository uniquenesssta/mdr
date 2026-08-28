//! Document-store use-case orchestration and the shared cache handle.
//!
//! Commands call this module; snapshots, journal, index and chunks retain their own policies.
//! Each operation checks out one document, performs IO and CPU work without a MutexGuard,
//! then returns its sole in-memory state through the cache lease, including error exits.
//! No Tauri runtime, second cache, serialization format or low-level atomic-write logic lives here.

use super::{
    cache::DocumentCache,
    chunks,
    index::search_document_content,
    journal::{
        append_journal, apply_transactions, recover_from_journal_replay,
        recover_from_snapshot_notes, replay_journal,
    },
    paths::journal_path,
    repository::{read_if_exists, remove_dir_if_exists},
    snapshot::{load_active_snapshot, write_snapshot},
    types::{
        DocumentChunk, DocumentManifest, JournalEntry, LoadedDocument, SaveDocumentRequest,
        SaveDocumentResponse, SearchDocumentRequest, SearchDocumentResponse,
    },
    validation::{safe_document_id, validate_save_versions},
    StoredDocument,
};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

const SNAPSHOT_ENTRY_LIMIT: u32 = 24;
const SNAPSHOT_BYTE_LIMIT: u64 = 2 * 1024 * 1024;

#[derive(Clone, Default)]
pub(crate) struct DocumentStore {
    inner: Arc<DocumentCache>,
}

impl DocumentStore {
    pub(super) fn save(
        &self,
        root: &Path,
        request: SaveDocumentRequest,
    ) -> Result<SaveDocumentResponse, String> {
        // Preserve the original save error priority: cache poison precedes ID validation.
        let mut lease = self
            .inner
            .checkout(safe_document_id(&request.document_id))?;
        if lease.document.is_none() {
            lease.document = Some(load_document_from_disk(root)?.unwrap_or_default());
        }
        let document = lease.document.as_mut().ok_or("无法初始化文档存储")?;
        save_document_inner(root, document, request)
    }

    pub(super) fn load(
        &self,
        root: &Path,
        document_id: String,
    ) -> Result<Option<LoadedDocument>, String> {
        let key = safe_document_id(&document_id)?;
        let mut lease = self.inner.checkout(Ok(key))?;
        if lease.document.is_none() {
            lease.document = load_document_from_disk(root)?;
        }
        Ok(lease.document.as_mut().map(|document| {
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
    }

    pub(super) fn manifest(
        &self,
        root: &Path,
        document_id: String,
    ) -> Result<Option<DocumentManifest>, String> {
        let key = safe_document_id(&document_id)?;
        let mut lease = self.inner.checkout(Ok(key))?;
        if lease.document.is_none() {
            lease.document = load_document_from_disk(root)?;
        }
        let Some(document) = lease.document.as_mut() else {
            return Ok(None);
        };
        let recovered = document.recovered;
        let recovery_message = document.recovery_message.take();
        document.recovered = false;
        let index = document.ensure_index().clone();
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
    }

    pub(super) fn read_chunk(
        &self,
        root: &Path,
        document_id: String,
        byte_offset: usize,
        max_bytes: usize,
    ) -> Result<Option<DocumentChunk>, String> {
        let key = safe_document_id(&document_id)?;
        let mut lease = self.inner.checkout(Ok(key))?;
        if lease.document.is_none() {
            lease.document = load_document_from_disk(root)?;
        }
        let Some(document) = lease.document.as_ref() else {
            return Ok(None);
        };
        let chunk = chunks::read_chunk(&document.content, byte_offset, max_bytes)?;
        Ok(Some(DocumentChunk {
            document_id,
            byte_offset,
            next_byte_offset: chunk.next_byte_offset,
            total_bytes: chunk.total_bytes,
            content: chunk.content,
            done: chunk.done,
        }))
    }

    // Empty search returns before resolving/creating a directory, even for an invalid ID.
    // Inject only root resolution so this ordering can be tested without a Tauri app.
    pub(super) fn prepare_search(
        request: &SearchDocumentRequest,
        resolve_root: impl FnOnce(&str) -> Result<PathBuf, String>,
    ) -> Result<Option<PathBuf>, String> {
        if request.query.is_empty() {
            return Ok(None);
        }
        resolve_root(&request.document_id).map(Some)
    }

    pub(super) fn search(
        &self,
        root: &Path,
        request: SearchDocumentRequest,
    ) -> Result<Option<SearchDocumentResponse>, String> {
        let key = safe_document_id(&request.document_id)?;
        let mut lease = self.inner.checkout(Ok(key))?;
        if lease.document.is_none() {
            lease.document = load_document_from_disk(root)?;
        }
        let Some(document) = lease.document.as_mut() else {
            return Ok(None);
        };
        let index = document.ensure_index().clone();
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
    }

    pub(super) fn delete(&self, root: &Path, document_id: &str) -> Result<(), String> {
        let key = safe_document_id(document_id)?;
        let mut lease = self.inner.checkout(Ok(key))?;
        // Keep eviction-before-delete, including on filesystem failure, while retaining the
        // document reservation until IO completes so no stale read can repopulate the cache.
        lease.document = None;
        remove_dir_if_exists(root).map_err(|err| format!("无法删除文档快照：{err}"))
    }

    pub(super) fn commit_upload(
        &self,
        root: &Path,
        mut request: SaveDocumentRequest,
        upload_id: &str,
    ) -> Result<SaveDocumentResponse, String> {
        if request.full_content.is_some() {
            return Err("分段快照提交不能同时包含完整正文".into());
        }
        let content = chunks::take_snapshot_upload(root, upload_id)?;
        request.full_content = Some(content);
        self.save(root, request)
    }
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
    if let Some(bytes) =
        read_if_exists(&journal).map_err(|err| format!("无法读取增量日志：{err}"))?
    {
        let replay = replay_journal(&mut document, &bytes, recovery_notes);
        recover_from_journal_replay(root, &mut document, &bytes, replay)?;
    } else {
        recover_from_snapshot_notes(root, &mut document, &recovery_notes)?;
    }

    Ok(Some(document))
}

fn save_document_inner(
    root: &Path,
    document: &mut StoredDocument,
    request: SaveDocumentRequest,
) -> Result<SaveDocumentResponse, String> {
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

#[cfg(test)]
#[path = "../../tests/support/document_store_command_contracts.rs"]
mod command_contract_tests;

#[cfg(test)]
#[path = "../../tests/support/document_store_concurrency.rs"]
mod concurrency_tests;

#[cfg(test)]
mod tests {
    use super::chunks::{append_snapshot_chunk, begin_snapshot_upload, take_snapshot_upload};
    use super::*;
    use crate::document_store::paths::snapshot_paths;
    use crate::document_store::types::{DocumentTransaction, TextChange};
    use std::fs::{self, OpenOptions};
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
        let response = DocumentStore::default().save(&root, request).unwrap();
        assert_eq!(response.version, 1);
        assert_eq!(response.content_bytes, 3_000_000);

        let loaded = load_document_from_disk(&root).unwrap().unwrap();
        assert_eq!(loaded.content.encode_utf16().count(), 1_000_000);
        assert_eq!(loaded.version, 1);
        fs::remove_dir_all(root).unwrap();
    }
}

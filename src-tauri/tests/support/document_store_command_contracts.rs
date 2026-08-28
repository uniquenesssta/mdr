//! R11-14 command-facing use-case regression tests, compiled inside the production store module.
//! Uses the real store, DTOs, snapshots, journal, index and upload implementation on owned temp
//! directories. No substitute storage implementation or writes to the frozen fixture corpus.

use super::*;
use crate::document_store::{
    abort_snapshot_upload, append_snapshot_chunk, begin_snapshot_upload, paths,
};
use serde_json::{json, Value};
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};

pub(super) const DOCUMENT_ID: &str = "doc-r11-14";
static NEXT_ROOT: AtomicU64 = AtomicU64::new(0);

pub(super) struct TestRoot(pub(super) PathBuf);

impl TestRoot {
    pub(super) fn new() -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let serial = NEXT_ROOT.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "mdr-r11-14-{}-{nonce}-{serial}",
            std::process::id()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }

    pub(super) fn fixture(name: &str) -> Self {
        let root = Self::new();
        let source = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/document_store")
            .join(name);
        for entry in fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            assert!(entry.file_type().unwrap().is_file());
            fs::copy(entry.path(), root.0.join(entry.file_name())).unwrap();
        }
        root
    }
}

impl Drop for TestRoot {
    fn drop(&mut self) {
        if self.0.exists() {
            fs::remove_dir_all(&self.0).expect("remove owned R11-14 test directory");
        }
    }
}

pub(super) fn full_request(content: &str) -> SaveDocumentRequest {
    serde_json::from_value(json!({
        "documentId": DOCUMENT_ID, "title": "命令😀.md", "baseVersion": 0,
        "nextVersion": 1, "fullContent": content, "updatedAt": 42
    }))
    .unwrap()
}

fn upload_request() -> SaveDocumentRequest {
    let mut request = full_request("");
    request.full_content = None;
    request
}

pub(super) fn query(text: &str, from: usize, wrap: bool) -> SearchDocumentRequest {
    serde_json::from_value(json!({
        "documentId": DOCUMENT_ID, "query": text, "from": from, "wrap": wrap
    }))
    .unwrap()
}

#[test]
fn snapshot_load_manifest_chunk_search_keep_wire_shapes_and_unicode_offsets() {
    let root = TestRoot::new();
    let store = DocumentStore::default();
    let content = "# 标题😀\n甲😀乙";
    let saved = store.save(&root.0, full_request(content)).unwrap();
    assert_eq!(
        serde_json::to_value(saved).unwrap(),
        json!({"documentId": DOCUMENT_ID, "version": 1, "contentBytes": content.len(),
            "snapshotCreated": true, "journalEntries": 0})
    );
    let loaded = store.load(&root.0, DOCUMENT_ID.into()).unwrap().unwrap();
    assert_eq!(
        serde_json::to_value(loaded).unwrap(),
        json!({"documentId": DOCUMENT_ID, "title": "命令😀.md", "content": content,
            "version": 1, "updatedAt": 42, "recovered": false, "recoveryMessage": null})
    );
    let manifest = store
        .manifest(&root.0, DOCUMENT_ID.into())
        .unwrap()
        .unwrap();
    assert_eq!(manifest.content_bytes, content.len());
    assert_eq!(manifest.text_length, content.encode_utf16().count());
    assert_eq!(manifest.headings.len(), 1);
    assert_eq!(manifest.headings[0].text, "标题😀");
    let chunk = store.read_chunk(&root.0, DOCUMENT_ID.into(), 0, 1).unwrap();
    assert_eq!(
        serde_json::to_value(chunk).unwrap(),
        json!({"documentId": DOCUMENT_ID, "byteOffset": 0, "nextByteOffset": content.len(),
            "totalBytes": content.len(), "content": content, "done": true})
    );
    let found = store
        .search(&root.0, query("😀", 7, true))
        .unwrap()
        .unwrap();
    assert_eq!(
        (found.from, found.to, found.wrapped, found.version),
        (8, 10, false, 1)
    );
    let wrapped = store
        .search(&root.0, query("标题", 11, true))
        .unwrap()
        .unwrap();
    assert_eq!((wrapped.from, wrapped.to, wrapped.wrapped), (2, 4, true));
    assert!(store
        .search(&root.0, query("标题", 11, false))
        .unwrap()
        .is_none());
    assert_eq!(
        store
            .read_chunk(&root.0, DOCUMENT_ID.into(), 3, 1)
            .unwrap_err(),
        "文档分段读取位置无效"
    );
}

#[test]
fn delta_save_invalidates_cached_index_and_preserves_version_mismatch_errors() {
    let root = TestRoot::new();
    let store = DocumentStore::default();
    store.save(&root.0, full_request("甲😀乙")).unwrap();
    assert_eq!(
        store
            .manifest(&root.0, DOCUMENT_ID.into())
            .unwrap()
            .unwrap()
            .text_length,
        4
    );
    let delta: SaveDocumentRequest = serde_json::from_value(json!({
        "documentId": DOCUMENT_ID, "title": "命令😀.md", "baseVersion": 1,
        "nextVersion": 2, "updatedAt": 43,
        "transactions": [{"changes": [{"from": 1, "to": 3, "insert": "丙"}]}]
    }))
    .unwrap();
    let saved = store.save(&root.0, delta.clone()).unwrap();
    assert_eq!(
        (saved.version, saved.journal_entries, saved.snapshot_created),
        (2, 1, false)
    );
    assert_eq!(
        store.save(&root.0, delta).unwrap_err(),
        "VERSION_MISMATCH:2:1"
    );
    let manifest = store
        .manifest(&root.0, DOCUMENT_ID.into())
        .unwrap()
        .unwrap();
    assert_eq!((manifest.text_length, manifest.version), (3, 2));
    let reloaded = DocumentStore::default()
        .load(&root.0, DOCUMENT_ID.into())
        .unwrap()
        .unwrap();
    assert_eq!(reloaded.content, "甲丙乙");
    assert_eq!(reloaded.version, 2);
}

#[test]
fn missing_and_empty_documents_remain_distinct() {
    let root = TestRoot::new();
    let store = DocumentStore::default();
    assert!(store.load(&root.0, DOCUMENT_ID.into()).unwrap().is_none());
    assert!(store
        .manifest(&root.0, DOCUMENT_ID.into())
        .unwrap()
        .is_none());
    assert!(store
        .read_chunk(&root.0, DOCUMENT_ID.into(), 0, 1)
        .unwrap()
        .is_none());
    assert!(store
        .search(&root.0, query("甲", 0, true))
        .unwrap()
        .is_none());
    store.save(&root.0, full_request("")).unwrap();
    let chunk = store
        .read_chunk(&root.0, DOCUMENT_ID.into(), 0, 1)
        .unwrap()
        .unwrap();
    assert_eq!(chunk.content, "");
    assert_eq!(chunk.next_byte_offset, 0);
    assert!(chunk.done);
    assert!(store.load(&root.0, DOCUMENT_ID.into()).unwrap().is_some());
}

#[test]
fn historic_fixture_corpus_loads_through_real_store_not_a_compatibility_reimplementation() {
    let manifest: Value =
        serde_json::from_str(include_str!("../fixtures/document_store/manifest.json")).unwrap();
    for (name, expected) in manifest["cases"].as_object().unwrap() {
        let root = TestRoot::fixture(name);
        let store = DocumentStore::default();
        let loaded = store.load(&root.0, DOCUMENT_ID.into()).unwrap().unwrap();
        assert_eq!(
            loaded.content,
            expected["expectedContent"].as_str().unwrap()
        );
        assert_eq!(loaded.title, expected["expectedTitle"].as_str().unwrap());
        assert_eq!(
            loaded.version,
            expected["expectedVersion"].as_u64().unwrap()
        );
        assert_eq!(
            loaded.recovered,
            expected["expectedRecovered"].as_bool().unwrap()
        );
        assert_eq!(
            loaded.recovery_message.as_deref(),
            expected["expectedRecoveryMessage"].as_str()
        );
        if let Some(search) = expected.get("search") {
            let found = store
                .search(&root.0, query(search["query"].as_str().unwrap(), 0, true))
                .unwrap()
                .unwrap();
            assert_eq!(found.from as u64, search["from"].as_u64().unwrap());
            assert_eq!(found.to as u64, search["to"].as_u64().unwrap());
        }
    }
}

#[test]
fn recovery_notice_is_consumed_once_across_load_and_manifest_in_either_order() {
    for manifest_first in [false, true] {
        let root = TestRoot::fixture("corrupt-slot");
        let store = DocumentStore::default();
        if manifest_first {
            let first = store
                .manifest(&root.0, DOCUMENT_ID.into())
                .unwrap()
                .unwrap();
            assert!(first.recovered && first.recovery_message.is_some());
            let second = store.load(&root.0, DOCUMENT_ID.into()).unwrap().unwrap();
            assert!(!second.recovered && second.recovery_message.is_none());
        } else {
            let first = store.load(&root.0, DOCUMENT_ID.into()).unwrap().unwrap();
            assert!(first.recovered && first.recovery_message.is_some());
            let second = store
                .manifest(&root.0, DOCUMENT_ID.into())
                .unwrap()
                .unwrap();
            assert!(!second.recovered && second.recovery_message.is_none());
        }
    }
}

#[test]
fn cloned_command_handle_preserves_one_shared_cache_owner() {
    let root = TestRoot::new();
    let store = DocumentStore::default();
    let worker = store.clone();
    assert!(Arc::ptr_eq(&store.inner, &worker.inner));
    worker.save(&root.0, full_request("共享缓存😀")).unwrap();
    assert_eq!(store.inner.cached_len(), 1);
    assert_eq!(
        store
            .load(&root.0, DOCUMENT_ID.into())
            .unwrap()
            .unwrap()
            .content,
        "共享缓存😀"
    );
}

#[test]
fn upload_commit_and_abort_preserve_session_isolation_and_cleanup() {
    let root = TestRoot::new();
    let store = DocumentStore::default();
    begin_snapshot_upload(&root.0, "session_a").unwrap();
    begin_snapshot_upload(&root.0, "session_b").unwrap();
    append_snapshot_chunk(&root.0, "session_a", "取消内容").unwrap();
    append_snapshot_chunk(&root.0, "session_b", "甲").unwrap();
    abort_snapshot_upload(&root.0, "session_a").unwrap();
    abort_snapshot_upload(&root.0, "session_a").unwrap();
    append_snapshot_chunk(&root.0, "session_b", "乙😀").unwrap();
    let saved = store
        .commit_upload(&root.0, upload_request(), "session_b")
        .unwrap();
    assert_eq!(saved.content_bytes, "甲乙😀".len());
    assert!(!paths::snapshot_upload_path(&root.0, "session_a")
        .unwrap()
        .exists());
    assert!(!paths::snapshot_upload_path(&root.0, "session_b")
        .unwrap()
        .exists());
    assert_eq!(
        store
            .load(&root.0, DOCUMENT_ID.into())
            .unwrap()
            .unwrap()
            .content,
        "甲乙😀"
    );
}

#[test]
fn rejected_upload_commit_preserves_the_pending_file_and_original_error_text() {
    let root = TestRoot::new();
    let store = DocumentStore::default();
    begin_snapshot_upload(&root.0, "pending").unwrap();
    append_snapshot_chunk(&root.0, "pending", "待提交").unwrap();
    assert_eq!(
        store
            .commit_upload(&root.0, full_request("冲突"), "pending")
            .unwrap_err(),
        "分段快照提交不能同时包含完整正文"
    );
    assert_eq!(
        fs::read_to_string(paths::snapshot_upload_path(&root.0, "pending").unwrap()).unwrap(),
        "待提交"
    );
    assert_eq!(store.inner.cached_len(), 0);
    let error = store
        .commit_upload(&root.0, upload_request(), "missing")
        .unwrap_err();
    assert!(error.starts_with("无法读取分段快照："));
    store
        .commit_upload(&root.0, upload_request(), "pending")
        .unwrap();
}

#[test]
fn delete_clears_cache_is_idempotent_and_reports_filesystem_errors() {
    let root = TestRoot::new();
    let store = DocumentStore::default();
    store.save(&root.0, full_request("删除内容")).unwrap();
    let regular_file = root.0.join("not-a-directory");
    fs::write(&regular_file, "阻止目录删除").unwrap();
    assert!(store
        .delete(&regular_file, DOCUMENT_ID)
        .unwrap_err()
        .starts_with("无法删除文档快照："));
    assert_eq!(store.inner.cached_len(), 0);
    assert!(store.load(&root.0, DOCUMENT_ID.into()).unwrap().is_some());
    store.delete(&root.0, DOCUMENT_ID).unwrap();
    assert!(!root.0.exists());
    assert_eq!(store.inner.cached_len(), 0);
    store.delete(&root.0, DOCUMENT_ID).unwrap();
}

#[test]
fn poisoned_cache_errors_are_preserved_in_every_stateful_command_use_case() {
    let root = TestRoot::new();
    let store = DocumentStore::default();
    let poisoned = store.clone();
    assert!(std::thread::spawn(move || {
        poisoned.inner.poison_for_test();
    })
    .join()
    .is_err());
    let expected = "文档存储锁已损坏";
    let mut invalid_save = full_request("非法 ID");
    invalid_save.document_id = "../".into();
    assert_eq!(store.save(&root.0, invalid_save).unwrap_err(), expected);
    assert_eq!(
        store.load(&root.0, "../".into()).unwrap_err(),
        "文档标识无效"
    );
    assert_eq!(
        store.save(&root.0, full_request("甲")).unwrap_err(),
        expected
    );
    assert_eq!(
        store.load(&root.0, DOCUMENT_ID.into()).unwrap_err(),
        expected
    );
    assert_eq!(
        store.manifest(&root.0, DOCUMENT_ID.into()).unwrap_err(),
        expected
    );
    assert_eq!(
        store
            .read_chunk(&root.0, DOCUMENT_ID.into(), 0, 1)
            .unwrap_err(),
        expected
    );
    assert_eq!(
        store.search(&root.0, query("甲", 0, true)).unwrap_err(),
        expected
    );
    assert_eq!(store.delete(&root.0, DOCUMENT_ID).unwrap_err(), expected);
    begin_snapshot_upload(&root.0, "before_lock").unwrap();
    append_snapshot_chunk(&root.0, "before_lock", "甲").unwrap();
    assert_eq!(
        store
            .commit_upload(&root.0, upload_request(), "before_lock")
            .unwrap_err(),
        expected
    );
    // Existing ordering consumes the upload before taking the cache lock; do not change it here.
    assert!(!paths::snapshot_upload_path(&root.0, "before_lock")
        .unwrap()
        .exists());
}

#[test]
fn empty_search_skips_root_resolution_and_nonempty_search_preserves_resolution_errors() {
    let mut request = query("", 0, true);
    request.document_id = "../".into();
    let prepared = DocumentStore::prepare_search(&request, |_| panic!("empty query resolved root"));
    assert!(prepared.unwrap().is_none());
    request.query = "甲".into();
    assert_eq!(
        DocumentStore::prepare_search(&request, |id| {
            safe_document_id(id)?;
            panic!("invalid ID passed validation")
        })
        .unwrap_err(),
        "文档标识无效"
    );
    request.document_id = DOCUMENT_ID.into();
    let root = TestRoot::new();
    let mut resolved = 0;
    let prepared = DocumentStore::prepare_search(&request, |id| {
        assert_eq!(id, DOCUMENT_ID);
        resolved += 1;
        Ok(root.0.clone())
    })
    .unwrap();
    assert_eq!(resolved, 1);
    assert_eq!(prepared, Some(root.0.clone()));
}

#[test]
fn two_corrupt_slots_fail_through_load_manifest_chunk_and_search() {
    let root = TestRoot::fixture("corrupt-slot");
    let (slot_a, _) = paths::snapshot_paths(&root.0, 'a');
    fs::write(slot_a, "损坏剩余快照").unwrap();
    let store = DocumentStore::default();
    let expected = "后台文档的两个快照均无法通过完整性校验";
    assert_eq!(
        store.load(&root.0, DOCUMENT_ID.into()).unwrap_err(),
        expected
    );
    assert_eq!(
        store.manifest(&root.0, DOCUMENT_ID.into()).unwrap_err(),
        expected
    );
    assert_eq!(
        store
            .read_chunk(&root.0, DOCUMENT_ID.into(), 0, 1)
            .unwrap_err(),
        expected
    );
    assert_eq!(
        store.search(&root.0, query("甲", 0, true)).unwrap_err(),
        expected
    );
}

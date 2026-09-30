//! R12-19 production save/cache recovery against real files.
//! Injected boundary failures are explicitly separate from Windows OS IO refusals.
use super::command_contract_tests::{full_request, TestRoot, DOCUMENT_ID};
use super::*;
use crate::document_store::{paths::snapshot_paths, repository::faults};
use serde_json::json;
use std::fs;

fn delta() -> SaveDocumentRequest {
    serde_json::from_value(json!({
        "documentId": DOCUMENT_ID, "title": "new.md", "baseVersion": 1,
        "nextVersion": 2, "updatedAt": 43,
        "transactions": [{"changes": [{"from": 1, "to": 1, "insert": "乙"}]}]
    })).unwrap()
}

fn assert_disk_cache_retry(store: &DocumentStore, root: &Path, expected: &str) {
    let current = store.load(root, DOCUMENT_ID.into()).unwrap().unwrap();
    let restarted = DocumentStore::default().load(root, DOCUMENT_ID.into()).unwrap().unwrap();
    assert_eq!(current.content, expected);
    assert_eq!((&current.content, current.version), (&restarted.content, restarted.version));
    store.save(root, full_request("重试😀")).unwrap();
    let current = store.load(root, DOCUMENT_ID.into()).unwrap().unwrap();
    let restarted = DocumentStore::default().load(root, DOCUMENT_ID.into()).unwrap().unwrap();
    assert_eq!(current.content, "重试😀");
    assert_eq!((current.content, current.version), (restarted.content, restarted.version));
}

#[test]
fn invalid_later_transaction_never_publishes_partially_mutated_cache() {
    let root = TestRoot::new();
    let store = DocumentStore::default();
    store.save(&root.0, full_request("甲")).unwrap();
    let mut request = delta();
    request.transactions.push(serde_json::from_value(json!({"changes":[{"from":999,"to":999,"insert":"错误"}]})).unwrap());
    assert!(store.save(&root.0, request).is_err());
    assert_eq!(store.inner.cached_len(), 0);
    assert_disk_cache_retry(&store, &root.0, "甲");
}

#[test]
fn injected_journal_open_partial_write_and_sync_errors_recover_disk_fact() {
    for stage in ["journal-open", "journal-write", "journal-sync"] {
        let root = TestRoot::new();
        let store = DocumentStore::default();
        store.save(&root.0, full_request("甲")).unwrap();
        faults::arm("changes.jsonl", stage);
        assert!(store.save(&root.0, delta()).unwrap_err().contains("INJECTED_IO_FAILURE"));
        faults::assert_consumed();
        assert_eq!(store.inner.cached_len(), 0);
        let expected = if stage == "journal-sync" { "甲乙" } else { "甲" };
        assert_disk_cache_retry(&store, &root.0, expected);
    }
}

#[test]
fn injected_snapshot_content_metadata_and_reset_boundaries_preserve_recoverable_state() {
    for filename in ["snapshot-b.md", "snapshot-b.json", "changes.jsonl"] {
        for stage in ["create", "write", "sync", "replace"] {
            let root = TestRoot::new();
            let store = DocumentStore::default();
            store.save(&root.0, full_request("甲")).unwrap();
            faults::arm(filename, stage);
            assert!(store.save(&root.0, full_request("新正文")).unwrap_err().contains("INJECTED_IO_FAILURE"));
            faults::assert_consumed();
            assert_eq!(store.inner.cached_len(), 0);
            let expected = if filename == "changes.jsonl" { "新正文" } else { "甲" };
            assert_disk_cache_retry(&store, &root.0, expected);
        }
    }
}

#[test]
fn journal_committed_but_snapshot_failed_reloads_committed_delta() {
    let root = TestRoot::new();
    let store = DocumentStore::default();
    store.save(&root.0, full_request("甲")).unwrap();
    let mut request = delta();
    request.force_snapshot = true;
    faults::arm("snapshot-b.md", "create");
    assert!(store.save(&root.0, request).is_err());
    faults::assert_consumed();
    assert_eq!(store.inner.cached_len(), 0);
    assert_disk_cache_retry(&store, &root.0, "甲乙");
}

#[test]
fn real_directory_obstructions_at_each_snapshot_stage_keep_disk_and_cache_consistent() {
    for filename in ["snapshot-b.md.tmp", "snapshot-b.json.tmp", "changes.jsonl.tmp"] {
        let root = TestRoot::new();
        let store = DocumentStore::default();
        store.save(&root.0, full_request("甲")).unwrap();
        let obstruction = root.0.join(filename);
        fs::create_dir(&obstruction).unwrap();
        assert!(store.save(&root.0, full_request("新正文")).unwrap_err().contains("无法创建临时文件"));
        assert_eq!(store.inner.cached_len(), 0);
        fs::remove_dir(&obstruction).unwrap();
        let expected = if filename == "changes.jsonl.tmp" { "新正文" } else { "甲" };
        assert_disk_cache_retry(&store, &root.0, expected);
    }
}

#[cfg(windows)]
#[test]
fn windows_real_exclusive_journal_handle_refuses_append_and_recovers() {
    use std::os::windows::fs::OpenOptionsExt;
    let root = TestRoot::new();
    let store = DocumentStore::default();
    store.save(&root.0, full_request("甲")).unwrap();
    let lock = fs::OpenOptions::new().read(true).share_mode(0).open(journal_path(&root.0)).unwrap();
    assert!(store.save(&root.0, delta()).unwrap_err().contains("无法打开增量日志"));
    assert_eq!(store.inner.cached_len(), 0);
    drop(lock);
    assert_disk_cache_retry(&store, &root.0, "甲");
}

#[cfg(windows)]
#[test]
fn windows_real_snapshot_replace_denial_preserves_previous_slot() {
    use std::os::windows::fs::OpenOptionsExt;
    for metadata in [false, true] {
        let root = TestRoot::new();
        let store = DocumentStore::default();
        store.save(&root.0, full_request("甲")).unwrap();
        let (content, meta) = snapshot_paths(&root.0, 'b');
        let blocked = if metadata { meta } else { content };
        fs::write(&blocked, b"incomplete inactive slot").unwrap();
        let lock = fs::OpenOptions::new().read(true).share_mode(0).open(&blocked).unwrap();
        assert!(store.save(&root.0, full_request("新正文")).unwrap_err().contains("无法替换旧快照"));
        assert_eq!(store.inner.cached_len(), 0);
        drop(lock);
        assert_disk_cache_retry(&store, &root.0, "甲");
    }
}

#[cfg(windows)]
#[test]
fn windows_case_alias_read_save_delete_never_observe_stale_cache() {
    let parent = TestRoot::new();
    let upper = parent.0.join("CaseDoc");
    let lower = parent.0.join("casedoc");
    fs::create_dir(&upper).unwrap();
    assert!(lower.exists(), "this test requires the default case-insensitive Windows directory");
    let store = DocumentStore::default();
    let mut request = full_request("首版");
    request.document_id = "CaseDoc".into();
    store.save(&upper, request).unwrap();
    assert_eq!(store.load(&lower, "casedoc".into()).unwrap().unwrap().content, "首版");
    let mut request = full_request("新版本");
    request.document_id = "CASEDOC".into();
    store.save(&lower, request).unwrap();
    assert_eq!(store.load(&upper, "CaseDoc".into()).unwrap().unwrap().content, "新版本");
    assert_eq!(store.inner.cached_len(), 1);
    store.delete(&lower, "casedoc").unwrap();
    assert!(store.load(&upper, "CaseDoc".into()).unwrap().is_none());
}

#[test]
fn case_spelling_eviction_keeps_distinct_directory_bodies_isolated() {
    // Distinct roots emulate case-sensitive directory identities without merging bodies.
    let first = TestRoot::new();
    let second = TestRoot::new();
    let store = DocumentStore::default();
    for (root, id, body) in [(&first.0, "CaseDoc", "甲"), (&second.0, "casedoc", "乙")] {
        let mut request = full_request(body);
        request.document_id = id.into();
        store.save(root, request).unwrap();
    }
    for (root, id, body) in [(&first.0, "CaseDoc", "甲"), (&second.0, "casedoc", "乙")] {
        assert_eq!(store.load(root, id.into()).unwrap().unwrap().content, body);
        assert_eq!(store.inner.cached_len(), 1);
    }
    store.delete(&first.0, "CaseDoc").unwrap();
    assert_eq!(store.load(&second.0, "casedoc".into()).unwrap().unwrap().content, "乙");
}

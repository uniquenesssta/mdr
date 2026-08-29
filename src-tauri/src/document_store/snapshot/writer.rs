//! Snapshot write ordering.
//!
//! Responsibility: write one full snapshot in the crash-safe order — content, then meta, then
//! reset the journal — always into the currently-inactive slot, and record the new slot on the
//! document. No slot-selection policy, hashing, meta parsing, or journal entry semantics — those
//! remain with their dedicated Stage 11 atomics.

use std::path::Path;

use super::metadata::build_snapshot_meta;
use super::slots::next_snapshot_slot;
use crate::document_store::{
    paths::{journal_path, snapshot_paths},
    repository::write_atomic,
    StoredDocument,
};

pub(in crate::document_store) fn write_snapshot(
    root: &Path,
    document: &mut StoredDocument,
) -> Result<(), String> {
    // 始终写入非当前槽位。这样写入中断时，当前完整快照仍可与
    // 尚未清空的增量日志一起恢复，不能简单按版本奇偶覆盖当前槽。
    let slot = next_snapshot_slot(document.snapshot_slot);
    let (content_path, meta_path) = snapshot_paths(root, slot);
    let meta = build_snapshot_meta(
        document.version,
        document.title.clone(),
        document.updated_at,
        &document.content,
    );
    write_atomic(&content_path, document.content.as_bytes())?;
    let meta_bytes =
        serde_json::to_vec(&meta).map_err(|err| format!("无法序列化快照信息：{err}"))?;
    write_atomic(&meta_path, &meta_bytes)?;
    document.snapshot_slot = Some(slot);
    write_atomic(&journal_path(root), b"")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document_store::snapshot::metadata::parse_snapshot_meta;

    fn test_root(name: &str) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("markdown-editor-writer-{name}-{nonce}"));
        std::fs::create_dir_all(&root).unwrap();
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
    fn write_snapshot_targets_the_inactive_slot_and_records_it() {
        let root = test_root("targets-inactive");
        let mut document = stored("第一版", 1);
        write_snapshot(&root, &mut document).unwrap();
        assert_eq!(document.snapshot_slot, Some('a'));
        document.content = "第二版".into();
        document.version = 2;
        write_snapshot(&root, &mut document).unwrap();
        assert_eq!(document.snapshot_slot, Some('b'));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn write_snapshot_leaves_the_previous_slot_untouched_for_crash_recovery() {
        let root = test_root("previous-slot-intact");
        let mut document = stored("第一版", 1);
        write_snapshot(&root, &mut document).unwrap();
        let (content_path_a, meta_path_a) = snapshot_paths(&root, 'a');
        document.content = "第二版".into();
        document.version = 2;
        write_snapshot(&root, &mut document).unwrap();

        assert_eq!(std::fs::read_to_string(&content_path_a).unwrap(), "第一版");
        let meta_a = parse_snapshot_meta(&std::fs::read(&meta_path_a).unwrap()).unwrap();
        assert_eq!(meta_a.version, 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn write_snapshot_resets_the_journal_after_a_full_snapshot() {
        let root = test_root("resets-journal");
        std::fs::write(journal_path(&root), b"stale-journal-bytes").unwrap();
        let mut document = stored("内容", 1);
        write_snapshot(&root, &mut document).unwrap();
        assert!(std::fs::read(journal_path(&root)).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
}

//! Recovery-message assembly and safe-snapshot rebuild.
//!
//! Responsibility: turn accumulated integrity notes (from snapshot loading or journal replay)
//! into the exact user-facing recovery message, mark the document recovered, rebuild a safe
//! snapshot when notes exist, and otherwise persist a journal truncated to its valid prefix. No
//! journal parsing/version-chain validation or snapshot slot/write policy — those remain with
//! `replay` and `snapshot`.

use std::path::Path;

use super::replay::JournalReplay;
use crate::document_store::{
    paths::journal_path, repository::write_atomic, snapshot::write_snapshot, StoredDocument,
};

pub(in crate::document_store) fn recover_from_snapshot_notes(
    root: &Path,
    document: &mut StoredDocument,
    notes: &[String],
) -> Result<(), String> {
    if notes.is_empty() {
        return Ok(());
    }
    document.recovered = true;
    document.recovery_message = Some(format!(
        "检测到存储异常，已从可用快照恢复到版本 {}：{}",
        document.version,
        notes.join("；")
    ));
    write_snapshot(root, document)
}

pub(in crate::document_store) fn recover_from_journal_replay(
    root: &Path,
    document: &mut StoredDocument,
    original_journal_bytes: &[u8],
    replay: JournalReplay,
) -> Result<(), String> {
    if !replay.notes.is_empty() {
        document.recovered = true;
        document.recovery_message = Some(format!(
            "检测到存储异常，已恢复到版本 {}：{}",
            document.version,
            replay.notes.join("；")
        ));
        // 将已经验证的连续增量折叠为新快照，并清空损坏尾部，避免后续保存
        // 继续追加到无法重放的日志之后。
        write_snapshot(root, document)?;
        document.journal_entries = 0;
        document.journal_bytes = 0;
    } else if replay.stale_entries || replay.valid_journal != original_journal_bytes {
        write_atomic(&journal_path(root), &replay.valid_journal)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("markdown-editor-journal-recovery-{name}-{nonce}"));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn stored(content: &str, version: u64) -> StoredDocument {
        StoredDocument {
            title: "测试.md".into(),
            content: content.into(),
            version,
            updated_at: version,
            journal_entries: 3,
            journal_bytes: 30,
            snapshot_slot: None,
            recovered: false,
            recovery_message: None,
            index: None,
        }
    }

    #[test]
    fn recover_from_snapshot_notes_is_a_no_op_when_there_are_no_notes() {
        let root = test_root("snapshot-noop");
        let mut document = stored("内容", 1);
        recover_from_snapshot_notes(&root, &mut document, &[]).unwrap();
        assert!(!document.recovered);
        assert!(document.recovery_message.is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recover_from_snapshot_notes_marks_recovered_and_rebuilds_a_snapshot() {
        let root = test_root("snapshot-recovers");
        let mut document = stored("内容", 4);
        recover_from_snapshot_notes(&root, &mut document, &["A 槽快照校验失败".to_string()])
            .unwrap();
        assert!(document.recovered);
        assert_eq!(
            document.recovery_message.as_deref(),
            Some("检测到存储异常，已从可用快照恢复到版本 4：A 槽快照校验失败")
        );
        assert_eq!(document.snapshot_slot, Some('a'));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recover_from_journal_replay_is_a_no_op_when_the_journal_was_already_canonical() {
        let root = test_root("journal-noop");
        let mut document = stored("内容", 1);
        let bytes = b"{}".to_vec();
        let replay = JournalReplay {
            notes: Vec::new(),
            stale_entries: false,
            valid_journal: bytes.clone(),
        };
        recover_from_journal_replay(&root, &mut document, &bytes, replay).unwrap();
        assert!(!document.recovered);
        assert_eq!(document.journal_entries, 3);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recover_from_journal_replay_persists_the_truncated_prefix_when_stale_without_notes() {
        let root = test_root("journal-truncate");
        let mut document = stored("内容", 1);
        let original = b"stale-line\nvalid-line\n".to_vec();
        let replay = JournalReplay {
            notes: Vec::new(),
            stale_entries: true,
            valid_journal: b"valid-line\n".to_vec(),
        };
        recover_from_journal_replay(&root, &mut document, &original, replay).unwrap();
        assert!(!document.recovered);
        assert_eq!(std::fs::read(journal_path(&root)).unwrap(), b"valid-line\n");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recover_from_journal_replay_marks_recovered_rebuilds_snapshot_and_resets_journal_counters() {
        let root = test_root("journal-recovers");
        let mut document = stored("内容", 2);
        let replay = JournalReplay {
            notes: vec!["增量日志版本链不连续".to_string()],
            stale_entries: false,
            valid_journal: Vec::new(),
        };
        recover_from_journal_replay(&root, &mut document, b"garbage", replay).unwrap();
        assert!(document.recovered);
        assert_eq!(
            document.recovery_message.as_deref(),
            Some("检测到存储异常，已恢复到版本 2：增量日志版本链不连续")
        );
        assert_eq!(document.journal_entries, 0);
        assert_eq!(document.journal_bytes, 0);
        assert_eq!(document.snapshot_slot, Some('a'));
        std::fs::remove_dir_all(root).unwrap();
    }
}

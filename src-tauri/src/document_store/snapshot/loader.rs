//! Two-slot snapshot loading.
//!
//! Responsibility: read and validate both snapshot slots, then hand back whichever is active
//! (by `select_active_slot`'s version preference) plus notes for any slot that existed but
//! failed integrity validation. No journal replay, recovery-message assembly, or write/fsync
//! policy — those remain with their dedicated Stage 11 atomics.

use std::{fs, path::Path};

use super::integrity::content_integrity_valid;
use super::metadata::parse_snapshot_meta;
use super::slots::select_active_slot;
use crate::document_store::{paths::snapshot_paths, StoredDocument};

pub(in crate::document_store) struct LoadedSnapshots {
    pub(in crate::document_store) document: Option<StoredDocument>,
    pub(in crate::document_store) notes: Vec<String>,
}

fn read_snapshot(root: &Path, slot: char) -> Option<StoredDocument> {
    let (content_path, meta_path) = snapshot_paths(root, slot);
    let meta = parse_snapshot_meta(&fs::read(meta_path).ok()?)?;
    let content = fs::read_to_string(content_path).ok()?;
    if !content_integrity_valid(&content, meta.content_bytes, &meta.content_hash) {
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

pub(in crate::document_store) fn load_active_snapshot(root: &Path) -> LoadedSnapshots {
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
    let mut notes = Vec::new();
    if a_exists && snapshot_a.is_none() {
        notes.push("A 槽快照校验失败".to_string());
    }
    if b_exists && snapshot_b.is_none() {
        notes.push("B 槽快照校验失败".to_string());
    }
    let document = select_active_slot(snapshot_a, snapshot_b, |item| item.version);
    LoadedSnapshots { document, notes }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document_store::repository::write_atomic;
    use crate::document_store::snapshot::metadata::build_snapshot_meta;
    use crate::document_store::snapshot::slots::next_snapshot_slot;

    fn test_root(name: &str) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("markdown-editor-loader-{name}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn write_slot(root: &Path, slot: char, version: u64, content: &str) {
        let (content_path, meta_path) = snapshot_paths(root, slot);
        let meta = build_snapshot_meta(version, "测试.md".into(), version, content);
        write_atomic(&content_path, content.as_bytes()).unwrap();
        write_atomic(&meta_path, &serde_json::to_vec(&meta).unwrap()).unwrap();
    }

    #[test]
    fn load_active_snapshot_returns_none_and_no_notes_when_nothing_exists() {
        let root = test_root("empty");
        let loaded = load_active_snapshot(&root);
        assert!(loaded.document.is_none());
        assert!(loaded.notes.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn load_active_snapshot_prefers_the_higher_version_slot() {
        let root = test_root("prefer-higher");
        write_slot(&root, 'a', 1, "旧内容");
        write_slot(&root, 'b', 2, "新内容");
        let loaded = load_active_snapshot(&root);
        let document = loaded.document.unwrap();
        assert_eq!(document.content, "新内容");
        assert_eq!(document.version, 2);
        assert!(loaded.notes.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn load_active_snapshot_falls_back_and_notes_the_corrupt_slot() {
        let root = test_root("fallback-note");
        write_slot(&root, 'a', 1, "旧内容");
        write_slot(&root, 'b', 2, "新内容");
        let (latest_content, _) = snapshot_paths(&root, 'b');
        fs::write(latest_content, "损坏").unwrap();

        let loaded = load_active_snapshot(&root);
        let document = loaded.document.unwrap();
        assert_eq!(document.content, "旧内容");
        assert_eq!(document.version, 1);
        assert_eq!(loaded.notes, vec!["B 槽快照校验失败".to_string()]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn load_active_snapshot_none_document_with_notes_signals_both_slots_corrupt() {
        let root = test_root("both-corrupt");
        write_slot(&root, 'a', 1, "内容");
        let (content_path, _) = snapshot_paths(&root, 'a');
        fs::write(content_path, "损坏").unwrap();

        let loaded = load_active_snapshot(&root);
        assert!(loaded.document.is_none());
        assert_eq!(loaded.notes, vec!["A 槽快照校验失败".to_string()]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn load_active_snapshot_survives_a_slot_written_via_the_real_next_slot_rotation() {
        let root = test_root("rotation");
        let slot = next_snapshot_slot(None);
        write_slot(&root, slot, 1, "轮换后的内容");
        let loaded = load_active_snapshot(&root);
        assert_eq!(loaded.document.unwrap().content, "轮换后的内容");
        fs::remove_dir_all(root).unwrap();
    }
}

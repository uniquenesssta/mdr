//! Journal file append.
//!
//! Responsibility: durably append one encoded journal-entry record to the document's journal
//! file — create it if missing, append, then fsync. No entry encoding, version-chain validation,
//! or replay policy — those remain with `entry` and the dedicated R11-09 Replay/Recovery atomic.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

use super::entry::encode_journal_entry;
use crate::document_store::{paths::journal_path, types::JournalEntry};

pub(in crate::document_store) fn append_journal(
    root: &Path,
    entry: &JournalEntry,
) -> Result<u64, String> {
    let encoded = encode_journal_entry(entry)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document_store::types::DocumentTransaction;
    use std::fs;

    fn test_root(name: &str) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("markdown-editor-journal-append-{name}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn entry(base_version: u64, next_version: u64) -> JournalEntry {
        JournalEntry {
            base_version,
            next_version,
            title: "测试.md".into(),
            updated_at: next_version,
            transactions: vec![DocumentTransaction { changes: vec![] }],
        }
    }

    #[test]
    fn append_journal_creates_the_file_when_missing_and_returns_encoded_byte_length() {
        let root = test_root("creates-missing");
        let written = append_journal(&root, &entry(0, 1)).unwrap();
        let bytes = fs::read(journal_path(&root)).unwrap();
        assert_eq!(written, bytes.len() as u64);
        assert!(bytes.ends_with(b"\n"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn append_journal_appends_subsequent_entries_in_call_order_without_truncating() {
        let root = test_root("appends-in-order");
        append_journal(&root, &entry(0, 1)).unwrap();
        append_journal(&root, &entry(1, 2)).unwrap();
        let bytes = fs::read(journal_path(&root)).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains(r#""baseVersion":0"#));
        assert!(lines[1].contains(r#""baseVersion":1"#));
        fs::remove_dir_all(root).unwrap();
    }
}

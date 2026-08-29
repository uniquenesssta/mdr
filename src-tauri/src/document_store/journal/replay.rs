//! Journal replay.
//!
//! Responsibility: apply document transactions to in-memory content, and walk one document's raw
//! journal bytes line by line — parsing, validating the base/next version chain, applying each
//! valid entry to a loaded snapshot, and stopping at the first entry that breaks the chain. No
//! recovery-message assembly or snapshot rebuild — those remain with `recovery`.

use crate::document_store::{
    types::{DocumentTransaction, JournalEntry},
    validation::transaction_byte_range,
    StoredDocument,
};

pub(in crate::document_store) fn apply_transactions(
    content: &mut String,
    transactions: &[DocumentTransaction],
) -> Result<(), String> {
    for transaction in transactions {
        let mut changes = transaction.changes.clone();
        changes.sort_by(|left, right| right.from.cmp(&left.from));
        for change in changes {
            let range = transaction_byte_range(content, change.from, change.to)?;
            content.replace_range(range, &change.insert);
        }
    }
    Ok(())
}

pub(in crate::document_store) struct JournalReplay {
    pub(in crate::document_store) notes: Vec<String>,
    pub(in crate::document_store) stale_entries: bool,
    pub(in crate::document_store) valid_journal: Vec<u8>,
}

/// `notes` seeds any recovery notes already raised while loading the snapshot (e.g. one
/// corrupt slot) — replay notes are appended to it, so a document that had a bad slot but a
/// clean journal still reports the earlier note and is recovered the same way the pre-Stage-11
/// implementation did.
pub(in crate::document_store) fn replay_journal(
    document: &mut StoredDocument,
    bytes: &[u8],
    mut notes: Vec<String>,
) -> JournalReplay {
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
        cursor = if relative_end < bytes.len() {
            relative_end + 1
        } else {
            bytes.len()
        };
        if raw.iter().all(|byte| byte.is_ascii_whitespace()) {
            continue;
        }
        let line = match std::str::from_utf8(raw) {
            Ok(line) => line.trim_end_matches('\r'),
            Err(_) => {
                notes.push("增量日志尾部包含无效 UTF-8 数据".to_string());
                break;
            }
        };
        let entry: JournalEntry = match serde_json::from_str(line) {
            Ok(entry) => entry,
            Err(_) => {
                notes.push("增量日志包含未完整写入的记录".to_string());
                break;
            }
        };
        if entry.next_version <= document.version {
            stale_entries = true;
            continue;
        }
        if entry.base_version != document.version {
            notes.push("增量日志版本链不连续".to_string());
            break;
        }

        let mut next_content = document.content.clone();
        if let Err(error) = apply_transactions(&mut next_content, &entry.transactions) {
            notes.push(format!("增量日志文本范围无效：{error}"));
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
    JournalReplay {
        notes,
        stale_entries,
        valid_journal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document_store::types::TextChange;

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

    fn entry_bytes(base_version: u64, next_version: u64, insert: &str) -> Vec<u8> {
        let entry = JournalEntry {
            base_version,
            next_version,
            title: "测试.md".into(),
            updated_at: next_version,
            transactions: vec![DocumentTransaction {
                changes: vec![TextChange {
                    from: 0,
                    to: 0,
                    insert: insert.into(),
                }],
            }],
        };
        let mut encoded = serde_json::to_vec(&entry).unwrap();
        encoded.push(b'\n');
        encoded
    }

    #[test]
    fn replay_journal_applies_a_continuous_chain_and_reports_no_notes() {
        let mut document = stored("甲", 1);
        let mut bytes = entry_bytes(1, 2, "乙");
        bytes.extend(entry_bytes(2, 3, "丙"));
        let replay = replay_journal(&mut document, &bytes, Vec::new());
        assert!(replay.notes.is_empty());
        assert!(!replay.stale_entries);
        assert_eq!(document.content, "丙乙甲");
        assert_eq!(document.version, 3);
        assert_eq!(document.journal_entries, 2);
        assert_eq!(replay.valid_journal, bytes);
        assert_eq!(document.journal_bytes, bytes.len() as u64);
    }

    #[test]
    fn replay_journal_skips_stale_entries_already_folded_into_the_snapshot() {
        let mut document = stored("甲", 2);
        let bytes = entry_bytes(1, 2, "乙");
        let replay = replay_journal(&mut document, &bytes, Vec::new());
        assert!(replay.stale_entries);
        assert!(replay.notes.is_empty());
        assert_eq!(document.content, "甲");
        assert_eq!(document.version, 2);
        assert!(replay.valid_journal.is_empty());
    }

    #[test]
    fn replay_journal_stops_at_a_broken_version_chain_and_notes_it() {
        let mut document = stored("甲", 1);
        let bytes = entry_bytes(5, 6, "乙");
        let replay = replay_journal(&mut document, &bytes, Vec::new());
        assert_eq!(replay.notes, vec!["增量日志版本链不连续".to_string()]);
        assert_eq!(document.version, 1);
        assert!(replay.valid_journal.is_empty());
    }

    #[test]
    fn replay_journal_stops_at_a_truncated_trailing_record() {
        let mut document = stored("甲", 1);
        let mut bytes = entry_bytes(1, 2, "乙");
        bytes.extend_from_slice(b"{\"baseVersion\":2");
        let replay = replay_journal(&mut document, &bytes, Vec::new());
        assert_eq!(
            replay.notes,
            vec!["增量日志包含未完整写入的记录".to_string()]
        );
        assert_eq!(document.version, 2);
        assert_eq!(document.content, "乙甲");
        assert_eq!(replay.valid_journal, entry_bytes(1, 2, "乙"));
    }

    #[test]
    fn replay_journal_carries_forward_notes_seeded_from_snapshot_loading() {
        let mut document = stored("甲", 1);
        let bytes = entry_bytes(1, 2, "乙");
        let seeded = vec!["B 槽快照校验失败".to_string()];
        let replay = replay_journal(&mut document, &bytes, seeded);
        assert_eq!(replay.notes, vec!["B 槽快照校验失败".to_string()]);
        assert_eq!(document.version, 2);
    }
}

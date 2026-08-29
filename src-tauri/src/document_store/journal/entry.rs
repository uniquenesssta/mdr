//! Journal entry byte encoding.
//!
//! Responsibility: encode one `JournalEntry` into its canonical newline-terminated JSON byte
//! record, unchanged from the pre-Stage-11 wire format. No file IO, version-chain validation, or
//! replay policy — those remain with `append` and the dedicated R11-09 Replay/Recovery atomic.

use crate::document_store::types::JournalEntry;

pub(in crate::document_store) fn encode_journal_entry(
    entry: &JournalEntry,
) -> Result<Vec<u8>, String> {
    let mut encoded =
        serde_json::to_vec(entry).map_err(|err| format!("无法序列化增量日志：{err}"))?;
    encoded.push(b'\n');
    Ok(encoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document_store::types::{DocumentTransaction, TextChange};

    fn entry() -> JournalEntry {
        JournalEntry {
            base_version: 3,
            next_version: 4,
            title: "标题😀.md".into(),
            updated_at: 99,
            transactions: vec![DocumentTransaction {
                changes: vec![TextChange {
                    from: 1,
                    to: 3,
                    insert: "中".into(),
                }],
            }],
        }
    }

    #[test]
    fn encode_journal_entry_keeps_the_exact_camel_case_json_and_trailing_newline() {
        let encoded = encode_journal_entry(&entry()).unwrap();
        assert!(encoded.ends_with(b"\n"));
        let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(
            line,
            r#"{"baseVersion":3,"nextVersion":4,"title":"标题😀.md","updatedAt":99,"transactions":[{"changes":[{"from":1,"to":3,"insert":"中"}]}]}"#
        );
        assert_eq!(line.matches('\n').count(), 0);
    }

    #[test]
    fn encode_journal_entry_is_deterministic_across_repeated_calls() {
        assert_eq!(
            encode_journal_entry(&entry()).unwrap(),
            encode_journal_entry(&entry()).unwrap()
        );
    }
}

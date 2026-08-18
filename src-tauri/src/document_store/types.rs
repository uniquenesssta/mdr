//! Serde-backed document-store DTO definitions.
//!
//! Responsibility: own request, response, and persisted JSON shapes plus their serde annotations.
//! Allowed dependencies: serde only. Forbidden here: file IO, Tauri commands, store state, recovery,
//! validation policy, or indexing behavior. This module is pure and owns no runtime state or side effects.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHeading {
    pub(super) id: String,
    pub(super) level: u8,
    pub(super) text: String,
    pub(super) line: usize,
    pub(super) position: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextChange {
    pub(super) from: usize,
    pub(super) to: usize,
    pub(super) insert: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTransaction {
    pub(super) changes: Vec<TextChange>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentRequest {
    pub(super) document_id: String,
    pub(super) title: String,
    pub(super) base_version: u64,
    pub(super) next_version: u64,
    pub(super) full_content: Option<String>,
    #[serde(default)]
    pub(super) transactions: Vec<DocumentTransaction>,
    pub(super) updated_at: u64,
    #[serde(default)]
    pub(super) force_snapshot: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentResponse {
    pub(super) document_id: String,
    pub(super) version: u64,
    pub(super) content_bytes: usize,
    pub(super) snapshot_created: bool,
    pub(super) journal_entries: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedDocument {
    pub(super) document_id: String,
    pub(super) title: String,
    pub(super) content: String,
    pub(super) version: u64,
    pub(super) updated_at: u64,
    pub(super) recovered: bool,
    pub(super) recovery_message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentManifest {
    pub(super) document_id: String,
    pub(super) title: String,
    pub(super) version: u64,
    pub(super) updated_at: u64,
    pub(super) content_bytes: usize,
    pub(super) text_length: usize,
    pub(super) line_count: usize,
    pub(super) non_whitespace_count: usize,
    pub(super) headings: Vec<NativeHeading>,
    pub(super) recovered: bool,
    pub(super) recovery_message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChunk {
    pub(super) document_id: String,
    pub(super) byte_offset: usize,
    pub(super) next_byte_offset: usize,
    pub(super) total_bytes: usize,
    pub(super) content: String,
    pub(super) done: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDocumentRequest {
    pub(super) document_id: String,
    pub(super) query: String,
    #[serde(default)]
    pub(super) from: usize,
    #[serde(default = "default_true")]
    pub(super) wrap: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDocumentResponse {
    pub(super) from: usize,
    pub(super) to: usize,
    pub(super) wrapped: bool,
    pub(super) version: u64,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct JournalEntry {
    pub(super) base_version: u64,
    pub(super) next_version: u64,
    pub(super) title: String,
    pub(super) updated_at: u64,
    pub(super) transactions: Vec<DocumentTransaction>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SnapshotMeta {
    pub(super) version: u64,
    pub(super) title: String,
    pub(super) updated_at: u64,
    pub(super) content_bytes: usize,
    pub(super) content_hash: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_request_json_contract_keeps_camel_case_and_defaults() {
        let request: SaveDocumentRequest = serde_json::from_str(
            r#"{"documentId":"doc_1","title":"中文😀.md","baseVersion":3,"nextVersion":4,"fullContent":null,"updatedAt":99}"#,
        )
        .unwrap();

        assert_eq!(request.document_id, "doc_1");
        assert_eq!(request.title, "中文😀.md");
        assert_eq!(request.base_version, 3);
        assert_eq!(request.next_version, 4);
        assert_eq!(request.full_content, None);
        assert!(request.transactions.is_empty());
        assert_eq!(request.updated_at, 99);
        assert!(!request.force_snapshot);
    }

    #[test]
    fn search_request_json_contract_keeps_defaults() {
        let request: SearchDocumentRequest =
            serde_json::from_str(r#"{"documentId":"doc_2","query":"😀中文"}"#).unwrap();

        assert_eq!(request.document_id, "doc_2");
        assert_eq!(request.query, "😀中文");
        assert_eq!(request.from, 0);
        assert!(request.wrap);
    }

    #[test]
    fn response_json_snapshots_remain_exact() {
        let heading = NativeHeading {
            id: "native-h-1-2-abcd".into(),
            level: 2,
            text: "标题😀".into(),
            line: 1,
            position: 0,
        };
        assert_eq!(
            serde_json::to_string(&heading).unwrap(),
            r#"{"id":"native-h-1-2-abcd","level":2,"text":"标题😀","line":1,"position":0}"#
        );
        assert_eq!(
            serde_json::to_string(&SaveDocumentResponse {
                document_id: "doc_1".into(),
                version: 4,
                content_bytes: 12,
                snapshot_created: true,
                journal_entries: 0,
            })
            .unwrap(),
            r#"{"documentId":"doc_1","version":4,"contentBytes":12,"snapshotCreated":true,"journalEntries":0}"#
        );
        assert_eq!(
            serde_json::to_string(&LoadedDocument {
                document_id: "doc_1".into(),
                title: "标题😀.md".into(),
                content: "正文😀".into(),
                version: 4,
                updated_at: 99,
                recovered: true,
                recovery_message: Some("恢复".into()),
            })
            .unwrap(),
            r#"{"documentId":"doc_1","title":"标题😀.md","content":"正文😀","version":4,"updatedAt":99,"recovered":true,"recoveryMessage":"恢复"}"#
        );
        assert_eq!(
            serde_json::to_string(&DocumentManifest {
                document_id: "doc_1".into(),
                title: "标题😀.md".into(),
                version: 4,
                updated_at: 99,
                content_bytes: 12,
                text_length: 4,
                line_count: 2,
                non_whitespace_count: 3,
                headings: vec![heading],
                recovered: false,
                recovery_message: None,
            })
            .unwrap(),
            r#"{"documentId":"doc_1","title":"标题😀.md","version":4,"updatedAt":99,"contentBytes":12,"textLength":4,"lineCount":2,"nonWhitespaceCount":3,"headings":[{"id":"native-h-1-2-abcd","level":2,"text":"标题😀","line":1,"position":0}],"recovered":false,"recoveryMessage":null}"#
        );
        assert_eq!(
            serde_json::to_string(&DocumentChunk {
                document_id: "doc_1".into(),
                byte_offset: 0,
                next_byte_offset: 12,
                total_bytes: 12,
                content: "正文😀".into(),
                done: true,
            })
            .unwrap(),
            r#"{"documentId":"doc_1","byteOffset":0,"nextByteOffset":12,"totalBytes":12,"content":"正文😀","done":true}"#
        );
        assert_eq!(
            serde_json::to_string(&SearchDocumentResponse {
                from: 2,
                to: 4,
                wrapped: false,
                version: 4,
            })
            .unwrap(),
            r#"{"from":2,"to":4,"wrapped":false,"version":4}"#
        );
    }

    #[test]
    fn persistence_json_snapshots_remain_exact() {
        let entry = JournalEntry {
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
        };
        assert_eq!(
            serde_json::to_string(&entry).unwrap(),
            r#"{"baseVersion":3,"nextVersion":4,"title":"标题😀.md","updatedAt":99,"transactions":[{"changes":[{"from":1,"to":3,"insert":"中"}]}]}"#
        );

        let meta = SnapshotMeta {
            version: 4,
            title: "标题😀.md".into(),
            updated_at: 99,
            content_bytes: 12,
            content_hash: "0123456789abcdef".into(),
        };
        assert_eq!(
            serde_json::to_string(&meta).unwrap(),
            r#"{"version":4,"title":"标题😀.md","updatedAt":99,"contentBytes":12,"contentHash":"0123456789abcdef"}"#
        );
    }
}

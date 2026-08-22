//! Snapshot metadata construction and parsing.
//!
//! Responsibility: build a `SnapshotMeta` from already-known document fields plus its computed
//! byte count and content hash (via `integrity`), and parse persisted meta bytes back into
//! `SnapshotMeta`. No file IO, slot selection, or recovery/journal policy.

use super::integrity::fnv1a64;
use crate::document_store::types::SnapshotMeta;

pub(in crate::document_store) fn build_snapshot_meta(
    version: u64,
    title: String,
    updated_at: u64,
    content: &str,
) -> SnapshotMeta {
    SnapshotMeta::new(
        version,
        title,
        updated_at,
        content.len(),
        fnv1a64(content.as_bytes()),
    )
}

pub(in crate::document_store) fn parse_snapshot_meta(bytes: &[u8]) -> Option<SnapshotMeta> {
    serde_json::from_slice(bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_snapshot_meta_computes_byte_count_and_hash_from_content() {
        let content = "甲😀乙";
        let meta = build_snapshot_meta(4, "测试.md".into(), 99, content);
        assert_eq!(meta.version, 4);
        assert_eq!(meta.title, "测试.md");
        assert_eq!(meta.updated_at, 99);
        assert_eq!(meta.content_bytes, content.len());
        assert_eq!(meta.content_hash, fnv1a64(content.as_bytes()));
    }

    #[test]
    fn parse_snapshot_meta_round_trips_serialized_bytes() {
        let meta = build_snapshot_meta(1, "a.md".into(), 1, "内容");
        let bytes = serde_json::to_vec(&meta).unwrap();
        let parsed = parse_snapshot_meta(&bytes).unwrap();
        assert_eq!(parsed.version, meta.version);
        assert_eq!(parsed.content_hash, meta.content_hash);
    }

    #[test]
    fn parse_snapshot_meta_rejects_invalid_json() {
        assert!(parse_snapshot_meta(b"not json").is_none());
    }
}

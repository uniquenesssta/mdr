//! Document index construction.
//!
//! Responsibility: build the full `DocumentIndex` from document content — sparse UTF-16
//! checkpoints for byte<->UTF-16 mapping, ATX headings found outside fenced code, total UTF-16
//! length, line count, and non-whitespace count — and lazily cache it on a `StoredDocument`. No
//! UTF-16<->byte lookup or search — those remain with the dedicated R11-11 atomic.

use super::headings::{fence_marker, heading_id, parse_atx_heading};
use crate::document_store::{types::NativeHeading, StoredDocument};

const INDEX_CHECKPOINT_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Default)]
pub(in crate::document_store) struct DocumentIndex {
    pub(in crate::document_store) checkpoints: Vec<IndexCheckpoint>,
    pub(in crate::document_store) headings: Vec<NativeHeading>,
    pub(in crate::document_store) utf16_length: usize,
    pub(in crate::document_store) line_count: usize,
    pub(in crate::document_store) non_whitespace_count: usize,
}

#[derive(Clone, Debug)]
pub(in crate::document_store) struct IndexCheckpoint {
    pub(in crate::document_store) byte_offset: usize,
    pub(in crate::document_store) utf16_offset: usize,
}

pub(in crate::document_store) fn build_document_index(content: &str) -> DocumentIndex {
    let mut checkpoints = vec![IndexCheckpoint {
        byte_offset: 0,
        utf16_offset: 0,
    }];
    let mut utf16_offset = 0usize;
    let mut non_whitespace_count = 0usize;
    let mut next_checkpoint = INDEX_CHECKPOINT_BYTES;

    for (byte_offset, ch) in content.char_indices() {
        if byte_offset >= next_checkpoint {
            checkpoints.push(IndexCheckpoint {
                byte_offset,
                utf16_offset,
            });
            next_checkpoint = byte_offset.saturating_add(INDEX_CHECKPOINT_BYTES);
        }
        utf16_offset += ch.len_utf16();
        if !ch.is_whitespace() {
            non_whitespace_count += 1;
        }
    }
    if checkpoints.last().map(|item| item.byte_offset) != Some(content.len()) {
        checkpoints.push(IndexCheckpoint {
            byte_offset: content.len(),
            utf16_offset,
        });
    }

    let mut headings = Vec::new();
    let mut line_number = 1usize;
    let mut line_start_utf16 = 0usize;
    let mut active_fence: Option<(char, usize)> = None;
    for raw_line in content.split_inclusive('\n') {
        let line = raw_line.trim_end_matches('\n').trim_end_matches('\r');
        if let Some((marker, count)) = fence_marker(line) {
            match active_fence {
                Some((active_marker, active_count))
                    if active_marker == marker && count >= active_count =>
                {
                    active_fence = None;
                }
                None => active_fence = Some((marker, count)),
                _ => {}
            }
        } else if active_fence.is_none() {
            if let Some((level, text)) = parse_atx_heading(line) {
                headings.push(NativeHeading {
                    id: heading_id(line_number, level, &text),
                    level,
                    text,
                    line: line_number,
                    position: line_start_utf16,
                });
            }
        }
        line_start_utf16 += raw_line.encode_utf16().count();
        line_number += 1;
    }

    DocumentIndex {
        checkpoints,
        headings,
        utf16_length: utf16_offset,
        line_count: content.bytes().filter(|byte| *byte == b'\n').count() + 1,
        non_whitespace_count,
    }
}

pub(in crate::document_store) fn ensure_document_index(
    document: &mut StoredDocument,
) -> &DocumentIndex {
    if document.index.is_none() {
        document.index = Some(build_document_index(&document.content));
    }
    document.index.as_ref().expect("document index initialized")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_document_index_finds_headings_outside_fences_and_counts_lines_and_length() {
        let content = "# 标题😀\n正文\n```md\n# 代码标题\n```\n## 第二节\n";
        let index = build_document_index(content);
        assert_eq!(index.line_count, 7);
        assert_eq!(index.headings.len(), 2);
        assert_eq!(index.headings[0].line, 1);
        assert_eq!(index.headings[0].level, 1);
        assert_eq!(index.headings[0].text, "标题😀");
        assert_eq!(index.headings[1].line, 6);
        assert_eq!(index.headings[1].level, 2);
        assert_eq!(index.utf16_length, content.encode_utf16().count());
    }

    #[test]
    fn build_document_index_counts_non_whitespace_and_scatters_checkpoints_past_the_threshold() {
        let content = format!("{}\n非 空白", "甲".repeat(40_000));
        let index = build_document_index(&content);
        assert!(index.checkpoints.len() > 1);
        assert!(index.non_whitespace_count >= 40_003);
    }

    #[test]
    fn ensure_document_index_builds_once_and_caches_on_the_document() {
        let mut document = StoredDocument {
            content: "# 标题\n正文".into(),
            ..StoredDocument::default()
        };
        assert!(document.index.is_none());
        let first = ensure_document_index(&mut document).clone();
        assert!(document.index.is_some());
        let second = ensure_document_index(&mut document);
        assert_eq!(first.line_count, second.line_count);
        assert_eq!(first.headings.len(), second.headings.len());
    }
}

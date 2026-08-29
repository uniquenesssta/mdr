//! Query search within already-loaded document content.
//!
//! Responsibility: locate one query match starting from a UTF-16 offset, optionally wrapping to
//! the start of the document when nothing is found in the forward scan, and report the match's
//! UTF-16 range. No document loading, caching, or UTF-16<->byte conversion policy itself — those
//! remain with the store orchestration and `utf16`.

use super::builder::DocumentIndex;
use super::utf16::{index_byte_to_utf16, index_utf16_to_byte};

pub(in crate::document_store) struct DocumentSearchMatch {
    pub(in crate::document_store) from: usize,
    pub(in crate::document_store) to: usize,
    pub(in crate::document_store) wrapped: bool,
}

pub(in crate::document_store) fn search_document_content(
    content: &str,
    index: &DocumentIndex,
    query: &str,
    from: usize,
    wrap: bool,
) -> Result<Option<DocumentSearchMatch>, String> {
    let start = from.min(index.utf16_length);
    let start_byte = index_utf16_to_byte(content, index, start)?;
    let mut wrapped = false;
    let found_byte = content[start_byte..]
        .find(query)
        .map(|relative| start_byte + relative)
        .or_else(|| {
            if wrap && start_byte > 0 {
                wrapped = true;
                content[..start_byte].find(query)
            } else {
                None
            }
        });
    let Some(found_byte) = found_byte else {
        return Ok(None);
    };
    let from = index_byte_to_utf16(content, index, found_byte)?;
    let to = from + query.encode_utf16().count();
    Ok(Some(DocumentSearchMatch { from, to, wrapped }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document_store::index::build_document_index;

    #[test]
    fn finds_the_first_match_at_or_after_the_requested_utf16_offset() {
        let content = "甲乙甲丙";
        let index = build_document_index(content);
        let found = search_document_content(content, &index, "甲", 1, true)
            .unwrap()
            .unwrap();
        assert_eq!(found.from, 2);
        assert_eq!(found.to, 3);
        assert!(!found.wrapped);
    }

    #[test]
    fn wraps_to_the_start_when_nothing_matches_after_the_offset_and_wrap_is_enabled() {
        let content = "甲乙丙";
        let index = build_document_index(content);
        let found = search_document_content(content, &index, "甲", 1, true)
            .unwrap()
            .unwrap();
        assert_eq!(found.from, 0);
        assert!(found.wrapped);
    }

    #[test]
    fn does_not_wrap_when_wrap_is_disabled() {
        let content = "甲乙丙";
        let index = build_document_index(content);
        let found = search_document_content(content, &index, "甲", 1, false).unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn reports_no_match_when_the_query_is_absent_even_with_wrap_enabled() {
        let content = "甲乙丙";
        let index = build_document_index(content);
        let found = search_document_content(content, &index, "丁", 0, true).unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn matches_across_a_surrogate_pair_emoji_and_reports_utf16_span() {
        let content = "甲😀乙";
        let index = build_document_index(content);
        let found = search_document_content(content, &index, "😀", 0, true)
            .unwrap()
            .unwrap();
        assert_eq!(found.from, "甲".encode_utf16().count());
        assert_eq!(found.to, found.from + "😀".encode_utf16().count());
    }
}

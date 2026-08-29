//! Safe UTF-8 boundary chunk reading.
//!
//! Responsibility: read one bounded chunk of document content starting at a byte offset, landing
//! the end offset on a valid UTF-8 char boundary and always advancing by at least one character
//! when content remains (so paging through a document can never stall on one offset). No
//! document loading, caching, or upload-session state — those remain with the store
//! orchestration and the dedicated R11-13 atomic.

#[derive(Debug)]
pub(in crate::document_store) struct DocumentChunkRead {
    pub(in crate::document_store) next_byte_offset: usize,
    pub(in crate::document_store) total_bytes: usize,
    pub(in crate::document_store) content: String,
    pub(in crate::document_store) done: bool,
}

pub(in crate::document_store) fn read_chunk(
    content: &str,
    byte_offset: usize,
    max_bytes: usize,
) -> Result<DocumentChunkRead, String> {
    let total_bytes = content.len();
    if byte_offset > total_bytes || !content.is_char_boundary(byte_offset) {
        return Err("文档分段读取位置无效".into());
    }
    let requested = max_bytes.clamp(16 * 1024, 2 * 1024 * 1024);
    let mut end = byte_offset.saturating_add(requested).min(total_bytes);
    while end > byte_offset && !content.is_char_boundary(end) {
        end -= 1;
    }
    if end == byte_offset && byte_offset < total_bytes {
        end = content[byte_offset..]
            .char_indices()
            .nth(1)
            .map(|(relative, _)| byte_offset + relative)
            .unwrap_or(total_bytes);
    }
    Ok(DocumentChunkRead {
        next_byte_offset: end,
        total_bytes,
        content: content[byte_offset..end].to_string(),
        done: end >= total_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_empty_document_as_one_done_chunk_with_no_content() {
        let chunk = read_chunk("", 0, 64 * 1024).unwrap();
        assert_eq!(chunk.content, "");
        assert_eq!(chunk.next_byte_offset, 0);
        assert_eq!(chunk.total_bytes, 0);
        assert!(chunk.done);
    }

    #[test]
    fn reads_starting_exactly_at_the_end_as_a_done_empty_chunk() {
        let content = "甲乙丙";
        let chunk = read_chunk(content, content.len(), 64 * 1024).unwrap();
        assert_eq!(chunk.content, "");
        assert!(chunk.done);
        assert_eq!(chunk.next_byte_offset, content.len());
    }

    #[test]
    fn rejects_an_offset_past_the_end_of_the_document() {
        let content = "甲乙丙";
        let error = read_chunk(content, content.len() + 1, 64 * 1024).unwrap_err();
        assert_eq!(error, "文档分段读取位置无效");
    }

    #[test]
    fn rejects_an_offset_that_splits_a_multi_byte_character() {
        let content = "甲乙丙";
        let error = read_chunk(content, 1, 64 * 1024).unwrap_err();
        assert_eq!(error, "文档分段读取位置无效");
    }

    #[test]
    fn clamps_the_requested_size_into_the_allowed_range_but_never_past_the_document() {
        let content = "甲乙丙";
        let chunk = read_chunk(content, 0, 1).unwrap();
        assert_eq!(chunk.content, content);
        assert!(chunk.done);
    }

    #[test]
    fn backs_off_a_landing_mid_character_to_the_previous_boundary_when_content_remains() {
        // The minimum allowed chunk size (16 KiB) lands one byte into the 3-byte "甲" that
        // starts right at that boundary, so the reader must back off to the boundary before
        // it rather than slicing mid-character.
        let content = format!("{}甲乙丙", "a".repeat(16_383));
        let chunk = read_chunk(&content, 0, 1).unwrap();
        assert_eq!(chunk.content, "a".repeat(16_383));
        assert_eq!(chunk.next_byte_offset, 16_383);
        assert!(!chunk.done);
    }

    #[test]
    fn advancing_next_byte_offset_across_calls_reads_a_large_document_exactly_once() {
        let content = "甲乙丙丁戊".repeat(3_000);
        let mut offset = 0usize;
        let mut collected = String::new();
        let mut iterations = 0usize;
        loop {
            let chunk = read_chunk(&content, offset, 1).unwrap();
            collected.push_str(&chunk.content);
            offset = chunk.next_byte_offset;
            iterations += 1;
            if chunk.done {
                break;
            }
        }
        assert_eq!(collected, content);
        assert_eq!(offset, content.len());
        assert!(
            iterations > 1,
            "expected multiple chunks for a >16KiB document"
        );
    }
}

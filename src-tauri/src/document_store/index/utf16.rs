//! UTF-16 code-unit offset <-> UTF-8 byte offset lookup.
//!
//! Responsibility: translate between a document's UTF-16 offsets (what the frontend editor
//! speaks) and UTF-8 byte offsets (what Rust string slicing needs), using a `DocumentIndex`'s
//! sparse checkpoints to avoid rescanning from the start of the document. No index construction
//! or search — those remain with `builder` and `search`.

use super::builder::DocumentIndex;

pub(in crate::document_store) fn index_utf16_to_byte(
    content: &str,
    index: &DocumentIndex,
    target: usize,
) -> Result<usize, String> {
    if target > index.utf16_length {
        return Err("搜索位置超过文档长度".into());
    }
    let checkpoint_index = index
        .checkpoints
        .partition_point(|checkpoint| checkpoint.utf16_offset <= target)
        .saturating_sub(1);
    let checkpoint = &index.checkpoints[checkpoint_index];
    let mut utf16 = checkpoint.utf16_offset;
    for (relative, ch) in content[checkpoint.byte_offset..].char_indices() {
        if utf16 == target {
            return Ok(checkpoint.byte_offset + relative);
        }
        let width = ch.len_utf16();
        if utf16 + width > target {
            return Err("搜索位置落在代理字符中间".into());
        }
        utf16 += width;
    }
    if utf16 == target {
        Ok(content.len())
    } else {
        Err("搜索位置超过文档长度".into())
    }
}

pub(in crate::document_store) fn index_byte_to_utf16(
    content: &str,
    index: &DocumentIndex,
    target: usize,
) -> Result<usize, String> {
    if target > content.len() || !content.is_char_boundary(target) {
        return Err("搜索结果不是有效 UTF-8 边界".into());
    }
    let checkpoint_index = index
        .checkpoints
        .partition_point(|checkpoint| checkpoint.byte_offset <= target)
        .saturating_sub(1);
    let checkpoint = &index.checkpoints[checkpoint_index];
    Ok(checkpoint.utf16_offset
        + content[checkpoint.byte_offset..target]
            .encode_utf16()
            .count())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document_store::index::build_document_index;

    #[test]
    fn round_trips_byte_and_utf16_offsets_across_chinese_and_emoji() {
        let content = "甲😀乙丙";
        let index = build_document_index(content);
        let emoji_byte = content.find('😀').unwrap();
        let emoji_utf16 = index_byte_to_utf16(content, &index, emoji_byte).unwrap();
        assert_eq!(emoji_utf16, "甲".encode_utf16().count());
        assert_eq!(
            index_utf16_to_byte(content, &index, emoji_utf16).unwrap(),
            emoji_byte
        );
    }

    #[test]
    fn index_utf16_to_byte_rejects_a_target_past_the_document_length() {
        let content = "甲乙";
        let index = build_document_index(content);
        let error = index_utf16_to_byte(content, &index, index.utf16_length + 1).unwrap_err();
        assert_eq!(error, "搜索位置超过文档长度");
    }

    #[test]
    fn index_utf16_to_byte_rejects_a_target_inside_a_surrogate_pair() {
        let content = "😀";
        let index = build_document_index(content);
        let error = index_utf16_to_byte(content, &index, 1).unwrap_err();
        assert_eq!(error, "搜索位置落在代理字符中间");
    }

    #[test]
    fn index_byte_to_utf16_rejects_a_target_past_the_content_length() {
        let content = "甲乙";
        let index = build_document_index(content);
        let error = index_byte_to_utf16(content, &index, content.len() + 1).unwrap_err();
        assert_eq!(error, "搜索结果不是有效 UTF-8 边界");
    }

    #[test]
    fn index_byte_to_utf16_rejects_a_target_not_on_a_char_boundary() {
        let content = "甲";
        let index = build_document_index(content);
        let error = index_byte_to_utf16(content, &index, 1).unwrap_err();
        assert_eq!(error, "搜索结果不是有效 UTF-8 边界");
    }
}

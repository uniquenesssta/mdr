//! Document-store validation rules and UTF-16 transaction range mapping.
//!
//! Responsibility: preserve document identifier normalization, incremental version guards, and
//! text-change range validation/error semantics. No file IO, Tauri commands, or persistence policy.

use std::ops::Range;

pub(super) fn safe_document_id(document_id: &str) -> Result<String, String> {
    let safe: String = document_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
        .take(160)
        .collect();
    if safe.is_empty() {
        return Err("文档标识无效".into());
    }
    Ok(safe)
}

pub(super) fn validate_save_versions(
    current_version: u64,
    base_version: u64,
    next_version: u64,
    is_full_reset: bool,
) -> Result<(), String> {
    if !is_full_reset && base_version != current_version {
        return Err(format!("VERSION_MISMATCH:{current_version}:{base_version}"));
    }
    if next_version <= base_version && !is_full_reset {
        return Err("文档版本未前进".into());
    }
    Ok(())
}

fn utf16_to_byte_index(text: &str, target: usize) -> Result<usize, String> {
    if target == 0 {
        return Ok(0);
    }
    let mut utf16 = 0usize;
    for (byte_index, ch) in text.char_indices() {
        if utf16 == target {
            return Ok(byte_index);
        }
        let width = ch.len_utf16();
        if utf16 + width > target {
            return Err("文本修改位置落在代理字符中间".into());
        }
        utf16 += width;
    }
    if utf16 == target {
        Ok(text.len())
    } else {
        Err("文本修改位置超过文档长度".into())
    }
}

pub(super) fn transaction_byte_range(
    text: &str,
    from_utf16: usize,
    to_utf16: usize,
) -> Result<Range<usize>, String> {
    if to_utf16 < from_utf16 {
        return Err("文本修改范围无效".into());
    }
    let from = utf16_to_byte_index(text, from_utf16)?;
    let to = utf16_to_byte_index(text, to_utf16)?;
    if to < from {
        return Err("文本修改范围无效".into());
    }
    Ok(from..to)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_id_normalization_and_error_text_remain_exact() {
        assert_eq!(safe_document_id("a/b中-_.x").unwrap(), "ab-_x");
        assert_eq!(safe_document_id(&"a".repeat(200)).unwrap().len(), 160);
        assert_eq!(safe_document_id("中/").unwrap_err(), "文档标识无效");
    }

    #[test]
    fn incremental_version_errors_remain_exact() {
        assert_eq!(
            validate_save_versions(5, 4, 6, false).unwrap_err(),
            "VERSION_MISMATCH:5:4"
        );
        assert_eq!(
            validate_save_versions(5, 5, 5, false).unwrap_err(),
            "文档版本未前进"
        );
    }

    #[test]
    fn full_reset_keeps_existing_version_guard_bypass() {
        assert!(validate_save_versions(5, 99, 0, true).is_ok());
    }

    #[test]
    fn utf16_transaction_range_maps_chinese_and_emoji_exactly() {
        let text = "甲😀乙";
        assert_eq!(transaction_byte_range(text, 1, 3).unwrap(), 3..7);
    }

    #[test]
    fn reversed_transaction_range_error_remains_exact() {
        assert_eq!(
            transaction_byte_range("甲乙", 2, 1).unwrap_err(),
            "文本修改范围无效"
        );
    }

    #[test]
    fn surrogate_boundary_error_remains_exact() {
        assert_eq!(
            transaction_byte_range("😀", 1, 1).unwrap_err(),
            "文本修改位置落在代理字符中间"
        );
    }

    #[test]
    fn out_of_bounds_error_remains_exact() {
        assert_eq!(
            transaction_byte_range("甲", 2, 2).unwrap_err(),
            "文本修改位置超过文档长度"
        );
    }
}

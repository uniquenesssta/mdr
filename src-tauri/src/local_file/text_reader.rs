//! Bounded UTF-8 text reading for local files.
//!
//! Responsibility: enforce the frozen dropped-text size limit and decode one file as UTF-8.
//! This module does not classify paths, resolve paths, expose commands or construct DTOs.

use std::{fs, path::Path};

pub(super) const MAX_TEXT_BYTES: u64 = 20 * 1024 * 1024;

pub(super) fn is_supported_text_size(bytes: u64) -> bool {
    bytes <= MAX_TEXT_BYTES
}

pub(super) fn read_dropped_text(path: &Path, file_size: u64) -> Result<String, String> {
    if !is_supported_text_size(file_size) {
        return Err("文本文件过大，暂不支持直接拖入".into());
    }
    fs::read_to_string(path).map_err(|err| format!("无法读取文本文件：{err}"))
}

#[cfg(test)]
mod tests {
    use super::{is_supported_text_size, read_dropped_text, MAX_TEXT_BYTES};
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temporary_file(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!("markdown-editor-text-reader-{nonce}-{name}"))
    }

    #[test]
    fn accepts_only_files_at_or_below_the_frozen_text_limit() {
        assert!(is_supported_text_size(MAX_TEXT_BYTES));
        assert!(!is_supported_text_size(MAX_TEXT_BYTES + 1));
    }

    #[test]
    fn reads_utf8_text_without_changing_multibyte_content() {
        let path = temporary_file("utf8.md");
        let content = "标题与 emoji 🚀";
        fs::write(&path, content).expect("write UTF-8 text");

        assert_eq!(
            read_dropped_text(&path, content.len() as u64).expect("read UTF-8 text"),
            content
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_oversized_text_before_touching_the_path() {
        let missing = temporary_file("missing.md");
        assert_eq!(
            read_dropped_text(&missing, MAX_TEXT_BYTES + 1).expect_err("oversized text must fail"),
            "文本文件过大，暂不支持直接拖入"
        );
    }

    #[test]
    fn rejects_binary_bytes_instead_of_treating_them_as_text() {
        let path = temporary_file("binary.md");
        fs::write(&path, [0xff, 0xfe]).expect("write invalid UTF-8 bytes");

        let error = read_dropped_text(&path, 2).expect_err("binary bytes must not decode as text");
        assert!(error.starts_with("无法读取文本文件："));
        let _ = fs::remove_file(path);
    }
}

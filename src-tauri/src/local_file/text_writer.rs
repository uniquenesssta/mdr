//! UTF-8 text persistence for local files.
//!
//! Responsibility: write the supplied text bytes to one already-resolved path and preserve the
//! frozen text-write error and byte-count semantics. This module does not resolve paths, create
//! parent directories, open dialogs, expose commands or construct DTOs.

use std::{fs, path::Path};

pub(super) fn write_text(path: &Path, content: &str) -> Result<usize, String> {
    fs::write(path, content.as_bytes()).map_err(|err| format!("无法写入文本文件：{err}"))?;
    Ok(content.len())
}

#[cfg(test)]
mod tests {
    use super::write_text;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temporary_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!("markdown-editor-text-writer-{nonce}-{name}"))
    }

    #[test]
    fn writes_utf8_text_and_reports_its_byte_count() {
        let path = temporary_path("utf8.md");
        let content = "标题与 emoji 🚀";

        assert_eq!(write_text(&path, content).expect("write UTF-8 text"), content.len());
        assert_eq!(fs::read_to_string(&path).expect("read UTF-8 text"), content);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn overwrites_an_existing_text_file_without_appending() {
        let path = temporary_path("overwrite.md");
        fs::write(&path, "old content").expect("write old text");

        assert_eq!(write_text(&path, "new").expect("overwrite text"), 3);
        assert_eq!(fs::read_to_string(&path).expect("read new text"), "new");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn preserves_the_missing_parent_error_without_creating_directories() {
        let parent = temporary_path("missing-parent");
        let path = parent.join("document.md");

        let error = write_text(&path, "content").expect_err("missing parent must fail");
        assert!(error.starts_with("无法写入文本文件："));
        assert!(!parent.exists());
    }

    #[test]
    fn writes_an_empty_text_file_with_zero_bytes() {
        let path = temporary_path("empty.txt");

        assert_eq!(write_text(&path, "").expect("write empty text"), 0);
        assert_eq!(fs::metadata(&path).expect("empty text metadata").len(), 0);
        let _ = fs::remove_file(path);
    }
}

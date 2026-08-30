//! Base64 decoding and binary persistence for local files.
//!
//! Responsibility: decode the command's Base64 payload, write the supplied bytes to one
//! already-resolved path and preserve the frozen decode/write errors and byte-count semantics.
//! This module does not resolve paths, create parent directories, open dialogs, expose commands
//! or construct DTOs.

use base64::{engine::general_purpose, Engine as _};
use std::{fs, path::Path};

pub(super) fn decode_binary(content_base64: &str) -> Result<Vec<u8>, String> {
    general_purpose::STANDARD
        .decode(content_base64)
        .map_err(|err| format!("文件数据解码失败：{err}"))
}

pub(super) fn write_binary(path: &Path, content: &[u8]) -> Result<usize, String> {
    let bytes = content.len();
    fs::write(path, content).map_err(|err| format!("无法写入文件：{err}"))?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::{decode_binary, write_binary};
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temporary_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!("markdown-editor-binary-writer-{nonce}-{name}"))
    }

    #[test]
    fn decodes_the_command_base64_payload_without_changing_bytes() {
        assert_eq!(
            decode_binary("AAEC/v8=").expect("decode binary payload"),
            [0_u8, 1, 2, 254, 255]
        );
    }

    #[test]
    fn preserves_the_base64_decode_error_prefix() {
        let error = decode_binary("not base64!").expect_err("invalid Base64 must fail");
        assert!(error.starts_with("文件数据解码失败："));
    }

    #[test]
    fn writes_binary_content_and_reports_its_byte_count() {
        let path = temporary_path("content.bin");
        let content = [0_u8, 1, 2, 254, 255];

        assert_eq!(write_binary(&path, &content).expect("write binary"), content.len());
        assert_eq!(fs::read(&path).expect("read binary"), content);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn overwrites_an_existing_binary_file_without_appending() {
        let path = temporary_path("overwrite.bin");
        fs::write(&path, [1_u8, 2, 3]).expect("write old binary");

        assert_eq!(write_binary(&path, &[9_u8]).expect("overwrite binary"), 1);
        assert_eq!(fs::read(&path).expect("read new binary"), [9_u8]);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn preserves_the_missing_parent_error_without_creating_directories() {
        let parent = temporary_path("missing-parent");
        let path = parent.join("content.bin");

        let error = write_binary(&path, &[1_u8]).expect_err("missing parent must fail");
        assert!(error.starts_with("无法写入文件："));
        assert!(!parent.exists());
    }

    #[test]
    fn writes_an_empty_binary_file_with_zero_bytes() {
        let path = temporary_path("empty.bin");

        assert_eq!(write_binary(&path, &[]).expect("write empty binary"), 0);
        assert_eq!(fs::metadata(&path).expect("empty binary metadata").len(), 0);
        let _ = fs::remove_file(path);
    }
}

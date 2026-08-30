//! Bounded binary image reading and Data URL encoding for local files.
//!
//! Responsibility: enforce the frozen image size limits, read image bytes and encode them with
//! the MIME supplied by File Kind. This module does not classify or resolve paths, expose commands
//! or construct DTOs.

use base64::{engine::general_purpose, Engine as _};
use std::{fs, path::Path};

pub(super) const MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;
pub(super) const MAX_EMBEDDED_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug)]
pub(super) struct ImageContent {
    pub(super) data_url: String,
    pub(super) bytes: usize,
}

pub(super) fn validate_embedded_image_size(file_size: u64) -> Result<(), String> {
    if file_size > MAX_EMBEDDED_IMAGE_BYTES {
        return Err("图片超过 20MB，混合编辑模式暂不加载".into());
    }
    Ok(())
}

pub(super) fn read_dropped_image(path: &Path, mime: &str, file_size: u64) -> Result<ImageContent, String> {
    if file_size > MAX_IMAGE_BYTES {
        return Err("图片超过 5MB，暂不支持直接插入".into());
    }
    read_image(path, mime)
}

pub(super) fn read_embedded_image(path: &Path, mime: &str) -> Result<ImageContent, String> {
    read_image(path, mime)
}

fn read_image(path: &Path, mime: &str) -> Result<ImageContent, String> {
    let bytes = fs::read(path).map_err(|err| format!("无法读取图片文件：{err}"))?;
    let encoded = general_purpose::STANDARD.encode(&bytes);
    Ok(ImageContent {
        data_url: format!("data:{mime};base64,{encoded}"),
        bytes: bytes.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        read_dropped_image, read_embedded_image, validate_embedded_image_size, MAX_EMBEDDED_IMAGE_BYTES,
        MAX_IMAGE_BYTES,
    };
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temporary_file(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!("markdown-editor-image-reader-{nonce}-{name}"))
    }

    #[test]
    fn accepts_only_dropped_images_at_or_below_the_frozen_limit() {
        let path = temporary_file("boundary.png");
        fs::write(&path, [1_u8]).expect("write boundary image");
        assert!(read_dropped_image(&path, "image/png", MAX_IMAGE_BYTES).is_ok());
        assert_eq!(
            read_dropped_image(&path, "image/png", MAX_IMAGE_BYTES + 1)
                .expect_err("oversized dropped image must fail"),
            "图片超过 5MB，暂不支持直接插入"
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn accepts_embedded_images_only_through_the_frozen_limit() {
        assert_eq!(validate_embedded_image_size(MAX_EMBEDDED_IMAGE_BYTES), Ok(()));
        assert_eq!(
            validate_embedded_image_size(MAX_EMBEDDED_IMAGE_BYTES + 1),
            Err("图片超过 20MB，混合编辑模式暂不加载".into())
        );
    }

    #[test]
    fn rejects_oversized_dropped_images_before_touching_the_path() {
        let missing = temporary_file("oversized.png");
        assert_eq!(
            read_dropped_image(&missing, "image/png", MAX_IMAGE_BYTES + 1)
                .expect_err("oversized dropped image must fail"),
            "图片超过 5MB，暂不支持直接插入"
        );
    }

    #[test]
    fn encodes_dropped_image_bytes_with_the_supplied_mime() {
        let path = temporary_file("drop.png");
        fs::write(&path, [0_u8, 1, 2]).expect("write image bytes");

        let image = read_dropped_image(&path, "image/png", 3).expect("read dropped image");
        assert_eq!(image.data_url, "data:image/png;base64,AAEC");
        assert_eq!(image.bytes, 3);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn reports_embedded_image_bytes_and_preserves_mime() {
        let path = temporary_file("embedded.svg");
        let bytes = b"<svg/>";
        fs::write(&path, bytes).expect("write embedded image");

        let image = read_embedded_image(&path, "image/svg+xml").expect("read embedded image");
        assert!(image.data_url.starts_with("data:image/svg+xml;base64,"));
        assert_eq!(image.bytes, bytes.len());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn preserves_the_image_read_error_prefix() {
        let missing = temporary_file("missing.webp");
        let error = read_embedded_image(&missing, "image/webp").expect_err("missing image must fail");
        assert!(error.starts_with("无法读取图片文件："));
    }
}

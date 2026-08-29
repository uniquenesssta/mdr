//! Pure local-file extension and supported-kind classification.
//!
//! Responsibility: normalize the final path extension and classify it as supported text,
//! supported image with its frozen MIME, or unsupported. This module performs no file I/O and
//! owns no size, path, command, DTO, encoding, or tree policy.

use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum FileKind {
    Text,
    Image { mime: &'static str },
    Unsupported,
}

pub(super) fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

pub(super) fn classify(path: &Path) -> FileKind {
    match extension(path).as_str() {
        "md" | "markdown" | "txt" => FileKind::Text,
        "png" => FileKind::Image { mime: "image/png" },
        "jpg" | "jpeg" => FileKind::Image { mime: "image/jpeg" },
        "gif" => FileKind::Image { mime: "image/gif" },
        "webp" => FileKind::Image { mime: "image/webp" },
        "svg" => FileKind::Image { mime: "image/svg+xml" },
        _ => FileKind::Unsupported,
    }
}

pub(super) fn is_supported_text_path(path: &Path) -> bool {
    classify(path) == FileKind::Text
}

#[cfg(test)]
mod tests {
    use super::{classify, extension, is_supported_text_path, FileKind};
    use std::path::Path;

    #[test]
    fn normalizes_the_final_extension_to_ascii_lowercase() {
        assert_eq!(extension(Path::new("archive.note.MARKDOWN")), "markdown");
        assert_eq!(extension(Path::new("folder.with.dot/notes.TXT")), "txt");
    }

    #[test]
    fn preserves_the_empty_extension_contract() {
        assert_eq!(extension(Path::new("README")), "");
        assert_eq!(extension(Path::new(".markdown")), "");
    }

    #[test]
    fn classifies_all_frozen_text_extensions() {
        for path in ["document.md", "document.MARKDOWN", "notes.txt"] {
            assert_eq!(classify(Path::new(path)), FileKind::Text, "{path}");
        }
    }

    #[test]
    fn classifies_all_frozen_image_mime_types() {
        for (path, mime) in [
            ("image.png", "image/png"),
            ("image.jpg", "image/jpeg"),
            ("image.JPEG", "image/jpeg"),
            ("image.gif", "image/gif"),
            ("image.webp", "image/webp"),
            ("image.svg", "image/svg+xml"),
        ] {
            assert_eq!(classify(Path::new(path)), FileKind::Image { mime }, "{path}");
        }
    }

    #[test]
    fn rejects_unknown_and_missing_extensions() {
        assert_eq!(classify(Path::new("image.bmp")), FileKind::Unsupported);
        assert_eq!(classify(Path::new("README")), FileKind::Unsupported);
    }

    #[test]
    fn text_predicate_delegates_to_the_single_classifier() {
        assert!(is_supported_text_path(Path::new("document.md")));
        assert!(!is_supported_text_path(Path::new("image.png")));
    }
}

//! Local-file path construction and boundary policy.
//!
//! Responsibility: construct input paths, resolve document-relative images, identify parent
//! directories, and classify directory-tree entries against the requested lexical root.
//! Allowed dependencies: `std::fs`, `std::path`, and the package's existing `url` crate.
//! Forbidden here: file contents, extension/MIME classification, recursion, writes, DTOs, Tauri
//! commands, or application state. This module owns no state and requires no lifecycle cleanup.

use std::{
    fs,
    path::{Component, Path, PathBuf},
};

pub(super) enum TreeEntryPolicy {
    Allowed(fs::Metadata),
    Skip,
    Unreadable,
}

pub(super) fn input_path(value: &str) -> PathBuf {
    PathBuf::from(value)
}

pub(super) fn required_path(value: &str, empty_error: &str) -> Result<PathBuf, String> {
    let path = input_path(value);
    if path.as_os_str().is_empty() {
        Err(empty_error.to_string())
    } else {
        Ok(path)
    }
}

pub(super) fn parent_directory(path: &Path, error: &str) -> Result<PathBuf, String> {
    path.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| error.to_string())
}

pub(super) fn resolve_local_image_path(
    source: &str,
    document_path: Option<&str>,
) -> Result<PathBuf, String> {
    let value = source.trim();
    if value.is_empty() {
        return Err("图片地址为空".into());
    }

    let mut path = if value.to_ascii_lowercase().starts_with("file:") {
        url::Url::parse(value)
            .map_err(|_| "本地图片地址格式无效".to_string())?
            .to_file_path()
            .map_err(|_| "无法解析本地图片地址".to_string())?
    } else {
        input_path(value)
    };

    if path.is_relative() {
        let document = document_path
            .filter(|item| !item.trim().is_empty())
            .map(input_path)
            .ok_or_else(|| "相对图片路径需要先将 Markdown 文档保存到电脑".to_string())?;
        path = parent_directory(&document, "无法确定 Markdown 文档所在目录")?.join(path);
    }
    Ok(path)
}

pub(super) fn is_within_directory(root: &Path, candidate: &Path) -> bool {
    let Ok(relative) = candidate.strip_prefix(root) else {
        return false;
    };
    !relative.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    })
}

pub(super) fn inspect_tree_entry(root: &Path, candidate: &Path) -> TreeEntryPolicy {
    if !is_within_directory(root, candidate) {
        return TreeEntryPolicy::Skip;
    }
    match fs::symlink_metadata(candidate) {
        Ok(metadata) if metadata.file_type().is_symlink() => TreeEntryPolicy::Skip,
        Ok(metadata) => TreeEntryPolicy::Allowed(metadata),
        Err(_) => TreeEntryPolicy::Unreadable,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        input_path, inspect_tree_entry, is_within_directory, parent_directory, required_path,
        resolve_local_image_path, TreeEntryPolicy,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temporary_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!("markdown-editor-path-policy-{nonce}-{name}"))
    }

    #[test]
    fn constructs_input_paths_and_rejects_only_empty_required_paths() {
        assert_eq!(input_path("notes/readme.md"), PathBuf::from("notes/readme.md"));
        assert_eq!(
            required_path("", "empty path").expect_err("empty path must be rejected"),
            "empty path"
        );
        assert_eq!(
            required_path("  ", "empty path").expect("spaces remain a path"),
            PathBuf::from("  ")
        );
    }

    #[test]
    fn returns_the_parent_without_canonicalizing_the_input() {
        assert_eq!(
            parent_directory(Path::new("workspace/notes.md"), "missing parent")
                .expect("relative parent"),
            PathBuf::from("workspace")
        );
        assert_eq!(
            parent_directory(Path::new("/"), "missing parent")
                .expect_err("filesystem root has no parent"),
            "missing parent"
        );
    }

    #[test]
    fn keeps_absolute_image_paths_unchanged() {
        let absolute = temporary_path("absolute.png");
        assert_eq!(
            resolve_local_image_path(absolute.to_str().expect("UTF-8 path"), None)
                .expect("absolute image path"),
            absolute
        );
    }

    #[test]
    fn parses_file_urls_with_the_existing_error_contract() {
        let absolute = temporary_path("file-url.png");
        let source = url::Url::from_file_path(&absolute).expect("file URL");
        assert_eq!(
            resolve_local_image_path(source.as_str(), None).expect("file URL image path"),
            absolute
        );
        assert_eq!(
            resolve_local_image_path("file://[", None).expect_err("invalid URL must fail"),
            "本地图片地址格式无效"
        );
    }

    #[test]
    fn resolves_relative_images_against_the_document_parent() {
        let document = temporary_path("project").join("notes.md");
        assert_eq!(
            resolve_local_image_path("images/picture.png", document.to_str())
                .expect("relative image path"),
            document
                .parent()
                .expect("document parent")
                .join("images/picture.png")
        );
    }

    #[test]
    fn preserves_parent_relative_markdown_image_semantics() {
        let document = temporary_path("project").join("notes").join("entry.md");
        assert_eq!(
            resolve_local_image_path("../images/picture.png", document.to_str())
                .expect("parent-relative image path"),
            document
                .parent()
                .expect("document parent")
                .join("../images/picture.png")
        );
    }

    #[test]
    fn relative_images_require_a_saved_document_path() {
        assert_eq!(
            resolve_local_image_path("images/picture.png", None)
                .expect_err("unsaved relative image must fail"),
            "相对图片路径需要先将 Markdown 文档保存到电脑"
        );
        assert_eq!(
            resolve_local_image_path("", None).expect_err("empty image source must fail"),
            "图片地址为空"
        );
    }

    #[test]
    fn identifies_lexical_directory_escape_without_resolving_the_filesystem() {
        let root = temporary_path("root");
        assert!(is_within_directory(&root, &root.join("notes/readme.md")));
        assert!(!is_within_directory(&root, &root.join("../outside.md")));
        assert!(!is_within_directory(&root, &temporary_path("outside.md")));
    }

    #[test]
    fn classifies_missing_tree_entries_as_unreadable() {
        let root = temporary_path("missing-root");
        assert!(matches!(
            inspect_tree_entry(&root, &root.join("missing.md")),
            TreeEntryPolicy::Unreadable
        ));
        assert!(matches!(
            inspect_tree_entry(&root, &root.join("../outside.md")),
            TreeEntryPolicy::Skip
        ));
    }

    #[cfg(unix)]
    #[test]
    fn skips_symlink_tree_entries_and_allows_regular_entries() {
        use std::os::unix::fs::symlink;

        let root = temporary_path("symlink-root");
        fs::create_dir_all(&root).expect("create root");
        let file = root.join("notes.md");
        let alias = root.join("alias.md");
        fs::write(&file, "notes").expect("write regular file");
        symlink(&file, &alias).expect("create symlink");

        assert!(matches!(
            inspect_tree_entry(&root, &file),
            TreeEntryPolicy::Allowed(_)
        ));
        assert!(matches!(
            inspect_tree_entry(&root, &alias),
            TreeEntryPolicy::Skip
        ));

        fs::remove_dir_all(root).expect("remove root");
    }
}

use serde::Serialize;
use serde_json::json;
use std::{
    env, fs,
    path::{Path, PathBuf},
};

mod binary_writer;
mod directory_tree;
mod file_kind;
mod image_reader;
mod path_policy;
mod text_reader;
mod text_writer;

use binary_writer::{decode_binary, write_binary};
use directory_tree::build_text_file_tree;
// Preserve the historical DTO path even though current callers infer node values through TextFileTree.
#[allow(unused_imports)]
pub use directory_tree::{TextFileTree, TextFileTreeNode};
use file_kind::{classify, extension, is_supported_text_path, FileKind};
use image_reader::{read_dropped_image, read_embedded_image, validate_embedded_image_size};
use path_policy::{input_path, required_path, resolve_local_image_path};
use text_reader::read_dropped_text;
use text_writer::write_text;

const MAX_FILE_TREE_DEPTH: usize = 24;
const MAX_FILE_TREE_ENTRIES: usize = 12_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedFile {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub content: Option<String>,
    pub data_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalImageData {
    pub path: String,
    pub data_url: String,
    pub bytes: usize,
}

fn read_local_image_inner(
    source: String,
    document_path: Option<String>,
) -> Result<LocalImageData, String> {
    let path = resolve_local_image_path(&source, document_path.as_deref())?;
    let metadata = fs::metadata(&path).map_err(|err| format!("无法读取图片文件：{err}"))?;
    if !metadata.is_file() {
        return Err("图片路径不是文件".into());
    }
    validate_embedded_image_size(metadata.len())?;
    let mime = match classify(&path) {
        FileKind::Image { mime } => mime,
        FileKind::Text | FileKind::Unsupported => return Err("不支持该本地图片格式".into()),
    };
    let image = read_embedded_image(&path, mime)?;
    Ok(LocalImageData {
        path: path.to_string_lossy().into_owned(),
        data_url: image.data_url,
        bytes: image.bytes,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalWriteResult {
    pub path: String,
    pub bytes: usize,
}

fn write_local_text_file_inner(path: String, content: String) -> Result<LocalWriteResult, String> {
    let path_buf = required_path(&path, "保存路径不能为空")?;
    let bytes = write_text(&path_buf, &content)?;
    Ok(LocalWriteResult {
        path: path_buf.to_string_lossy().into_owned(),
        bytes,
    })
}

fn write_local_binary_file_inner(path: String, content: Vec<u8>) -> Result<LocalWriteResult, String> {
    let path_buf = required_path(&path, "保存路径不能为空")?;
    let bytes = write_binary(&path_buf, &content)?;
    Ok(LocalWriteResult {
        path: path_buf.to_string_lossy().into_owned(),
        bytes,
    })
}

#[tauri::command]
pub async fn list_text_file_tree(document_path: String) -> Result<TextFileTree, String> {
    let extension = extension(Path::new(&document_path));
    tauri::async_runtime::spawn_blocking(move || {
        crate::performance_log::measure_sync(
            "native.command",
            "list_text_file_tree",
            json!({ "extension": extension }),
            || build_text_file_tree(&document_path, MAX_FILE_TREE_DEPTH, MAX_FILE_TREE_ENTRIES),
        )
    })
    .await
    .map_err(|err| format!("文件树读取任务失败：{err}"))?
}

fn read_dropped_file_inner(path: String) -> Result<DroppedFile, String> {
    let path_buf = input_path(&path);
    let metadata = fs::metadata(&path_buf).map_err(|err| format!("无法读取文件信息：{err}"))?;
    if !metadata.is_file() {
        return Err("只支持拖入文件，不支持拖入文件夹".into());
    }

    let name = path_buf
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("未命名文件")
        .to_string();
    match classify(&path_buf) {
        FileKind::Text => {
            let content = read_dropped_text(&path_buf, metadata.len())?;
            Ok(DroppedFile {
                name,
                path,
                kind: "text".into(),
                content: Some(content),
                data_url: None,
            })
        }
        FileKind::Image { mime } => {
            let image = read_dropped_image(&path_buf, mime, metadata.len())?;
            Ok(DroppedFile {
                name,
                path,
                kind: "image".into(),
                content: None,
                data_url: Some(image.data_url),
            })
        }
        FileKind::Unsupported => Err("不支持该文件类型，请拖入 Markdown、文本或图片文件".into()),
    }
}

#[tauri::command]
pub fn read_dropped_file(path: String) -> Result<DroppedFile, String> {
    let extension = input_path(&path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    crate::performance_log::measure_sync(
        "native.command",
        "read_dropped_file",
        json!({ "extension": extension }),
        || read_dropped_file_inner(path),
    )
}

#[tauri::command]
pub async fn read_local_image(
    source: String,
    document_path: Option<String>,
) -> Result<LocalImageData, String> {
    let source_length = source.len();
    tauri::async_runtime::spawn_blocking(move || {
        crate::performance_log::measure_sync(
            "native.command",
            "read_local_image",
            json!({ "sourceLength": source_length, "hasDocumentPath": document_path.is_some() }),
            || read_local_image_inner(source, document_path),
        )
    })
    .await
    .map_err(|err| format!("图片读取任务失败：{err}"))?
}

#[tauri::command]
pub async fn write_local_text_file(path: String, content: String) -> Result<LocalWriteResult, String> {
    let extension = extension(Path::new(&path));
    let bytes = content.len();
    tauri::async_runtime::spawn_blocking(move || {
        crate::performance_log::measure_sync(
            "native.command",
            "write_local_text_file",
            json!({ "extension": extension, "bytes": bytes }),
            || write_local_text_file_inner(path, content),
        )
    })
    .await
    .map_err(|err| format!("写入任务失败：{err}"))?
}

#[tauri::command]
pub async fn write_local_binary_file(path: String, content_base64: String) -> Result<LocalWriteResult, String> {
    let extension = extension(Path::new(&path));
    tauri::async_runtime::spawn_blocking(move || {
        let content = decode_binary(&content_base64)?;
        let bytes = content.len();
        crate::performance_log::measure_sync(
            "native.command",
            "write_local_binary_file",
            json!({ "extension": extension, "bytes": bytes }),
            || write_local_binary_file_inner(path, content),
        )
    })
    .await
    .map_err(|err| format!("写入任务失败：{err}"))?
}

#[tauri::command]
pub fn initial_file_path() -> Option<String> {
    env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|path| path.is_file() && is_supported_text_path(path))
        .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{
        build_text_file_tree, is_supported_text_path, resolve_local_image_path,
        write_local_binary_file_inner, write_local_text_file_inner, MAX_FILE_TREE_DEPTH,
        MAX_FILE_TREE_ENTRIES,
    };
    use std::{
        fs,
        path::Path,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temporary_file(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!("markdown-editor-{nonce}-{name}"))
    }

    #[test]
    fn lists_supported_text_files_as_a_nested_tree() {
        let root = temporary_file("file-tree");
        let nested = root.join("notes");
        fs::create_dir_all(&nested).expect("create nested folder");
        let current = root.join("current.md");
        fs::write(&current, "# Current").expect("write current document");
        fs::write(root.join("readme.txt"), "text").expect("write text file");
        fs::write(root.join("image.png"), "not an image").expect("write ignored file");
        fs::write(nested.join("nested.markdown"), "# Nested").expect("write nested markdown");

        let tree = build_text_file_tree(
            &current.to_string_lossy(),
            MAX_FILE_TREE_DEPTH,
            MAX_FILE_TREE_ENTRIES,
        )
        .expect("scan file tree");
        assert_eq!(tree.file_count, 3);
        assert_eq!(tree.directory_count, 1);
        assert!(!tree.truncated);
        assert!(tree.nodes.iter().any(|node| node.name == "current.md" && node.kind == "file"));
        assert!(tree.nodes.iter().any(|node| {
            node.name == "notes"
                && node.kind == "directory"
                && node.children.iter().any(|child| child.name == "nested.markdown")
        }));
        assert!(!tree.nodes.iter().any(|node| node.name == "image.png"));
        fs::remove_dir_all(root).expect("remove test folder");
    }

    #[test]
    fn recognizes_supported_text_extensions_case_insensitively() {
        assert!(is_supported_text_path(Path::new("document.md")));
        assert!(is_supported_text_path(Path::new("document.MARKDOWN")));
        assert!(is_supported_text_path(Path::new("notes.txt")));
        assert!(!is_supported_text_path(Path::new("image.png")));
    }

    #[test]
    fn resolves_relative_image_against_document_directory() {
        let document = std::env::temp_dir().join("markdown-project").join("notes.md");
        let resolved = resolve_local_image_path("images/picture.png", document.to_str())
            .expect("resolve relative image");
        assert_eq!(
            resolved,
            document
                .parent()
                .expect("document parent")
                .join("images/picture.png")
        );
    }

    #[test]
    fn writes_text_and_binary_to_absolute_paths() {
        let text_path = temporary_file("text.md");
        let binary_path = temporary_file("binary.bin");
        let text = "标题与 emoji 🚀".to_string();
        let binary = vec![0_u8, 1, 2, 254, 255];

        let text_result = write_local_text_file_inner(text_path.to_string_lossy().into_owned(), text.clone())
            .expect("write text file");
        let binary_result = write_local_binary_file_inner(binary_path.to_string_lossy().into_owned(), binary.clone())
            .expect("write binary file");

        assert_eq!(text_result.bytes, text.len());
        assert_eq!(binary_result.bytes, binary.len());
        assert_eq!(fs::read_to_string(&text_path).expect("read text file"), text);
        assert_eq!(fs::read(&binary_path).expect("read binary file"), binary);

        let _ = fs::remove_file(text_path);
        let _ = fs::remove_file(binary_path);
    }
}

// R12-01 rustfmt boundary: only the new pre-rewrite behavior tests below.
#[cfg(test)]
mod stage_12_tests {
    use super::directory_tree::{build_text_file_tree, scan_text_file_tree_directory, DirectoryTreeScanState};
    use super::image_reader::{MAX_EMBEDDED_IMAGE_BYTES, MAX_IMAGE_BYTES};
    use super::text_reader::MAX_TEXT_BYTES;
    use super::{
        classify, read_dropped_file_inner, read_local_image_inner, FileKind, MAX_FILE_TREE_DEPTH, MAX_FILE_TREE_ENTRIES,
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
        std::env::temp_dir().join(format!("markdown-editor-r12-{nonce}-{name}"))
    }

    #[test]
    fn stage_12_freezes_supported_extensions_mime_and_security_limits() {
        assert_eq!(MAX_TEXT_BYTES, 20 * 1024 * 1024);
        assert_eq!(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
        assert_eq!(MAX_EMBEDDED_IMAGE_BYTES, 20 * 1024 * 1024);
        assert_eq!(MAX_FILE_TREE_DEPTH, 24);
        assert_eq!(MAX_FILE_TREE_ENTRIES, 12_000);
        assert_eq!(
            classify(std::path::Path::new("image.png")),
            FileKind::Image { mime: "image/png" }
        );
        assert_eq!(
            classify(std::path::Path::new("image.jpg")),
            FileKind::Image { mime: "image/jpeg" }
        );
        assert_eq!(
            classify(std::path::Path::new("image.jpeg")),
            FileKind::Image { mime: "image/jpeg" }
        );
        assert_eq!(
            classify(std::path::Path::new("image.gif")),
            FileKind::Image { mime: "image/gif" }
        );
        assert_eq!(
            classify(std::path::Path::new("image.webp")),
            FileKind::Image { mime: "image/webp" }
        );
        assert_eq!(
            classify(std::path::Path::new("image.svg")),
            FileKind::Image { mime: "image/svg+xml" }
        );
        assert_eq!(classify(std::path::Path::new("image.bmp")), FileKind::Unsupported);
    }

    #[test]
    fn stage_12_rejects_files_only_after_each_frozen_byte_limit() {
        let oversized_text = temporary_file("oversized.md");
        let oversized_drop_image = temporary_file("oversized-drop.png");
        let oversized_embedded_image = temporary_file("oversized-embedded.png");
        fs::File::create(&oversized_text)
            .expect("create sparse text")
            .set_len(MAX_TEXT_BYTES + 1)
            .expect("size sparse text");
        fs::File::create(&oversized_drop_image)
            .expect("create sparse dropped image")
            .set_len(MAX_IMAGE_BYTES + 1)
            .expect("size sparse dropped image");
        fs::File::create(&oversized_embedded_image)
            .expect("create sparse embedded image")
            .set_len(MAX_EMBEDDED_IMAGE_BYTES + 1)
            .expect("size sparse embedded image");

        assert_eq!(
            read_dropped_file_inner(oversized_text.to_string_lossy().into_owned())
                .expect_err("oversized text must be rejected"),
            "文本文件过大，暂不支持直接拖入"
        );
        assert_eq!(
            read_dropped_file_inner(oversized_drop_image.to_string_lossy().into_owned())
                .expect_err("oversized dropped image must be rejected"),
            "图片超过 5MB，暂不支持直接插入"
        );
        assert_eq!(
            read_local_image_inner(oversized_embedded_image.to_string_lossy().into_owned(), None)
                .expect_err("oversized embedded image must be rejected"),
            "图片超过 20MB，混合编辑模式暂不加载"
        );

        let _ = fs::remove_file(oversized_text);
        let _ = fs::remove_file(oversized_drop_image);
        let _ = fs::remove_file(oversized_embedded_image);
    }

    #[test]
    fn stage_12_freezes_tree_depth_and_entry_truncation_boundaries() {
        let root = temporary_file("tree-limits");
        fs::create_dir_all(&root).expect("create tree root");
        fs::write(root.join("visible.md"), "text").expect("write tree file");

        let mut depth_state = DirectoryTreeScanState::default();
        let depth_nodes = scan_text_file_tree_directory(
            &root,
            &root,
            MAX_FILE_TREE_DEPTH + 1,
            MAX_FILE_TREE_DEPTH,
            MAX_FILE_TREE_ENTRIES,
            &mut depth_state,
        );
        assert!(depth_nodes.is_empty());
        assert!(depth_state.truncated);
        assert_eq!(depth_state.scanned_entries, 0);

        let mut entry_state = DirectoryTreeScanState {
            scanned_entries: MAX_FILE_TREE_ENTRIES,
            ..DirectoryTreeScanState::default()
        };
        let entry_nodes = scan_text_file_tree_directory(
            &root,
            &root,
            0,
            MAX_FILE_TREE_DEPTH,
            MAX_FILE_TREE_ENTRIES,
            &mut entry_state,
        );
        assert!(entry_nodes.is_empty());
        assert!(entry_state.truncated);
        assert_eq!(entry_state.scanned_entries, MAX_FILE_TREE_ENTRIES);

        fs::remove_dir_all(root).expect("remove tree root");
    }

    #[cfg(unix)]
    #[test]
    fn stage_12_skips_symlinks_without_incrementing_skipped_count() {
        use std::os::unix::fs::symlink;

        let root = temporary_file("tree-symlink");
        fs::create_dir_all(&root).expect("create symlink tree root");
        let current = root.join("current.md");
        fs::write(&current, "text").expect("write current document");
        symlink(&current, root.join("alias.md")).expect("create file symlink");

        let tree = build_text_file_tree(&current.to_string_lossy(), MAX_FILE_TREE_DEPTH, MAX_FILE_TREE_ENTRIES)
            .expect("scan symlink tree");
        assert_eq!(tree.file_count, 1);
        assert_eq!(tree.skipped_count, 0);
        assert!(!tree.nodes.iter().any(|node| node.name == "alias.md"));

        fs::remove_dir_all(root).expect("remove symlink tree root");
    }
}

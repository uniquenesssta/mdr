use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use serde_json::json;
use std::{
    env, fs,
    fs::File,
    path::{Path, PathBuf},
};

mod path_policy;

use path_policy::{
    input_path, inspect_tree_entry, parent_directory, required_path, resolve_local_image_path,
    TreeEntryPolicy,
};

const MAX_TEXT_BYTES: u64 = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_EMBEDDED_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
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
pub struct TextFileTreeNode {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub children: Vec<TextFileTreeNode>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileTree {
    pub root_path: String,
    pub root_name: String,
    pub nodes: Vec<TextFileTreeNode>,
    pub file_count: usize,
    pub directory_count: usize,
    pub skipped_count: usize,
    pub truncated: bool,
}

#[derive(Default)]
struct TextFileTreeScanState {
    scanned_entries: usize,
    file_count: usize,
    directory_count: usize,
    skipped_count: usize,
    truncated: bool,
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn is_supported_text_path(path: &Path) -> bool {
    matches!(extension(path).as_str(), "md" | "markdown" | "txt")
}

fn image_mime(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
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
    if metadata.len() > MAX_EMBEDDED_IMAGE_BYTES {
        return Err("图片超过 20MB，混合编辑模式暂不加载".into());
    }
    let ext = extension(&path);
    let mime = image_mime(&ext).ok_or_else(|| "不支持该本地图片格式".to_string())?;
    let bytes = fs::read(&path).map_err(|err| format!("无法读取图片文件：{err}"))?;
    let encoded = general_purpose::STANDARD.encode(&bytes);
    Ok(LocalImageData {
        path: path.to_string_lossy().into_owned(),
        data_url: format!("data:{mime};base64,{encoded}"),
        bytes: bytes.len(),
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
    fs::write(&path_buf, content.as_bytes()).map_err(|err| format!("无法写入文本文件：{err}"))?;
    Ok(LocalWriteResult {
        path: path_buf.to_string_lossy().into_owned(),
        bytes: content.len(),
    })
}

fn write_local_binary_file_inner(path: String, content: Vec<u8>) -> Result<LocalWriteResult, String> {
    let path_buf = required_path(&path, "保存路径不能为空")?;
    let bytes = content.len();
    fs::write(&path_buf, content).map_err(|err| format!("无法写入文件：{err}"))?;
    Ok(LocalWriteResult {
        path: path_buf.to_string_lossy().into_owned(),
        bytes,
    })
}

fn compare_tree_nodes(left: &TextFileTreeNode, right: &TextFileTreeNode) -> std::cmp::Ordering {
    let left_directory = left.kind == "directory";
    let right_directory = right.kind == "directory";
    right_directory
        .cmp(&left_directory)
        .then_with(|| left.name.to_ascii_lowercase().cmp(&right.name.to_ascii_lowercase()))
        .then_with(|| left.name.cmp(&right.name))
}

fn scan_text_file_tree_directory(
    root: &Path,
    directory: &Path,
    depth: usize,
    state: &mut TextFileTreeScanState,
) -> Vec<TextFileTreeNode> {
    if depth > MAX_FILE_TREE_DEPTH {
        state.truncated = true;
        return Vec::new();
    }

    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => {
            state.skipped_count += 1;
            return Vec::new();
        }
    };
    let mut nodes = Vec::new();
    for entry_result in entries {
        if state.scanned_entries >= MAX_FILE_TREE_ENTRIES {
            state.truncated = true;
            break;
        }
        state.scanned_entries += 1;
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(_) => {
                state.skipped_count += 1;
                continue;
            }
        };
        let path = entry.path();
        let metadata = match inspect_tree_entry(root, &path) {
            TreeEntryPolicy::Allowed(metadata) => metadata,
            TreeEntryPolicy::Skip => continue,
            TreeEntryPolicy::Unreadable => {
                state.skipped_count += 1;
                continue;
            }
        };
        let file_type = metadata.file_type();
        let name = entry.file_name().to_string_lossy().into_owned();
        if file_type.is_dir() {
            let children = scan_text_file_tree_directory(root, &path, depth + 1, state);
            if !children.is_empty() {
                state.directory_count += 1;
                nodes.push(TextFileTreeNode {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    kind: "directory".into(),
                    children,
                });
            }
            continue;
        }
        if !file_type.is_file() || !is_supported_text_path(&path) {
            continue;
        }
        if metadata.len() > MAX_TEXT_BYTES || File::open(&path).is_err() {
            state.skipped_count += 1;
            continue;
        }
        state.file_count += 1;
        nodes.push(TextFileTreeNode {
            name,
            path: path.to_string_lossy().into_owned(),
            kind: "file".into(),
            children: Vec::new(),
        });
    }
    nodes.sort_by(compare_tree_nodes);
    nodes
}

fn list_text_file_tree_inner(document_path: String) -> Result<TextFileTree, String> {
    let document = required_path(document_path.trim(), "当前文档尚未关联本地文件")?;
    let metadata = fs::metadata(&document).map_err(|err| format!("无法读取当前文档信息：{err}"))?;
    if !metadata.is_file() || !is_supported_text_path(&document) {
        return Err("当前文档不是可读取的 Markdown 或 TXT 文件".into());
    }
    let root = parent_directory(&document, "无法确定当前文档所在文件夹")?;
    fs::read_dir(&root).map_err(|err| format!("无法读取当前文件夹：{err}"))?;

    let mut state = TextFileTreeScanState::default();
    let nodes = scan_text_file_tree_directory(&root, &root, 0, &mut state);
    let root_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| root.to_string_lossy().into_owned());
    Ok(TextFileTree {
        root_path: root.to_string_lossy().into_owned(),
        root_name,
        nodes,
        file_count: state.file_count,
        directory_count: state.directory_count,
        skipped_count: state.skipped_count,
        truncated: state.truncated,
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
            || list_text_file_tree_inner(document_path),
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
    let ext = extension(&path_buf);

    if matches!(ext.as_str(), "md" | "markdown" | "txt") {
        if metadata.len() > MAX_TEXT_BYTES {
            return Err("文本文件过大，暂不支持直接拖入".into());
        }
        let content = fs::read_to_string(&path_buf).map_err(|err| format!("无法读取文本文件：{err}"))?;
        return Ok(DroppedFile {
            name,
            path,
            kind: "text".into(),
            content: Some(content),
            data_url: None,
        });
    }

    if let Some(mime) = image_mime(&ext) {
        if metadata.len() > MAX_IMAGE_BYTES {
            return Err("图片超过 5MB，暂不支持直接插入".into());
        }
        let bytes = fs::read(&path_buf).map_err(|err| format!("无法读取图片文件：{err}"))?;
        let encoded = general_purpose::STANDARD.encode(bytes);
        return Ok(DroppedFile {
            name,
            path,
            kind: "image".into(),
            content: None,
            data_url: Some(format!("data:{mime};base64,{encoded}")),
        });
    }

    Err("不支持该文件类型，请拖入 Markdown、文本或图片文件".into())
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
        let content = general_purpose::STANDARD
            .decode(content_base64)
            .map_err(|err| format!("文件数据解码失败：{err}"))?;
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
        is_supported_text_path, list_text_file_tree_inner, resolve_local_image_path,
        write_local_binary_file_inner, write_local_text_file_inner,
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

        let tree = list_text_file_tree_inner(current.to_string_lossy().into_owned())
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
    use super::{
        image_mime, list_text_file_tree_inner, read_dropped_file_inner, read_local_image_inner,
        scan_text_file_tree_directory, TextFileTreeScanState, MAX_EMBEDDED_IMAGE_BYTES, MAX_FILE_TREE_DEPTH,
        MAX_FILE_TREE_ENTRIES, MAX_IMAGE_BYTES, MAX_TEXT_BYTES,
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
        assert_eq!(image_mime("png"), Some("image/png"));
        assert_eq!(image_mime("jpg"), Some("image/jpeg"));
        assert_eq!(image_mime("jpeg"), Some("image/jpeg"));
        assert_eq!(image_mime("gif"), Some("image/gif"));
        assert_eq!(image_mime("webp"), Some("image/webp"));
        assert_eq!(image_mime("svg"), Some("image/svg+xml"));
        assert_eq!(image_mime("bmp"), None);
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

        let mut depth_state = TextFileTreeScanState::default();
        let depth_nodes =
            scan_text_file_tree_directory(&root, &root, MAX_FILE_TREE_DEPTH + 1, &mut depth_state);
        assert!(depth_nodes.is_empty());
        assert!(depth_state.truncated);
        assert_eq!(depth_state.scanned_entries, 0);

        let mut entry_state = TextFileTreeScanState {
            scanned_entries: MAX_FILE_TREE_ENTRIES,
            ..TextFileTreeScanState::default()
        };
        let entry_nodes = scan_text_file_tree_directory(&root, &root, 0, &mut entry_state);
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

        let tree = list_text_file_tree_inner(current.to_string_lossy().into_owned()).expect("scan symlink tree");
        assert_eq!(tree.file_count, 1);
        assert_eq!(tree.skipped_count, 0);
        assert!(!tree.nodes.iter().any(|node| node.name == "alias.md"));

        fs::remove_dir_all(root).expect("remove symlink tree root");
    }
}

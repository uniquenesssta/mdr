//! Preserved pre-Stage-12 local-file regression tests.

use super::directory_tree::build_text_file_tree;
use super::file_kind::is_supported_text_path;
use super::operations::{write_local_binary_file, write_local_text_file};
use super::path_policy::resolve_local_image_path;
use super::tree_limits::TreeLimits;
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

    let tree = build_text_file_tree(&current.to_string_lossy(), TreeLimits::default()).expect("scan file tree");
    assert_eq!(tree.file_count, 3);
    assert_eq!(tree.directory_count, 1);
    assert!(!tree.truncated);
    assert!(tree
        .nodes
        .iter()
        .any(|node| node.name == "current.md" && node.kind == "file"));
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
    let resolved = resolve_local_image_path("images/picture.png", document.to_str()).expect("resolve relative image");
    assert_eq!(
        resolved,
        document.parent().expect("document parent").join("images/picture.png")
    );
}

#[test]
fn writes_text_and_binary_to_absolute_paths() {
    let text_path = temporary_file("text.md");
    let binary_path = temporary_file("binary.bin");
    let text = "标题与 emoji 🚀".to_string();
    let binary = vec![0_u8, 1, 2, 254, 255];

    let text_result =
        write_local_text_file(text_path.to_string_lossy().into_owned(), text.clone()).expect("write text file");
    let binary_result =
        write_local_binary_file(binary_path.to_string_lossy().into_owned(), binary.clone()).expect("write binary file");

    assert_eq!(text_result.bytes, text.len());
    assert_eq!(binary_result.bytes, binary.len());
    assert_eq!(fs::read_to_string(&text_path).expect("read text file"), text);
    assert_eq!(fs::read(&binary_path).expect("read binary file"), binary);

    let _ = fs::remove_file(text_path);
    let _ = fs::remove_file(binary_path);
}

//! Preserved R12-01 direct security behavior tests after directory promotion.

use super::directory_tree::{build_text_file_tree, scan_text_file_tree_directory};
use super::file_kind::{classify, FileKind};
use super::image_reader::{MAX_EMBEDDED_IMAGE_BYTES, MAX_IMAGE_BYTES};
use super::operations::{read_dropped_file, read_local_image};
use super::text_reader::MAX_TEXT_BYTES;
use super::tree_limits::{TreeLimitState, TreeLimits, MAX_FILE_TREE_DEPTH, MAX_FILE_TREE_ENTRIES};
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
        read_dropped_file(oversized_text.to_string_lossy().into_owned()).expect_err("oversized text must be rejected"),
        "文本文件过大，暂不支持直接拖入"
    );
    assert_eq!(
        read_dropped_file(oversized_drop_image.to_string_lossy().into_owned())
            .expect_err("oversized dropped image must be rejected"),
        "图片超过 5MB，暂不支持直接插入"
    );
    assert_eq!(
        read_local_image(oversized_embedded_image.to_string_lossy().into_owned(), None)
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

    let limits = TreeLimits::default();
    let mut depth_state = TreeLimitState::default();
    let depth_nodes = scan_text_file_tree_directory(&root, &root, MAX_FILE_TREE_DEPTH + 1, limits, &mut depth_state);
    assert!(depth_nodes.is_empty());
    assert!(depth_state.truncated());
    assert_eq!(depth_state.scanned_entries(), 0);

    let mut entry_state = TreeLimitState::with_scanned_entries(MAX_FILE_TREE_ENTRIES);
    let entry_nodes = scan_text_file_tree_directory(&root, &root, 0, limits, &mut entry_state);
    assert!(entry_nodes.is_empty());
    assert!(entry_state.truncated());
    assert_eq!(entry_state.scanned_entries(), MAX_FILE_TREE_ENTRIES);

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

    let tree = build_text_file_tree(&current.to_string_lossy(), TreeLimits::default()).expect("scan symlink tree");
    assert_eq!(tree.file_count, 1);
    assert_eq!(tree.skipped_count, 0);
    assert!(!tree.nodes.iter().any(|node| node.name == "alias.md"));

    fs::remove_dir_all(root).expect("remove symlink tree root");
}

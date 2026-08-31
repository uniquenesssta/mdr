//! Bounded local text-file directory-tree scanning.
//!
//! Responsibility: recursively scan one validated document directory, keep supported readable
//! text files, omit empty directories, sort stable directory-first nodes, count accepted/skipped
//! entries, and report truncation without following symbolic links. The caller supplies the
//! current depth and entry limits; limit ownership remains outside this module until R12-07.
//! Allowed dependencies: local File Kind, Path Policy and Text Reader boundaries plus `std::fs`.
//! Forbidden here: Tauri commands, performance logs, dialogs, writes, Base64 and limit constants.
//! The scan state is call-local and requires no lifecycle cleanup.

use super::{
    file_kind::is_supported_text_path,
    path_policy::{inspect_tree_entry, parent_directory, required_path, TreeEntryPolicy},
    text_reader::is_supported_text_size,
};
use serde::Serialize;
use std::{fs, fs::File, path::Path};

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
pub(super) struct DirectoryTreeScanState {
    pub(super) scanned_entries: usize,
    pub(super) file_count: usize,
    pub(super) directory_count: usize,
    pub(super) skipped_count: usize,
    pub(super) truncated: bool,
}

fn compare_tree_nodes(left: &TextFileTreeNode, right: &TextFileTreeNode) -> std::cmp::Ordering {
    let left_directory = left.kind == "directory";
    let right_directory = right.kind == "directory";
    right_directory
        .cmp(&left_directory)
        .then_with(|| left.name.to_ascii_lowercase().cmp(&right.name.to_ascii_lowercase()))
        .then_with(|| left.name.cmp(&right.name))
}

pub(super) fn scan_text_file_tree_directory(
    root: &Path,
    directory: &Path,
    depth: usize,
    max_depth: usize,
    max_entries: usize,
    state: &mut DirectoryTreeScanState,
) -> Vec<TextFileTreeNode> {
    if depth > max_depth {
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
        if state.scanned_entries >= max_entries {
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
            let children = scan_text_file_tree_directory(root, &path, depth + 1, max_depth, max_entries, state);
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
        if !is_supported_text_size(metadata.len()) || File::open(&path).is_err() {
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

pub(super) fn build_text_file_tree(
    document_path: &str,
    max_depth: usize,
    max_entries: usize,
) -> Result<TextFileTree, String> {
    let document = required_path(document_path.trim(), "当前文档尚未关联本地文件")?;
    let metadata = fs::metadata(&document).map_err(|err| format!("无法读取当前文档信息：{err}"))?;
    if !metadata.is_file() || !is_supported_text_path(&document) {
        return Err("当前文档不是可读取的 Markdown 或 TXT 文件".into());
    }
    let root = parent_directory(&document, "无法确定当前文档所在文件夹")?;
    fs::read_dir(&root).map_err(|err| format!("无法读取当前文件夹：{err}"))?;

    let mut state = DirectoryTreeScanState::default();
    let nodes = scan_text_file_tree_directory(&root, &root, 0, max_depth, max_entries, &mut state);
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

#[cfg(test)]
mod tests {
    use super::{build_text_file_tree, scan_text_file_tree_directory, DirectoryTreeScanState};
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temporary_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!("markdown-editor-directory-tree-{nonce}-{name}"))
    }

    #[test]
    fn builds_a_nested_supported_tree_and_omits_empty_directories() {
        let root = temporary_path("nested");
        let notes = root.join("notes");
        let empty = root.join("empty");
        fs::create_dir_all(&notes).expect("create notes directory");
        fs::create_dir_all(&empty).expect("create empty directory");
        let current = root.join("current.md");
        fs::write(&current, "# Current").expect("write current document");
        fs::write(root.join("readme.txt"), "text").expect("write text file");
        fs::write(notes.join("nested.markdown"), "# Nested").expect("write nested markdown");
        fs::write(empty.join("image.png"), "ignored").expect("write ignored image");

        let tree =
            build_text_file_tree(current.to_str().expect("document path"), 24, 12_000).expect("build directory tree");

        assert_eq!(tree.file_count, 3);
        assert_eq!(tree.directory_count, 1);
        assert_eq!(tree.skipped_count, 0);
        assert!(!tree.truncated);
        assert!(tree
            .nodes
            .iter()
            .any(|node| node.name == "notes" && node.children.len() == 1));
        assert!(!tree.nodes.iter().any(|node| node.name == "empty"));
        fs::remove_dir_all(root).expect("remove nested tree");
    }

    #[test]
    fn sorts_directories_first_then_names_case_insensitively_and_stably() {
        let root = temporary_path("sorting");
        for directory in ["beta", "Alpha"] {
            fs::create_dir_all(root.join(directory)).expect("create sorted directory");
            fs::write(root.join(directory).join("child.md"), "text").expect("write child");
        }
        let current = root.join("current.md");
        fs::write(&current, "text").expect("write current document");
        for file in ["zeta.md", "Bravo.md", "alpha.md"] {
            fs::write(root.join(file), "text").expect("write sorted file");
        }

        let tree =
            build_text_file_tree(current.to_str().expect("document path"), 24, 12_000).expect("build sorted tree");
        let names = tree.nodes.iter().map(|node| node.name.as_str()).collect::<Vec<_>>();

        assert_eq!(
            names,
            ["Alpha", "beta", "alpha.md", "Bravo.md", "current.md", "zeta.md"]
        );
        fs::remove_dir_all(root).expect("remove sorted tree");
    }

    #[test]
    fn preserves_document_validation_errors() {
        assert_eq!(
            build_text_file_tree("  ", 24, 12_000).expect_err("empty path must fail"),
            "当前文档尚未关联本地文件"
        );

        let missing = temporary_path("missing.md");
        assert!(
            build_text_file_tree(missing.to_str().expect("missing path"), 24, 12_000)
                .expect_err("missing document must fail")
                .starts_with("无法读取当前文档信息：")
        );

        let unsupported = temporary_path("unsupported.png");
        fs::write(&unsupported, "not markdown").expect("write unsupported document");
        assert_eq!(
            build_text_file_tree(unsupported.to_str().expect("unsupported path"), 24, 12_000)
                .expect_err("unsupported document must fail"),
            "当前文档不是可读取的 Markdown 或 TXT 文件"
        );
        fs::remove_file(unsupported).expect("remove unsupported document");
    }

    #[test]
    fn reports_depth_and_entry_truncation_at_the_supplied_boundaries() {
        let root = temporary_path("limits");
        fs::create_dir_all(&root).expect("create limit root");
        fs::write(root.join("visible.md"), "text").expect("write visible file");

        let mut depth_state = DirectoryTreeScanState::default();
        let depth_nodes = scan_text_file_tree_directory(&root, &root, 2, 1, 10, &mut depth_state);
        assert!(depth_nodes.is_empty());
        assert!(depth_state.truncated);
        assert_eq!(depth_state.scanned_entries, 0);

        let mut entry_state = DirectoryTreeScanState {
            scanned_entries: 1,
            ..DirectoryTreeScanState::default()
        };
        let entry_nodes = scan_text_file_tree_directory(&root, &root, 0, 10, 1, &mut entry_state);
        assert!(entry_nodes.is_empty());
        assert!(entry_state.truncated);
        assert_eq!(entry_state.scanned_entries, 1);
        fs::remove_dir_all(root).expect("remove limit root");
    }

    #[test]
    fn skips_oversized_supported_files_and_counts_them_once() {
        let root = temporary_path("oversized");
        fs::create_dir_all(&root).expect("create oversized root");
        let current = root.join("current.md");
        fs::write(&current, "text").expect("write current document");
        fs::File::create(root.join("oversized.txt"))
            .expect("create oversized text")
            .set_len(20 * 1024 * 1024 + 1)
            .expect("size oversized text");

        let tree =
            build_text_file_tree(current.to_str().expect("document path"), 24, 12_000).expect("build oversized tree");

        assert_eq!(tree.file_count, 1);
        assert_eq!(tree.skipped_count, 1);
        assert!(!tree.nodes.iter().any(|node| node.name == "oversized.txt"));
        fs::remove_dir_all(root).expect("remove oversized tree");
    }

    #[cfg(unix)]
    #[test]
    fn never_follows_file_or_directory_symbolic_links() {
        use std::os::unix::fs::symlink;

        let root = temporary_path("symlinks");
        let outside = temporary_path("outside");
        fs::create_dir_all(&root).expect("create symlink root");
        fs::create_dir_all(&outside).expect("create outside directory");
        let current = root.join("current.md");
        fs::write(&current, "text").expect("write current document");
        fs::write(outside.join("outside.md"), "text").expect("write outside document");
        symlink(&current, root.join("alias.md")).expect("create file symlink");
        symlink(&outside, root.join("linked-directory")).expect("create directory symlink");

        let tree =
            build_text_file_tree(current.to_str().expect("document path"), 24, 12_000).expect("build symlink tree");

        assert_eq!(tree.file_count, 1);
        assert_eq!(tree.directory_count, 0);
        assert_eq!(tree.skipped_count, 0);
        assert!(!tree.nodes.iter().any(|node| node.name == "alias.md"));
        assert!(!tree.nodes.iter().any(|node| node.name == "linked-directory"));
        fs::remove_dir_all(root).expect("remove symlink root");
        fs::remove_dir_all(outside).expect("remove outside directory");
    }
}

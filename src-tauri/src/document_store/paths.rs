//! Document-store path layout and filename construction.
//!
//! Responsibility: own stable directory/file naming only. Directory creation, reads, writes,
//! rename/remove, and recovery policy remain outside this module for their dedicated atomics.

use std::path::{Path, PathBuf};

use super::validation::safe_document_id;

pub(super) fn document_directory(app_data_dir: &Path, safe_document_id: &str) -> PathBuf {
    app_data_dir.join("documents").join(safe_document_id)
}

pub(super) fn snapshot_paths(root: &Path, slot: char) -> (PathBuf, PathBuf) {
    (
        root.join(format!("snapshot-{slot}.md")),
        root.join(format!("snapshot-{slot}.json")),
    )
}

pub(super) fn journal_path(root: &Path) -> PathBuf {
    root.join("changes.jsonl")
}

pub(super) fn snapshot_upload_path(root: &Path, upload_id: &str) -> Result<PathBuf, String> {
    Ok(root.join(format!(
        "snapshot-upload-{}.tmp",
        safe_document_id(upload_id)?
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_snapshot_and_journal_layout_remains_exact() {
        let app_data = PathBuf::from("app-data");
        let root = document_directory(&app_data, "doc_1");
        assert_eq!(root, app_data.join("documents").join("doc_1"));
        let (content, meta) = snapshot_paths(&root, 'b');
        assert_eq!(content.file_name().and_then(|value| value.to_str()), Some("snapshot-b.md"));
        assert_eq!(meta.file_name().and_then(|value| value.to_str()), Some("snapshot-b.json"));
        assert_eq!(
            journal_path(&root).file_name().and_then(|value| value.to_str()),
            Some("changes.jsonl")
        );
    }

    #[test]
    fn upload_filename_reuses_document_id_normalization_and_error_text() {
        let root = PathBuf::from("document-root");
        let path = snapshot_upload_path(&root, "upload:中_1").unwrap();
        assert_eq!(
            path.file_name().and_then(|value| value.to_str()),
            Some("snapshot-upload-upload_1.tmp")
        );
        assert_eq!(
            snapshot_upload_path(&root, "中/").unwrap_err(),
            "文档标识无效"
        );
    }
}

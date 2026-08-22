//! Segmented snapshot upload session lifecycle.
//!
//! Responsibility: own the upload-session lifecycle — begin (create an empty temp file for one
//! upload id), append (append one chunk of text to it), take (read the full content back and
//! delete the temp file, used by commit), and abort (delete the temp file if present). Each
//! session is addressed solely by its own `upload_id -> snapshot_upload_path` temp file, so
//! concurrent sessions with different ids never share state or touch each other's file. No
//! document-store/save orchestration, snapshot writing, or path construction — those remain with
//! the store orchestration, `snapshot`, and `paths`.

use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
};

use crate::document_store::paths::snapshot_upload_path;

pub(in crate::document_store) fn begin_snapshot_upload(
    root: &Path,
    upload_id: &str,
) -> Result<(), String> {
    let path = snapshot_upload_path(root, upload_id)?;
    let file = File::create(path).map_err(|err| format!("无法创建分段快照：{err}"))?;
    file.sync_all()
        .map_err(|err| format!("无法初始化分段快照：{err}"))
}

pub(in crate::document_store) fn append_snapshot_chunk(
    root: &Path,
    upload_id: &str,
    chunk: &str,
) -> Result<(), String> {
    let path = snapshot_upload_path(root, upload_id)?;
    let mut file = OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|err| format!("无法打开分段快照：{err}"))?;
    file.write_all(chunk.as_bytes())
        .map_err(|err| format!("无法写入分段快照：{err}"))
}

pub(in crate::document_store) fn take_snapshot_upload(
    root: &Path,
    upload_id: &str,
) -> Result<String, String> {
    let path = snapshot_upload_path(root, upload_id)?;
    let content = fs::read_to_string(&path).map_err(|err| format!("无法读取分段快照：{err}"))?;
    fs::remove_file(path).map_err(|err| format!("无法清理分段快照：{err}"))?;
    Ok(content)
}

pub(in crate::document_store) fn abort_snapshot_upload(
    root: &Path,
    upload_id: &str,
) -> Result<(), String> {
    let path = snapshot_upload_path(root, upload_id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|err| format!("无法清理分段快照：{err}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("markdown-editor-upload-session-{name}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn snapshot_upload_round_trip_begins_appends_and_takes_content() {
        let root = test_root("upload-roundtrip");
        begin_snapshot_upload(&root, "upload_1").unwrap();
        append_snapshot_chunk(&root, "upload_1", "甲").unwrap();
        append_snapshot_chunk(&root, "upload_1", "乙😀").unwrap();
        let content = take_snapshot_upload(&root, "upload_1").unwrap();
        assert_eq!(content, "甲乙😀");
        assert!(!snapshot_upload_path(&root, "upload_1").unwrap().exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn take_snapshot_upload_missing_file_reports_read_error() {
        let root = test_root("upload-missing");
        let error = take_snapshot_upload(&root, "missing_upload").unwrap_err();
        assert!(error.starts_with("无法读取分段快照："));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn abort_snapshot_upload_is_idempotent_when_nothing_pending() {
        let root = test_root("upload-abort-noop");
        abort_snapshot_upload(&root, "never_started").unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn abort_snapshot_upload_removes_pending_temp_file() {
        let root = test_root("upload-abort");
        begin_snapshot_upload(&root, "upload_2").unwrap();
        let path = snapshot_upload_path(&root, "upload_2").unwrap();
        assert!(path.exists());
        abort_snapshot_upload(&root, "upload_2").unwrap();
        assert!(!path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_sessions_with_different_upload_ids_never_share_or_touch_each_others_file() {
        let root = test_root("upload-concurrent");
        begin_snapshot_upload(&root, "session_a").unwrap();
        begin_snapshot_upload(&root, "session_b").unwrap();
        append_snapshot_chunk(&root, "session_a", "甲").unwrap();
        append_snapshot_chunk(&root, "session_b", "乙").unwrap();
        append_snapshot_chunk(&root, "session_a", "丙").unwrap();

        // Aborting one session must not affect the other's pending temp file or content.
        abort_snapshot_upload(&root, "session_b").unwrap();
        assert!(!snapshot_upload_path(&root, "session_b").unwrap().exists());
        assert!(snapshot_upload_path(&root, "session_a").unwrap().exists());

        let content_a = take_snapshot_upload(&root, "session_a").unwrap();
        assert_eq!(content_a, "甲丙");
        fs::remove_dir_all(root).unwrap();
    }
}

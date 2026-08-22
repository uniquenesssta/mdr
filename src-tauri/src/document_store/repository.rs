//! Document-store atomic file IO primitives: durable write, directory creation, and the
//! segmented snapshot upload transport.
//!
//! Responsibility: own only byte-level create/write/append/rename/remove/directory operations.
//! No recovery strategy, snapshot slot selection, integrity validation, or journal entry
//! semantics — those remain with their dedicated Stage 11 atomics.

use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use super::paths::snapshot_upload_path;

pub(super) fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|err| format!("无法创建文档存储目录：{err}"))
}

fn write_temp_file(path: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let temp = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("data")
    ));
    let mut file = File::create(&temp).map_err(|err| format!("无法创建临时文件：{err}"))?;
    file.write_all(bytes)
        .map_err(|err| format!("无法写入临时文件：{err}"))?;
    file.sync_all()
        .map_err(|err| format!("无法同步临时文件：{err}"))?;
    Ok(temp)
}

fn replace_file(temp: &Path, target: &Path) -> Result<(), String> {
    match fs::rename(temp, target) {
        Ok(()) => Ok(()),
        Err(first_error) => {
            if target.exists() {
                fs::remove_file(target).map_err(|err| format!("无法替换旧快照：{err}"))?;
                fs::rename(temp, target).map_err(|err| {
                    format!("无法提交快照（首次错误：{first_error}；重试错误：{err}）")
                })
            } else {
                Err(format!("无法提交快照：{first_error}"))
            }
        }
    }
}

pub(super) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = write_temp_file(path, bytes)?;
    replace_file(&temp, path)
}

pub(super) fn begin_snapshot_upload(root: &Path, upload_id: &str) -> Result<(), String> {
    let path = snapshot_upload_path(root, upload_id)?;
    let file = File::create(path).map_err(|err| format!("无法创建分段快照：{err}"))?;
    file.sync_all()
        .map_err(|err| format!("无法初始化分段快照：{err}"))
}

pub(super) fn append_snapshot_chunk(
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

pub(super) fn take_snapshot_upload(root: &Path, upload_id: &str) -> Result<String, String> {
    let path = snapshot_upload_path(root, upload_id)?;
    let content = fs::read_to_string(&path).map_err(|err| format!("无法读取分段快照：{err}"))?;
    fs::remove_file(path).map_err(|err| format!("无法清理分段快照：{err}"))?;
    Ok(content)
}

pub(super) fn abort_snapshot_upload(root: &Path, upload_id: &str) -> Result<(), String> {
    let path = snapshot_upload_path(root, upload_id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|err| format!("无法清理分段快照：{err}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("markdown-editor-repository-{name}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn ensure_dir_creates_nested_missing_directories() {
        let root = test_root("ensure-dir");
        let nested = root.join("a").join("b");
        assert!(!nested.exists());
        ensure_dir(&nested).unwrap();
        assert!(nested.is_dir());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn write_atomic_creates_new_file_and_overwrites_existing_target_without_leaving_temp() {
        let root = test_root("write-atomic");
        let target = root.join("value.md");
        write_atomic(&target, "第一版".as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "第一版");
        write_atomic(&target, "第二版".as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "第二版");
        assert!(!root.join("value.md.tmp").exists());
        fs::remove_dir_all(root).unwrap();
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
}

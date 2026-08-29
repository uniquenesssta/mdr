//! Document-store file IO primitives: durable writes, byte reads and directory operations.
//!
//! Responsibility: own only byte-level create/write/rename/directory operations shared across
//! callers. No recovery strategy, snapshot slot selection, integrity validation, journal entry
//! semantics, or upload-session lifecycle — those remain with their dedicated Stage 11 atomics.

use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

pub(super) fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|err| format!("无法创建文档存储目录：{err}"))
}

pub(super) fn read_if_exists(path: &Path) -> std::io::Result<Option<Vec<u8>>> {
    if path.exists() {
        fs::read(path).map(Some)
    } else {
        Ok(None)
    }
}

pub(super) fn remove_dir_if_exists(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        fs::remove_dir_all(path)?;
    }
    Ok(())
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
}

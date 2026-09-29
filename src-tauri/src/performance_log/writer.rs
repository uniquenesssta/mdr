//! Serialized JSONL appends. Redaction happens at this single persistence boundary.
use super::{paths::log_file_path, redaction::redact_value};
use serde_json::Value;
use std::{
    fs::OpenOptions,
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

pub(super) const MAX_BATCH_ENTRIES: usize = 500;
pub(super) const MAX_ENTRY_BYTES: usize = 64 * 1024;

static WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub(super) fn write_lock() -> &'static Mutex<()> {
    WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

pub(super) fn append_values(values: &[Value]) -> Result<PathBuf, String> {
    if !cfg!(debug_assertions) {
        return Ok(PathBuf::new());
    }
    if values.is_empty() {
        return log_file_path();
    }
    if values.len() > MAX_BATCH_ENTRIES {
        return Err(format!("单次性能日志数量不能超过 {MAX_BATCH_ENTRIES} 条"));
    }

    let file_path = log_file_path()?;
    let _guard = write_lock().lock().map_err(|_| "性能日志写入锁已损坏".to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .map_err(|err| format!("无法打开性能日志：{err}"))?;

    for value in values {
        let redacted = redact_value(value);
        let line = serde_json::to_string(&redacted).map_err(|err| format!("性能日志序列化失败：{err}"))?;
        if line.len() > MAX_ENTRY_BYTES {
            return Err(format!("单条性能日志不能超过 {MAX_ENTRY_BYTES} 字节"));
        }
        file.write_all(line.as_bytes())
            .and_then(|_| file.write_all(b"\n"))
            .map_err(|err| format!("性能日志写入失败：{err}"))?;
    }
    file.flush().map_err(|err| format!("性能日志刷新失败：{err}"))?;
    Ok(file_path)
}

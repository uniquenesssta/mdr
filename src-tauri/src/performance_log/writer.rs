//! Single serialized JSONL append/rollback boundary, shared by legacy and acknowledged batches.
use super::{paths::log_file_path, redaction::redact_value};
use serde_json::Value;
use std::{
    fs::{File, OpenOptions},
    io::{self, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
};

pub(super) const MAX_BATCH_ENTRIES: usize = 500;
pub(super) const MAX_ENTRY_BYTES: usize = 64 * 1024;
pub(super) const MAX_BATCH_BYTES: usize = 1024 * 1024;
pub(super) const MAX_LOG_BYTES: u64 = 16 * 1024 * 1024;
static WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static BLOCKED: AtomicBool = AtomicBool::new(false);
pub(super) fn write_lock() -> &'static Mutex<()> {
    WRITE_LOCK.get_or_init(|| Mutex::new(()))
}
pub(super) fn blocked() -> bool {
    BLOCKED.load(Ordering::Relaxed)
}
pub(super) fn block() {
    BLOCKED.store(true, Ordering::Relaxed);
}

pub(super) trait LogFile {
    fn length(&self) -> io::Result<u64>;
    fn frame(&mut self, bytes: &[u8]) -> io::Result<()>;
    fn truncate(&mut self, length: u64) -> io::Result<()>;
    fn finish(&mut self) -> io::Result<()>;
}
impl LogFile for File {
    fn length(&self) -> io::Result<u64> {
        Ok(self.metadata()?.len())
    }
    fn frame(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.seek(SeekFrom::End(0))?;
        self.write_all(bytes)
    }
    fn truncate(&mut self, length: u64) -> io::Result<()> {
        self.set_len(length)
    }
    fn finish(&mut self) -> io::Result<()> {
        self.flush()
    }
}
pub(super) struct Progress {
    pub accepted: usize,
    pub uncertain: bool,
    pub reason: &'static str,
}
pub(super) fn prepare(values: &[Value], limit: usize) -> Result<Vec<Vec<u8>>, String> {
    if values.len() > limit {
        return Err(format!("单次性能日志数量不能超过 {limit} 条"));
    }
    let mut frames = Vec::with_capacity(values.len());
    let mut bytes = 0;
    for value in values {
        let redacted = redact_value(value);
        let line = serde_json::to_string(&redacted).map_err(|_| "性能日志序列化失败".to_string())?;
        if line.len() > MAX_ENTRY_BYTES {
            return Err(format!("单条性能日志不能超过 {MAX_ENTRY_BYTES} 字节"));
        }
        bytes += line.len() + 1;
        if bytes > MAX_BATCH_BYTES {
            return Err("性能日志批次字节超限".into());
        }
        let mut frame = line.into_bytes();
        frame.push(b'\n');
        frames.push(frame);
    }
    Ok(frames)
}
pub(super) fn append_prepared(file: &mut impl LogFile, frames: &[Vec<u8>]) -> Progress {
    let mut result = Progress {
        accepted: 0,
        uncertain: false,
        reason: "ok",
    };
    for frame in frames {
        let start = match file.length() {
            Ok(length) => length,
            Err(_) => {
                result.reason = "metadata";
                break;
            }
        };
        if start.saturating_add(frame.len() as u64) > MAX_LOG_BYTES {
            result.reason = "file-limit";
            break;
        }
        if file.frame(frame).is_err() {
            result.reason = "write";
            if file.truncate(start).is_err() {
                result.uncertain = true;
                result.reason = "rollback";
            }
            break;
        }
        result.accepted += 1;
    }
    if result.accepted > 0 && file.finish().is_err() {
        result.uncertain = true;
        result.reason = "flush";
    }
    result
}
pub(super) fn append_values(values: &[Value]) -> Result<PathBuf, String> {
    if !cfg!(debug_assertions) {
        return Ok(PathBuf::new());
    }
    if values.is_empty() {
        return log_file_path();
    }
    let frames = prepare(values, MAX_BATCH_ENTRIES)?;
    let file_path = log_file_path()?;
    let _guard = write_lock().lock().map_err(|_| "性能日志写入锁已损坏".to_string())?;
    if blocked() {
        return Err("性能日志写入已隔离".into());
    }
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&file_path)
        .map_err(|err| format!("无法打开性能日志：{err}"))?;
    let progress = append_prepared(&mut file, &frames);
    if progress.uncertain {
        block();
    }
    if progress.accepted != frames.len() || progress.uncertain {
        return Err(format!("性能日志写入失败：{}", progress.reason));
    }
    Ok(file_path)
}

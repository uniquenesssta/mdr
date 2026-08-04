use serde_json::{json, Value};
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const MAX_BATCH_ENTRIES: usize = 500;
const MAX_ENTRY_BYTES: usize = 64 * 1024;

static WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static LOG_FILE_PATH: OnceLock<PathBuf> = OnceLock::new();

fn write_lock() -> &'static Mutex<()> {
    WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

fn unix_time_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis()
}

fn utc_timestamp_from_unix_ms(timestamp_ms: u128) -> String {
    let total_seconds = timestamp_ms / 1_000;
    let seconds_of_day = total_seconds % 86_400;
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    let millisecond = timestamp_ms % 1_000;

    let mut z = (total_seconds / 86_400) as i64;
    z += 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096)
            / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year =
        day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };

    format!(
        "{year:04}-{month:02}-{day:02}_{hour:02}-{minute:02}-{second:02}-{millisecond:03}"
    )
}

fn log_directory() -> Result<PathBuf, String> {
    if let Some(custom) = env::var_os("MARKDOWN_EDITOR_LOG_DIR") {
        let path = PathBuf::from(custom);
        fs::create_dir_all(&path).map_err(|err| format!("无法创建性能日志目录：{err}"))?;
        return Ok(path);
    }

    #[cfg(debug_assertions)]
    let path = {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest_dir
            .parent()
            .unwrap_or(manifest_dir.as_path())
            .join("logs")
    };

    #[cfg(not(debug_assertions))]
    let path = env::current_exe()
        .ok()
        .and_then(|value| value.parent().map(|parent| parent.join("logs")))
        .unwrap_or_else(|| PathBuf::from("logs"));

    fs::create_dir_all(&path).map_err(|err| format!("无法创建性能日志目录：{err}"))?;
    Ok(path)
}

fn log_file_path() -> Result<PathBuf, String> {
    if let Some(path) = LOG_FILE_PATH.get() {
        return Ok(path.clone());
    }

    let path = log_directory()?.join(format!(
        "performance-{}_pid-{}.jsonl",
        utc_timestamp_from_unix_ms(unix_time_ms()),
        std::process::id()
    ));
    let _ = LOG_FILE_PATH.set(path.clone());
    Ok(LOG_FILE_PATH.get().cloned().unwrap_or(path))
}

fn append_values(values: &[Value]) -> Result<PathBuf, String> {
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
    let _guard = write_lock()
        .lock()
        .map_err(|_| "性能日志写入锁已损坏".to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .map_err(|err| format!("无法打开性能日志：{err}"))?;

    for value in values {
        let line = serde_json::to_string(value).map_err(|err| format!("性能日志序列化失败：{err}"))?;
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

pub fn record_backend(
    category: &str,
    operation: &str,
    duration: Duration,
    status: &str,
    details: Value,
) {
    if !cfg!(debug_assertions) {
        return;
    }
    let entry = json!({
        "timestampMs": unix_time_ms(),
        "source": "rust",
        "category": category,
        "operation": operation,
        "durationMs": duration.as_secs_f64() * 1000.0,
        "status": status,
        "details": details
    });
    if let Err(err) = append_values(&[entry]) {
        eprintln!("performance log error: {err}");
    }
}

pub fn record_lifecycle(operation: &str) {
    record_backend(
        "app.lifecycle",
        operation,
        Duration::ZERO,
        "ok",
        json!({
            "debugBuild": cfg!(debug_assertions),
            "pid": std::process::id()
        }),
    );
}

pub async fn measure_async<T, E, F>(
    category: &str,
    operation: &str,
    details: Value,
    future: F,
) -> Result<T, E>
where
    F: std::future::Future<Output = Result<T, E>>,
{
    let started = Instant::now();
    let result = future.await;
    record_backend(
        category,
        operation,
        started.elapsed(),
        if result.is_ok() { "ok" } else { "error" },
        details,
    );
    result
}

pub fn measure_sync<T, E, F>(
    category: &str,
    operation: &str,
    details: Value,
    function: F,
) -> Result<T, E>
where
    F: FnOnce() -> Result<T, E>,
{
    let started = Instant::now();
    let result = function();
    record_backend(
        category,
        operation,
        started.elapsed(),
        if result.is_ok() { "ok" } else { "error" },
        details,
    );
    result
}

#[tauri::command]
pub fn write_performance_logs(entries: Vec<Value>) -> Result<String, String> {
    append_values(&entries).map(|path| path.to_string_lossy().to_string())
}

//! Development log directory and stable per-process session file identity.
use std::{
    env, fs,
    path::PathBuf,
    sync::OnceLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

static LOG_FILE_PATH: OnceLock<PathBuf> = OnceLock::new();

pub(super) fn unix_time_ms() -> u128 {
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
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };

    format!("{year:04}-{month:02}-{day:02}_{hour:02}-{minute:02}-{second:02}-{millisecond:03}")
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
        manifest_dir.parent().unwrap_or(manifest_dir.as_path()).join("logs")
    };

    #[cfg(not(debug_assertions))]
    let path = env::current_exe()
        .ok()
        .and_then(|value| value.parent().map(|parent| parent.join("logs")))
        .unwrap_or_else(|| PathBuf::from("logs"));

    fs::create_dir_all(&path).map_err(|err| format!("无法创建性能日志目录：{err}"))?;
    Ok(path)
}

pub(super) fn log_file_path() -> Result<PathBuf, String> {
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

#[cfg(test)]
mod tests {
    use super::super::writer::{MAX_BATCH_ENTRIES, MAX_ENTRY_BYTES};
    use super::utc_timestamp_from_unix_ms;

    #[test]
    fn stage_12_freezes_log_limits_and_utc_file_timestamp_shape() {
        assert_eq!(MAX_BATCH_ENTRIES, 500);
        assert_eq!(MAX_ENTRY_BYTES, 64 * 1024);
        assert_eq!(utc_timestamp_from_unix_ms(0), "1970-01-01_00-00-00-000");
        assert_eq!(utc_timestamp_from_unix_ms(1_704_164_645_678), "2024-01-02_03-04-05-678");
        assert_eq!(utc_timestamp_from_unix_ms(951_782_400_123), "2000-02-29_00-00-00-123");
        assert_eq!(utc_timestamp_from_unix_ms(1_704_067_199_999), "2023-12-31_23-59-59-999");
    }
}

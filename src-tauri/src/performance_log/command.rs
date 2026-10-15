use super::writer::append_values;
use serde_json::Value;

#[tauri::command]
pub fn write_performance_logs(entries: Vec<Value>) -> Result<String, String> {
    append_values(&entries).map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn write_performance_log_batch(
    entries: Vec<Value>,
    batch_id: String,
    offset: usize,
    attempt: u32,
    total: usize,
    query: bool,
) -> Result<Value, String> {
    if !cfg!(debug_assertions) {
        return super::batch::submit(entries, &batch_id, offset, attempt, total, query);
    }
    tauri::async_runtime::spawn_blocking(move || {
        super::batch::submit(entries, &batch_id, offset, attempt, total, query)
    })
    .await
    .map_err(|_| "log worker unavailable".to_string())?
}

use super::writer::append_values;
use serde_json::Value;

#[tauri::command]
pub fn write_performance_logs(entries: Vec<Value>) -> Result<String, String> {
    append_values(&entries).map(|path| path.to_string_lossy().to_string())
}

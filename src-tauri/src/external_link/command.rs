use super::opener::open_platform_url;
use super::validation::validate_external_url;

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let validated = validate_external_url(&url)?;
    open_platform_url(&validated)
}

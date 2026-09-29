use super::client::build_client;
use super::response::read_response;
use super::validation::normalize_url;
use super::FetchResponse;
use serde_json::json;

async fn fetch_url_inner(url: String) -> Result<FetchResponse, String> {
    let parsed = normalize_url(&url)?;

    let client = build_client()?;

    let response = client
        .get(parsed.clone())
        .send()
        .await
        .map_err(|err| format!("Request failed: {err}"))?;

    read_response(parsed, response).await
}

#[tauri::command]
pub async fn fetch_url(url: String) -> Result<FetchResponse, String> {
    let details = json!({
        "inputLength": url.len()
    });
    crate::performance_log::measure_async("native.command", "fetch_url", details, fetch_url_inner(url)).await
}

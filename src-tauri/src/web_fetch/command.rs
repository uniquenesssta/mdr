//! Tauri web-fetch commands: measured fetch and cancellation of app-owned requests.
//! URL, connection, response policy and cancellation state remain in their dedicated owners.
use super::client::{fetch_response, FETCH_TIMEOUT};
use super::requests::WebFetchRequests;
use super::response::read_response;
use super::validation::normalize_url;
use super::FetchResponse;
use serde_json::json;

pub(super) async fn fetch_url_inner(url: String) -> Result<FetchResponse, String> {
    let parsed = normalize_url(&url)?;
    tokio::time::timeout(FETCH_TIMEOUT, async {
        let response = fetch_response(&parsed).await?;
        read_response(parsed, response).await
    })
    .await
    .map_err(|_| "Request failed: web fetch exceeded 30 seconds".to_string())?
}

#[tauri::command]
pub async fn fetch_url(
    url: String,
    request_id: Option<String>,
    requests: tauri::State<'_, WebFetchRequests>,
) -> Result<FetchResponse, String> {
    let details = json!({ "inputLength": url.len() });
    crate::performance_log::measure_async(
        "native.command",
        "fetch_url",
        details,
        requests.run(request_id, fetch_url_inner(url)),
    )
    .await
}

#[tauri::command]
pub fn cancel_fetch_url(request_id: String, requests: tauri::State<'_, WebFetchRequests>) -> Result<(), String> {
    requests.cancel(&request_id)
}

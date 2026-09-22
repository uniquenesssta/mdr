//! Web-fetch response projection and existing error mapping.
//!
//! Owns the frozen status check, final URL and Content-Type reporting, text-body read,
//! empty-body rejection and FetchResponse DTO assembly.
//! Stateless per response; no URL input policy, client construction, Tauri command, logging,
//! response-size/content-type allowlist or redirect policy lives here. R12-S01 remains pending.

use reqwest::header::CONTENT_TYPE;
use serde::Serialize;
use url::Url;

#[derive(Debug, Serialize)]
pub struct FetchResponse {
    pub success: bool,
    pub url: String,
    pub final_url: String,
    pub status: u16,
    pub content_type: String,
    pub html: String,
}

pub(super) async fn read_response(parsed: Url, response: reqwest::Response) -> Result<FetchResponse, String> {
    let status = response.status();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !status.is_success() {
        return Err(format!("HTTP request failed with status {}", status.as_u16()));
    }

    let html = response
        .text()
        .await
        .map_err(|err| format!("Failed to read response body: {err}"))?;

    if html.trim().is_empty() {
        return Err("Response body is empty".into());
    }

    Ok(FetchResponse {
        success: true,
        url: parsed.to_string(),
        final_url,
        status: status.as_u16(),
        content_type,
        html,
    })
}

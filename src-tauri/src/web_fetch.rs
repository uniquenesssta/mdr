use serde_json::json;
mod client;
mod response;
mod validation;

use client::build_client;
use response::read_response;
pub use response::FetchResponse;
use validation::normalize_url;

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

// R12-01 rustfmt boundary: only the new pre-rewrite behavior tests below.
#[cfg(test)]
mod tests {
    use super::{client::browser_headers, normalize_url};
    use reqwest::header::{ACCEPT, ACCEPT_LANGUAGE, USER_AGENT};

    #[test]
    fn stage_12_preserves_url_normalization_and_scheme_policy() {
        assert_eq!(normalize_url(" ").expect_err("empty URL must fail"), "URL is empty");
        assert_eq!(
            normalize_url("example.com/path")
                .expect("bare host must receive HTTPS")
                .as_str(),
            "https://example.com/path"
        );
        assert_eq!(
            normalize_url("http://example.com/path")
                .expect("HTTP URL must stay HTTP")
                .as_str(),
            "http://example.com/path"
        );
        assert_eq!(
            normalize_url("https://example.com/path")
                .expect("HTTPS URL must stay HTTPS")
                .as_str(),
            "https://example.com/path"
        );
    }

    #[test]
    fn stage_12_preserves_browser_request_headers() {
        let headers = browser_headers();
        assert!(headers[USER_AGENT]
            .to_str()
            .expect("user agent must be text")
            .contains("Chrome/126.0.0.0"));
        assert_eq!(
            headers[ACCEPT].to_str().expect("accept must be text"),
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        );
        assert_eq!(
            headers[ACCEPT_LANGUAGE].to_str().expect("accept language must be text"),
            "zh-CN,zh;q=0.9,en;q=0.8"
        );
    }
}

#[cfg(test)]
#[path = "../tests/web_fetch/validation.rs"]
mod validation_tests;

#[cfg(test)]
#[path = "../tests/web_fetch/http_compatibility.rs"]
mod http_compatibility_tests;

use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, CONTENT_TYPE, USER_AGENT};
use serde::Serialize;
use serde_json::json;
use std::time::Duration;
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

fn normalize_url(input: &str) -> Result<Url, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".into());
    }

    let candidate = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    let parsed = Url::parse(&candidate).map_err(|err| format!("Invalid URL: {err}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        scheme => Err(format!("Unsupported URL scheme: {scheme}")),
    }
}

fn browser_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        ),
    );
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    );
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("zh-CN,zh;q=0.9,en;q=0.8"));
    headers
}

async fn fetch_url_inner(url: String) -> Result<FetchResponse, String> {
    let parsed = normalize_url(&url)?;

    let client = reqwest::Client::builder()
        .default_headers(browser_headers())
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|err| format!("Failed to create HTTP client: {err}"))?;

    let response = client
        .get(parsed.clone())
        .send()
        .await
        .map_err(|err| format!("Request failed: {err}"))?;

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

#[tauri::command]
pub async fn fetch_url(url: String) -> Result<FetchResponse, String> {
    let details = json!({
        "inputLength": url.len()
    });
    crate::performance_log::measure_async(
        "native.command",
        "fetch_url",
        details,
        fetch_url_inner(url),
    )
    .await
}

// R12-01 rustfmt boundary: only the new pre-rewrite behavior tests below.
#[cfg(test)]
mod tests {
    use super::{browser_headers, normalize_url};
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

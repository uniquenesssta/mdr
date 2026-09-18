//! Web-fetch reqwest client construction and browser request defaults.
//!
//! Owns the frozen browser headers, ten-redirect policy and thirty-second request timeout.
//! Compression and TLS remain compile-time reqwest features from Cargo.toml; no response handling lives here.
//! Stateless per-call builder: no shared client, response parsing, Tauri command or URL policy.

use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, USER_AGENT};
use std::time::Duration;

pub(super) fn browser_headers() -> HeaderMap {
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

pub(super) fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .default_headers(browser_headers())
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|err| format!("Failed to create HTTP client: {err}"))
}

#[cfg(test)]
mod tests {
    use super::{browser_headers, build_client};
    use reqwest::header::{ACCEPT, ACCEPT_LANGUAGE, USER_AGENT};

    #[test]
    fn keeps_the_frozen_browser_headers() {
        let headers = browser_headers();
        assert_eq!(
            headers[USER_AGENT].to_str().expect("user agent text"),
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        );
        assert_eq!(
            headers[ACCEPT].to_str().expect("accept text"),
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        );
        assert_eq!(
            headers[ACCEPT_LANGUAGE].to_str().expect("accept-language text"),
            "zh-CN,zh;q=0.9,en;q=0.8"
        );
    }

    #[test]
    fn builds_independent_clients_without_shared_state() {
        build_client().expect("first client");
        build_client().expect("second client");
    }
}

//! Web-fetch input URL normalization and parsed-scheme policy.
//!
//! Owns the existing trim, case-sensitive prefix check, HTTPS fallback and URL errors.
//! Pure and call-local; imports only `url`. No HTTP, response, Tauri or shared-state work.
//! Deliberately preserves legacy input reinterpretation. Response hardening is R12-S01.

use url::Url;

pub(super) fn normalize_url(input: &str) -> Result<Url, String> {
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

//! External-link URL admission policy.
//!
//! Owns trimming, URL parsing, the frozen four-scheme allowlist and stable validation errors.
//! Pure call-local policy: no Tauri commands, process launches, network or filesystem access.
//! Returns the trimmed original spelling, not a reserialized or normalized URL.

use url::Url;

pub(super) fn validate_external_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("链接地址为空".to_string());
    }

    let parsed = Url::parse(trimmed).map_err(|_| "链接格式无效".to_string())?;
    match parsed.scheme() {
        "http" | "https" | "mailto" | "tel" => Ok(trimmed.to_string()),
        _ => Err("不支持打开此链接".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::validate_external_url;

    #[test]
    fn allows_exactly_the_four_supported_scheme_families() {
        for value in [
            "http://example.com",
            "https://example.com",
            "mailto:test@example.com",
            "tel:+8613800000000",
        ] {
            assert_eq!(validate_external_url(value), Ok(value.to_string()));
        }
    }

    #[test]
    fn trims_unicode_whitespace_without_touching_url_content() {
        assert_eq!(
            validate_external_url(" \u{2003}https://example.com/path\u{00a0}"),
            Ok("https://example.com/path".into())
        );
    }

    #[test]
    fn preserves_original_case_percent_encoding_query_and_fragment() {
        let value = "HTTPS://EXAMPLE.COM/%2f?q=%2B#Part";
        assert_eq!(validate_external_url(&format!("  {value}  ")), Ok(value.into()));
        assert_eq!(
            validate_external_url("MAILTO:test@example.com"),
            Ok("MAILTO:test@example.com".into())
        );
    }

    #[test]
    fn preserves_unicode_paths_and_mailto_query_parameters() {
        for value in [
            "https://example.com/中文?q=内容",
            "mailto:test@example.com?subject=Hello%20World",
        ] {
            assert_eq!(validate_external_url(value), Ok(value.into()));
        }
    }

    #[test]
    fn rejects_empty_input_before_attempting_url_parsing() {
        for value in ["", "   ", "\t\r\n", "\u{2003}\u{00a0}"] {
            assert_eq!(validate_external_url(value), Err("链接地址为空".into()));
        }
    }

    #[test]
    fn rejects_dangerous_unknown_and_lookalike_protocols() {
        for value in [
            "javascript:alert(1)",
            "JAVASCRIPT:alert(1)",
            "file:///tmp/private.txt",
            "data:text/html,test",
            "vbscript:msgbox(1)",
            "ftp://example.com",
            "about:blank",
            "httpsx://example.com",
        ] {
            assert_eq!(validate_external_url(value), Err("不支持打开此链接".into()), "{value}");
        }
    }

    #[test]
    fn rejects_relative_missing_host_and_malformed_absolute_urls() {
        for value in [
            "not a url",
            "example.com",
            "/document.md",
            "//example.com",
            "http://",
            "https://[::1",
            "https://example.com:invalid",
        ] {
            assert_eq!(validate_external_url(value), Err("链接格式无效".into()), "{value}");
        }
    }

    #[test]
    fn successive_valid_and_invalid_calls_have_no_shared_state() {
        for _ in 0..3 {
            assert_eq!(
                validate_external_url("https://example.com"),
                Ok("https://example.com".into())
            );
            assert_eq!(validate_external_url("file:///tmp/x"), Err("不支持打开此链接".into()));
            assert_eq!(validate_external_url("tel:123"), Ok("tel:123".into()));
        }
    }
}

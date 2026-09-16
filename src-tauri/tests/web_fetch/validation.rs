//! Shared before/after behavior tests; no copy of the production normalizer.
use super::normalize_url;
use url::{ParseError, Url};

#[test]
fn empty_and_unicode_whitespace_keep_the_first_error() {
    for input in ["", " ", "\t\r\n", "\u{2003}\u{00a0}"] {
        assert_eq!(normalize_url(input), Err("URL is empty".into()));
    }
}

#[test]
fn bare_addresses_receive_https_after_trimming() {
    for (input, expected) in [
        ("example.com", "https://example.com/"),
        (
            " \u{2003}example.com/path?q=1#part\u{00a0}",
            "https://example.com/path?q=1#part",
        ),
        ("example.com:8443/page", "https://example.com:8443/page"),
    ] {
        assert_eq!(normalize_url(input).expect("bare address").as_str(), expected);
    }
}

#[test]
fn lowercase_http_https_ports_and_ipv6_keep_their_transport() {
    for value in [
        "http://example.com/a",
        "https://example.com:8443/a",
        "http://[::1]:8181/a",
    ] {
        assert_eq!(
            normalize_url(value),
            Url::parse(value).map_err(|error| error.to_string())
        );
    }
}

#[test]
fn serialization_keeps_parser_canonicalization_and_query_fragment() {
    let input = "https://EXAMPLE.COM:443/a/../中文?q=%2B#Part";
    let actual = normalize_url(input).expect("Unicode URL");
    assert_eq!(actual.as_str(), "https://example.com/%E4%B8%AD%E6%96%87?q=%2B#Part");
    assert_eq!(actual.query(), Some("q=%2B"));
    assert_eq!(actual.fragment(), Some("Part"));
}

#[test]
fn parse_errors_keep_the_existing_prefix_and_error_kind() {
    for (input, error) in [
        ("http://", ParseError::EmptyHost),
        ("https://[::1", ParseError::InvalidIpv6Address),
        ("https://example.com:bad", ParseError::InvalidPort),
        ("example.com:bad", ParseError::InvalidPort),
    ] {
        assert_eq!(normalize_url(input), Err(format!("Invalid URL: {error}")));
    }
}

#[test]
fn uppercase_prefix_keeps_legacy_https_fallback_instead_of_silent_repair() {
    for value in [
        "HTTP://example.com/path",
        "HTTPS://example.com/path",
        "HtTp://example.com/path",
    ] {
        let expected = Url::parse(&format!("https://{value}")).expect("legacy candidate");
        assert_eq!(normalize_url(value), Ok(expected));
    }
}

#[test]
fn non_http_input_keeps_legacy_reinterpretation_not_external_link_policy() {
    for (input, candidate) in [
        ("ftp://example.com/path", "https://ftp://example.com/path"),
        ("mailto:test@example.com", "https://mailto:test@example.com"),
        ("//example.com/path", "https:////example.com/path"),
    ] {
        let expected = Url::parse(candidate).expect("legacy fallback candidate");
        assert_eq!(expected.scheme(), "https");
        assert_eq!(normalize_url(input), Ok(expected));
    }
    assert_eq!(
        normalize_url("javascript:alert(1)"),
        Err(format!("Invalid URL: {}", ParseError::InvalidPort))
    );
}

#[test]
fn repeated_calls_have_no_shared_state() {
    for _ in 0..3 {
        assert_eq!(normalize_url(" "), Err("URL is empty".into()));
        assert_eq!(
            normalize_url("example.com").expect("next call").as_str(),
            "https://example.com/"
        );
        assert_eq!(normalize_url("http://example.com").expect("HTTP call").scheme(), "http");
    }
}

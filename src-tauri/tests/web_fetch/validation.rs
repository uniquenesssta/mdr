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
fn uppercase_http_prefixes_are_normalized_without_reinterpreting_the_host() {
    for value in [
        "HTTP://example.com/path",
        "HTTPS://example.com/path",
        "HtTp://example.com/path",
    ] {
        assert_eq!(normalize_url(value).unwrap().host_str(), Some("example.com"));
    }
}

#[test]
fn non_http_schemes_credentials_controls_and_backslashes_are_rejected() {
    for value in [
        "ftp://example.com/path",
        "mailto:test@example.com",
        "javascript:alert(1)",
        "https://user:pass@example.com",
        "https://example.com/\\evil",
        "https://exa\nmple.com",
    ] {
        assert!(normalize_url(value).is_err(), "{value}");
    }
    assert_eq!(
        normalize_url("//example.com/path").unwrap().as_str(),
        "https://example.com/path"
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

#[test]
fn public_address_policy_rejects_all_special_and_encoded_local_forms() {
    for address in [
        "0.0.0.0",
        "10.1.2.3",
        "127.0.0.1",
        "100.64.0.1",
        "169.254.169.254",
        "172.16.0.1",
        "192.168.0.1",
        "192.0.0.9",
        "192.0.2.1",
        "192.88.99.1",
        "198.18.0.1",
        "198.51.100.1",
        "203.0.113.1",
        "224.0.0.1",
        "255.255.255.255",
        "::",
        "::1",
        "fc00::1",
        "fe80::1",
        "ff02::1",
        "::ffff:127.0.0.1",
        "64:ff9b::7f00:1",
        "2002:7f00:1::",
        "2001:db8::1",
        "2001::1",
        "3fff::1",
    ] {
        assert!(
            !super::validation::is_public_address(address.parse().unwrap()),
            "{address}"
        );
    }
    for address in [
        "8.8.8.8",
        "1.1.1.1",
        "93.184.216.34",
        "2606:4700:4700::1111",
        "2001:4860:4860::8888",
    ] {
        assert!(
            super::validation::is_public_address(address.parse().unwrap()),
            "{address}"
        );
    }
    for url in [
        "http://2130706433",
        "http://0x7f000001",
        "http://127.1",
        "http://[::ffff:127.0.0.1]",
    ] {
        let parsed = normalize_url(url).unwrap();
        let address = match parsed.host().unwrap() {
            url::Host::Ipv4(ip) => ip.into(),
            url::Host::Ipv6(ip) => ip.into(),
            _ => panic!("numeric address"),
        };
        assert!(!super::validation::is_public_address(address));
    }
    for name in [
        "http://localhost",
        "http://LOCALHOST.",
        "http://other.localhost",
        "http://printer.local",
    ] {
        assert!(normalize_url(name).is_err());
    }
}

#[test]
fn every_resolved_address_and_redirect_scheme_must_be_allowed() {
    let public = "8.8.8.8:80".parse().unwrap();
    let private = "127.0.0.1:80".parse().unwrap();
    assert!(super::client::validate_addresses(&[]).is_err());
    assert!(super::client::validate_addresses(&[public, private]).is_err());
    assert!(super::client::validate_addresses(&[public]).is_ok());
    let https = Url::parse("https://example.com").unwrap();
    for next in [
        "http://example.com",
        "file:///etc/file",
        "ftp://example.com",
        "https://user@example.com",
    ] {
        assert!(super::validation::validate_redirect(&https, &Url::parse(next).unwrap()).is_err());
    }
    assert!(super::validation::validate_redirect(&https, &https).is_ok());
}

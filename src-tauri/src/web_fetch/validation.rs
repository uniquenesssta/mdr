//! Pure URL and public-address policy for initial and redirected web targets.
//! DNS and transport belong to client.rs; these rules never grant test/network exceptions.
use std::net::IpAddr;
use url::Url;

pub(super) fn normalize_url(input: &str) -> Result<Url, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".into());
    }
    if trimmed.contains('\\') || trimmed.chars().any(char::is_control) {
        return Err("Invalid URL: control characters or backslashes".into());
    }
    let lower = trimmed.to_ascii_lowercase();
    let candidate = if lower.starts_with("http://") || lower.starts_with("https://") {
        trimmed.to_string()
    } else if trimmed.starts_with("//") {
        format!("https:{trimmed}")
    } else {
        // A bare host:port remains supported. Never reinterpret an explicit foreign scheme.
        if trimmed.contains("://")
            || trimmed.split_once(':').is_some_and(|(prefix, rest)| {
                !prefix.contains('.') && !prefix.starts_with('[') && !rest.starts_with(|c: char| c.is_ascii_digit())
            })
        {
            return Err("Unsupported URL scheme: only HTTP(S) is allowed".into());
        }
        format!("https://{trimmed}")
    };
    let parsed = Url::parse(&candidate).map_err(|err| format!("Invalid URL: {err}"))?;
    validate_url(&parsed)?;
    Ok(parsed)
}

pub(super) fn validate_url(url: &Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Unsupported URL scheme: only HTTP(S) is allowed".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Web fetch does not accept URL credentials".into());
    }
    let host = url.host_str().ok_or("Invalid URL: missing host")?;
    let name = host.trim_end_matches('.').to_ascii_lowercase();
    if name == "localhost" || name.ends_with(".localhost") || name.ends_with(".local") {
        return Err("Web fetch only allows public network addresses".into());
    }
    Ok(())
}

pub(super) fn validate_redirect(from: &Url, to: &Url) -> Result<(), String> {
    validate_url(to)?;
    if from.scheme() == "https" && to.scheme() == "http" {
        return Err("Web fetch refuses HTTPS to HTTP redirects".into());
    }
    Ok(())
}

pub(super) fn is_public_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && (b == 168 || (b == 0 && (c == 0 || c == 2)) || (b == 88 && c == 99)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            let s = ip.segments();
            // Only global unicast, excluding special/transition/documentation networks.
            // This also rejects loopback, ULA, link-local, mapped IPv4 and NAT64 encodings.
            (s[0] & 0xe000) == 0x2000
                && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
                && s[0] != 0x2002
                && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}

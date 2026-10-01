//! Request transport: public DNS validation, pinned connections and explicit per-hop redirects.
//! Each call owns its clients; proxies and automatic redirects/decompression cannot bypass policy.
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

pub(super) const FETCH_TIMEOUT: Duration = Duration::from_secs(30);
pub(super) const MAX_REDIRECTS: usize = 10;

#[cfg(test)]
pub(super) fn build_client() -> Result<reqwest::Client, String> {
    client_builder()
        .build()
        .map_err(|err| format!("Failed to create HTTP client: {err}"))
}

pub(super) fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .default_headers(browser_headers())
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .timeout(FETCH_TIMEOUT)
}

pub(super) async fn resolve_public(url: url::Url) -> Result<Vec<std::net::SocketAddr>, String> {
    use std::net::SocketAddr;
    use url::Host;
    let port = url.port_or_known_default().ok_or("Invalid URL port")?;
    let addresses: Vec<SocketAddr> = match url.host().ok_or("Invalid URL host")? {
        Host::Ipv4(ip) => vec![SocketAddr::new(ip.into(), port)],
        Host::Ipv6(ip) => vec![SocketAddr::new(ip.into(), port)],
        Host::Domain(host) => tokio::net::lookup_host((host, port))
            .await
            .map_err(|_| "Web fetch DNS resolution failed")?
            .collect(),
    };
    validate_addresses(&addresses)?;
    Ok(addresses)
}

pub(super) fn validate_addresses(addresses: &[std::net::SocketAddr]) -> Result<(), String> {
    if addresses.is_empty()
        || addresses
            .iter()
            .any(|addr| !super::validation::is_public_address(addr.ip()))
    {
        return Err("Web fetch only allows public network addresses".into());
    }
    Ok(())
}

pub(super) async fn fetch_response(initial: &url::Url) -> Result<reqwest::Response, String> {
    fetch_with_resolver(initial, resolve_public, client_builder).await
}

// The resolver is a private transport boundary. Production always uses resolve_public;
// tests can connect an owned server without adding a loopback exception to product policy.
pub(super) async fn fetch_with_resolver<F, Fut>(
    initial: &url::Url,
    mut resolve: F,
    builder: impl Fn() -> reqwest::ClientBuilder,
) -> Result<reqwest::Response, String>
where
    F: FnMut(url::Url) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<std::net::SocketAddr>, String>>,
{
    let mut current = initial.clone();
    let mut visited = std::collections::HashSet::new();
    for hop in 0..=MAX_REDIRECTS {
        super::validation::validate_url(&current)?;
        let mut key = current.clone();
        key.set_fragment(None);
        if !visited.insert(key) {
            return Err("Request failed: redirect loop".into());
        }
        let addresses = resolve(current.clone()).await?;
        if addresses.is_empty() {
            return Err("Web fetch DNS resolution failed".into());
        }
        let client = builder()
            .resolve_to_addrs(current.host_str().ok_or("Invalid URL host")?, &addresses)
            .build()
            .map_err(|_| "Failed to create HTTP client")?;
        let response = client
            .get(current.clone())
            .header(reqwest::header::ACCEPT_ENCODING, "gzip, br, deflate")
            .send()
            .await
            .map_err(|_| "Request failed: HTTP transport error")?;
        // No proxy, no second DNS lookup, and no connection to an unvalidated peer.
        if !response.remote_addr().is_some_and(|peer| addresses.contains(&peer)) {
            return Err("Web fetch connected to an unexpected address".into());
        }
        if matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
            if hop == MAX_REDIRECTS {
                return Err("Request failed: redirect limit".into());
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("Request failed: invalid redirect location")?;
            if response.headers().get_all(reqwest::header::LOCATION).iter().count() != 1
                || location.contains('\\')
                || location.chars().any(char::is_control)
            {
                return Err("Request failed: invalid redirect location".into());
            }
            let next = current
                .join(location)
                .map_err(|_| "Request failed: invalid redirect URL")?;
            super::validation::validate_redirect(&current, &next)?;
            current = next;
            // Dropping this response stops its body before following the next target.
        } else {
            return Ok(response);
        }
    }
    Err("Request failed: redirect limit".into())
}

#[cfg(test)]
mod tests {
    use super::{browser_headers, build_client};
    use reqwest::header::{ACCEPT, ACCEPT_LANGUAGE, USER_AGENT};

    #[cfg(windows)]
    mod tls_server {
        include!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/web_fetch/tls_server.rs"));
    }

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
        let first = build_client().expect("first client");
        build_client().expect("second client");
        #[cfg(windows)]
        {
            let server = tls_server::OwnedTlsServer::start();
            let root =
                reqwest::Certificate::from_pem(include_bytes!("../../../tests/fixtures/dependency-tls/root-ca.pem"));
            // Test-only trust addition; production build_client retains public roots.
            let trusted = reqwest::Client::builder()
                .add_root_certificate(root.expect("owned test CA"))
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .expect("owned-CA client");
            tauri::async_runtime::block_on(async {
                let response = trusted.get(&server.url).send().await.expect("TLS 1.3 handshake");
                assert_eq!(response.status(), reqwest::StatusCode::OK);
                assert_eq!(
                    response.text().await.expect("HTTPS text"),
                    "R12-23 owned TLS 1.3 中文🙂"
                );
                let error = first
                    .get(&server.url)
                    .send()
                    .await
                    .expect_err("production must reject the untrusted CA");
                assert!(
                    error.is_connect(),
                    "untrusted TLS certificate must fail connection: {error:?}"
                );
            });
        }
        #[cfg(not(windows))]
        drop(first);
    }
}

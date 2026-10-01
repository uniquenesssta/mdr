//! Real owned HTTP transport/response regressions with a test-only DNS mapping.
//! The .test hostname maps to loopback only here; production policy is tested separately.
//! The server owns its listener/thread and always stops and joins; no global environment changes.
use super::FetchResponse;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

struct Server {
    url: String,
    stop: Arc<AtomicBool>,
    seen: Arc<AtomicBool>,
    peer_closed: Arc<AtomicBool>,
    worker: Option<JoinHandle<Result<Vec<String>, String>>>,
}

impl Server {
    fn start(handler: impl Fn(&str) -> Option<Vec<u8>> + Send + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("loopback listener");
        listener.set_nonblocking(true).expect("nonblocking listener");
        let url = format!(
            "http://web-fetch.test:{}",
            listener.local_addr().expect("bound address").port()
        );
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let seen = Arc::new(AtomicBool::new(false));
        let peer_closed = Arc::new(AtomicBool::new(false));
        let request_seen = seen.clone();
        let closed = peer_closed.clone();
        let worker = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(45);
            let mut requests = Vec::new();
            while !stopped.load(Ordering::SeqCst) && Instant::now() < deadline {
                let (mut stream, _) = match listener.accept() {
                    Ok(connection) => connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(error) => return Err(format!("accept: {error}")),
                };
                // Windows accepted sockets can inherit the listener nonblocking mode.
                stream.set_nonblocking(false).map_err(|e| e.to_string())?;
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .map_err(|e| e.to_string())?;
                stream
                    .set_write_timeout(Some(Duration::from_secs(2)))
                    .map_err(|e| e.to_string())?;
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    let mut byte = [0];
                    stream.read_exact(&mut byte).map_err(|e| format!("read request: {e}"))?;
                    request.push(byte[0]);
                    if request.len() > 16_384 {
                        return Err("request header limit".into());
                    }
                }
                let request = String::from_utf8(request).map_err(|e| e.to_string())?;
                let reply = handler(&request);
                let body_stall = request.starts_with("GET /body-stall ");
                requests.push(request);
                request_seen.store(true, Ordering::SeqCst);
                match reply {
                    Some(bytes) => {
                        if let Err(error) = stream.write_all(&bytes) {
                            if !matches!(
                                error.kind(),
                                std::io::ErrorKind::BrokenPipe
                                    | std::io::ErrorKind::WouldBlock
                                    | std::io::ErrorKind::ConnectionReset
                                    | std::io::ErrorKind::ConnectionAborted
                                    | std::io::ErrorKind::TimedOut
                            ) {
                                return Err(format!("write response: {error}"));
                            }
                        }
                    }
                    None => {
                        if body_stall {
                            stream
                                .write_all(
                                    b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 1024\r\n\r\n<p>",
                                )
                                .map_err(|e| e.to_string())?;
                        }
                        stream
                            .set_read_timeout(Some(Duration::from_millis(100)))
                            .map_err(|e| e.to_string())?;
                        while !stopped.load(Ordering::SeqCst) && Instant::now() < deadline {
                            match stream.read(&mut [0]) {
                                Ok(0) => {
                                    closed.store(true, Ordering::SeqCst);
                                    break;
                                }
                                Err(e)
                                    if matches!(
                                        e.kind(),
                                        std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
                                    ) =>
                                {
                                    closed.store(true, Ordering::SeqCst);
                                    break;
                                }
                                Err(e)
                                    if matches!(
                                        e.kind(),
                                        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                                    ) => {}
                                Err(e) => return Err(e.to_string()),
                                _ => {}
                            }
                        }
                    }
                }
            }
            if !stopped.load(Ordering::SeqCst) {
                return Err("fixture lifetime exceeded".into());
            }
            Ok(requests)
        });
        Self {
            url,
            stop,
            seen,
            peer_closed,
            worker: Some(worker),
        }
    }

    fn finish(mut self) -> Vec<String> {
        self.stop.store(true, Ordering::SeqCst);
        self.worker
            .take()
            .expect("owned server thread")
            .join()
            .expect("server panic")
            .expect("server error")
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            let result = worker.join();
            if !thread::panicking() {
                result
                    .expect("server panic during cleanup")
                    .expect("server error during cleanup");
            } else if !matches!(result, Ok(Ok(_))) {
                eprintln!("HTTP fixture also failed during panic cleanup");
            }
        }
    }
}

fn response(status: u16, headers: &str, body: &[u8]) -> Vec<u8> {
    let mut bytes = format!(
        "HTTP/1.1 {status} Fixture\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n",
        body.len()
    )
    .into_bytes();
    bytes.extend_from_slice(body);
    bytes
}

fn fetch(value: String) -> Result<FetchResponse, String> {
    tauri::async_runtime::block_on(fetch_owned(value))
}

async fn fetch_owned(value: String) -> Result<FetchResponse, String> {
    let parsed = super::validation::normalize_url(&value)?;
    tokio::time::timeout(super::client::FETCH_TIMEOUT, async {
        let response = super::client::fetch_with_resolver(
            &parsed,
            |target| async move {
                if target.host_str() == Some("web-fetch.test") {
                    Ok(vec![std::net::SocketAddr::from((
                        [127, 0, 0, 1],
                        target.port().unwrap(),
                    ))])
                } else {
                    super::client::resolve_public(target).await
                }
            },
            super::client::client_builder,
        )
        .await?;
        super::response::read_response(parsed, response).await
    })
    .await
    .map_err(|_| "Request failed: web fetch exceeded 30 seconds".to_string())?
}

#[test]
fn real_http_preserves_payload_unicode_and_browser_headers() {
    let server = Server::start(|_| {
        Some(response(
            200,
            "Content-Type: text/html; charset=utf-8\r\n",
            "<p>中文🙂</p>".as_bytes(),
        ))
    });
    let url = format!("{}/page?q=%2B", server.url);
    let result = fetch(format!("  {url}  "));
    let requests = server.finish();
    let payload = serde_json::to_value(result.expect("real fetch")).expect("wire serialization");
    assert_eq!(
        payload,
        serde_json::json!({
            "success": true, "url": url, "final_url": url, "status": 200,
            "content_type": "text/html; charset=utf-8", "html": "<p>中文🙂</p>"
        })
    );
    assert_eq!(requests.len(), 1);
    assert!(requests[0].starts_with("GET /page?q=%2B HTTP/1.1\r\n"));
    let headers = requests[0].to_ascii_lowercase();
    assert!(headers.contains("chrome/126.0.0.0"));
    assert!(headers.contains("accept-language: zh-cn,zh;q=0.9,en;q=0.8"));
    assert!(headers.contains("accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
}

#[test]
fn bounded_gzip_decompression_preserves_existing_text() {
    const GZIP_BODY: &[u8] = &[
        31, 139, 8, 0, 0, 0, 0, 0, 2, 255, 75, 206, 207, 45, 40, 74, 45, 46, 78, 77, 81, 200, 72, 205, 201, 201, 87,
        120, 178, 99, 237, 179, 105, 237, 31, 230, 207, 108, 2, 0, 221, 211, 75, 187, 27, 0, 0, 0,
    ];
    let server = Server::start(|_| {
        Some(response(
            200,
            "Content-Type: text/html; charset=utf-8\r\nContent-Encoding: gzip\r\n",
            GZIP_BODY,
        ))
    });
    let result = fetch(server.url.clone()).expect("gzip response");
    let requests = server.finish();
    assert_eq!(result.html, "compressed hello 中文🙂");
    assert_eq!(requests.len(), 1);
    assert!(requests[0].to_ascii_lowercase().contains("accept-encoding: "));
}

#[test]
fn missing_and_non_html_types_are_rejected_before_body_read() {
    for content_type in ["", "application/octet-stream", "application/json", "image/png"] {
        let header = if content_type.is_empty() {
            String::new()
        } else {
            format!("Content-Type: {content_type}\r\n")
        };
        let body = "x".repeat(2 * 1024 * 1024);
        let server = Server::start(move |_| Some(response(200, &header, body.as_bytes())));
        let result = fetch(server.url.clone());
        let requests = server.finish();
        assert!(result
            .expect_err("HTML MIME is required")
            .contains("HTML/XHTML Content-Type"));
        assert_eq!(requests.len(), 1);
    }
}

#[test]
fn redirects_keep_initial_and_final_url_and_final_reported_type() {
    let server = Server::start(|request| {
        Some(if request.starts_with("GET /start ") {
            response(302, "Location: /final\r\nContent-Type: image/png\r\n", b"")
        } else {
            response(200, "Content-Type: text/html\r\n", b"redirected")
        })
    });
    let initial = format!("{}/start", server.url);
    let final_url = format!("{}/final", server.url);
    let result = fetch(initial.clone());
    let requests = server.finish();
    let result = result.expect("redirect fetch");
    assert_eq!(result.url, initial);
    assert_eq!(result.final_url, final_url);
    assert_eq!(result.content_type, "text/html");
    assert_eq!(result.html, "redirected");
    assert_eq!(requests.len(), 2);
}

#[test]
fn redirect_loops_still_fail_with_the_existing_request_error() {
    let server = Server::start(|_| Some(response(302, "Location: /again\r\n", b"")));
    let result = fetch(format!("{}/again", server.url));
    let requests = server.finish();
    assert!(result.expect_err("redirect limit").starts_with("Request failed: "));
    assert_eq!(requests.len(), 1, "loop must be rejected before a repeated request");
}

#[test]
fn status_empty_and_truncated_body_errors_keep_their_order_and_text() {
    for (bytes, exact, expected) in [
        (response(404, "", b""), true, "HTTP request failed with status 404"),
        (
            response(200, "Content-Type: text/html\r\n", b" \r\n\t"),
            true,
            "Response body is empty",
        ),
        (
            b"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 20\r\nContent-Type: text/html\r\n\r\nshort"
                .to_vec(),
            false,
            "Failed to read response body: ",
        ),
    ] {
        let server = Server::start(move |_| Some(bytes.clone()));
        let result = fetch(server.url.clone());
        server.finish();
        let error = result.expect_err("response must fail");
        if exact {
            assert_eq!(error, expected);
        } else {
            assert!(error.starts_with(expected), "{error}");
        }
    }
}

#[test]
fn backend_rejects_invalid_inputs_before_any_http_request() {
    let server = Server::start(|_| Some(response(200, "", b"unexpected")));
    assert_eq!(fetch(" \u{2003}".into()).expect_err("empty input"), "URL is empty");
    let error = fetch(format!("{}:bad", server.url)).expect_err("malformed port");
    let requests = server.finish();
    assert!(error.starts_with("Invalid URL: "));
    assert!(requests.is_empty());
}

#[test]
fn errors_and_successive_fetches_do_not_share_response_state() {
    let server = Server::start(|request| {
        Some(if request.starts_with("GET /bad ") {
            response(503, "", b"unavailable")
        } else {
            response(200, "Content-Type: text/html\r\n", b"next request")
        })
    });
    let first = fetch(format!("{}/bad", server.url));
    let second = fetch(format!("{}/good", server.url));
    let third = fetch(format!("{}/again", server.url));
    let requests = server.finish();
    assert_eq!(first.expect_err("HTTP failure"), "HTTP request failed with status 503");
    assert_eq!(second.expect("retry").html, "next request");
    assert_eq!(third.expect("independent call").html, "next request");
    assert_eq!(requests.len(), 3);
}

#[test]
fn real_request_retains_the_thirty_second_timeout() {
    let server = Server::start(|_| None);
    let start = Instant::now();
    let result = fetch(server.url.clone());
    let elapsed = start.elapsed();
    let requests = server.finish();
    let error = result.expect_err("stalled server must time out");
    assert!(error.starts_with("Request failed: "), "{error}");
    assert!(
        elapsed >= Duration::from_secs(29) && elapsed < Duration::from_secs(44),
        "{elapsed:?}"
    );
    assert_eq!(requests.len(), 1);
}

#[test]
fn encoded_limit_counts_actual_bytes_with_length_missing_and_chunked() {
    use super::response::MAX_ENCODED_BYTES;
    for mode in ["length", "missing", "chunked"] {
        for size in [MAX_ENCODED_BYTES, MAX_ENCODED_BYTES + 1] {
            let body = vec![b'x'; size];
            let server = Server::start(move |_| {
                let bytes = match mode {
                    "length" => response(200, "Content-Type: text/html\r\n", &body),
                    "missing" => [b"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: text/html\r\n\r\n".as_slice(), &body].concat(),
                    _ => [format!("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n", body.len()).as_bytes(), &body, b"\r\n0\r\n\r\n"].concat(),
                };
                Some(bytes)
            });
            let result = fetch(server.url.clone());
            server.finish();
            if size == MAX_ENCODED_BYTES {
                assert_eq!(result.unwrap().html.len(), size, "{mode}");
            } else {
                assert!(result.unwrap_err().contains("encoded limit"), "{mode}");
            }
        }
    }
}

#[test]
fn compressed_limits_and_all_supported_codecs_use_real_http_bodies() {
    use async_compression::tokio::bufread::{BrotliEncoder, GzipEncoder, ZlibEncoder};
    use tokio::io::{AsyncRead, AsyncReadExt};
    for encoding in ["gzip", "br", "deflate"] {
        for size in [
            super::response::MAX_DECODED_BYTES,
            super::response::MAX_DECODED_BYTES + 1,
        ] {
            let body = vec![b'x'; size];
            let compressed = tauri::async_runtime::block_on(async {
                let mut encoder: Box<dyn AsyncRead + Unpin> = match encoding {
                    "gzip" => Box::new(GzipEncoder::new(body.as_slice())),
                    "br" => Box::new(BrotliEncoder::new(body.as_slice())),
                    _ => Box::new(ZlibEncoder::new(body.as_slice())),
                };
                let mut compressed = Vec::new();
                encoder.read_to_end(&mut compressed).await.unwrap();
                compressed
            });
            assert!(compressed.len() < super::response::MAX_ENCODED_BYTES);
            let server = Server::start(move |_| {
                Some(response(
                    200,
                    &format!("Content-Type: text/html\r\nContent-Encoding: {encoding}\r\n"),
                    &compressed,
                ))
            });
            let result = fetch(server.url.clone());
            server.finish();
            if size == super::response::MAX_DECODED_BYTES {
                assert_eq!(result.unwrap().html.len(), size);
            } else {
                assert!(result.unwrap_err().contains("decoded limit"));
            }
        }
    }
}

#[test]
fn misleading_lengths_mime_and_compression_do_not_bypass_limits() {
    let cases = [
        (
            b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 3\r\nContent-Length: 9\r\n\r\n123456789"
                .to_vec(),
            "Request failed",
        ),
        (
            response(200, "Content-Type: text/html\r\nContent-Type: image/png\r\n", b"x"),
            "HTML/XHTML",
        ),
        (
            response(200, "Content-Type: text/html\r\n", b"\x89PNG\r\n\x1a\n"),
            "binary",
        ),
        (
            response(
                200,
                "Content-Type: text/html\r\nContent-Encoding: gzip\r\n",
                b"invalid gzip",
            ),
            "invalid compression",
        ),
        (
            response(200, "Content-Type: text/html\r\nContent-Encoding: gzip, br\r\n", b"x"),
            "Unsupported response encoding",
        ),
    ];
    for (bytes, error) in cases {
        let server = Server::start(move |_| Some(bytes.clone()));
        let result = fetch(server.url.clone());
        server.finish();
        assert!(result.unwrap_err().contains(error), "{error}");
    }
    let server = Server::start(|_| {
        Some(response(
            200,
            "Content-Type: Application/XHTML+XML; charset=utf-8\r\n",
            b"<html><p>normal</p></html>",
        ))
    });
    assert!(fetch(server.url.clone()).unwrap().html.contains("normal"));
    server.finish();
}

#[test]
fn production_blocks_loopback_and_redirects_to_private_or_foreign_targets_before_connecting() {
    let server = Server::start(|_| Some(response(200, "Content-Type: text/html\r\n", b"forbidden")));
    let local = server.url.replace("web-fetch.test", "127.0.0.1");
    let result = tauri::async_runtime::block_on(super::command::fetch_url_inner(local));
    assert!(result.unwrap_err().contains("public network"));
    assert!(server.finish().is_empty());
    for location in [
        "http://127.0.0.1:9/private",
        "http://[::1]:9/private",
        "http://169.254.169.254/metadata",
        "file:///tmp/test",
        "https://user@example.com",
    ] {
        let server = Server::start(move |_| Some(response(302, &format!("Location: {location}\r\n"), b"")));
        assert!(fetch(server.url.clone()).is_err());
        assert_eq!(
            server.finish().len(),
            1,
            "blocked redirect must not reach another server"
        );
    }
}

#[test]
fn each_hop_resolves_again_and_changed_dns_answers_are_rejected() {
    let server = Server::start(|_| Some(response(302, "Location: /next\r\n", b"")));
    let initial = super::normalize_url(&server.url).unwrap();
    let mut resolutions = 0;
    let result = tauri::async_runtime::block_on(super::client::fetch_with_resolver(
        &initial,
        |target| {
            resolutions += 1;
            let result = if resolutions == 1 {
                Ok(vec![std::net::SocketAddr::from((
                    [127, 0, 0, 1],
                    target.port().unwrap(),
                ))])
            } else {
                let changed = ["127.0.0.1:80".parse().unwrap()];
                super::client::validate_addresses(&changed).map(|_| changed.to_vec())
            };
            std::future::ready(result)
        },
        super::client::client_builder,
    ));
    assert!(result.unwrap_err().contains("public network"));
    assert_eq!(resolutions, 2);
    assert_eq!(server.finish().len(), 1);
}

#[test]
fn ten_redirects_succeed_and_an_eleventh_is_rejected() {
    for redirects in [10, 11] {
        let server = Server::start(move |request| {
            let path = request.split_whitespace().nth(1).unwrap();
            let index: usize = path.trim_start_matches('/').parse().unwrap();
            Some(if index < redirects {
                response(302, &format!("Location: /{}\r\n", index + 1), b"")
            } else {
                response(200, "Content-Type: text/html\r\n", b"done")
            })
        });
        let result = fetch(format!("{}/0", server.url));
        assert_eq!(server.finish().len(), 11);
        if redirects == 10 {
            assert_eq!(result.unwrap().html, "done");
        } else {
            assert!(result.unwrap_err().contains("redirect limit"));
        }
    }
}

#[test]
fn native_cancel_drops_pending_headers_and_body_connections() {
    for path in ["/header-stall", "/body-stall"] {
        let server = Server::start(|_| None);
        let owner = Arc::new(super::requests::WebFetchRequests::default());
        tauri::async_runtime::block_on(async {
            let running_owner = owner.clone();
            let request_id = format!(
                "{}-cancel-owned",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis()
            );
            let running_id = request_id.clone();
            let url = format!("{}{path}", server.url);
            let task = tokio::spawn(async move { running_owner.run(Some(running_id), fetch_owned(url)).await });
            let until = Instant::now() + Duration::from_secs(5);
            while !server.seen.load(Ordering::SeqCst) && Instant::now() < until {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            assert!(server.seen.load(Ordering::SeqCst), "request must reach owned server");
            // Let the partial-body fixture write its headers before cancellation.
            tokio::time::sleep(Duration::from_millis(50)).await;
            owner.cancel(&request_id).unwrap();
            assert_eq!(task.await.unwrap().unwrap_err(), "WEB_FETCH_CANCELLED");
            while !server.peer_closed.load(Ordering::SeqCst) && Instant::now() < until {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            assert!(
                server.peer_closed.load(Ordering::SeqCst),
                "cancel must close the actual socket"
            );
        });
        server.finish();
    }
}

#[cfg(windows)]
mod tls_server {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/web_fetch/tls_server.rs"));
}

#[cfg(windows)]
#[test]
fn actual_https_keeps_certificate_validation_and_blocks_downgrade() {
    let server = tls_server::OwnedTlsServer::start();
    let root = reqwest::Certificate::from_pem(include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/dependency-tls/root-ca.pem"
    )))
    .unwrap();
    for (path, expected) in [("/html", "normal TLS HTML"), ("/downgrade", "HTTPS to HTTP")] {
        let url = url::Url::parse(&server.url.replace("/owned", path)).unwrap();
        let result = tauri::async_runtime::block_on(async {
            let response = super::client::fetch_with_resolver(
                &url,
                |target| {
                    std::future::ready(Ok(vec![std::net::SocketAddr::from((
                        [127, 0, 0, 1],
                        target.port().unwrap(),
                    ))]))
                },
                || super::client::client_builder().add_root_certificate(root.clone()),
            )
            .await?;
            super::response::read_response(url, response).await
        });
        if path == "/html" {
            assert_eq!(result.unwrap().html, expected);
        } else {
            assert!(result.unwrap_err().contains(expected));
        }
    }
}

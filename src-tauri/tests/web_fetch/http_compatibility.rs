//! Real loopback HTTP characterization through the production Tauri command.
//! The server owns its listener/thread and always stops and joins; no global environment changes.
use super::{fetch_url, FetchResponse};
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
    worker: Option<JoinHandle<Result<Vec<String>, String>>>,
}

impl Server {
    fn start(handler: impl Fn(&str) -> Option<Vec<u8>> + Send + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("loopback listener");
        listener.set_nonblocking(true).expect("nonblocking listener");
        let url = format!("http://{}", listener.local_addr().expect("bound address"));
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
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
                requests.push(request);
                match reply {
                    Some(bytes) => stream.write_all(&bytes).map_err(|e| format!("write response: {e}"))?,
                    None => {
                        while !stopped.load(Ordering::SeqCst) && Instant::now() < deadline {
                            thread::sleep(Duration::from_millis(5));
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
    tauri::async_runtime::block_on(fetch_url(value))
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
fn automatic_gzip_decompression_remains_enabled_by_the_locked_reqwest_feature() {
    const GZIP_BODY: &[u8] = &[
        31, 139, 8, 0, 0, 0, 0, 0, 2, 255, 75, 206, 207, 45, 40, 74, 45, 46, 78, 77, 81, 200, 72, 205, 201, 201, 87,
        120, 178, 99, 237, 179, 105, 237, 31, 230, 207, 108, 2, 0, 221, 211, 75, 187, 27, 0, 0, 0,
    ];
    let server = Server::start(|_| {
        Some(response(
            200,
            "Content-Type: text/plain; charset=utf-8\r\nContent-Encoding: gzip\r\n",
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
fn missing_and_non_html_types_still_report_without_filtering() {
    for content_type in ["", "application/octet-stream", "application/json", "image/png"] {
        let header = if content_type.is_empty() {
            String::new()
        } else {
            format!("Content-Type: {content_type}\r\n")
        };
        let body = "x".repeat(2 * 1024 * 1024);
        let expected = body.clone();
        let server = Server::start(move |_| Some(response(200, &header, body.as_bytes())));
        let result = fetch(server.url.clone());
        let requests = server.finish();
        let result = result.expect("unrestricted response remains accepted");
        assert_eq!(result.content_type, content_type);
        assert_eq!(result.html, expected);
        assert_eq!(requests.len(), 1);
    }
}

#[test]
fn redirects_keep_initial_and_final_url_and_final_reported_type() {
    let server = Server::start(|request| {
        Some(if request.starts_with("GET /start ") {
            response(302, "Location: /final\r\nContent-Type: image/png\r\n", b"")
        } else {
            response(200, "Content-Type: text/plain\r\n", b"redirected")
        })
    });
    let initial = format!("{}/start", server.url);
    let final_url = format!("{}/final", server.url);
    let result = fetch(initial.clone());
    let requests = server.finish();
    let result = result.expect("redirect fetch");
    assert_eq!(result.url, initial);
    assert_eq!(result.final_url, final_url);
    assert_eq!(result.content_type, "text/plain");
    assert_eq!(result.html, "redirected");
    assert_eq!(requests.len(), 2);
}

#[test]
fn redirect_loops_still_fail_with_the_existing_request_error() {
    let server = Server::start(|_| Some(response(302, "Location: /again\r\n", b"")));
    let result = fetch(format!("{}/again", server.url));
    let requests = server.finish();
    assert!(result.expect_err("redirect limit").starts_with("Request failed: "));
    assert!(requests.len() > 1 && requests.len() <= 11);
}

#[test]
fn status_empty_and_truncated_body_errors_keep_their_order_and_text() {
    for (bytes, exact, expected) in [
        (response(404, "", b""), true, "HTTP request failed with status 404"),
        (response(200, "", b" \r\n\t"), true, "Response body is empty"),
        (
            b"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 20\r\n\r\nshort".to_vec(),
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

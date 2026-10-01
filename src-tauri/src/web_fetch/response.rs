//! Bounded response reading and decoding; preserves the FetchResponse wire fields.
//! Counts actual encoded body bytes before decompression and decoded bytes before UTF-8 conversion.
use async_compression::tokio::bufread::{BrotliDecoder, GzipDecoder, ZlibDecoder};
use reqwest::header::{CONTENT_ENCODING, CONTENT_TYPE};
use serde::Serialize;
use tokio::io::{AsyncRead, AsyncReadExt};
use url::Url;

pub(super) const MAX_ENCODED_BYTES: usize = 10 * 1024 * 1024;
pub(super) const MAX_DECODED_BYTES: usize = 20 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct FetchResponse {
    pub success: bool,
    pub url: String,
    pub final_url: String,
    pub status: u16,
    pub content_type: String,
    pub html: String,
}

pub(super) async fn read_response(parsed: Url, mut response: reqwest::Response) -> Result<FetchResponse, String> {
    let status = response.status();
    let final_url = response.url().to_string();
    if !status.is_success() {
        return Err(format!("HTTP request failed with status {}", status.as_u16()));
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let mime = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    if response.headers().get_all(CONTENT_TYPE).iter().count() != 1
        || !matches!(mime.as_str(), "text/html" | "application/xhtml+xml")
    {
        return Err("Web fetch requires HTML/XHTML Content-Type; paste HTML manually".into());
    }
    let encoding = response
        .headers()
        .get(CONTENT_ENCODING)
        .map(|v| v.to_str())
        .transpose()
        .map_err(|_| "Unsupported response encoding")?
        .unwrap_or("identity")
        .trim()
        .to_ascii_lowercase();
    if response.headers().get_all(CONTENT_ENCODING).iter().count() > 1
        || !matches!(encoding.as_str(), "identity" | "gzip" | "br" | "deflate")
    {
        return Err("Unsupported response encoding".into());
    }
    if response
        .content_length()
        .is_some_and(|len| len > MAX_ENCODED_BYTES as u64)
    {
        return Err("Web response exceeds encoded limit (10 MiB)".into());
    }
    let mut raw = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Failed to read response body: transport error")?
    {
        if chunk.len() > MAX_ENCODED_BYTES - raw.len() {
            return Err("Web response exceeds encoded limit (10 MiB)".into());
        }
        raw.extend_from_slice(&chunk);
        tokio::task::yield_now().await;
    }
    let bytes = decode_body(&raw, &encoding).await?;
    // MIME is not a trust boundary for executable HTML. Reject obvious binary disguises;
    // HTML remains untrusted and still passes the existing renderer sanitization/CSP.
    if bytes.contains(&0)
        || bytes.starts_with(b"%PDF-")
        || bytes.starts_with(b"GIF8")
        || bytes.starts_with(b"\x89PNG")
        || bytes.starts_with(b"\xff\xd8\xff")
        || bytes.starts_with(b"PK\x03\x04")
    {
        return Err("Web response is binary, not HTML".into());
    }
    let html = String::from_utf8_lossy(&bytes).into_owned();
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

async fn decode_body(raw: &[u8], encoding: &str) -> Result<Vec<u8>, String> {
    let mut reader: Box<dyn AsyncRead + Unpin + Send + '_> = match encoding {
        "gzip" => {
            let mut decoder = GzipDecoder::new(raw);
            decoder.multiple_members(true);
            Box::new(decoder)
        }
        "br" => Box::new(BrotliDecoder::new(raw)),
        "deflate" => Box::new(ZlibDecoder::new(raw)),
        _ => Box::new(raw),
    };
    let mut decoded = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        let count = reader
            .read(&mut buffer)
            .await
            .map_err(|_| "Failed to read response body: invalid compression")?;
        if count == 0 {
            return Ok(decoded);
        }
        if count > MAX_DECODED_BYTES - decoded.len() {
            return Err("Web response exceeds decoded limit (20 MiB)".into());
        }
        decoded.extend_from_slice(&buffer[..count]);
        // Makes both timeout and cancellation effective even with ready in-memory decompression.
        tokio::task::yield_now().await;
    }
}

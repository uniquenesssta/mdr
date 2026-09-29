//! Stateless startup/exit event projection through the existing best-effort backend sink.
use super::record_backend;
use serde_json::json;
use std::time::Duration;

pub fn record_lifecycle(operation: &str) {
    record_backend(
        "app.lifecycle",
        operation,
        Duration::ZERO,
        "ok",
        json!({
            "debugBuild": cfg!(debug_assertions),
            "pid": std::process::id()
        }),
    );
}

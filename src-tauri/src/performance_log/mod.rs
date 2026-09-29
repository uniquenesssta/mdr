pub(crate) mod command;
mod lifecycle;
pub use lifecycle::record_lifecycle;

mod paths;
mod redaction;
mod writer;

#[cfg(test)]
use command::write_performance_logs;
use paths::unix_time_ms;
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use writer::append_values;

pub fn record_backend(category: &str, operation: &str, duration: Duration, status: &str, details: Value) {
    if !cfg!(debug_assertions) {
        return;
    }
    let entry = json!({
        "timestampMs": unix_time_ms(),
        "source": "rust",
        "category": category,
        "operation": operation,
        "durationMs": duration.as_secs_f64() * 1000.0,
        "status": status,
        "details": details
    });
    if let Err(err) = append_values(&[entry]) {
        eprintln!("performance log error: {err}");
    }
}

pub async fn measure_async<T, E, F>(category: &str, operation: &str, details: Value, future: F) -> Result<T, E>
where
    F: std::future::Future<Output = Result<T, E>>,
{
    let started = Instant::now();
    let result = future.await;
    record_backend(
        category,
        operation,
        started.elapsed(),
        if result.is_ok() { "ok" } else { "error" },
        details,
    );
    result
}

pub fn measure_sync<T, E, F>(category: &str, operation: &str, details: Value, function: F) -> Result<T, E>
where
    F: FnOnce() -> Result<T, E>,
{
    let started = Instant::now();
    let result = function();
    record_backend(
        category,
        operation,
        started.elapsed(),
        if result.is_ok() { "ok" } else { "error" },
        details,
    );
    result
}

#[cfg(all(test, debug_assertions))]
#[path = "../../tests/performance_log/redaction_pipeline.rs"]
mod redaction_pipeline_tests;

#[cfg(test)]
#[path = "../../tests/performance_log/writer_contract.rs"]
mod writer_contract_tests;

#[cfg(all(test, debug_assertions))]
#[path = "../../tests/performance_log/lifecycle_contract.rs"]
mod lifecycle_contract_tests;

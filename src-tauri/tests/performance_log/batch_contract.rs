//! Real temporary-file faults: partial byte writes, rollback, flush, receipt loss and retry readback.
use super::{
    batch::{self, Ledger, Request},
    writer::{self, LogFile},
};
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Disk {
    file: File,
    path: PathBuf,
    calls: usize,
    fail_at: usize,
    partial: bool,
    rollback: bool,
    flush: bool,
}
impl Disk {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "mdr-batch-{}-{}.jsonl",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let file = OpenOptions::new().create_new(true).write(true).open(&path).unwrap();
        Self {
            file,
            path,
            calls: 0,
            fail_at: usize::MAX,
            partial: false,
            rollback: false,
            flush: false,
        }
    }
    fn rows(&self) -> Vec<Value> {
        let data = fs::read(&self.path).unwrap();
        assert!(data.is_empty() || data.ends_with(b"\n"));
        String::from_utf8(data)
            .unwrap()
            .lines()
            .map(|s| serde_json::from_str(s).unwrap())
            .collect()
    }
}
impl Drop for Disk {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}
impl LogFile for Disk {
    fn length(&self) -> io::Result<u64> {
        Ok(self.file.metadata()?.len())
    }
    fn frame(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.file.seek(SeekFrom::End(0))?;
        self.calls += 1;
        if self.calls == self.fail_at {
            if self.partial {
                self.file.write_all(&bytes[..bytes.len() / 2])?;
            }
            return Err(io::Error::other("synthetic disk full"));
        }
        self.file.write_all(bytes)
    }
    fn truncate(&mut self, length: u64) -> io::Result<()> {
        if self.rollback {
            return Err(io::Error::other("synthetic rollback denial"));
        }
        self.file.set_len(length)
    }
    fn finish(&mut self) -> io::Result<()> {
        if self.flush {
            return Err(io::Error::other("synthetic flush denial"));
        }
        self.file.flush()
    }
}
fn rows() -> Vec<Vec<u8>> {
    writer::prepare(
        &[
            json!({"count":1,"body":"PRIVATE"}),
            json!({"count":2}),
            json!({"count":3}),
        ],
        250,
    )
    .unwrap()
}
fn request(id: &str, offset: usize, attempt: u32, total: usize) -> Request<'_> {
    Request {
        id,
        offset,
        attempt,
        total,
    }
}

#[test]
fn batch_full_receipt_and_duplicate_never_append_twice() {
    let mut ledger = Ledger::default();
    let mut disk = Disk::new();
    let r = request("fixture-batch-1", 0, 1, 3);
    assert_eq!(ledger.append(&r, rows(), &mut disk)["acceptedCount"], 3);
    assert_eq!(ledger.append(&r, rows(), &mut disk)["state"], "complete");
    assert_eq!(
        disk.rows(),
        vec![json!({"count":1}), json!({"count":2}), json!({"count":3})]
    );
    assert_eq!(disk.calls, 3);
}
#[test]
fn batch_real_partial_bytes_are_rolled_back_and_only_the_suffix_is_retried() {
    let mut ledger = Ledger::default();
    let mut disk = Disk::new();
    disk.fail_at = 2;
    disk.partial = true;
    let first = ledger.append(&request("fixture-batch-1", 0, 1, 3), rows(), &mut disk);
    assert_eq!(first["acceptedCount"], 1);
    assert_eq!(first["state"], "partial");
    assert_eq!(disk.rows(), vec![json!({"count":1})]);
    disk.fail_at = usize::MAX;
    let next = ledger.append(&request("fixture-batch-1", 1, 2, 3), rows()[1..].to_vec(), &mut disk);
    assert_eq!(next["acceptedCount"], 3);
    assert_eq!(disk.rows().len(), 3);
    assert_eq!(disk.rows()[1]["count"], 2);
}
#[test]
fn batch_zero_write_denial_has_an_explicit_recoverable_boundary() {
    let mut ledger = Ledger::default();
    let mut disk = Disk::new();
    disk.fail_at = 1;
    assert_eq!(
        ledger.append(&request("fixture-batch-1", 0, 1, 3), rows(), &mut disk)["acceptedCount"],
        0
    );
    assert!(disk.rows().is_empty());
    disk.fail_at = usize::MAX;
    assert_eq!(
        ledger.append(&request("fixture-batch-1", 0, 2, 3), rows(), &mut disk)["state"],
        "complete"
    );
    assert_eq!(disk.rows().len(), 3);
}
#[test]
fn batch_lost_response_is_recovered_by_query_without_any_append() {
    let mut ledger = Ledger::default();
    let mut disk = Disk::new();
    let r = request("fixture-batch-1", 0, 1, 3);
    let _lost = ledger.append(&r, rows(), &mut disk);
    let calls = disk.calls;
    assert_eq!(ledger.query(&r)["acceptedCount"], 3);
    assert_eq!(disk.calls, calls);
    assert_eq!(disk.rows().len(), 3);
}
#[test]
fn batch_failed_rollback_is_uncertain_and_isolates_every_later_write() {
    let mut ledger = Ledger::default();
    let mut disk = Disk::new();
    disk.fail_at = 2;
    disk.partial = true;
    disk.rollback = true;
    let result = ledger.append(&request("fixture-batch-1", 0, 1, 3), rows(), &mut disk);
    assert_eq!(result["state"], "uncertain");
    let bytes = fs::read(&disk.path).unwrap();
    assert_eq!(
        ledger.append(&request("fixture-batch-2", 0, 1, 3), rows(), &mut disk)["state"],
        "uncertain"
    );
    assert_eq!(fs::read(&disk.path).unwrap(), bytes);
}
#[test]
fn batch_flush_failure_is_uncertain_and_never_blindly_replays_complete_rows() {
    let mut ledger = Ledger::default();
    let mut disk = Disk::new();
    disk.flush = true;
    let r = request("fixture-batch-1", 0, 1, 3);
    assert_eq!(ledger.append(&r, rows(), &mut disk)["state"], "uncertain");
    assert_eq!(disk.rows().len(), 3);
    let calls = disk.calls;
    assert_eq!(ledger.append(&r, rows(), &mut disk)["state"], "uncertain");
    assert_eq!(disk.calls, calls);
}
#[test]
fn batch_changed_payload_or_total_or_offset_or_stale_attempt_is_rejected() {
    let mut ledger = Ledger::default();
    let mut disk = Disk::new();
    disk.fail_at = 2;
    ledger.append(&request("fixture-batch-1", 0, 2, 3), rows(), &mut disk);
    for (offset, attempt, total, data) in [
        (0, 1, 3, rows()),
        (2, 3, 3, rows()[2..].to_vec()),
        (0, 3, 2, rows()[..2].to_vec()),
        (1, 3, 3, vec![b"changed\n".to_vec(); 2]),
    ] {
        assert_eq!(
            ledger.append(&request("fixture-batch-1", offset, attempt, total), data, &mut disk)["state"],
            "rejected"
        );
    }
    assert_eq!(disk.rows().len(), 1);
}
#[test]
fn batch_evicted_completed_receipt_cannot_be_replayed_after_200_new_batches() {
    let mut ledger = Ledger::default();
    let mut disk = Disk::new();
    for sequence in 1..=201 {
        let id = format!("fixture-batch-{sequence}");
        assert_eq!(
            ledger.append(&request(&id, 0, 1, 3), rows(), &mut disk)["state"],
            "complete"
        );
    }
    assert_eq!(
        ledger.append(&request("fixture-batch-1", 0, 1, 3), rows(), &mut disk)["state"],
        "expired"
    );
    assert_eq!(disk.rows().len(), 603);
}
#[test]
fn batch_new_sessions_are_bounded_without_evicting_an_unknown_session_high_watermark() {
    let mut ledger = Ledger::default();
    let mut disk = Disk::new();
    for sequence in 0..32 {
        let id = format!("session{sequence}-batch-1");
        assert_eq!(
            ledger.append(&request(&id, 0, 1, 3), rows(), &mut disk)["state"],
            "complete"
        );
    }
    assert_eq!(
        ledger.append(&request("overflow-batch-1", 0, 1, 3), rows(), &mut disk)["reason"],
        "session-limit"
    );
    assert_eq!(disk.rows().len(), 96);
}
#[test]
fn batch_file_growth_stops_at_the_exact_process_log_budget() {
    let mut ledger = Ledger::default();
    let mut disk = Disk::new();
    disk.file.set_len(writer::MAX_LOG_BYTES).unwrap();
    let result = ledger.append(&request("fixture-batch-1", 0, 1, 3), rows(), &mut disk);
    assert_eq!(result["acceptedCount"], 0);
    assert_eq!(result["reason"], "file-limit");
    assert_eq!(disk.length().unwrap(), writer::MAX_LOG_BYTES);
}
#[test]
fn batch_prevalidation_rejects_total_size_and_invalid_metadata_before_appending() {
    let mut ledger = Ledger::default();
    let mut disk = Disk::new();
    for id in ["PRIVATE /path", "fixture-batch-0", "fixture-batch-9007199254740992"] {
        assert_eq!(
            ledger.append(&request(id, 0, 1, 3), rows(), &mut disk)["state"],
            "rejected"
        );
    }
    assert!(writer::prepare(&vec![Value::Null; 251], 250).is_err());
    assert_eq!(disk.calls, 0);
}
#[test]
fn batch_actual_frontend_command_receipt_and_jsonl_readback_are_consistent() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let output = std::process::Command::new("node")
        .arg(root.join("tests/support/performance-log/frontend-payload.mjs"))
        .current_dir(root)
        .output()
        .unwrap();
    assert!(output.status.success());
    let fixture: Value = serde_json::from_slice(&output.stdout).unwrap();
    let args = &fixture["requests"][0];
    let entries = args["entries"].as_array().unwrap().clone();
    let id = args["batchId"].as_str().unwrap().to_string();
    let result = tauri::async_runtime::block_on(super::command::write_performance_log_batch(
        entries.clone(),
        id.clone(),
        0,
        1,
        3,
        false,
    ))
    .unwrap();
    assert_eq!(result["acceptedCount"], 3);
    let again = tauri::async_runtime::block_on(super::command::write_performance_log_batch(
        entries,
        id.clone(),
        0,
        1,
        3,
        false,
    ))
    .unwrap();
    assert_eq!(again, result);
    let query = batch::submit(vec![], &id, 0, 1, 3, true).unwrap();
    assert_eq!(query, result);
    assert!(result.get("logPath").is_none());
    let _guard = writer::write_lock().lock().unwrap();
    let text = fs::read_to_string(super::paths::log_file_path().unwrap()).unwrap();
    let rows: Vec<Value> = text
        .lines()
        .map(|s| serde_json::from_str::<Value>(s).unwrap())
        .filter(|r| r["sessionId"] == fixture["entries"][0]["sessionId"])
        .collect();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0]["details"]["scrollSourceSide"], "editor");
    for secret in fixture["secrets"].as_array().unwrap() {
        assert!(!serde_json::to_string(&rows).unwrap().contains(secret.as_str().unwrap()));
    }
}
#[test]
fn batch_windows_exclusive_file_open_failure_recovers_without_duplicate_rows() {
    #[cfg(windows)]
    {
        let root = std::env::temp_dir().join(format!(
            "mdr-batch-child-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "performance_log::batch_contract_tests::batch_child",
                "--nocapture",
            ])
            .env("MDR_BATCH_CASE", "exclusive")
            .env("MARKDOWN_EDITOR_LOG_DIR", &root)
            .output()
            .unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stdout));
        let _ = fs::remove_dir_all(root);
    }
}
#[test]
fn batch_child() {
    if std::env::var("MDR_BATCH_CASE").ok().as_deref() != Some("exclusive") {
        return;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        let path = super::paths::log_file_path().unwrap();
        let held = OpenOptions::new()
            .create(true)
            .append(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        let first = batch::submit(vec![json!({"count":1})], "exclusive-batch-1", 0, 1, 1, false).unwrap();
        assert_eq!(first["reason"], "open");
        drop(held);
        let recovered = batch::submit(vec![json!({"count":1})], "exclusive-batch-1", 0, 2, 1, false).unwrap();
        assert_eq!(recovered["state"], "complete");
        assert_eq!(fs::read_to_string(path).unwrap().lines().count(), 1);
    }
}

#[test]
fn batch_serialized_byte_budget_is_checked_before_the_first_file_write() {
    let small = sized(60000);
    let prepared = writer::prepare(&vec![small.clone(); 17], 250).unwrap();
    assert_eq!(prepared.iter().map(Vec::len).sum::<usize>(), 17 * 60001);
    assert!(writer::prepare(&vec![small; 18], 250).is_err());
    assert!(writer::prepare(&[sized(65537)], 250).is_err());
}
#[test]
fn batch_uncompleted_receipts_cannot_exceed_the_ledger_memory_budget() {
    let mut ledger = Ledger::default();
    let mut disk = Disk::new();
    let payload = writer::prepare(&vec![sized(60000); 17], 250).unwrap();
    let batch_bytes = payload.iter().map(Vec::len).sum::<usize>();
    assert_eq!(batch_bytes, 17 * 60001);
    assert!(4 * batch_bytes <= 4 * 1024 * 1024 && 5 * batch_bytes > 4 * 1024 * 1024);
    for sequence in 1..=4 {
        disk.fail_at = disk.calls + 1;
        let id = format!("bounded-batch-{sequence}");
        assert_eq!(
            ledger.append(&request(&id, 0, 1, 17), payload.clone(), &mut disk)["state"],
            "partial"
        );
    }
    let calls = disk.calls;
    assert_eq!(
        ledger.append(&request("bounded-batch-5", 0, 1, 17), payload, &mut disk)["reason"],
        "ledger-limit"
    );
    assert_eq!(disk.calls, calls);
    for sequence in 1..=4 {
        let id = format!("bounded-batch-{sequence}");
        let retained = ledger.query(&request(&id, 0, 1, 17));
        assert_eq!(retained["state"], "partial");
        assert_eq!(retained["acceptedCount"], 0);
    }
    assert!(disk.rows().is_empty());
}
#[test]
fn batch_200_uncompleted_receipts_are_retained_without_unbounded_growth() {
    let mut ledger = Ledger::default();
    let mut disk = Disk::new();
    for sequence in 1..=200 {
        disk.fail_at = disk.calls + 1;
        let id = format!("bounded-batch-{sequence}");
        assert_eq!(
            ledger.append(&request(&id, 0, 1, 3), rows(), &mut disk)["state"],
            "partial"
        );
    }
    assert_eq!(
        ledger.append(&request("bounded-batch-201", 0, 1, 3), rows(), &mut disk)["reason"],
        "ledger-limit"
    );
    assert_eq!(disk.calls, 200);
    assert!(disk.rows().is_empty());
}

// Keep all fields within the production redactor's key/container/path budgets.
// Raw bytes alone cannot establish a serialized post-redaction boundary.
fn sized(bytes: usize) -> Value {
    let mut groups = serde_json::Map::new();
    for group in 0..5 {
        let mut fields = serde_json::Map::new();
        for index in 0..60 {
            fields.insert(format!("{}_{index:02}_path", "k".repeat(48)), json!("x"));
        }
        groups.insert(format!("group{group}"), Value::Object(fields));
    }
    let mut value = Value::Object(groups);
    let mut remaining = bytes - serde_json::to_vec(&value).unwrap().len();
    for group in value.as_object_mut().unwrap().values_mut() {
        for field in group.as_object_mut().unwrap().values_mut() {
            let extra = remaining.min(159);
            *field = json!("x".repeat(extra + 1));
            remaining -= extra;
        }
    }
    assert_eq!(remaining, 0, "fixture must reach requested byte size");
    assert_eq!(serde_json::to_vec(&value).unwrap().len(), bytes);
    assert_eq!(
        serde_json::to_vec(&super::redaction::redact_value(&value))
            .unwrap()
            .len(),
        bytes,
        "production redaction must retain the exact boundary fixture"
    );
    value
}

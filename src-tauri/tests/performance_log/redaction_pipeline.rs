use super::write_performance_logs;
use serde_json::Value;
use std::{fs, path::Path, process::Command};

#[test]
fn actual_frontend_payload_is_redacted_by_the_real_command_before_jsonl_write() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let result = Command::new("node")
        .arg(root.join("tests/support/performance-log/frontend-payload.mjs"))
        .current_dir(root)
        .output()
        .expect("Node is required for the actual JS to Rust log pipeline test");
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    let fixture: Value = serde_json::from_slice(&result.stdout).unwrap();
    let entries = fixture["entries"].as_array().unwrap().clone();
    assert_eq!(entries.len(), 3);
    assert!(entries[0]["details"]["nested"].is_object());
    let session = entries[0]["sessionId"].clone();
    let path = write_performance_logs(entries).unwrap();
    let contents = {
        let _guard = super::write_lock().lock().unwrap();
        fs::read_to_string(path).unwrap()
    };
    let rows: Vec<Value> = contents
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|row| row["sessionId"] == session)
        .collect();
    assert_eq!(rows.len(), 3);
    let persisted = serde_json::to_string(&rows).unwrap();
    for secret in fixture["secrets"].as_array().unwrap() {
        let encoded = serde_json::to_string(secret).unwrap();
        let escaped = &encoded[1..encoded.len() - 1];
        assert!(!persisted.contains(secret.as_str().unwrap()), "secret reached JSONL");
        assert!(!persisted.contains(escaped), "escaped secret reached JSONL");
    }
    let details = &rows[0]["details"];
    for field in ["nested", "encoded", "twice"] {
        assert_eq!(details[field]["count"], 7);
        assert_eq!(details[field]["path"], "note.md");
        assert!(details[field].get("body").is_none());
        assert!(details[field].get("token").is_none());
    }
    assert_eq!(details["contentLength"], 2048);
    assert_eq!(details["contentType"], "text/html");
    assert_eq!(rows[0]["operation"], "runtime.snapshot");
    assert_eq!(rows[0]["durationMs"], 12.5);
    assert_eq!(rows[1]["status"], "warning");
    assert_eq!(rows[2]["status"], "error");
    assert_eq!(rows[2]["details"]["error"], "[redacted]");
}

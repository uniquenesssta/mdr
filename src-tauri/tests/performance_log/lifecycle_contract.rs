//! Real lifecycle sink calls in isolated child processes; no shared environment mutation.
use super::{record_lifecycle, write_performance_logs};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, process::Command};

struct CaseDirectory(PathBuf);
impl Drop for CaseDirectory {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).expect("remove lifecycle test directory");
    }
}

fn run_case(case: &str, expected_error: Option<&str>) {
    let root = CaseDirectory(std::env::temp_dir().join(format!("mdr-lifecycle-{}-{case}", std::process::id())));
    fs::create_dir(&root.0).unwrap();
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "performance_log::lifecycle_contract_tests::lifecycle_child",
            "--nocapture",
        ])
        .env("MDR_LIFECYCLE_CASE", case)
        .env("MARKDOWN_EDITOR_LOG_DIR", root.0.join("日志 空间"))
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "{case}: {stdout}\n{stderr}");
    assert!(stdout.contains("application continuation reached"));
    if let Some(error) = expected_error {
        assert!(stderr.contains(error), "missing diagnostic: {stderr}");
    } else {
        assert!(
            !stderr.contains("performance log error:"),
            "unexpected diagnostic: {stderr}"
        );
    }
}

fn rows() -> Vec<Value> {
    let path = write_performance_logs(vec![]).unwrap();
    let bytes = fs::read(path).unwrap();
    assert!(bytes.ends_with(b"\n"));
    String::from_utf8(bytes)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn lifecycle_child() {
    let Ok(case) = std::env::var("MDR_LIFECYCLE_CASE") else {
        return;
    };
    let directory = PathBuf::from(std::env::var_os("MARKDOWN_EDITOR_LOG_DIR").unwrap());
    match case.as_str() {
        "events" => {
            record_lifecycle("app.start");
            write_performance_logs(vec![json!({"operation": "frontend.marker", "count": 1})]).unwrap();
            record_lifecycle("app.exit");
            let values = rows();
            assert_eq!(values.len(), 3);
            // Unknown operation labels remain redacted under the accepted R12-14 policy.
            assert_eq!(values[1], json!({"operation": "[redacted]", "count": 1}));
            for (index, operation) in [(0, "app.start"), (2, "app.exit")] {
                let value = &values[index];
                assert_eq!(value.as_object().unwrap().len(), 7);
                assert!(value["timestampMs"].as_u64().unwrap() > 0);
                assert_eq!(value["source"], "rust");
                assert_eq!(value["category"], "app.lifecycle");
                assert_eq!(value["operation"], operation);
                assert_eq!(value["durationMs"].as_f64(), Some(0.0));
                assert_eq!(value["status"], "ok");
                assert_eq!(value["details"], json!({"debugBuild": true, "pid": std::process::id()}));
            }
            assert!(values[2]["timestampMs"].as_u64() >= values[0]["timestampMs"].as_u64());
            assert_eq!(fs::read_dir(directory).unwrap().count(), 1);
        }
        "directory" => {
            fs::write(&directory, b"block log directory").unwrap();
            record_lifecycle("app.start");
            record_lifecycle("app.exit");
            assert_eq!(fs::read(&directory).unwrap(), b"block log directory");
            fs::remove_file(&directory).unwrap();
            record_lifecycle("app.start");
            record_lifecycle("app.exit");
            assert_eq!(rows().len(), 2);
        }
        "open" => {
            let path = write_performance_logs(vec![]).unwrap();
            fs::create_dir(&path).unwrap();
            record_lifecycle("app.start");
            record_lifecycle("app.exit");
            fs::remove_dir(&path).unwrap();
            record_lifecycle("app.exit");
            assert_eq!(rows()[0]["operation"], "app.exit");
        }
        "poison" => {
            // Poison the real shared writer lock in this isolated process only.
            assert!(std::thread::spawn(|| {
                let _guard = super::writer::write_lock().lock().unwrap();
                panic!("synthetic writer lock poison");
            })
            .join()
            .is_err());
            record_lifecycle("app.start");
            record_lifecycle("app.exit");
            assert_eq!(fs::read_dir(directory).unwrap().count(), 0);
        }
        "repeat" => {
            // Preserve event semantics: no hidden one-shot state, deduplication or async queue.
            for operation in ["app.start", "app.start", "app.exit", "app.exit"] {
                record_lifecycle(operation);
            }
            assert_eq!(
                rows()
                    .iter()
                    .map(|row| row["operation"].as_str().unwrap())
                    .collect::<Vec<_>>(),
                vec!["app.start", "app.start", "app.exit", "app.exit"]
            );
        }
        _ => panic!("unknown lifecycle case"),
    }
    println!("application continuation reached");
}

#[test]
fn startup_and_exit_keep_fields_order_and_share_the_frontend_file() {
    run_case("events", None);
}
#[test]
fn directory_failure_does_not_block_caller_and_recovers() {
    run_case("directory", Some("performance log error: 无法创建性能日志目录："));
}
#[test]
fn open_failure_does_not_block_caller_and_recovers() {
    run_case("open", Some("performance log error: 无法打开性能日志："));
}
#[test]
fn poisoned_writer_does_not_block_startup_or_exit_caller() {
    run_case("poison", Some("performance log error: 性能日志写入锁已损坏"));
}
#[test]
fn lifecycle_has_no_deduplication_or_pending_shutdown_work() {
    run_case("repeat", None);
}

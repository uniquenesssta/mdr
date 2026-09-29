//! Each filesystem scenario runs in its own process, isolating the session OnceLock and environment.
use super::write_performance_logs;
use serde_json::{json, Map, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicUsize, Ordering},
    thread,
};

static NEXT_CASE: AtomicUsize = AtomicUsize::new(0);

struct CaseDirectory(PathBuf);
impl Drop for CaseDirectory {
    fn drop(&mut self) {
        if self.0.exists() {
            fs::remove_dir_all(&self.0).expect("remove isolated log test directory");
        }
    }
}

fn run_case(name: &str) {
    let root = CaseDirectory(std::env::temp_dir().join(format!(
        "mdr-log-writer-{}-{}-{}",
        std::process::id(),
        NEXT_CASE.fetch_add(1, Ordering::Relaxed),
        name
    )));
    fs::create_dir(&root.0).unwrap();
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "performance_log::writer_contract_tests::writer_contract_child",
            "--nocapture",
        ])
        .env("MDR_LOG_WRITER_CASE", name)
        .env("MARKDOWN_EDITOR_LOG_DIR", root.0.join("日志 空间").join("session"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{name}: {}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn read_rows(path: &str) -> Vec<Value> {
    let bytes = fs::read(path).unwrap();
    assert!(bytes.ends_with(b"\n"));
    assert!(!bytes.contains(&b'\r'));
    String::from_utf8(bytes)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn sized_entry(target: usize) -> Value {
    let mut groups = Map::new();
    for group in 0..5 {
        let mut fields = Map::new();
        for index in 0..60 {
            fields.insert(format!("{}_{index:02}_path", "k".repeat(48)), json!("x"));
        }
        groups.insert(format!("group{group}"), Value::Object(fields));
    }
    let mut value = Value::Object(groups);
    let mut remaining = target - serde_json::to_vec(&value).unwrap().len();
    for group in value.as_object_mut().unwrap().values_mut() {
        for field in group.as_object_mut().unwrap().values_mut() {
            let extra = remaining.min(159);
            *field = json!("x".repeat(extra + 1));
            remaining -= extra;
        }
    }
    assert_eq!(remaining, 0, "fixture must reach requested serialized byte size");
    assert_eq!(serde_json::to_vec(&value).unwrap().len(), target);
    value
}

#[test]
fn writer_contract_child() {
    let Ok(case) = std::env::var("MDR_LOG_WRITER_CASE") else {
        return;
    };
    let directory = PathBuf::from(std::env::var_os("MARKDOWN_EDITOR_LOG_DIR").unwrap());
    match case.as_str() {
        "empty" => {
            let path = write_performance_logs(vec![]).unwrap();
            assert_eq!(Path::new(&path).parent(), Some(directory.as_path()));
            assert!(directory.is_dir());
            assert!(!Path::new(&path).exists());
            assert_eq!(write_performance_logs(vec![]).unwrap(), path);
            let name = Path::new(&path).file_name().unwrap().to_str().unwrap();
            assert!(name.starts_with("performance-"));
            assert!(name.ends_with(&format!("_pid-{}.jsonl", std::process::id())));
            let timestamp = &name[12..35];
            assert_eq!(timestamp.len(), 23);
            for (index, byte) in timestamp.bytes().enumerate() {
                if [4, 7, 13, 16, 19].contains(&index) {
                    assert_eq!(byte, b'-');
                } else if index == 10 {
                    assert_eq!(byte, b'_');
                } else {
                    assert!(byte.is_ascii_digit());
                }
            }
        }
        "append" => {
            let path = write_performance_logs(vec![json!({"count": 1, "path": "C:\\private\\中文.md", "body": "secret"}), json!(null)]).unwrap();
            assert_eq!(write_performance_logs(vec![json!({"count": 2})]).unwrap(), path);
            let rows = read_rows(&path);
            assert_eq!(rows, vec![json!({"count": 1, "path": "中文.md"}), Value::Null, json!({"count": 2})]);
        }
        "batch" => {
            assert_eq!(write_performance_logs(vec![Value::Null; 501]).unwrap_err(), "单次性能日志数量不能超过 500 条");
            assert!(!directory.exists());
            let path = write_performance_logs(vec![Value::Null; 500]).unwrap();
            assert_eq!(read_rows(&path).len(), 500);
        }
        "size" => {
            let path = write_performance_logs(vec![sized_entry(64 * 1024)]).unwrap();
            assert_eq!(fs::read(&path).unwrap().len(), 64 * 1024 + 1);
            assert_eq!(write_performance_logs(vec![sized_entry(64 * 1024 + 1)]).unwrap_err(), "单条性能日志不能超过 65536 字节");
            assert_eq!(read_rows(&path).len(), 1);
            write_performance_logs(vec![json!({"count": 3})]).unwrap();
            assert_eq!(read_rows(&path).len(), 2);
        }
        "partial" => {
            assert!(write_performance_logs(vec![json!({"count": 1}), sized_entry(64 * 1024 + 1)]).is_err());
            let path = write_performance_logs(vec![]).unwrap();
            assert_eq!(read_rows(&path), vec![json!({"count": 1})]);
            // A04 remains explicitly deferred: this task preserves partial-batch semantics.
        }
        "directory" => {
            fs::create_dir_all(directory.parent().unwrap()).unwrap();
            fs::write(&directory, b"directory blocker").unwrap();
            assert!(write_performance_logs(vec![Value::Null]).unwrap_err().starts_with("无法创建性能日志目录："));
            fs::remove_file(&directory).unwrap();
            let path = write_performance_logs(vec![json!({"count": 1})]).unwrap();
            assert_eq!(read_rows(&path), vec![json!({"count": 1})]);
        }
        "open" => {
            let path = write_performance_logs(vec![]).unwrap();
            fs::create_dir(&path).unwrap();
            assert!(write_performance_logs(vec![Value::Null]).unwrap_err().starts_with("无法打开性能日志："));
            fs::remove_dir(&path).unwrap();
            assert_eq!(write_performance_logs(vec![Value::Null]).unwrap(), path);
            assert_eq!(read_rows(&path), vec![Value::Null]);
        }
        "concurrent" => {
            let handles: Vec<_> = (0..8).map(|worker| thread::spawn(move || {
                let mut path = String::new();
                for batch in 0..8 {
                    path = write_performance_logs((0..10).map(|index| json!({"worker": worker, "batch": batch, "index": index})).collect()).unwrap();
                }
                path
            })).collect();
            let paths: Vec<_> = handles.into_iter().map(|handle| handle.join().unwrap()).collect();
            assert!(paths.iter().all(|path| path == &paths[0]));
            let rows = read_rows(&paths[0]);
            assert_eq!(rows.len(), 640);
            let unique: std::collections::HashSet<_> = rows.iter().map(|row| (row["worker"].as_u64().unwrap(), row["batch"].as_u64().unwrap(), row["index"].as_u64().unwrap())).collect();
            assert_eq!(unique.len(), 640);
            for batch in rows.chunks_exact(10) {
                for (index, row) in batch.iter().enumerate() {
                    assert_eq!(row["worker"], batch[0]["worker"]);
                    assert_eq!(row["batch"], batch[0]["batch"]);
                    assert_eq!(row["index"], index);
                }
            }
        }
        _ => panic!("unknown log writer case"),
    }
}

#[test]
fn session_path_and_empty_batch_are_stable_without_creating_a_file() {
    run_case("empty");
}
#[test]
fn append_preserves_jsonl_order_utf8_and_redaction() {
    run_case("append");
}
#[test]
fn stage_12_rejects_oversized_batches_before_opening_a_log_file() {
    run_case("batch");
}
#[test]
fn serialized_byte_limit_allows_equal_and_recovers_after_rejection() {
    run_case("size");
}
#[test]
fn partial_batch_error_remains_visible_without_claiming_a04_fixed() {
    run_case("partial");
}
#[test]
fn directory_failure_is_reported_and_does_not_poison_the_session() {
    run_case("directory");
}
#[test]
fn file_open_failure_is_reported_and_later_append_can_succeed() {
    run_case("open");
}
#[test]
fn concurrent_batches_share_one_session_and_never_interleave_rows() {
    run_case("concurrent");
}

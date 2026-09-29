//! Compiled by the Windows CI rustc harness with debug assertions disabled.
//! Uses the production Paths/Writer/Redaction files, not a mock or Tauri GUI substitute.
#[path = "../../src/performance_log/paths.rs"]
mod paths;
#[path = "../../src/performance_log/redaction.rs"]
mod redaction;
#[path = "../../src/performance_log/writer.rs"]
mod writer;

#[test]
fn release_writer_never_resolves_paths_or_writes_even_for_oversized_input() {
    assert!(
        !cfg!(debug_assertions),
        "release harness requires debug assertions disabled"
    );
    let directory =
        std::path::PathBuf::from(std::env::var_os("MARKDOWN_EDITOR_LOG_DIR").expect("isolated CI directory"));
    assert!(!directory.exists(), "release sentinel must start absent");
    assert_eq!(writer::append_values(&[]).unwrap(), std::path::PathBuf::new());
    assert_eq!(
        writer::append_values(&[serde_json::json!({"body": "synthetic secret"})]).unwrap(),
        std::path::PathBuf::new()
    );
    assert_eq!(
        writer::append_values(&vec![serde_json::Value::Null; 501]).unwrap(),
        std::path::PathBuf::new()
    );
    assert!(
        !directory.exists(),
        "release logging must not create a directory or file"
    );
}

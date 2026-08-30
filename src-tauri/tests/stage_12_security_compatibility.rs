//! R12-01 pre-rewrite security behavior fixture.
//!
//! Responsibility: freeze the observable limits, allowlists, response handling, log schema and
//! command names before the four Rust monoliths are split. This test owns no production state,
//! performs no network access and does not introduce an alternate policy implementation.
//! Allowed dependencies: std and the package's existing serde_json dependency.
//! Forbidden here: changing limits, accepting new protocols, filtering responses or redacting
//! logs ahead of the Atomic Task that owns that behavior.

use serde_json::Value;
use std::{fs, path::Path};

const SOURCE_LOCAL_FILE: &str = include_str!("../src/local_file.rs");
const SOURCE_LOCAL_FILE_BINARY_WRITER: &str = include_str!("../src/local_file/binary_writer.rs");
const SOURCE_LOCAL_FILE_KIND: &str = include_str!("../src/local_file/file_kind.rs");
const SOURCE_LOCAL_FILE_IMAGE_READER: &str = include_str!("../src/local_file/image_reader.rs");
const SOURCE_LOCAL_FILE_PATH_POLICY: &str = include_str!("../src/local_file/path_policy.rs");
const SOURCE_LOCAL_FILE_TEXT_READER: &str = include_str!("../src/local_file/text_reader.rs");
const SOURCE_LOCAL_FILE_TEXT_WRITER: &str = include_str!("../src/local_file/text_writer.rs");
const SOURCE_EXTERNAL_LINK: &str = include_str!("../src/external_link.rs");
const SOURCE_WEB_FETCH: &str = include_str!("../src/web_fetch.rs");
const SOURCE_PERFORMANCE_LOG: &str = include_str!("../src/performance_log.rs");
const SOURCE_MAIN: &str = include_str!("../src/main.rs");

fn manifest() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("stage_12_security")
        .join("manifest.json");
    serde_json::from_slice(&fs::read(path).expect("R12-01 fixture manifest must exist"))
        .expect("R12-01 fixture manifest must be valid JSON")
}

fn strings(value: &Value) -> Vec<&str> {
    value
        .as_array()
        .expect("fixture field must be an array")
        .iter()
        .map(|item| item.as_str().expect("fixture array item must be a string"))
        .collect()
}

fn local_file_source_contains(token: &str) -> bool {
    SOURCE_LOCAL_FILE.contains(token)
        || SOURCE_LOCAL_FILE_BINARY_WRITER.contains(token)
        || SOURCE_LOCAL_FILE_KIND.contains(token)
        || SOURCE_LOCAL_FILE_IMAGE_READER.contains(token)
        || SOURCE_LOCAL_FILE_PATH_POLICY.contains(token)
        || SOURCE_LOCAL_FILE_TEXT_READER.contains(token)
        || SOURCE_LOCAL_FILE_TEXT_WRITER.contains(token)
}

#[test]
fn manifest_pins_the_exact_pre_rewrite_sources_and_dependency_contracts() {
    let fixture = manifest();
    assert_eq!(fixture["schemaVersion"], 1);
    assert_eq!(fixture["atomicTask"], "R12-01");
    assert_eq!(fixture["source"]["commit"], "b8ee68b93cf51f45835ac837cad8110aeea24ad0");
    assert_eq!(
        fixture["source"]["files"]["src-tauri/src/local_file.rs"],
        "87a5ecb7a34e0676741d8dd9b968e5002f01a8be"
    );
    assert_eq!(
        fixture["source"]["files"]["src-tauri/src/external_link.rs"],
        "fb1f2fec1eb54319b623db99705194d82ea43f53"
    );
    assert_eq!(
        fixture["source"]["files"]["src-tauri/src/web_fetch.rs"],
        "58c6c352372c87417b714c92e67f8dd696193bfa"
    );
    assert_eq!(
        fixture["source"]["files"]["src-tauri/src/performance_log.rs"],
        "ac7c37e072b36758b9ccfba644b63bd0f7e3cdde"
    );
    assert_eq!(
        fixture["source"]["dependencyFiles"]["src-tauri/Cargo.lock"],
        "4b0fab4f33f06e47f366224d2b680bfeb2b27fde"
    );
    assert_eq!(
        fixture["source"]["dependencyFiles"]["package-lock.json"],
        "3f084cf57bf76499c22e0adad43627771c0379eb"
    );
}

#[test]
fn local_file_fixture_freezes_extensions_mime_limits_and_tree_policy() {
    let fixture = manifest();
    assert_eq!(
        strings(&fixture["localFile"]["textExtensions"]),
        ["md", "markdown", "txt"]
    );
    assert_eq!(fixture["localFile"]["limits"]["droppedTextBytes"], 20 * 1024 * 1024);
    assert_eq!(fixture["localFile"]["limits"]["droppedImageBytes"], 5 * 1024 * 1024);
    assert_eq!(fixture["localFile"]["limits"]["embeddedImageBytes"], 20 * 1024 * 1024);
    assert_eq!(fixture["localFile"]["limits"]["treeDepth"], 24);
    assert_eq!(fixture["localFile"]["limits"]["treeEntries"], 12_000);
    assert_eq!(
        fixture["localFile"]["treePolicy"]["symlinks"],
        "skip-without-counting-as-skipped"
    );

    for token in [
        "const MAX_TEXT_BYTES: u64 = 20 * 1024 * 1024;",
        "const MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;",
        "const MAX_EMBEDDED_IMAGE_BYTES: u64 = 20 * 1024 * 1024;",
        "const MAX_FILE_TREE_DEPTH: usize = 24;",
        "const MAX_FILE_TREE_ENTRIES: usize = 12_000;",
        "File::open(&path).is_err()",
    ] {
        assert!(
            local_file_source_contains(token),
            "missing local-file contract token: {token}"
        );
    }
    assert!(
        SOURCE_LOCAL_FILE_PATH_POLICY.contains("metadata.file_type().is_symlink()"),
        "Path Policy must keep the frozen symlink rejection"
    );
    for mime in ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"] {
        assert!(SOURCE_LOCAL_FILE_KIND.contains(mime), "missing MIME contract: {mime}");
    }
}

#[test]
fn external_link_fixture_freezes_the_exact_protocol_allowlist() {
    let fixture = manifest();
    assert_eq!(
        strings(&fixture["externalLink"]["allowedSchemes"]),
        ["http", "https", "mailto", "tel"]
    );
    assert!(fixture["externalLink"]["trimInput"]
        .as_bool()
        .expect("trimInput must be a boolean"));
    assert_eq!(
        fixture["externalLink"]["unsupportedPolicy"],
        "reject-before-platform-open"
    );
    assert!(SOURCE_EXTERNAL_LINK.contains("\"http\" | \"https\" | \"mailto\" | \"tel\""));
    assert!(SOURCE_EXTERNAL_LINK.contains("let validated = validate_external_url(&url)?;"));
    assert!(SOURCE_EXTERNAL_LINK.contains("open_platform_url(&validated)"));
}

#[test]
fn web_fetch_fixture_records_limits_response_fields_and_current_unfiltered_gaps() {
    let fixture = manifest();
    assert_eq!(fixture["webFetch"]["redirectLimit"], 10);
    assert_eq!(fixture["webFetch"]["timeoutSeconds"], 30);
    assert_eq!(fixture["webFetch"]["successStatus"], "2xx");
    assert_eq!(
        fixture["webFetch"]["contentType"]["policy"],
        "reported-only-no-allowlist"
    );
    assert!(fixture["webFetch"]["responseBody"]["maximumBytes"].is_null());
    assert_eq!(
        strings(&fixture["webFetch"]["responseFields"]),
        ["success", "url", "final_url", "status", "content_type", "html"]
    );

    assert!(SOURCE_WEB_FETCH.contains("Policy::limited(10)"));
    assert!(SOURCE_WEB_FETCH.contains("Duration::from_secs(30)"));
    assert!(SOURCE_WEB_FETCH.contains(".get(CONTENT_TYPE)"));
    assert!(SOURCE_WEB_FETCH.contains(".text()"));
    assert!(SOURCE_WEB_FETCH.contains("if !status.is_success()"));
    assert!(SOURCE_WEB_FETCH.contains("if html.trim().is_empty()"));
    assert!(!SOURCE_WEB_FETCH.contains("MAX_RESPONSE_BYTES"));
}

#[test]
fn performance_log_fixture_freezes_limits_modes_fields_and_absent_redaction() {
    let fixture = manifest();
    assert_eq!(fixture["performanceLog"]["limits"]["batchEntries"], 500);
    assert_eq!(fixture["performanceLog"]["limits"]["serializedEntryBytes"], 64 * 1024);
    assert_eq!(fixture["performanceLog"]["commandRedaction"], "none");
    assert_eq!(
        strings(&fixture["performanceLog"]["backendEntryFields"]),
        [
            "timestampMs",
            "source",
            "category",
            "operation",
            "durationMs",
            "status",
            "details"
        ]
    );
    assert_eq!(
        strings(&fixture["performanceLog"]["lifecycleDetailFields"]),
        ["debugBuild", "pid"]
    );

    for token in [
        "const MAX_BATCH_ENTRIES: usize = 500;",
        "const MAX_ENTRY_BYTES: usize = 64 * 1024;",
        "if !cfg!(debug_assertions)",
        "MARKDOWN_EDITOR_LOG_DIR",
        "timestampMs",
        "durationMs",
        "debugBuild",
    ] {
        assert!(
            SOURCE_PERFORMANCE_LOG.contains(token),
            "missing log contract token: {token}"
        );
    }
}

#[test]
fn command_registry_fixture_freezes_all_nine_stage_12_command_names() {
    let fixture = manifest();
    let commands = strings(&fixture["commands"]);
    assert_eq!(commands.len(), 9);
    for command in commands {
        assert!(
            SOURCE_MAIN.contains(command),
            "missing registered Stage 12 command: {command}"
        );
    }
}

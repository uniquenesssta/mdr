//! Real Linux process-boundary regression, reusable unchanged against the pre-split command.
//! Each process environment and application receipt belongs to one disposable subprocess.
//! Uses the installed xdg-open unchanged; the BROWSER fixture is its selected local application,
//! not an alternate opener. No network, real browser, shared environment mutation or user files.

use super::{open_external_url, open_platform_url};
use std::io::Error;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};
use std::{env, fs, thread};

static NEXT_FIXTURE: AtomicUsize = AtomicUsize::new(0);
const CHILD_CASE: &str = "MDR_OPENER_CHILD_CASE";
const RECEIPT: &str = "MDR_OPENER_RECEIPT";
const APPLICATION: &str = r#"#!/bin/sh
printf '%s\000' "$@" > "$MDR_OPENER_RECEIPT.tmp"
/bin/mv "$MDR_OPENER_RECEIPT.tmp" "$MDR_OPENER_RECEIPT"
exit "$MDR_OPENER_HANDLER_EXIT"
"#;

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let serial = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let root = env::temp_dir().join(format!("mdr-opener-{}-{serial}", std::process::id()));
        fs::create_dir(&root).expect("create exclusively owned opener fixture");
        Self(root)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.0) {
            if thread::panicking() {
                eprintln!("opener fixture cleanup failed: {error}");
            } else {
                panic!("opener fixture cleanup failed: {error}");
            }
        }
    }
}

fn isolated(case: &str, mode: &str, check: impl FnOnce(&Path)) {
    if env::var(CHILD_CASE).as_deref() == Ok(case) {
        check(&PathBuf::from(env::var_os(RECEIPT).expect("isolated receipt path")));
        return;
    }

    let fixture = Fixture::new();
    let root = &fixture.0;
    for name in ["home", "config", "data", "bin"] {
        fs::create_dir(root.join(name)).expect("create isolated process directory");
    }
    let application = root.join("receipt-application");
    fs::write(&application, APPLICATION).expect("write local application fixture");
    fs::set_permissions(&application, fs::Permissions::from_mode(0o700)).expect("make application executable");
    let executable_path = if mode == "missing" || mode == "denied" {
        if mode == "denied" {
            let denied = root.join("bin/xdg-open");
            fs::write(&denied, b"not executable").expect("create non-executable failure fixture");
            fs::set_permissions(denied, fs::Permissions::from_mode(0o600)).expect("deny executable permission");
        }
        root.join("bin")
    } else {
        assert!(
            Path::new("/usr/bin/xdg-open").is_file(),
            "real xdg-open must be installed"
        );
        PathBuf::from("/usr/bin:/bin")
    };
    let mut child = Command::new(env::current_exe().expect("test executable"))
        .args([
            "--exact",
            &format!("external_link::opener_tests::{case}"),
            "--nocapture",
        ])
        .env_clear()
        .env(CHILD_CASE, case)
        .env(RECEIPT, root.join("receipt"))
        .env(
            "MDR_OPENER_HANDLER_EXIT",
            if mode == "handler-failure" { "7" } else { "0" },
        )
        .env("PATH", executable_path)
        .env("HOME", root.join("home"))
        .env("XDG_CONFIG_HOME", root.join("config"))
        .env("XDG_DATA_HOME", root.join("data"))
        .env("XDG_CURRENT_DESKTOP", "generic")
        .env("BROWSER", &application)
        .env("LANG", "C.UTF-8")
        .current_dir(root)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("start isolated process-boundary test");
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if child.try_wait().expect("poll isolated test").is_some() {
            break;
        }
        if Instant::now() >= deadline {
            child.kill().expect("terminate timed-out test");
            child.wait().expect("reap timed-out test");
            panic!("isolated opener case timed out: {case}");
        }
        thread::sleep(Duration::from_millis(10));
    }
    let output = child.wait_with_output().expect("collect isolated test result");
    assert!(
        output.status.success(),
        "{case}: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed; 0 failed"));
}

fn assert_application_argument(receipt: &Path, expected: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match fs::read(receipt) {
            Ok(bytes) => {
                assert_eq!(bytes, [expected.as_bytes(), &[0]].concat(), "one literal URL argument");
                fs::remove_file(receipt).expect("consume application receipt");
                return;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => panic!("real system launcher did not deliver its argument: {error}"),
        }
    }
}

#[test]
fn missing_launcher_propagates_os_error() {
    isolated("missing_launcher_propagates_os_error", "missing", |receipt| {
        let expected = Err(format!("系统无法打开链接：{}", Error::from_raw_os_error(2)));
        assert_eq!(open_platform_url("https://example.invalid"), expected);
        assert_eq!(open_external_url("https://example.invalid".into()), expected);
        assert!(!receipt.exists());
    });
}

#[test]
fn non_executable_launcher_propagates_os_error() {
    isolated("non_executable_launcher_propagates_os_error", "denied", |receipt| {
        let expected = Err(format!("系统无法打开链接：{}", Error::from_raw_os_error(13)));
        assert_eq!(open_platform_url("https://example.invalid"), expected);
        assert_eq!(open_external_url("https://example.invalid".into()), expected);
        assert!(!receipt.exists());
    });
}

#[test]
fn nul_argument_preserves_spawn_error() {
    let value = "https://example.invalid/\0suffix";
    let native = Command::new("xdg-open")
        .arg(value)
        .spawn()
        .expect_err("NUL cannot be a process argument");
    assert_eq!(native.kind(), std::io::ErrorKind::InvalidInput);
    assert_eq!(open_platform_url(value), Err(format!("系统无法打开链接：{native}")));
}

#[test]
fn real_launcher_forwards_four_protocols_as_single_literal_argument() {
    isolated(
        "real_launcher_forwards_four_protocols_as_single_literal_argument",
        "real",
        |receipt| {
            for value in [
                "HTTP://EXAMPLE.invalid/中文/%2f?q=two words&x='quote';$(touch injection-marker)",
                "https://example.invalid/path?q=%2B#Part",
                "MAILTO:test@example.invalid?subject=Hello%20World",
                "tel:+8613800000000",
            ] {
                assert_eq!(open_external_url(format!(" \u{2003}{value}\u{00a0} ")), Ok(()));
                assert_application_argument(receipt, value);
            }
            assert!(!receipt.parent().unwrap().join("injection-marker").exists());
        },
    );
}

#[test]
fn real_launcher_preserves_spawn_success_when_handler_fails() {
    isolated(
        "real_launcher_preserves_spawn_success_when_handler_fails",
        "handler-failure",
        |receipt| {
            let value = "https://example.invalid/handler-failure";
            assert_eq!(open_external_url(value.into()), Ok(()));
            assert_application_argument(receipt, value);
        },
    );
}

#[test]
fn backend_rejects_before_real_launcher() {
    isolated("backend_rejects_before_real_launcher", "real", |receipt| {
        for (value, expected) in [
            (" \t\n", "链接地址为空"),
            ("https://[::1", "链接格式无效"),
            ("javascript:alert(1)", "不支持打开此链接"),
            ("file:///tmp/private.txt", "不支持打开此链接"),
        ] {
            assert_eq!(open_external_url(value.into()), Err(expected.into()));
        }
        assert!(!receipt.exists());
    });
}

#[test]
fn private_opener_does_not_duplicate_protocol_validation() {
    isolated(
        "private_opener_does_not_duplicate_protocol_validation",
        "real",
        |receipt| {
            let value = "mdr-fixture:delegated-to-system";
            assert_eq!(open_platform_url(value), Ok(()));
            assert_application_argument(receipt, value);
            assert_eq!(open_external_url(value.into()), Err("不支持打开此链接".into()));
            assert!(!receipt.exists());
        },
    );
}

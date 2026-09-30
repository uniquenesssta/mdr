//! R12-21 Windows filesystem and commit-fault regressions against the shared production writer.

use super::{commit, write_bytes, Phase};
use crate::local_file::{binary_writer, commands, text_writer};
use std::{
    fs::{self, File, OpenOptions},
    io,
    os::windows::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

const ORIGINAL: &[u8] = b"recoverable original\0\xff";
const REPLACEMENT: &[u8] = b"complete new content\0\x80";

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos();
        let root = std::env::temp_dir().join(format!("mdr-safe-write-{}-{nonce}", std::process::id()));
        fs::create_dir(&root).expect("owned fixture");
        Self(root)
    }

    fn target(&self) -> PathBuf {
        self.0.join("用户文件.bin")
    }

    fn original(&self) -> PathBuf {
        let target = self.target();
        fs::write(&target, ORIGINAL).expect("fixture bytes");
        target
    }

    fn assert_clean(&self, expected: &[u8]) {
        assert_eq!(fs::read(self.target()).expect("target remains readable"), expected);
        assert_eq!(
            fs::read_dir(&self.0).expect("directory").count(),
            1,
            "no orphan sibling"
        );
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Err(err) = fs::remove_dir_all(&self.0) {
            eprintln!("safe-write fixture cleanup failed: {err}");
        }
    }
}

fn fail_at(phase: Phase, initially_present: bool) {
    let fixture = Fixture::new();
    let target = if initially_present {
        fixture.original()
    } else {
        fixture.target()
    };
    let mut observed = false;
    let parent = fs::canonicalize(&fixture.0).expect("parent");
    let mut hook = |actual, temporary: &Path| {
        assert_eq!(temporary.parent(), Some(parent.as_path()));
        if actual == phase {
            observed = true;
            Err(io::Error::other("injected commit I/O failure"))
        } else {
            Ok(())
        }
    };
    let err = commit(&target, REPLACEMENT, Some(&mut hook)).expect_err("fault must reject save");
    assert!(err.to_string().contains("injected commit I/O failure"));
    assert!(observed, "selected fault phase was reached");
    if initially_present {
        fixture.assert_clean(ORIGINAL);
    } else {
        assert!(!target.exists(), "failed new-file save must not publish partial bytes");
        assert_eq!(fs::read_dir(&fixture.0).expect("directory").count(), 0);
    }
    write_bytes(&target, REPLACEMENT).expect("retry after failure");
    fixture.assert_clean(REPLACEMENT);
}

#[test]
fn creates_new_unicode_file_with_complete_binary_bytes() {
    let fixture = Fixture::new();
    let target = fixture.target();
    assert_eq!(
        binary_writer::write_binary(&target, REPLACEMENT).expect("create"),
        REPLACEMENT.len()
    );
    fixture.assert_clean(REPLACEMENT);
}

#[test]
fn text_and_binary_overwrite_share_commit_and_keep_byte_counts() {
    let fixture = Fixture::new();
    let target = fixture.original();
    let text = "中文\r\n🙂";
    assert_eq!(text_writer::write_text(&target, text).expect("text"), text.len());
    fixture.assert_clean(text.as_bytes());
    assert_eq!(
        binary_writer::write_binary(&target, REPLACEMENT).expect("binary"),
        REPLACEMENT.len()
    );
    fixture.assert_clean(REPLACEMENT);
    assert_eq!(text_writer::write_text(&target, "").expect("empty"), 0);
    fixture.assert_clean(b"");
}

#[test]
fn partial_write_failure_preserves_old_bytes_and_cleans_sibling() {
    fail_at(Phase::PartialWrite, true);
}

#[test]
fn sync_failure_preserves_old_bytes_and_cleans_sibling() {
    fail_at(Phase::BeforeSync, true);
}

#[test]
fn replace_failure_preserves_old_bytes_and_cleans_sibling() {
    fail_at(Phase::BeforeReplace, true);
}

#[test]
fn failed_new_file_commit_does_not_publish_partial_file() {
    for phase in [
        Phase::Created,
        Phase::PartialWrite,
        Phase::BeforeSync,
        Phase::BeforeReplace,
    ] {
        fail_at(phase, false);
    }
}

#[test]
fn missing_parent_and_directory_target_are_rejected_without_creation() {
    let fixture = Fixture::new();
    assert!(write_bytes(&fixture.0.join("missing/file.bin"), REPLACEMENT).is_err());
    assert!(write_bytes(&fixture.0, REPLACEMENT).is_err());
    assert_eq!(fs::read_dir(&fixture.0).expect("directory").count(), 0);
}

#[test]
fn windows_devices_streams_and_ambiguous_names_are_rejected() {
    let fixture = Fixture::new();
    let target = fixture.original();
    for name in [
        "CON",
        "nul.txt",
        "COM1.bin",
        "LPT².txt",
        "trailing.",
        "trailing ",
        "bad?.bin",
    ] {
        assert!(write_bytes(&fixture.0.join(name), REPLACEMENT).is_err(), "{name}");
    }
    assert!(write_bytes(&PathBuf::from(format!("{}:secret", target.display())), REPLACEMENT).is_err());
    fixture.assert_clean(ORIGINAL);
}

#[test]
fn occupied_target_rejects_real_windows_replace_then_retries() {
    let fixture = Fixture::new();
    let target = fixture.original();
    // Allow a write preflight but deny FILE_SHARE_DELETE: the actual rename must fail.
    let held = OpenOptions::new()
        .read(true)
        .share_mode(0x1 | 0x2)
        .open(&target)
        .expect("hold target");
    let mut reached_replace = false;
    let mut hook = |phase, _: &Path| {
        reached_replace |= phase == Phase::BeforeReplace;
        Ok(())
    };
    commit(&target, REPLACEMENT, Some(&mut hook)).expect_err("real sharing violation");
    assert!(reached_replace, "not merely a rejected preflight");
    fixture.assert_clean(ORIGINAL);
    drop(held);
    write_bytes(&target, REPLACEMENT).expect("retry after release");
    fixture.assert_clean(REPLACEMENT);
}

struct RestoreReadonly {
    path: PathBuf,
    permissions: fs::Permissions,
}

impl RestoreReadonly {
    fn new(path: &Path) -> Self {
        Self {
            path: path.to_path_buf(),
            permissions: fs::metadata(path).expect("original fixture permissions").permissions(),
        }
    }
}

impl Drop for RestoreReadonly {
    fn drop(&mut self) {
        fs::set_permissions(&self.path, self.permissions.clone()).expect("restore original fixture permissions");
    }
}

#[test]
fn readonly_target_remains_readonly_and_recoverable() {
    let fixture = Fixture::new();
    let target = fixture.original();
    let restore = RestoreReadonly::new(&target);
    let mut permissions = fs::metadata(&target).expect("metadata").permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&target, permissions).expect("set readonly");
    assert!(text_writer::write_text(&target, "new")
        .expect_err("readonly")
        .starts_with("无法写入文本文件："));
    assert!(binary_writer::write_binary(&target, REPLACEMENT)
        .expect_err("readonly")
        .starts_with("无法写入文件："));
    fixture.assert_clean(ORIGINAL);
    assert!(fs::metadata(&target).expect("metadata").permissions().readonly());
    drop(restore);
    write_bytes(&target, REPLACEMENT).expect("retry after readonly removal");
    fixture.assert_clean(REPLACEMENT);
}

#[test]
fn readonly_set_after_staging_still_rejects_commit() {
    let fixture = Fixture::new();
    let target = fixture.original();
    let restore = RestoreReadonly::new(&target);
    let mut hook = |phase, _: &Path| {
        if phase == Phase::BeforeReplace {
            let mut permissions = fs::metadata(&target)?.permissions();
            permissions.set_readonly(true);
            fs::set_permissions(&target, permissions)?;
        }
        Ok(())
    };
    commit(&target, REPLACEMENT, Some(&mut hook)).expect_err("late readonly");
    fixture.assert_clean(ORIGINAL);
    drop(restore);
}

fn icacls(path: &Path, arguments: &[String]) -> String {
    let output = Command::new("icacls.exe")
        .arg(path)
        .args(arguments)
        .output()
        .expect("icacls available");
    assert!(
        output.status.success(),
        "icacls: {} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn user_sid() -> String {
    let output = Command::new("whoami.exe")
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .expect("whoami");
    assert!(output.status.success());
    String::from_utf8(output.stdout)
        .expect("SID output")
        .trim()
        .split(',')
        .next_back()
        .expect("SID")
        .trim_matches('"')
        .to_owned()
}

struct RestoreDeny {
    path: PathBuf,
    sid: String,
}

impl Drop for RestoreDeny {
    fn drop(&mut self) {
        icacls(&self.path, &["/remove:d".into(), format!("*{}", self.sid)]);
    }
}

#[test]
fn write_acl_denial_does_not_get_bypassed_by_parent_rename_rights() {
    let fixture = Fixture::new();
    let target = fixture.original();
    let sid = user_sid();
    let restore = RestoreDeny {
        path: target.clone(),
        sid: sid.clone(),
    };
    icacls(&target, &["/deny".into(), format!("*{sid}:(WD,AD)")]);
    write_bytes(&target, REPLACEMENT).expect_err("real target write ACL denial");
    fixture.assert_clean(ORIGINAL);
    drop(restore);
    write_bytes(&target, REPLACEMENT).expect("retry after ACL restoration");
    fixture.assert_clean(REPLACEMENT);
}

#[test]
fn successful_replace_preserves_protected_target_dacl() {
    let fixture = Fixture::new();
    let target = fixture.original();
    let sid = user_sid();
    icacls(
        &target,
        &["/inheritance:r".into(), "/grant:r".into(), format!("*{sid}:(F)")],
    );
    let before = icacls(&target, &[]);
    write_bytes(&target, REPLACEMENT).expect("commit with preserved ACL");
    fixture.assert_clean(REPLACEMENT);
    assert_eq!(icacls(&target, &[]), before, "protected DACL must survive replacement");
}

#[test]
fn cleanup_failure_reports_complete_recovery_file_without_deleting_original() {
    let fixture = Fixture::new();
    let target = fixture.original();
    let mut held: Option<File> = None;
    let mut recovery = None;
    let mut hook = |phase, temporary: &Path| {
        if phase == Phase::BeforeReplace {
            held = Some(OpenOptions::new().read(true).share_mode(0x1 | 0x2).open(temporary)?);
            recovery = Some(temporary.to_path_buf());
            return Err(io::Error::other("injected replace rejection"));
        }
        Ok(())
    };
    let err = commit(&target, REPLACEMENT, Some(&mut hook)).expect_err("cleanup sharing violation");
    let recovery = recovery.expect("recovery path");
    let message = err.to_string();
    assert!(message.contains("injected replace rejection"));
    assert!(message.contains("临时文件清理失败"));
    assert!(message.contains(&recovery.display().to_string()));
    assert_eq!(fs::read(&target).expect("original"), ORIGINAL);
    assert_eq!(fs::read(&recovery).expect("complete recovery bytes"), REPLACEMENT);
    drop(held);
    fs::remove_file(&recovery).expect("explicit cleanup after releasing handle");
    write_bytes(&target, REPLACEMENT).expect("retry");
    fixture.assert_clean(REPLACEMENT);
}

#[test]
fn invalid_base64_real_command_keeps_original_and_creates_no_sibling() {
    let fixture = Fixture::new();
    let target = fixture.original();
    let err = tauri::async_runtime::block_on(commands::write_local_binary_file(
        target.to_string_lossy().into_owned(),
        "%%%invalid%%%".into(),
    ))
    .expect_err("decode failure");
    assert!(err.starts_with("文件数据解码失败："));
    fixture.assert_clean(ORIGINAL);
}

#[test]
fn panicking_fault_hook_closes_handle_and_removes_owned_sibling() {
    let fixture = Fixture::new();
    let target = fixture.original();
    let result = std::panic::catch_unwind(|| {
        let mut hook = |phase, _: &Path| {
            if phase == Phase::PartialWrite {
                panic!("test unwind");
            }
            Ok(())
        };
        let _ = commit(&target, REPLACEMENT, Some(&mut hook));
    });
    assert!(result.is_err());
    fixture.assert_clean(ORIGINAL);
}

#[test]
fn concurrent_saves_publish_one_complete_payload_and_leave_no_siblings() {
    let fixture = Fixture::new();
    let target = fixture.original();
    let payloads: Vec<Vec<u8>> = (0..8).map(|byte| vec![byte; 131_072]).collect();
    std::thread::scope(|scope| {
        let threads: Vec<_> = payloads
            .iter()
            .map(|payload| {
                let target = &target;
                scope.spawn(move || write_bytes(target, payload))
            })
            .collect();
        let successes = threads
            .into_iter()
            .map(|thread| thread.join().expect("writer thread"))
            .filter(Result::is_ok)
            .count();
        assert!(successes > 0);
    });
    let bytes = fs::read(&target).expect("complete final payload");
    assert!(payloads.contains(&bytes), "never a mixed or partial payload");
    fixture.assert_clean(&bytes);
}

#[test]
fn preexisting_recovery_sibling_is_never_overwritten_or_cleaned() {
    let fixture = Fixture::new();
    let target = fixture.original();
    let orphan = fixture.0.join(".mdr-save-old-session.tmp");
    fs::write(&orphan, b"prior recoverable bytes").expect("previous session sibling");
    write_bytes(&target, REPLACEMENT).expect("commit");
    assert_eq!(fs::read(&target).expect("target"), REPLACEMENT);
    assert_eq!(
        fs::read(&orphan).expect("previous session retained"),
        b"prior recoverable bytes"
    );
    assert_eq!(fs::read_dir(&fixture.0).expect("directory").count(), 2);
}

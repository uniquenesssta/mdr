//! Real filesystem/Windows mutex checks, with test-owned paths only.
use super::{inbox, policy};
use std::{
    ffi::OsString,
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
fn root(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "mdr-launch-{name}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&path).unwrap();
    path
}
#[test]
fn default_enabled_and_policy_roundtrip() {
    let path = root("policy");
    assert!(policy::read(&path).unwrap());
    policy::write(&path, false).unwrap();
    assert!(!policy::read(&path).unwrap());
    policy::write(&path, true).unwrap();
    assert!(policy::read(&path).unwrap());
}

#[test]
fn failed_policy_write_retains_previously_confirmed_policy() {
    let path = root("policy-failure");
    policy::write(&path, false).unwrap();
    fs::create_dir(path.join("single-instance.pending")).unwrap();
    assert!(policy::write(&path, true).is_err());
    assert!(!policy::read(&path).unwrap());
}
#[test]
fn pending_paths_preserve_unicode_spaces_order_and_ack_only_one_request() {
    let path = root("inbox");
    let cwd = root("cwd");
    let id = inbox::enqueue(
        &path,
        vec![
            OsString::from("中文 空格.md"),
            OsString::from("b.txt"),
            OsString::from("image.png"),
        ]
        .into_iter(),
        &cwd,
    )
    .unwrap();
    inbox::enqueue(&path, std::iter::empty(), &cwd).unwrap();
    let requests = inbox::read_requests(&path).unwrap();
    assert_eq!(requests.len(), 2);
    let request = requests.iter().find(|r| r.id == id).unwrap();
    assert_eq!(
        request.paths,
        vec![
            cwd.join("中文 空格.md").to_string_lossy(),
            cwd.join("b.txt").to_string_lossy(),
            cwd.join("image.png").to_string_lossy()
        ]
    );
    inbox::acknowledge(&path, request).unwrap();
    assert_eq!(inbox::read_requests(&path).unwrap().len(), 1);
}
#[test]
fn request_limit_fails_explicitly_without_enqueuing_partial_batch() {
    let path = root("limits");
    assert!(inbox::enqueue(
        &path,
        (0..129).map(|n| OsString::from(format!("{n}.md"))),
        &path
    )
    .unwrap_err()
    .contains("128"));
    assert!(inbox::read_requests(&path).unwrap().is_empty());
}
#[cfg(windows)]
#[test]
fn named_coordinator_has_one_owner_and_releases_on_drop() {
    let id = format!("mdr-guard-test-{}", std::process::id());
    let first = super::InstanceGuard::acquire(&id).unwrap().unwrap();
    assert!(super::InstanceGuard::acquire(&id).unwrap().is_none());
    drop(first);
    assert!(super::InstanceGuard::acquire(&id).unwrap().is_some());
}

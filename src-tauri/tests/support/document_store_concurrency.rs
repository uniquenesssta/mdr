//! R11-15 concurrency regressions against the production store and real filesystem.
//! Reuses the command-contract fixtures; owns no alternate cache or storage implementation.

use super::command_contract_tests::{full_request, TestRoot, DOCUMENT_ID};
use super::*;
use serde_json::json;
use std::{
    fs,
    sync::{mpsc, Barrier},
    thread,
    time::Duration,
};

const DEADLINE: Duration = Duration::from_secs(5);

#[test]
fn reservation_releases_mutex_and_keeps_other_documents_available() {
    let root = TestRoot::new();
    let store = DocumentStore::default();
    let lease = store.inner.checkout(Ok(DOCUMENT_ID.into())).unwrap();
    assert!(store.inner.mutex_available());
    let worker = store.clone();
    let path = root.0.clone();
    let (send, receive) = mpsc::channel();
    let task = thread::spawn(move || {
        let mut request = full_request("另一份文档😀");
        request.document_id = "independent".into();
        send.send(worker.save(&path, request)).unwrap();
    });
    let result = receive.recv_timeout(DEADLINE);
    let alias_store = store.clone();
    let (alias_send, alias_receive) = mpsc::channel();
    let (started_send, started_receive) = mpsc::channel();
    let alias = thread::spawn(move || {
        started_send.send(()).unwrap();
        let _alias_lease = alias_store
            .inner
            .checkout(Ok(DOCUMENT_ID.to_ascii_uppercase()))
            .unwrap();
        alias_send.send(()).unwrap();
    });
    started_receive.recv_timeout(DEADLINE).unwrap();
    let alias_blocked = matches!(
        alias_receive.recv_timeout(Duration::from_millis(100)),
        Err(mpsc::RecvTimeoutError::Timeout)
    );
    drop(lease);
    task.join().unwrap();
    alias_receive.recv_timeout(DEADLINE).unwrap();
    alias.join().unwrap();
    assert!(
        alias_blocked,
        "case aliases must retain same-directory serialization"
    );
    assert_eq!(result.unwrap().unwrap().version, 1);
}

#[test]
fn competing_deltas_have_one_winner_and_preserve_disk_cache_agreement() {
    let root = TestRoot::new();
    let store = DocumentStore::default();
    store.save(&root.0, full_request("甲")).unwrap();
    let barrier = Arc::new(Barrier::new(8));
    let tasks: Vec<_> = (0..8)
        .map(|index| {
            let store = store.clone();
            let path = root.0.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                let request = serde_json::from_value(json!({
                "documentId": DOCUMENT_ID, "title": "并发.md", "baseVersion": 1,
                "nextVersion": 2, "updatedAt": 43,
                "transactions": [{"changes": [{"from": 1, "to": 1, "insert": index.to_string()}]}]
            })).unwrap();
                barrier.wait();
                (index, store.save(&path, request))
            })
        })
        .collect();
    let mut winners = Vec::new();
    for task in tasks {
        let (index, result) = task.join().unwrap();
        match result {
            Ok(response) => {
                assert_eq!((response.version, response.journal_entries), (2, 1));
                winners.push(index);
            }
            Err(error) => assert_eq!(error, "VERSION_MISMATCH:2:1"),
        }
    }
    assert_eq!(winners.len(), 1);
    let cached = store.load(&root.0, DOCUMENT_ID.into()).unwrap().unwrap();
    let disk = DocumentStore::default()
        .load(&root.0, DOCUMENT_ID.into())
        .unwrap()
        .unwrap();
    assert_eq!(cached.content, format!("甲{}", winners[0]));
    assert_eq!(
        (disk.content, disk.version),
        (cached.content, cached.version)
    );
}

#[test]
fn concurrent_full_saves_share_normalized_identity_and_rotate_valid_slots() {
    let root = TestRoot::new();
    let store = DocumentStore::default();
    let barrier = Arc::new(Barrier::new(8));
    let tasks: Vec<_> = (0..8)
        .map(|index| {
            let store = store.clone();
            let path = root.0.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                let content = format!("并发快照😀{index}");
                let mut request = full_request(&content);
                if index % 2 == 0 {
                    request.document_id.push_str("!!");
                }
                barrier.wait();
                (content, store.save(&path, request).unwrap().version)
            })
        })
        .collect();
    let mut results: Vec<_> = tasks.into_iter().map(|task| task.join().unwrap()).collect();
    results.sort_by_key(|(_, version)| *version);
    assert_eq!(
        results
            .iter()
            .map(|(_, version)| *version)
            .collect::<Vec<_>>(),
        (1..=8).collect::<Vec<_>>()
    );
    let disk = DocumentStore::default()
        .load(&root.0, DOCUMENT_ID.into())
        .unwrap()
        .unwrap();
    assert_eq!((disk.content, disk.version), results.pop().unwrap());
    assert_eq!(store.inner.cached_len(), 1);
}

#[test]
fn concurrent_recovery_readers_consume_the_notice_exactly_once() {
    let root = TestRoot::fixture("corrupt-slot");
    let store = DocumentStore::default();
    let barrier = Arc::new(Barrier::new(8));
    let tasks: Vec<_> = (0..8)
        .map(|index| {
            let store = store.clone();
            let path = root.0.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                barrier.wait();
                if index % 2 == 0 {
                    let document = store.load(&path, DOCUMENT_ID.into()).unwrap().unwrap();
                    (document.recovered, document.recovery_message)
                } else {
                    let manifest = store.manifest(&path, DOCUMENT_ID.into()).unwrap().unwrap();
                    (manifest.recovered, manifest.recovery_message)
                }
            })
        })
        .collect();
    let notices: Vec<_> = tasks.into_iter().map(|task| task.join().unwrap()).collect();
    assert_eq!(
        notices.iter().filter(|(recovered, _)| *recovered).count(),
        1
    );
    for (recovered, message) in notices {
        assert_eq!(recovered, message.is_some());
    }
}

#[test]
fn io_failure_returns_the_owned_document_and_allows_a_retry() {
    let root = TestRoot::new();
    let store = DocumentStore::default();
    let obstacle = root.0.join("snapshot-a.md.tmp");
    fs::create_dir(&obstacle).unwrap();
    assert!(store
        .save(&root.0, full_request("第一次"))
        .unwrap_err()
        .starts_with("无法创建临时文件："));
    assert!(store.inner.mutex_available());
    fs::remove_dir(obstacle).unwrap();
    let worker = store.clone();
    let path = root.0.clone();
    let (send, receive) = mpsc::channel();
    let task = thread::spawn(move || {
        send.send(worker.save(&path, full_request("重试😀")))
            .unwrap()
    });
    // Existing error behavior retains the attempted in-memory version, so retry advances to 2.
    assert_eq!(receive.recv_timeout(DEADLINE).unwrap().unwrap().version, 2);
    task.join().unwrap();
    let disk = DocumentStore::default()
        .load(&root.0, DOCUMENT_ID.into())
        .unwrap()
        .unwrap();
    assert_eq!((disk.content.as_str(), disk.version), ("重试😀", 2));
}

#[test]
fn unwind_releases_reservation_and_wakes_same_document_waiters_with_poison_error() {
    let root = TestRoot::new();
    let store = DocumentStore::default();
    let lease = store.inner.checkout(Ok(DOCUMENT_ID.into())).unwrap();
    let worker = store.clone();
    let path = root.0.clone();
    let (send, receive) = mpsc::channel();
    let (started_tx, started_rx) = mpsc::channel();
    let task = thread::spawn(move || {
        started_tx.send(()).unwrap();
        send.send(worker.load(&path, DOCUMENT_ID.into())).unwrap();
    });
    started_rx.recv_timeout(DEADLINE).unwrap();
    assert!(matches!(
        receive.recv_timeout(Duration::from_millis(100)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    let unwound = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        let _lease = lease;
        panic!("unwind while owning a document without holding a mutex");
    }));
    assert!(unwound.is_err());
    assert_eq!(
        receive.recv_timeout(DEADLINE).unwrap().unwrap_err(),
        "文档存储锁已损坏"
    );
    task.join().unwrap();
    assert!(store.inner.mutex_available());
    assert_eq!(
        store.save(&root.0, full_request("拒绝继续")).unwrap_err(),
        "文档存储锁已损坏"
    );
}

#[test]
fn delete_and_cold_load_never_leave_a_resurrected_cached_document() {
    for _ in 0..16 {
        let root = TestRoot::new();
        DocumentStore::default()
            .save(&root.0, full_request("待删除😀"))
            .unwrap();
        let store = DocumentStore::default();
        let reader = store.clone();
        let path = root.0.clone();
        let barrier = Arc::new(Barrier::new(2));
        let ready = barrier.clone();
        let task = thread::spawn(move || {
            ready.wait();
            reader.load(&path, DOCUMENT_ID.into()).unwrap()
        });
        barrier.wait();
        store.delete(&root.0, DOCUMENT_ID).unwrap();
        task.join().unwrap();
        assert!(store.load(&root.0, DOCUMENT_ID.into()).unwrap().is_none());
        assert_eq!(store.inner.cached_len(), 0);
        assert!(!root.0.exists());
    }
}

#[cfg(unix)]
#[test]
fn blocked_real_journal_read_does_not_block_another_documents_disk_save() {
    use std::fs::OpenOptions;
    use std::process::Command;

    let slow_root = TestRoot::new();
    let fast_root = TestRoot::new();
    DocumentStore::default()
        .save(&slow_root.0, full_request("慢文档😀"))
        .unwrap();
    let journal = journal_path(&slow_root.0);
    fs::remove_file(&journal).unwrap();
    assert!(Command::new("mkfifo")
        .arg(&journal)
        .status()
        .unwrap()
        .success());

    let store = DocumentStore::default();
    let slow_store = store.clone();
    let path = slow_root.0.clone();
    let slow = thread::spawn(move || slow_store.load(&path, DOCUMENT_ID.into()));
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let writer = thread::spawn(move || {
        let pipe = OpenOptions::new().write(true).open(journal).unwrap();
        entered_tx.send(()).unwrap();
        let released = release_rx.recv_timeout(DEADLINE);
        drop(pipe); // EOF releases the actual production fs::read, including a failing test.
        released
    });
    entered_rx.recv_timeout(DEADLINE).unwrap();
    let mutex_free = store.inner.mutex_available();
    let fast_store = store.clone();
    let path = fast_root.0.clone();
    let (send, receive) = mpsc::channel();
    let fast = thread::spawn(move || {
        let mut request = full_request("独立保存😀");
        request.document_id = "fast-document".into();
        send.send(fast_store.save(&path, request)).unwrap();
    });
    let result = receive.recv_timeout(Duration::from_secs(3));
    let released = release_tx.send(());
    let loaded = slow.join().unwrap().unwrap().unwrap();
    fast.join().unwrap();
    writer.join().unwrap().unwrap();
    released.unwrap();
    assert!(mutex_free, "real file IO must not retain the cache mutex");
    assert_eq!(result.unwrap().unwrap().version, 1);
    assert_eq!(loaded.content, "慢文档😀");
}

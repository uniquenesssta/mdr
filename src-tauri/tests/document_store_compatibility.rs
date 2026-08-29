//! R11-01 compatibility fixture gate for the pre-rewrite Rust document store.
//!
//! Responsibility: freeze the current on-disk bytes and externally observable recovery/UTF-16
//! semantics before production code is split. This test owns no production state and performs
//! no writes to the shipped fixture corpus.
//! Allowed dependencies: std plus the package's existing serde/serde_json dependencies.
//! Forbidden here: Tauri command execution, alternate persistence policy, or format migration.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

const SOURCE_COMMIT: &str = "a49d89918a20251287df28583ab29d4b6eb4c1de";
const SOURCE_DOCUMENT_STORE_BLOB: &str = "af58efc8ac19672e7834b5cd8bab26fd202f85aa";
const SOURCE_DOCUMENT_STORE_ENTRY: &str = include_str!("../src/document_store/mod.rs");
const SOURCE_DOCUMENT_STORE_TYPES: &str = include_str!("../src/document_store/types.rs");
const SOURCE_DOCUMENT_STORE_VALIDATION: &str = include_str!("../src/document_store/validation.rs");
const SOURCE_DOCUMENT_STORE_PATHS: &str = include_str!("../src/document_store/paths.rs");
const SOURCE_DOCUMENT_STORE_SNAPSHOT_INTEGRITY: &str =
    include_str!("../src/document_store/snapshot/integrity.rs");

const SOURCE_DOCUMENT_STORE_INDEX_SEARCH: &str =
    include_str!("../src/document_store/index/search.rs");

fn current_source_contains(token: &str) -> bool {
    SOURCE_DOCUMENT_STORE_ENTRY.contains(token)
        || SOURCE_DOCUMENT_STORE_TYPES.contains(token)
        || SOURCE_DOCUMENT_STORE_VALIDATION.contains(token)
        || SOURCE_DOCUMENT_STORE_PATHS.contains(token)
        || SOURCE_DOCUMENT_STORE_SNAPSHOT_INTEGRITY.contains(token)
        || SOURCE_DOCUMENT_STORE_INDEX_SEARCH.contains(token)
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct TextChange {
    from: usize,
    to: usize,
    insert: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocumentTransaction {
    changes: Vec<TextChange>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct JournalEntry {
    base_version: u64,
    next_version: u64,
    title: String,
    updated_at: u64,
    transactions: Vec<DocumentTransaction>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SnapshotMeta {
    version: u64,
    title: String,
    updated_at: u64,
    content_bytes: usize,
    content_hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CompatibleDocument {
    title: String,
    content: String,
    version: u64,
    updated_at: u64,
    recovered: bool,
    recovery_message: Option<String>,
}

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("document_store")
}

fn case_root(name: &str) -> PathBuf {
    fixture_root().join(name)
}

fn fnv1a64(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn snapshot_paths(root: &Path, slot: char) -> (PathBuf, PathBuf) {
    (
        root.join(format!("snapshot-{slot}.md")),
        root.join(format!("snapshot-{slot}.json")),
    )
}

fn read_snapshot(root: &Path, slot: char) -> Option<CompatibleDocument> {
    let (content_path, meta_path) = snapshot_paths(root, slot);
    let meta_bytes = fs::read(meta_path).ok()?;
    let meta: SnapshotMeta = serde_json::from_slice(&meta_bytes).ok()?;
    let content = fs::read_to_string(content_path).ok()?;
    if content.len() != meta.content_bytes || fnv1a64(content.as_bytes()) != meta.content_hash {
        return None;
    }
    Some(CompatibleDocument {
        title: meta.title,
        content,
        version: meta.version,
        updated_at: meta.updated_at,
        recovered: false,
        recovery_message: None,
    })
}

fn utf16_to_byte_index(text: &str, target: usize) -> Result<usize, String> {
    if target == 0 {
        return Ok(0);
    }
    let mut utf16 = 0usize;
    for (byte_index, ch) in text.char_indices() {
        if utf16 == target {
            return Ok(byte_index);
        }
        let width = ch.len_utf16();
        if utf16 + width > target {
            return Err("文本修改位置落在代理字符中间".into());
        }
        utf16 += width;
    }
    if utf16 == target {
        Ok(text.len())
    } else {
        Err("文本修改位置超过文档长度".into())
    }
}

fn apply_transactions(
    content: &mut String,
    transactions: &[DocumentTransaction],
) -> Result<(), String> {
    for transaction in transactions {
        let mut changes = transaction.changes.clone();
        changes.sort_by(|left, right| right.from.cmp(&left.from));
        for change in changes {
            if change.to < change.from {
                return Err("文本修改范围无效".into());
            }
            let from = utf16_to_byte_index(content, change.from)?;
            let to = utf16_to_byte_index(content, change.to)?;
            if to < from {
                return Err("文本修改范围无效".into());
            }
            content.replace_range(from..to, &change.insert);
        }
    }
    Ok(())
}

fn load_compatible_case(root: &Path) -> Result<Option<CompatibleDocument>, String> {
    let a_exists = {
        let (content, meta) = snapshot_paths(root, 'a');
        content.exists() || meta.exists()
    };
    let b_exists = {
        let (content, meta) = snapshot_paths(root, 'b');
        content.exists() || meta.exists()
    };
    let snapshot_a = read_snapshot(root, 'a');
    let snapshot_b = read_snapshot(root, 'b');
    let mut recovery_notes = Vec::new();
    if a_exists && snapshot_a.is_none() {
        recovery_notes.push("A 槽快照校验失败".to_string());
    }
    if b_exists && snapshot_b.is_none() {
        recovery_notes.push("B 槽快照校验失败".to_string());
    }

    let mut document = match (snapshot_a, snapshot_b) {
        (Some(left), Some(right)) => {
            if left.version >= right.version {
                left
            } else {
                right
            }
        }
        (Some(document), None) | (None, Some(document)) => document,
        (None, None) => {
            if a_exists || b_exists {
                return Err("后台文档的两个快照均无法通过完整性校验".into());
            }
            return Ok(None);
        }
    };

    let journal = root.join("changes.jsonl");
    if journal.exists() {
        let bytes = fs::read(&journal).map_err(|err| format!("无法读取增量日志：{err}"))?;
        let mut cursor = 0usize;
        while cursor < bytes.len() {
            let relative_end = bytes[cursor..]
                .iter()
                .position(|byte| *byte == b'\n')
                .map(|offset| cursor + offset)
                .unwrap_or(bytes.len());
            let raw = &bytes[cursor..relative_end];
            cursor = if relative_end < bytes.len() {
                relative_end + 1
            } else {
                bytes.len()
            };
            if raw.iter().all(|byte| byte.is_ascii_whitespace()) {
                continue;
            }
            let line = match std::str::from_utf8(raw) {
                Ok(line) => line.trim_end_matches('\r'),
                Err(_) => {
                    recovery_notes.push("增量日志尾部包含无效 UTF-8 数据".to_string());
                    break;
                }
            };
            let entry: JournalEntry = match serde_json::from_str(line) {
                Ok(entry) => entry,
                Err(_) => {
                    recovery_notes.push("增量日志包含未完整写入的记录".to_string());
                    break;
                }
            };
            if entry.next_version <= document.version {
                continue;
            }
            if entry.base_version != document.version {
                recovery_notes.push("增量日志版本链不连续".to_string());
                break;
            }
            let mut next_content = document.content.clone();
            if let Err(error) = apply_transactions(&mut next_content, &entry.transactions) {
                recovery_notes.push(format!("增量日志文本范围无效：{error}"));
                break;
            }
            document.content = next_content;
            document.version = entry.next_version;
            document.title = entry.title;
            document.updated_at = entry.updated_at;
        }
        if !recovery_notes.is_empty() {
            document.recovered = true;
            document.recovery_message = Some(format!(
                "检测到存储异常，已恢复到版本 {}：{}",
                document.version,
                recovery_notes.join("；")
            ));
        }
    } else if !recovery_notes.is_empty() {
        document.recovered = true;
        document.recovery_message = Some(format!(
            "检测到存储异常，已从可用快照恢复到版本 {}：{}",
            document.version,
            recovery_notes.join("；")
        ));
    }

    Ok(Some(document))
}

fn utf16_to_byte_for_search(text: &str, target: usize) -> Result<usize, String> {
    let total = text.encode_utf16().count();
    if target > total {
        return Err("搜索位置超过文档长度".into());
    }
    let mut utf16 = 0usize;
    for (byte_index, ch) in text.char_indices() {
        if utf16 == target {
            return Ok(byte_index);
        }
        let width = ch.len_utf16();
        if utf16 + width > target {
            return Err("搜索位置落在代理字符中间".into());
        }
        utf16 += width;
    }
    if utf16 == target {
        Ok(text.len())
    } else {
        Err("搜索位置超过文档长度".into())
    }
}

fn search_utf16(
    text: &str,
    query: &str,
    from: usize,
    wrap: bool,
) -> Result<Option<(usize, usize, bool)>, String> {
    if query.is_empty() {
        return Ok(None);
    }
    let total = text.encode_utf16().count();
    let start = from.min(total);
    let start_byte = utf16_to_byte_for_search(text, start)?;
    let mut wrapped = false;
    let found_byte = text[start_byte..]
        .find(query)
        .map(|relative| start_byte + relative)
        .or_else(|| {
            if wrap && start_byte > 0 {
                wrapped = true;
                text[..start_byte].find(query)
            } else {
                None
            }
        });
    let Some(found_byte) = found_byte else {
        return Ok(None);
    };
    let from = text[..found_byte].encode_utf16().count();
    let to = from + query.encode_utf16().count();
    Ok(Some((from, to, wrapped)))
}

#[test]
fn manifest_pins_the_exact_pre_rewrite_source_and_format_vocabulary() {
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(fixture_root().join("manifest.json")).expect("fixture manifest must exist"),
    )
    .expect("fixture manifest must be valid JSON");

    assert_eq!(manifest["sourceCommit"].as_str(), Some(SOURCE_COMMIT));
    assert_eq!(
        manifest["sourceDocumentStoreBlob"].as_str(),
        Some(SOURCE_DOCUMENT_STORE_BLOB)
    );
    assert_eq!(
        manifest["sourcePath"].as_str(),
        Some("src-tauri/src/document_store.rs")
    );
    assert_eq!(
        manifest["formatContract"]["jsonCase"].as_str(),
        Some("camelCase")
    );
    assert_eq!(
        manifest["formatContract"]["offsets"].as_str(),
        Some("UTF-16")
    );

    for frozen_token in [
        "snapshot-{slot}.md",
        "snapshot-{slot}.json",
        "changes.jsonl",
        "0xcbf29ce484222325",
        "0x100000001b3",
        "#[serde(rename_all = \"camelCase\")]",
        "encode_utf16",
    ] {
        assert!(
            current_source_contains(frozen_token),
            "current source no longer contains frozen R11-01 token: {frozen_token}"
        );
    }
}

#[test]
fn valid_ab_slots_and_journal_keep_canonical_bytes_and_replay_to_version_three() {
    let root = case_root("valid-ab-journal-unicode");
    for slot in ['a', 'b'] {
        let (_, meta_path) = snapshot_paths(&root, slot);
        let bytes = fs::read(meta_path).unwrap();
        let meta: SnapshotMeta = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(serde_json::to_vec(&meta).unwrap(), bytes);
        assert!(read_snapshot(&root, slot).is_some());
    }
    let journal_bytes = fs::read(root.join("changes.jsonl")).unwrap();
    assert!(journal_bytes.ends_with(b"\n"));
    let line = &journal_bytes[..journal_bytes.len() - 1];
    let entry: JournalEntry = serde_json::from_slice(line).unwrap();
    assert_eq!(serde_json::to_vec(&entry).unwrap(), line);

    let loaded = load_compatible_case(&root).unwrap().unwrap();
    assert_eq!(loaded.version, 3);
    assert_eq!(loaded.title, "中文😀.md");
    assert_eq!(loaded.content, "# 标题😀\n第一行\n第二行\n搜索😀中文\n");
    assert!(!loaded.recovered);
    assert_eq!(loaded.recovery_message, None);
}

#[test]
fn truncated_journal_recovers_the_valid_prefix_with_the_exact_message() {
    let root = case_root("truncated-journal");
    let bytes = fs::read(root.join("changes.jsonl")).unwrap();
    let newline = bytes.iter().position(|byte| *byte == b'\n').unwrap();
    let first: JournalEntry = serde_json::from_slice(&bytes[..newline]).unwrap();
    assert_eq!(serde_json::to_vec(&first).unwrap(), &bytes[..newline]);
    assert_eq!(&bytes[newline + 1..], b"{\"baseVersion\":5");
    assert!(serde_json::from_slice::<JournalEntry>(&bytes[newline + 1..]).is_err());

    let loaded = load_compatible_case(&root).unwrap().unwrap();
    assert_eq!(loaded.version, 5);
    assert_eq!(loaded.title, "截断😀.md");
    assert_eq!(loaded.content, "甲乙😀丙");
    assert!(loaded.recovered);
    assert_eq!(
        loaded.recovery_message.as_deref(),
        Some("检测到存储异常，已恢复到版本 5：增量日志包含未完整写入的记录")
    );
}

#[test]
fn corrupt_newer_slot_falls_back_to_a_with_the_exact_recovery_message() {
    let root = case_root("corrupt-slot");
    assert!(read_snapshot(&root, 'a').is_some());
    assert!(read_snapshot(&root, 'b').is_none());

    let loaded = load_compatible_case(&root).unwrap().unwrap();
    assert_eq!(loaded.version, 6);
    assert_eq!(loaded.title, "恢复😀.md");
    assert_eq!(loaded.content, "可用旧快照😀");
    assert!(loaded.recovered);
    assert_eq!(
        loaded.recovery_message.as_deref(),
        Some("检测到存储异常，已从可用快照恢复到版本 6：B 槽快照校验失败")
    );
}

#[test]
fn chinese_and_emoji_search_freezes_utf16_offsets_and_wrap_behavior() {
    let loaded = load_compatible_case(&case_root("valid-ab-journal-unicode"))
        .unwrap()
        .unwrap();
    let direct = search_utf16(&loaded.content, "😀中文", 0, true).unwrap();
    assert_eq!(direct, Some((17, 21, false)));
    let wrapped = search_utf16(&loaded.content, "😀中文", 21, true).unwrap();
    assert_eq!(wrapped, Some((17, 21, true)));
}

//! In-memory document ownership and per-document admission.
//!
//! The mutex protects only the cache map and active-key set. Checkout moves (never clones)
//! the document into an exclusive lease and releases the mutex before returning to the store.
//! Same-key callers wait on a predicate; unrelated keys proceed. Drop restores state and wakes
//! waiters on success, error and unwind. No file IO, Tauri, save or recovery policy is allowed.

use super::index::{build_document_index, DocumentIndex};
use std::{
    collections::{HashMap, HashSet},
    sync::{Condvar, Mutex},
};

const POISONED: &str = "文档存储锁已损坏";

#[derive(Clone, Debug, Default)]
pub(super) struct StoredDocument {
    pub(super) title: String,
    pub(super) content: String,
    pub(super) version: u64,
    pub(super) updated_at: u64,
    pub(super) journal_entries: u32,
    pub(super) journal_bytes: u64,
    pub(super) snapshot_slot: Option<char>,
    pub(super) recovered: bool,
    pub(super) recovery_message: Option<String>,
    pub(super) index: Option<DocumentIndex>,
}

impl StoredDocument {
    pub(super) fn ensure_index(&mut self) -> &DocumentIndex {
        if self.index.is_none() {
            self.index = Some(build_document_index(&self.content));
        }
        self.index.as_ref().expect("document index initialized")
    }
}

#[derive(Default)]
struct CacheState {
    documents: HashMap<String, StoredDocument>,
    active: HashSet<String>,
    poisoned: bool,
}

#[derive(Default)]
pub(super) struct DocumentCache {
    state: Mutex<CacheState>,
    available: Condvar,
}

pub(super) struct DocumentLease<'a> {
    cache: &'a DocumentCache,
    key: String,
    admission_key: String,
    pub(super) document: Option<StoredDocument>,
}

impl DocumentCache {
    // The validated key result is deliberately unwrapped after the poison check: save used to
    // lock before validating its ID. Read/delete callers still validate before calling here.
    pub(super) fn checkout(
        &self,
        key: Result<String, String>,
    ) -> Result<DocumentLease<'_>, String> {
        let mut state = self.state.lock().map_err(|_| POISONED.to_string())?;
        if state.poisoned {
            return Err(POISONED.into());
        }
        let key = key?;
        // IDs are ASCII. Case aliases can name the same directory on Windows/macOS; keep
        // their IO serialized without changing the existing cache keys or on-disk names.
        let admission_key = key.to_ascii_lowercase();
        while state.active.contains(&admission_key) {
            state = self
                .available
                .wait(state)
                .map_err(|_| POISONED.to_string())?;
            if state.poisoned {
                return Err(POISONED.into());
            }
        }
        state.active.insert(admission_key.clone());
        let document = state.documents.remove(&key);
        drop(state);
        Ok(DocumentLease {
            cache: self,
            key,
            admission_key,
            document,
        })
    }

    #[cfg(test)]
    pub(super) fn cached_len(&self) -> usize {
        self.state.lock().unwrap().documents.len()
    }

    #[cfg(test)]
    pub(super) fn poison_for_test(&self) {
        let _guard = self.state.lock().unwrap();
        panic!("deliberately poison the test cache");
    }

    #[cfg(test)]
    pub(super) fn mutex_available(&self) -> bool {
        self.state.try_lock().is_ok()
    }
}

impl Drop for DocumentLease<'_> {
    fn drop(&mut self) {
        // Reclaim ownership even when the mutex is already poisoned; never clear its poison.
        // An unwind during an unlocked use case must likewise fail subsequent operations closed.
        let mut state = match self.cache.state.lock() {
            Ok(state) => state,
            Err(error) => error.into_inner(),
        };
        state.poisoned |= std::thread::panicking();
        if let Some(document) = self.document.take() {
            state.documents.insert(self.key.clone(), document);
        }
        state.active.remove(&self.admission_key);
        drop(state);
        self.cache.available.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_document_index_builds_once_and_caches_on_the_document() {
        let mut document = StoredDocument {
            content: "# 标题\n正文".into(),
            ..StoredDocument::default()
        };
        assert!(document.index.is_none());
        let first = document.ensure_index().clone();
        assert!(document.index.is_some());
        let second = document.ensure_index();
        assert_eq!(first.line_count, second.line_count);
        assert_eq!(first.headings.len(), second.headings.len());
    }
}

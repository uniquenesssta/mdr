//! Local text-file tree limits and call-local truncation accounting.
//!
//! Responsibility: centralize the frozen tree depth, scanned-entry and readable-text size
//! boundaries, plus accepted file/directory, skipped-entry and truncation counters.
//! The text byte ceiling is shared from Text Reader so the 20 MiB policy has one numeric source.
//! This module does not inspect paths, read directories, open files, build DTOs or expose commands.
//! Every scan creates its own state, so there is no cross-call lifecycle cleanup.

use super::text_reader::MAX_TEXT_BYTES;

pub(super) const MAX_FILE_TREE_DEPTH: usize = 24;
pub(super) const MAX_FILE_TREE_ENTRIES: usize = 12_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct TreeLimits {
    max_depth: usize,
    max_entries: usize,
    max_file_bytes: u64,
}

impl TreeLimits {
    pub(super) const fn new(max_depth: usize, max_entries: usize, max_file_bytes: u64) -> Self {
        Self {
            max_depth,
            max_entries,
            max_file_bytes,
        }
    }

    pub(super) const fn accepts_file_size(self, bytes: u64) -> bool {
        bytes <= self.max_file_bytes
    }
}

impl Default for TreeLimits {
    fn default() -> Self {
        Self::new(MAX_FILE_TREE_DEPTH, MAX_FILE_TREE_ENTRIES, MAX_TEXT_BYTES)
    }
}

#[derive(Debug, Default)]
pub(super) struct TreeLimitState {
    scanned_entries: usize,
    file_count: usize,
    directory_count: usize,
    skipped_count: usize,
    truncated: bool,
}

impl TreeLimitState {
    pub(super) fn admit_depth(&mut self, depth: usize, limits: TreeLimits) -> bool {
        if depth <= limits.max_depth {
            return true;
        }
        self.truncated = true;
        false
    }

    pub(super) fn admit_entry(&mut self, limits: TreeLimits) -> bool {
        if self.scanned_entries >= limits.max_entries {
            self.truncated = true;
            return false;
        }
        self.scanned_entries += 1;
        true
    }

    pub(super) fn record_file(&mut self) {
        self.file_count += 1;
    }

    pub(super) fn record_directory(&mut self) {
        self.directory_count += 1;
    }

    pub(super) fn record_skipped(&mut self) {
        self.skipped_count += 1;
    }

    pub(super) const fn file_count(&self) -> usize {
        self.file_count
    }

    pub(super) const fn directory_count(&self) -> usize {
        self.directory_count
    }

    pub(super) const fn skipped_count(&self) -> usize {
        self.skipped_count
    }

    pub(super) const fn truncated(&self) -> bool {
        self.truncated
    }

    #[cfg(test)]
    pub(super) fn with_scanned_entries(scanned_entries: usize) -> Self {
        Self {
            scanned_entries,
            ..Self::default()
        }
    }

    #[cfg(test)]
    pub(super) const fn scanned_entries(&self) -> usize {
        self.scanned_entries
    }
}

#[cfg(test)]
mod tests {
    use super::{TreeLimitState, TreeLimits, MAX_FILE_TREE_DEPTH, MAX_FILE_TREE_ENTRIES, MAX_TEXT_BYTES};

    #[test]
    fn defaults_freeze_depth_entry_and_text_size_boundaries() {
        assert_eq!(
            TreeLimits::default(),
            TreeLimits::new(MAX_FILE_TREE_DEPTH, MAX_FILE_TREE_ENTRIES, MAX_TEXT_BYTES)
        );
        assert_eq!(MAX_FILE_TREE_DEPTH, 24);
        assert_eq!(MAX_FILE_TREE_ENTRIES, 12_000);
        assert_eq!(MAX_TEXT_BYTES, 20 * 1024 * 1024);
    }

    #[test]
    fn depth_allows_equal_and_truncates_only_after_the_limit() {
        let limits = TreeLimits::new(1, 10, 20);
        let mut state = TreeLimitState::default();

        assert!(state.admit_depth(1, limits));
        assert!(!state.truncated());
        assert!(!state.admit_depth(2, limits));
        assert!(state.truncated());
    }

    #[test]
    fn entry_budget_counts_each_admitted_entry_and_truncates_the_next() {
        let limits = TreeLimits::new(1, 1, 20);
        let mut state = TreeLimitState::default();

        assert!(state.admit_entry(limits));
        assert_eq!(state.scanned_entries(), 1);
        assert!(!state.admit_entry(limits));
        assert_eq!(state.scanned_entries(), 1);
        assert!(state.truncated());
    }

    #[test]
    fn text_size_allows_equal_and_rejects_only_greater_bytes() {
        let limits = TreeLimits::new(1, 1, 20);

        assert!(limits.accepts_file_size(20));
        assert!(!limits.accepts_file_size(21));
    }

    #[test]
    fn records_file_directory_and_skipped_counts_without_inventing_truncation() {
        let mut state = TreeLimitState::default();
        state.record_file();
        state.record_file();
        state.record_directory();
        state.record_skipped();

        assert_eq!(state.file_count(), 2);
        assert_eq!(state.directory_count(), 1);
        assert_eq!(state.skipped_count(), 1);
        assert!(!state.truncated());
    }

    #[test]
    fn scan_states_are_call_local_and_independent() {
        let limits = TreeLimits::new(0, 0, 0);
        let mut first = TreeLimitState::default();
        let second = TreeLimitState::default();

        assert!(!first.admit_entry(limits));
        assert!(first.truncated());
        assert_eq!(second.scanned_entries(), 0);
        assert!(!second.truncated());
    }
}

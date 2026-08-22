//! Journal subsystem aggregator.
//!
//! Responsibility: re-export the journal-owning submodules to `document_store`. Owns no state,
//! file IO, or policy itself.

mod append;
mod entry;
mod recovery;
mod replay;

pub(super) use append::append_journal;
pub(super) use recovery::{recover_from_journal_replay, recover_from_snapshot_notes};
pub(super) use replay::{apply_transactions, replay_journal};

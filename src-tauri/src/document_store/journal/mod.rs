//! Journal subsystem aggregator.
//!
//! Responsibility: re-export the journal-owning submodules to `document_store`. Owns no state,
//! file IO, or policy itself.

mod append;
mod entry;

pub(super) use append::append_journal;

//! Snapshot subsystem aggregator.
//!
//! Responsibility: re-export the snapshot-owning submodules to `document_store`. Owns no state,
//! file IO, or policy itself.

mod integrity;
mod loader;
mod metadata;
mod slots;
mod writer;

pub(super) use integrity::fnv1a64;
pub(super) use loader::load_active_snapshot;
pub(super) use writer::write_snapshot;

//! Snapshot subsystem aggregator.
//!
//! Responsibility: re-export the snapshot-owning submodules to `document_store`. Owns no state,
//! file IO, or policy itself.

mod integrity;
mod metadata;
mod slots;

pub(super) use integrity::{content_integrity_valid, fnv1a64};
pub(super) use metadata::{build_snapshot_meta, parse_snapshot_meta};
pub(super) use slots::{next_snapshot_slot, select_active_slot};

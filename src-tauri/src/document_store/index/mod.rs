//! Document index subsystem aggregator.
//!
//! Responsibility: re-export the index-owning submodules to `document_store`. Owns no state,
//! parsing, or policy itself.

mod builder;
mod headings;

#[cfg(test)]
pub(super) use builder::build_document_index;
pub(super) use builder::{ensure_document_index, DocumentIndex};

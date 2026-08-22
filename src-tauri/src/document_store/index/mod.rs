//! Document index subsystem aggregator.
//!
//! Responsibility: re-export the index-owning submodules to `document_store`. Owns no state,
//! parsing, or policy itself.

mod builder;
mod headings;
mod search;
mod utf16;

#[cfg(test)]
pub(super) use builder::build_document_index;
pub(super) use builder::{ensure_document_index, DocumentIndex};
pub(super) use search::search_document_content;

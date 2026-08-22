//! Chunk subsystem aggregator.
//!
//! Responsibility: re-export the chunk-owning submodules to `document_store`. Owns no state,
//! file IO, or policy itself.

mod reader;

pub(super) use reader::read_chunk;

//! Chunk subsystem aggregator.
//!
//! Responsibility: re-export the chunk-owning submodules to `document_store`. Owns no state,
//! file IO, or policy itself.

mod reader;
mod upload_session;

pub(super) use reader::read_chunk;
pub(super) use upload_session::{
    abort_snapshot_upload, append_snapshot_chunk, begin_snapshot_upload, take_snapshot_upload,
};

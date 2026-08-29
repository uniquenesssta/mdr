//! Document-store public directory boundary.
//!
//! R11-03 owns stable DTO, validation, and path-layout boundaries; R11-04 owns atomic file IO
//! primitives in `repository`; R11-05 owns snapshot A/B slot selection, R11-06 owns snapshot
//! hashing/metadata construction/parsing, and R11-07 owns snapshot write ordering and two-slot
//! loading, all in `snapshot`; R11-08 owns journal entry encoding/append and R11-09 owns journal
//! replay/recovery, both in `journal`; R11-10 owns document index construction and heading
//! detection and R11-11 owns UTF-16/byte mapping and search, both in `index`; R11-12 owns safe
//! UTF-8 boundary chunk reading and R11-13 owns the upload-session lifecycle, both in `chunks`;
//! R11-14 owns Tauri command wiring in `commands`; R11-15 owns the in-memory cache, per-document
//! serialization and use-case orchestration in `store`; R11-16 removes the former monolithic file
//! and makes this directory module the only public entry. This entry owns no runtime state. It may
//! expose the stable subsystem API and resolve the Tauri data root, but must not contain storage,
//! recovery, indexing, upload, or command implementations.

mod cache;
mod chunks;
pub(crate) mod commands;
mod index;
mod journal;
mod paths;
mod repository;
mod snapshot;
mod store;
mod types;
mod validation;

pub(in crate::document_store) use cache::StoredDocument;
pub(in crate::document_store) use chunks::{
    abort_snapshot_upload, append_snapshot_chunk, begin_snapshot_upload,
};
pub(crate) use store::DocumentStore;

use paths::document_directory;
use repository::ensure_dir;
use validation::safe_document_id;

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub(in crate::document_store) fn document_root(
    app: &AppHandle,
    document_id: &str,
) -> Result<PathBuf, String> {
    let safe = safe_document_id(document_id)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法获取应用数据目录：{err}"))?;
    let root = document_directory(&app_data_dir, &safe);
    ensure_dir(&root)?;
    Ok(root)
}

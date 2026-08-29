//! Read adapters: resolve the store root, dispatch a blocking use case and map join errors.
//! Cache, recovery, indexing and chunk policy belong to DocumentStore; no state is owned here.

use tauri::{AppHandle, State};

use crate::document_store::{
    document_root,
    types::{DocumentChunk, DocumentManifest, LoadedDocument},
    DocumentStore,
};

#[tauri::command]
pub async fn load_document_state(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    document_id: String,
) -> Result<Option<LoadedDocument>, String> {
    let root = document_root(&app, &document_id)?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.load(&root, document_id))
        .await
        .map_err(|err| format!("后台读取任务失败：{err}"))?
}

#[tauri::command]
pub async fn load_document_manifest(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    document_id: String,
) -> Result<Option<DocumentManifest>, String> {
    let root = document_root(&app, &document_id)?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.manifest(&root, document_id))
        .await
        .map_err(|err| format!("后台索引任务失败：{err}"))?
}

#[tauri::command]
pub async fn read_document_chunk(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    document_id: String,
    byte_offset: usize,
    max_bytes: usize,
) -> Result<Option<DocumentChunk>, String> {
    let root = document_root(&app, &document_id)?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.read_chunk(&root, document_id, byte_offset, max_bytes)
    })
    .await
    .map_err(|err| format!("后台分段读取任务失败：{err}"))?
}

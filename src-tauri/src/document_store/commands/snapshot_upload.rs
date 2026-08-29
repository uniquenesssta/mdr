//! Segmented snapshot upload Tauri commands (begin/append/commit/abort).
//!
//! Responsibility: receive parameters, dispatch the store's upload API and map join errors.
//! Commit validation, cache locking and session cleanup are not owned by this adapter.

use tauri::{AppHandle, State};

use crate::document_store::{
    abort_snapshot_upload, append_snapshot_chunk, begin_snapshot_upload, document_root,
    types::{SaveDocumentRequest, SaveDocumentResponse},
    DocumentStore,
};

#[tauri::command]
pub async fn begin_document_snapshot_upload(
    app: AppHandle,
    document_id: String,
    upload_id: String,
) -> Result<(), String> {
    let root = document_root(&app, &document_id)?;
    tauri::async_runtime::spawn_blocking(move || begin_snapshot_upload(&root, &upload_id))
        .await
        .map_err(|err| format!("后台初始化分段快照失败：{err}"))?
}

#[tauri::command]
pub async fn append_document_snapshot_chunk(
    app: AppHandle,
    document_id: String,
    upload_id: String,
    chunk: String,
) -> Result<(), String> {
    let root = document_root(&app, &document_id)?;
    tauri::async_runtime::spawn_blocking(move || append_snapshot_chunk(&root, &upload_id, &chunk))
        .await
        .map_err(|err| format!("后台写入分段快照失败：{err}"))?
}

#[tauri::command]
pub async fn commit_document_snapshot_upload(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    request: SaveDocumentRequest,
    upload_id: String,
) -> Result<SaveDocumentResponse, String> {
    let root = document_root(&app, &request.document_id)?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.commit_upload(&root, request, &upload_id))
        .await
        .map_err(|err| format!("后台提交分段快照失败：{err}"))?
}

#[tauri::command]
pub async fn abort_document_snapshot_upload(
    app: AppHandle,
    document_id: String,
    upload_id: String,
) -> Result<(), String> {
    let root = document_root(&app, &document_id)?;
    tauri::async_runtime::spawn_blocking(move || abort_snapshot_upload(&root, &upload_id))
        .await
        .map_err(|err| format!("后台清理分段快照失败：{err}"))?
}

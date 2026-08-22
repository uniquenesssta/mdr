//! Segmented snapshot upload Tauri commands (begin/append/commit/abort).
//!
//! Responsibility: destructure Tauri-injected parameters, run the upload-session lifecycle and
//! (for commit) the store's save orchestration on a blocking task, and map join errors. No
//! upload-session or save policy itself — those stay with `chunks` and `save_document_inner`.

use tauri::{AppHandle, State};

use crate::document_store::{
    chunks::{
        abort_snapshot_upload, append_snapshot_chunk, begin_snapshot_upload, take_snapshot_upload,
    },
    document_root, save_document_inner,
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
    mut request: SaveDocumentRequest,
    upload_id: String,
) -> Result<SaveDocumentResponse, String> {
    let root = document_root(&app, &request.document_id)?;
    let inner = store.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if request.full_content.is_some() {
            return Err("分段快照提交不能同时包含完整正文".into());
        }
        let content = take_snapshot_upload(&root, &upload_id)?;
        request.full_content = Some(content);
        let mut cache = inner.lock().map_err(|_| "文档存储锁已损坏".to_string())?;
        save_document_inner(&root, &mut cache, request)
    })
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

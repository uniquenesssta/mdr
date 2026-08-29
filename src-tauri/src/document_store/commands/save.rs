//! `save_document_state` Tauri command.
//!
//! Responsibility: destructure the Tauri-injected request and state, run the store's save
//! orchestration on a blocking task, and map the join error. No cache, lock, or save policy.

use tauri::{AppHandle, State};

use crate::document_store::{
    document_root,
    types::{SaveDocumentRequest, SaveDocumentResponse},
    DocumentStore,
};

#[tauri::command]
pub async fn save_document_state(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    request: SaveDocumentRequest,
) -> Result<SaveDocumentResponse, String> {
    let root = document_root(&app, &request.document_id)?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.save(&root, request))
        .await
        .map_err(|err| format!("后台保存任务失败：{err}"))?
}

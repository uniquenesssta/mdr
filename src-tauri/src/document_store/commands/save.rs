//! `save_document_state` Tauri command.
//!
//! Responsibility: destructure the Tauri-injected request and state, run the store's save
//! orchestration on a blocking task, and map the join error. No save policy itself — that stays
//! with `save_document_inner` in the store orchestration.

use tauri::{AppHandle, State};

use crate::document_store::{
    document_root, save_document_inner,
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
    let inner = store.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cache = inner.lock().map_err(|_| "文档存储锁已损坏".to_string())?;
        save_document_inner(&root, &mut cache, request)
    })
    .await
    .map_err(|err| format!("后台保存任务失败：{err}"))?
}

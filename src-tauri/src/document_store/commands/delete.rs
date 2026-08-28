//! `delete_document_state` Tauri command.
//!
//! Responsibility: receive parameters, dispatch store deletion and map its join error.
//! Cache eviction and filesystem deletion belong exclusively to DocumentStore.

use tauri::{AppHandle, State};

use crate::document_store::{document_root, DocumentStore};

#[tauri::command]
pub async fn delete_document_state(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    document_id: String,
) -> Result<(), String> {
    let root = document_root(&app, &document_id)?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.delete(&root, &document_id))
        .await
        .map_err(|err| format!("后台删除任务失败：{err}"))?
}

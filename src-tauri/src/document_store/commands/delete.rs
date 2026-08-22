//! `delete_document_state` Tauri command.
//!
//! Responsibility: destructure the Tauri-injected parameters, drop the cached document and
//! remove its on-disk directory on a blocking task, and map the join error. No cache or
//! filesystem-layout policy itself.

use std::fs;

use tauri::{AppHandle, State};

use crate::document_store::{document_root, validation::safe_document_id, DocumentStore};

#[tauri::command]
pub async fn delete_document_state(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    document_id: String,
) -> Result<(), String> {
    let root = document_root(&app, &document_id)?;
    let key = safe_document_id(&document_id)?;
    let inner = store.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cache = inner.lock().map_err(|_| "文档存储锁已损坏".to_string())?;
        cache.remove(&key);
        if root.exists() {
            fs::remove_dir_all(root).map_err(|err| format!("无法删除文档快照：{err}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|err| format!("后台删除任务失败：{err}"))?
}

//! `search_document_state` Tauri command.
//!
//! Responsibility: destructure the Tauri-injected request, load/cache the document and run the
//! query search on a blocking task, and map the join error. No search or indexing policy itself
//! — those stay with the store orchestration and `index`.

use tauri::{AppHandle, State};

use crate::document_store::{
    document_root,
    index::{ensure_document_index, search_document_content},
    load_document_from_disk,
    types::{SearchDocumentRequest, SearchDocumentResponse},
    validation::safe_document_id,
    DocumentStore,
};

#[tauri::command]
pub async fn search_document_state(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    request: SearchDocumentRequest,
) -> Result<Option<SearchDocumentResponse>, String> {
    if request.query.is_empty() {
        return Ok(None);
    }
    let root = document_root(&app, &request.document_id)?;
    let key = safe_document_id(&request.document_id)?;
    let inner = store.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cache = inner.lock().map_err(|_| "文档存储锁已损坏".to_string())?;
        if !cache.contains_key(&key) {
            if let Some(document) = load_document_from_disk(&root)? {
                cache.insert(key.clone(), document);
            }
        }
        let Some(document) = cache.get_mut(&key) else {
            return Ok(None);
        };
        let index = ensure_document_index(document).clone();
        let Some(found) = search_document_content(
            &document.content,
            &index,
            &request.query,
            request.from,
            request.wrap,
        )?
        else {
            return Ok(None);
        };
        Ok(Some(SearchDocumentResponse {
            from: found.from,
            to: found.to,
            wrapped: found.wrapped,
            version: document.version,
        }))
    })
    .await
    .map_err(|err| format!("后台搜索任务失败：{err}"))?
}

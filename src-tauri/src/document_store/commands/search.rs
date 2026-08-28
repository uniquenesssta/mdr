//! Search adapter: use store preflight, dispatch the search and map its join error.
//! Empty-query policy, cache, index and UTF-16 search semantics belong to DocumentStore.

use tauri::{AppHandle, State};

use crate::document_store::{
    document_root,
    types::{SearchDocumentRequest, SearchDocumentResponse},
    DocumentStore,
};

#[tauri::command]
pub async fn search_document_state(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    request: SearchDocumentRequest,
) -> Result<Option<SearchDocumentResponse>, String> {
    let Some(root) = DocumentStore::prepare_search(&request, |id| document_root(&app, id))? else {
        return Ok(None);
    };
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.search(&root, request))
        .await
        .map_err(|err| format!("后台搜索任务失败：{err}"))?
}

//! Document read Tauri commands (`load_document_state`, `load_document_manifest`,
//! `read_document_chunk`).
//!
//! Responsibility: destructure Tauri-injected parameters, load/cache the document and run the
//! index/chunk lookups on a blocking task, and map join errors. No load, indexing, or chunking
//! policy itself — those stay with the store orchestration, `index`, and `chunks`.

use tauri::{AppHandle, State};

use crate::document_store::{
    chunks::read_chunk,
    document_root,
    index::ensure_document_index,
    load_document_from_disk,
    types::{DocumentChunk, DocumentManifest, LoadedDocument},
    validation::safe_document_id,
    DocumentStore,
};

#[tauri::command]
pub async fn load_document_state(
    app: AppHandle,
    store: State<'_, DocumentStore>,
    document_id: String,
) -> Result<Option<LoadedDocument>, String> {
    let root = document_root(&app, &document_id)?;
    let key = safe_document_id(&document_id)?;
    let inner = store.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cache = inner.lock().map_err(|_| "文档存储锁已损坏".to_string())?;
        if !cache.contains_key(&key) {
            if let Some(document) = load_document_from_disk(&root)? {
                cache.insert(key.clone(), document);
            }
        }
        Ok(cache.get_mut(&key).map(|document| {
            let recovered = document.recovered;
            let recovery_message = document.recovery_message.take();
            document.recovered = false;
            LoadedDocument {
                document_id,
                title: document.title.clone(),
                content: document.content.clone(),
                version: document.version,
                updated_at: document.updated_at,
                recovered,
                recovery_message,
            }
        }))
    })
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
    let key = safe_document_id(&document_id)?;
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
        let recovered = document.recovered;
        let recovery_message = document.recovery_message.take();
        document.recovered = false;
        let index = ensure_document_index(document).clone();
        Ok(Some(DocumentManifest {
            document_id,
            title: document.title.clone(),
            version: document.version,
            updated_at: document.updated_at,
            content_bytes: document.content.len(),
            text_length: index.utf16_length,
            line_count: index.line_count,
            non_whitespace_count: index.non_whitespace_count,
            headings: index.headings,
            recovered,
            recovery_message,
        }))
    })
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
    let key = safe_document_id(&document_id)?;
    let inner = store.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cache = inner.lock().map_err(|_| "文档存储锁已损坏".to_string())?;
        if !cache.contains_key(&key) {
            if let Some(document) = load_document_from_disk(&root)? {
                cache.insert(key.clone(), document);
            }
        }
        let Some(document) = cache.get(&key) else {
            return Ok(None);
        };
        let chunk = read_chunk(&document.content, byte_offset, max_bytes)?;
        Ok(Some(DocumentChunk {
            document_id,
            byte_offset,
            next_byte_offset: chunk.next_byte_offset,
            total_bytes: chunk.total_bytes,
            content: chunk.content,
            done: chunk.done,
        }))
    })
    .await
    .map_err(|err| format!("后台分段读取任务失败：{err}"))?
}

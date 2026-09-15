//! Tauri transport boundary for the six stable local-file commands.
//!
//! Owns argument adaptation, blocking-task dispatch, task-error mapping and command telemetry.
//! File inspection and read/write orchestration belong to Operations; policy, content I/O and
//! tree state belong to their specialists. No shared state or detached tasks are retained.

use super::{
    binary_writer::decode_binary, directory_tree::build_text_file_tree, file_kind::extension, operations,
    path_policy::input_path, tree_limits::TreeLimits, DroppedFile, LocalImageData, LocalWriteResult, TextFileTree,
};
use serde_json::json;
use std::{env, path::Path};

#[tauri::command]
pub async fn list_text_file_tree(document_path: String) -> Result<TextFileTree, String> {
    let extension = extension(Path::new(&document_path));
    tauri::async_runtime::spawn_blocking(move || {
        crate::performance_log::measure_sync(
            "native.command",
            "list_text_file_tree",
            json!({ "extension": extension }),
            || build_text_file_tree(&document_path, TreeLimits::default()),
        )
    })
    .await
    .map_err(|err| format!("文件树读取任务失败：{err}"))?
}

#[tauri::command]
pub fn read_dropped_file(path: String) -> Result<DroppedFile, String> {
    let extension = input_path(&path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    crate::performance_log::measure_sync(
        "native.command",
        "read_dropped_file",
        json!({ "extension": extension }),
        || operations::read_dropped_file(path),
    )
}

#[tauri::command]
pub async fn read_local_image(source: String, document_path: Option<String>) -> Result<LocalImageData, String> {
    let source_length = source.len();
    tauri::async_runtime::spawn_blocking(move || {
        crate::performance_log::measure_sync(
            "native.command",
            "read_local_image",
            json!({ "sourceLength": source_length, "hasDocumentPath": document_path.is_some() }),
            || operations::read_local_image(source, document_path),
        )
    })
    .await
    .map_err(|err| format!("图片读取任务失败：{err}"))?
}

#[tauri::command]
pub async fn write_local_text_file(path: String, content: String) -> Result<LocalWriteResult, String> {
    let extension = extension(Path::new(&path));
    let bytes = content.len();
    tauri::async_runtime::spawn_blocking(move || {
        crate::performance_log::measure_sync(
            "native.command",
            "write_local_text_file",
            json!({ "extension": extension, "bytes": bytes }),
            || operations::write_local_text_file(path, content),
        )
    })
    .await
    .map_err(|err| format!("写入任务失败：{err}"))?
}

#[tauri::command]
pub async fn write_local_binary_file(path: String, content_base64: String) -> Result<LocalWriteResult, String> {
    let extension = extension(Path::new(&path));
    tauri::async_runtime::spawn_blocking(move || {
        let content = decode_binary(&content_base64)?;
        let bytes = content.len();
        crate::performance_log::measure_sync(
            "native.command",
            "write_local_binary_file",
            json!({ "extension": extension, "bytes": bytes }),
            || operations::write_local_binary_file(path, content),
        )
    })
    .await
    .map_err(|err| format!("写入任务失败：{err}"))?
}

#[tauri::command]
pub fn initial_file_path() -> Option<String> {
    operations::select_initial_file_path(env::args_os().skip(1))
}

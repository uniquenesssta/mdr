//! Local-file use-case orchestration, independent of Tauri transport.
//!
//! Combines path policy, metadata inspection and File Kind with the existing Readers/Writers
//! to construct stable results. Owns call-local values only, never a second policy or content
//! I/O implementation. Commands may call this boundary; specialists must not depend on it.

use super::{
    binary_writer::write_binary,
    file_kind::{classify, is_supported_text_path, FileKind},
    image_reader::{read_dropped_image, read_embedded_image, validate_embedded_image_size},
    path_policy::{input_path, required_path, resolve_local_image_path},
    text_reader::read_dropped_text,
    text_writer::write_text,
    DroppedFile, LocalImageData, LocalWriteResult,
};
use std::{ffi::OsString, fs, path::PathBuf};

pub(super) fn read_local_image(source: String, document_path: Option<String>) -> Result<LocalImageData, String> {
    let path = resolve_local_image_path(&source, document_path.as_deref())?;
    let metadata = fs::metadata(&path).map_err(|err| format!("无法读取图片文件：{err}"))?;
    if !metadata.is_file() {
        return Err("图片路径不是文件".into());
    }
    validate_embedded_image_size(metadata.len())?;
    let mime = match classify(&path) {
        FileKind::Image { mime } => mime,
        FileKind::Text | FileKind::Unsupported => return Err("不支持该本地图片格式".into()),
    };
    let image = read_embedded_image(&path, mime)?;
    Ok(LocalImageData {
        path: path.to_string_lossy().into_owned(),
        data_url: image.data_url,
        bytes: image.bytes,
    })
}

pub(super) fn write_local_text_file(path: String, content: String) -> Result<LocalWriteResult, String> {
    let path_buf = required_path(&path, "保存路径不能为空")?;
    let bytes = write_text(&path_buf, &content)?;
    Ok(LocalWriteResult {
        path: path_buf.to_string_lossy().into_owned(),
        bytes,
    })
}

pub(super) fn write_local_binary_file(path: String, content: Vec<u8>) -> Result<LocalWriteResult, String> {
    let path_buf = required_path(&path, "保存路径不能为空")?;
    let bytes = write_binary(&path_buf, &content)?;
    Ok(LocalWriteResult {
        path: path_buf.to_string_lossy().into_owned(),
        bytes,
    })
}

pub(super) fn read_dropped_file(path: String) -> Result<DroppedFile, String> {
    let path_buf = input_path(&path);
    let metadata = fs::metadata(&path_buf).map_err(|err| format!("无法读取文件信息：{err}"))?;
    if !metadata.is_file() {
        return Err("只支持拖入文件，不支持拖入文件夹".into());
    }

    let name = path_buf
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("未命名文件")
        .to_string();
    match classify(&path_buf) {
        FileKind::Text => {
            let content = read_dropped_text(&path_buf, metadata.len())?;
            Ok(DroppedFile {
                name,
                path,
                kind: "text".into(),
                content: Some(content),
                data_url: None,
            })
        }
        FileKind::Image { mime } => {
            let image = read_dropped_image(&path_buf, mime, metadata.len())?;
            Ok(DroppedFile {
                name,
                path,
                kind: "image".into(),
                content: None,
                data_url: Some(image.data_url),
            })
        }
        FileKind::Unsupported => Err("不支持该文件类型，请拖入 Markdown、文本或图片文件".into()),
    }
}

/// Select from arguments after the executable name without mutating process-global state.
pub(super) fn select_initial_file_path(arguments: impl IntoIterator<Item = OsString>) -> Option<String> {
    arguments
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.is_file() && is_supported_text_path(path))
        .map(|path| path.to_string_lossy().into_owned())
}

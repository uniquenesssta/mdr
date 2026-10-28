//! Durable launch envelopes contain paths only, never document contents. Ack removes one exact owned envelope.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Serialize, Deserialize)]
pub struct OpenRequest {
    pub id: String,
    pub paths: Vec<String>,
}

pub fn enqueue(
    root: &Path,
    args: impl Iterator<Item = std::ffi::OsString>,
    cwd: &Path,
) -> Result<String, String> {
    let mut paths = Vec::new();
    for arg in args {
        let text = arg.to_str().ok_or("打开路径不是有效的 Unicode")?;
        if text.starts_with('-') && !cwd.join(text).is_file() {
            continue;
        }
        if paths.len() >= 128 {
            return Err("一次最多打开128个文件，请分批打开".into());
        }
        let path = PathBuf::from(text);
        paths.push(
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
            .to_string_lossy()
            .into_owned(),
        );
    }
    let id = format!(
        "{:020}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos(),
        std::process::id()
    );
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let data = serde_json::to_vec(&OpenRequest {
        id: id.clone(),
        paths,
    })
    .map_err(|e| e.to_string())?;
    if data.len() > 1024 * 1024 {
        return Err("打开请求过大".into());
    }
    let partial = root.join(format!("{id}.partial"));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial)
        .map_err(|e| e.to_string())?;
    file.write_all(&data)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    fs::rename(partial, root.join(format!("{id}.json"))).map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn read_requests(root: &Path) -> Result<Vec<OpenRequest>, String> {
    let mut entries = fs::read_dir(root)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    entries.sort_by_key(|entry| entry.file_name());
    let mut requests = Vec::new();
    for entry in entries {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if entry.metadata().map_err(|e| e.to_string())?.len() > 1024 * 1024 {
            return Err("待打开请求过大".into());
        }
        let request: OpenRequest =
            serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("待打开请求损坏：{e}"))?;
        if path.file_stem().and_then(|s| s.to_str()) != Some(&request.id)
            || request.paths.len() > 128
        {
            return Err("待打开请求标识无效".into());
        }
        requests.push(request);
    }
    Ok(requests)
}

pub fn acknowledge(root: &Path, request: &OpenRequest) -> Result<(), String> {
    // Request IDs originate from a validated inbox entry, never directly from an IPC path argument.
    fs::remove_file(root.join(format!("{}.json", request.id))).map_err(|e| e.to_string())
}

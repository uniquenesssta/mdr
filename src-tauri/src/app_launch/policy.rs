//! Backend-owned launch policy, independent from renderer localStorage.
use std::{fs, path::Path};

pub fn read(root: &Path) -> Result<bool, String> {
    match fs::read(root.join("single-instance.json")) {
        Ok(bytes) => {
            serde_json::from_slice::<bool>(&bytes).map_err(|e| format!("多开设置读取失败：{e}"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(e) => Err(format!("多开设置读取失败：{e}")),
    }
}

pub fn write(root: &Path, enabled: bool) -> Result<(), String> {
    // A single coordinator serializes writes; sync before confirming the setting to the renderer.
    use std::io::Write;
    let pending = root.join("single-instance.pending");
    let target = root.join("single-instance.json");
    let mut file = fs::File::create(&pending).map_err(|e| format!("多开设置保存失败：{e}"))?;
    file.write_all(if enabled { b"true" } else { b"false" })
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("多开设置保存失败：{e}"))?;
    drop(file);
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let from: Vec<u16> = pending.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(format!(
                "多开设置保存失败：{}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    fs::rename(pending, target).map_err(|e| format!("多开设置保存失败：{e}"))
}

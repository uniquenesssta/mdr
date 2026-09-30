//! Shared user-file commit authority for text, binary and future export callers.
//!
//! Stage bytes in an exclusively created sibling, sync and close it before replacing the target.
//! Never truncate/unlink the target first. Errors clean only our sibling; failed cleanup reports
//! its recovery path. This is not a guarantee of persistence through every power loss/filesystem.

use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

pub(super) fn write_bytes(path: &Path, content: &[u8]) -> io::Result<()> {
    #[cfg(test)]
    {
        commit(path, content, None)
    }
    #[cfg(not(test))]
    {
        commit(path, content)
    }
}

fn destination(path: &Path) -> io::Result<PathBuf> {
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::other("保存路径必须包含文件名"))?;
    #[cfg(windows)]
    validate_windows_name(name)?;
    match fs::symlink_metadata(path) {
        Ok(_) => {
            let resolved = fs::canonicalize(path)?;
            check_target(&resolved)?;
            Ok(resolved)
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            let parent = path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or(Path::new("."));
            Ok(fs::canonicalize(parent)?.join(name))
        }
        Err(err) => Err(err),
    }
}

fn check_target(path: &Path) -> io::Result<()> {
    match fs::metadata(path) {
        Ok(metadata) => {
            if !metadata.is_file() {
                return Err(io::Error::other("保存目标不是普通文件"));
            }
            if metadata.permissions().readonly() {
                return Err(io::Error::new(io::ErrorKind::PermissionDenied, "保存目标为只读文件"));
            }
            // A rename permitted by the parent must not bypass the target's write ACL/share mode.
            drop(OpenOptions::new().write(true).open(path)?);
            Ok(())
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

#[cfg(windows)]
fn validate_windows_name(name: &std::ffi::OsStr) -> io::Result<()> {
    let name = name.to_string_lossy();
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end_matches(' ')
        .to_ascii_uppercase();
    let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(*prefix).is_some_and(|number| {
                matches!(
                    number,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
    if device
        || name.ends_with('.')
        || name.ends_with(' ')
        || name.chars().any(|ch| ch < ' ' || "<>:\"/\\|?*".contains(ch))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "保存路径包含 Windows 设备名、流名或无效文件名",
        ));
    }
    Ok(())
}

struct PendingFile {
    path: Option<PathBuf>,
    file: Option<File>,
}

impl PendingFile {
    fn create(target: &Path) -> io::Result<Self> {
        let parent = target.parent().ok_or_else(|| io::Error::other("保存目标缺少父目录"))?;
        for _ in 0..64 {
            let nonce = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
            let path = parent.join(format!(".mdr-save-{}-{nonce:016x}.tmp", std::process::id()));
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                options.share_mode(0);
            }
            match options.open(&path) {
                Ok(file) => {
                    return Ok(Self {
                        path: Some(path),
                        file: Some(file),
                    })
                }
                Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(err) => return Err(err),
            }
        }
        Err(io::Error::new(io::ErrorKind::AlreadyExists, "无法独占创建保存临时文件"))
    }

    fn cleanup(&mut self, result: io::Result<()>) -> io::Result<()> {
        drop(self.file.take());
        if let Some(path) = self.path.take() {
            if let Err(cleanup) = fs::remove_file(&path) {
                let cause = result.err().unwrap_or_else(|| io::Error::other("保存未提交"));
                return Err(io::Error::new(
                    cause.kind(),
                    format!("{cause}；临时文件清理失败：{cleanup}；可恢复文件：{}", path.display()),
                ));
            }
        }
        result
    }
}

impl Drop for PendingFile {
    fn drop(&mut self) {
        drop(self.file.take());
        if let Some(path) = self.path.take() {
            // Unwinding has no error return channel. Normal failures use cleanup() above.
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(test)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Created,
    PartialWrite,
    BeforeSync,
    BeforeReplace,
}

#[cfg(test)]
type FaultHook<'a> = Option<&'a mut dyn FnMut(Phase, &Path) -> io::Result<()>>;

fn commit(path: &Path, content: &[u8], #[cfg(test)] mut hook: FaultHook<'_>) -> io::Result<()> {
    let target = destination(path)?;
    let mut pending = PendingFile::create(&target)?;
    let result = (|| {
        let temporary = pending
            .path
            .as_deref()
            .ok_or_else(|| io::Error::other("保存临时文件丢失"))?;
        #[cfg(windows)]
        windows::copy_target_dacl(&target, temporary)?;
        let file = pending.file.as_mut().ok_or_else(|| io::Error::other("保存句柄丢失"))?;
        #[cfg(test)]
        if let Some(hook) = hook.as_mut() {
            hook(Phase::Created, temporary)?;
            let partial = content.len() / 2;
            file.write_all(&content[..partial])?;
            hook(Phase::PartialWrite, temporary)?;
            file.write_all(&content[partial..])?;
        } else {
            file.write_all(content)?;
        }
        #[cfg(not(test))]
        file.write_all(content)?;
        #[cfg(test)]
        if let Some(hook) = hook.as_mut() {
            hook(Phase::BeforeSync, temporary)?;
        }
        file.sync_all()?;
        drop(pending.file.take());
        #[cfg(test)]
        if let Some(hook) = hook.as_mut() {
            hook(Phase::BeforeReplace, temporary)?;
        }
        check_target(&target)?;
        #[cfg(windows)]
        windows::copy_target_dacl(&target, temporary)?;
        replace(temporary, &target)?;
        pending.path = None;
        Ok(())
    })();
    pending.cleanup(result)
}

#[cfg(not(windows))]
fn replace(temporary: &Path, target: &Path) -> io::Result<()> {
    fs::rename(temporary, target)
}

#[cfg(windows)]
fn replace(temporary: &Path, target: &Path) -> io::Result<()> {
    windows::replace(temporary, target)
}

#[cfg(windows)]
mod windows {
    use std::{ffi::c_void, io, os::windows::ffi::OsStrExt, path::Path};

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    const DACL_SECURITY_INFORMATION: u32 = 0x4;
    const PROTECTED_DACL_SECURITY_INFORMATION: u32 = 0x8000_0000;
    const UNPROTECTED_DACL_SECURITY_INFORMATION: u32 = 0x2000_0000;
    const SE_DACL_PROTECTED: u16 = 0x1000;
    const ERROR_INSUFFICIENT_BUFFER: i32 = 122;

    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn GetFileSecurityW(path: *const u16, info: u32, descriptor: *mut c_void, length: u32, needed: *mut u32)
            -> i32;
        fn GetSecurityDescriptorControl(descriptor: *const c_void, control: *mut u16, revision: *mut u32) -> i32;
        fn SetFileSecurityW(path: *const u16, info: u32, descriptor: *const c_void) -> i32;
    }

    fn wide(path: &Path) -> io::Result<Vec<u16>> {
        let mut value: Vec<u16> = path.as_os_str().encode_wide().collect();
        if value.contains(&0) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "保存路径包含 NUL"));
        }
        value.push(0);
        Ok(value)
    }

    pub(super) fn replace(temporary: &Path, target: &Path) -> io::Result<()> {
        let old = wide(temporary)?;
        let new = wide(target)?;
        // SAFETY: Both buffers are NUL-terminated and alive throughout this synchronous call.
        // Same-directory move, no copy/delete fallback and no readonly-ignoring retry.
        if unsafe {
            MoveFileExW(
                old.as_ptr(),
                new.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    pub(super) fn copy_target_dacl(target: &Path, temporary: &Path) -> io::Result<()> {
        let target = wide(target)?;
        let temporary = wide(temporary)?;
        let mut needed = 0;
        // SAFETY: Size query passes a null buffer and valid output pointer.
        let query = unsafe {
            GetFileSecurityW(
                target.as_ptr(),
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                0,
                &mut needed,
            )
        };
        if query == 0 {
            let err = io::Error::last_os_error();
            if err.kind() == io::ErrorKind::NotFound {
                return Ok(());
            }
            if err.raw_os_error() != Some(ERROR_INSUFFICIENT_BUFFER) {
                return Err(err);
            }
        }
        let mut descriptor = vec![0_u32; (needed as usize).div_ceil(4)];
        let mut control = 0;
        let mut revision = 0;
        // SAFETY: Aligned buffer is at least the queried byte size; all output pointers are valid.
        if unsafe {
            GetFileSecurityW(
                target.as_ptr(),
                DACL_SECURITY_INFORMATION,
                descriptor.as_mut_ptr().cast(),
                needed,
                &mut needed,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: The OS initialized the self-relative security descriptor above.
        if unsafe { GetSecurityDescriptorControl(descriptor.as_ptr().cast(), &mut control, &mut revision) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let protection = if control & SE_DACL_PROTECTED != 0 {
            PROTECTED_DACL_SECURITY_INFORMATION
        } else {
            UNPROTECTED_DACL_SECURITY_INFORMATION
        };
        // SAFETY: Both path buffer and valid descriptor stay alive for this call.
        if unsafe {
            SetFileSecurityW(
                temporary.as_ptr(),
                DACL_SECURITY_INFORMATION | protection,
                descriptor.as_ptr().cast(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

#[cfg(all(test, windows))]
#[path = "../../tests/local_file/atomic_writer.rs"]
mod tests;

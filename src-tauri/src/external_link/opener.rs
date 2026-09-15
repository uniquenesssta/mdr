//! Operating-system external-link launch boundary.
//!
//! Accepts only values admitted by the command's private validation policy; does not parse,
//! trim or validate URLs again. Owns ShellExecuteW / open / xdg-open and their launch errors.
//! No shared state, listeners or stored handles. Unix success means spawn succeeded, not that
//! the external application exited successfully; the existing detached-launch behavior is kept.
//! Allowed: std and the native shell32 API. No Tauri, frontend, filesystem or network policy.

#[cfg(target_os = "windows")]
pub(super) fn open_platform_url(url: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{null, null_mut};

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut core::ffi::c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show_command: i32,
        ) -> isize;
    }

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(once(0)).collect()
    }

    let operation = wide("open");
    let target = wide(url);
    let result = unsafe { ShellExecuteW(null_mut(), operation.as_ptr(), target.as_ptr(), null(), null(), 1) };

    if result <= 32 {
        return Err(format!("系统无法打开链接（错误码 {result}）"));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub(super) fn open_platform_url(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("系统无法打开链接：{error}"))
}

#[cfg(all(unix, not(target_os = "macos")))]
pub(super) fn open_platform_url(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("系统无法打开链接：{error}"))
}

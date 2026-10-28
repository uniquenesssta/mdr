//! Lifetime-owned Windows coordinator lock. Pending file requests are persisted before acquisition.
#[cfg(windows)]
pub struct InstanceGuard(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl InstanceGuard {
    pub fn acquire(identifier: &str) -> Result<Option<Self>, String> {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS},
            System::Threading::CreateMutexW,
        };
        let name: Vec<u16> = format!("Local\\{identifier}-launch-coordinator\0")
            .encode_utf16()
            .collect();
        // Named kernel objects are scoped to the current interactive Windows session.
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            unsafe {
                CloseHandle(handle);
            }
            return Ok(None);
        }
        Ok(Some(Self(handle)))
    }
}

#[cfg(windows)]
impl Drop for InstanceGuard {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

use url::Url;

fn validate_external_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("链接地址为空".to_string());
    }

    let parsed = Url::parse(trimmed).map_err(|_| "链接格式无效".to_string())?;
    match parsed.scheme() {
        "http" | "https" | "mailto" | "tel" => Ok(trimmed.to_string()),
        _ => Err("不支持打开此链接".to_string()),
    }
}

#[cfg(target_os = "windows")]
fn open_platform_url(url: &str) -> Result<(), String> {
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
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            null(),
            null(),
            1,
        )
    };

    if result <= 32 {
        return Err(format!("系统无法打开链接（错误码 {result}）"));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_platform_url(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("系统无法打开链接：{error}"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_platform_url(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("系统无法打开链接：{error}"))
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let validated = validate_external_url(&url)?;
    open_platform_url(&validated)
}

#[cfg(test)]
mod tests {
    use super::validate_external_url;

    #[test]
    fn accepts_supported_schemes() {
        assert!(validate_external_url("https://example.com").is_ok());
        assert!(validate_external_url("http://example.com").is_ok());
        assert!(validate_external_url("mailto:test@example.com").is_ok());
        assert!(validate_external_url("tel:+8613800000000").is_ok());
    }

    #[test]
    fn rejects_unsupported_schemes() {
        assert!(validate_external_url("file:///C:/secret.txt").is_err());
        assert!(validate_external_url("javascript:alert(1)").is_err());
    }
}

// R12-01 rustfmt boundary: only the new pre-rewrite behavior tests below.
#[cfg(test)]
mod stage_12_tests {
    use super::validate_external_url;

    #[test]
    fn stage_12_preserves_trimmed_values_and_the_exact_allowlist() {
        assert_eq!(
            validate_external_url("  HTTPS://example.com/path  "),
            Ok("HTTPS://example.com/path".to_string())
        );
        assert_eq!(
            validate_external_url(" MAILTO:test@example.com "),
            Ok("MAILTO:test@example.com".to_string())
        );
        assert_eq!(
            validate_external_url(" tel:+8613800000000 "),
            Ok("tel:+8613800000000".to_string())
        );
    }

    #[test]
    fn stage_12_preserves_validation_errors_before_platform_open() {
        assert_eq!(validate_external_url(""), Err("链接地址为空".to_string()));
        assert_eq!(validate_external_url("not a url"), Err("链接格式无效".to_string()));
        assert_eq!(
            validate_external_url("file:///tmp/private.txt"),
            Err("不支持打开此链接".to_string())
        );
        assert_eq!(
            validate_external_url("javascript:alert(1)"),
            Err("不支持打开此链接".to_string())
        );
    }
}

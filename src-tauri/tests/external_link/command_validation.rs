//! Invoke the real backend command without a frontend validator or an OS-opener mock.
use super::open_external_url;

#[test]
fn backend_command_rejects_dangerous_protocols_before_platform_open() {
    for value in [
        "file:///tmp/private.txt",
        "javascript:alert(1)",
        "data:text/html,test",
        "ftp://example.com",
    ] {
        assert_eq!(
            open_external_url(value.into()),
            Err("不支持打开此链接".into()),
            "{value}"
        );
    }
}

#[test]
fn backend_command_preserves_empty_and_malformed_errors() {
    for value in ["", " \t\n "] {
        assert_eq!(open_external_url(value.into()), Err("链接地址为空".into()));
    }
    for value in [
        "not a url",
        "//example.com",
        "https://[::1",
        "https://example.com:invalid",
    ] {
        assert_eq!(open_external_url(value.into()), Err("链接格式无效".into()), "{value}");
    }
}

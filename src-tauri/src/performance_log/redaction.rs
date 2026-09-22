//! Recursive performance-log redaction before JSONL persistence.
//!
//! Owns removal of document/body payloads and authentication-like secrets, plus path minimization.
//! Pure and stateless: no filesystem, environment, Tauri, logging, or command behavior lives here.

use serde_json::{Map, Value};

fn normalize_key(key: &str) -> String {
    key.chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

fn is_body_field(key: &str) -> bool {
    let key = normalize_key(key);
    ["body", "content", "html", "markdown", "text"]
        .iter()
        .any(|suffix| key == *suffix || key.ends_with(suffix))
}

fn is_sensitive_field(key: &str) -> bool {
    let key = normalize_key(key);
    [
        "password",
        "passwd",
        "passphrase",
        "secret",
        "token",
        "authorization",
        "cookie",
        "apikey",
        "credential",
        "credentials",
        "privatekey",
    ]
    .iter()
    .any(|suffix| key == *suffix || key.ends_with(suffix))
}

fn is_path_field(key: &str) -> bool {
    let key = normalize_key(key);
    matches!(
        key.as_str(),
        "path"
            | "paths"
            | "file"
            | "files"
            | "filename"
            | "directory"
            | "directorypath"
            | "dir"
            | "cwd"
            | "workingdirectory"
    ) || key.ends_with("path")
        || key.ends_with("paths")
}

fn terminal_path_component(value: &str) -> String {
    let trimmed = value.trim_end_matches(|character| character == '/' || character == '\\');
    if trimmed.is_empty() {
        return "[path]".to_string();
    }
    trimmed
        .rsplit(|character| character == '/' || character == '\\')
        .next()
        .filter(|component| !component.is_empty())
        .unwrap_or("[path]")
        .to_string()
}

fn redact_path_value(value: &Value) -> Value {
    match value {
        Value::String(path) => Value::String(terminal_path_component(path)),
        Value::Array(values) => Value::Array(values.iter().map(redact_path_value).collect()),
        Value::Object(_) => redact_value(value),
        _ => value.clone(),
    }
}

pub(super) fn redact_value(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut redacted = Map::new();
            for (key, nested) in object {
                if is_body_field(key) || is_sensitive_field(key) {
                    continue;
                }
                let value = if is_path_field(key) {
                    redact_path_value(nested)
                } else {
                    redact_value(nested)
                };
                redacted.insert(key.clone(), value);
            }
            Value::Object(redacted)
        }
        Value::Array(values) => Value::Array(values.iter().map(redact_value).collect()),
        _ => value.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::redact_value;
    use serde_json::json;

    #[test]
    fn removes_body_fields_at_every_object_depth() {
        let value = json!({
            "content": "document",
            "nested": {
                "responseBody": "body",
                "documentText": "text",
                "html": "<p>secret</p>",
                "markdown": "# secret"
            },
            "safe": "kept"
        });
        assert_eq!(redact_value(&value), json!({ "nested": {}, "safe": "kept" }));
    }

    #[test]
    fn removes_authentication_like_sensitive_fields_recursively() {
        let value = json!({
            "password": "p",
            "authToken": "t",
            "nested": {
                "authorization": "Bearer value",
                "apiKey": "k",
                "clientSecret": "s",
                "credentials": { "user": "u" }
            },
            "sessionId": "diagnostic-session"
        });
        assert_eq!(
            redact_value(&value),
            json!({ "nested": {}, "sessionId": "diagnostic-session" })
        );
    }

    #[test]
    fn reduces_path_fields_to_terminal_components() {
        let value = json!({
            "path": "/home/user/private/note.md",
            "documentPath": "C:\\Users\\User\\Documents\\draft.md",
            "file": "\\\\server\\share\\image.png",
            "directory": "/var/tmp/project/",
            "relative": "kept/value"
        });
        assert_eq!(
            redact_value(&value),
            json!({
                "path": "note.md",
                "documentPath": "draft.md",
                "file": "image.png",
                "directory": "project",
                "relative": "kept/value"
            })
        );
    }

    #[test]
    fn redacts_arrays_and_nested_path_lists() {
        let value = json!({
            "paths": ["/a/b.md", "C:\\c\\d.md"],
            "items": [
                { "text": "remove", "path": "/x/y.md", "count": 1 },
                { "token": "remove", "value": true }
            ]
        });
        assert_eq!(
            redact_value(&value),
            json!({
                "paths": ["b.md", "d.md"],
                "items": [
                    { "path": "y.md", "count": 1 },
                    { "value": true }
                ]
            })
        );
    }

    #[test]
    fn preserves_metric_fields_that_only_describe_payloads() {
        let value = json!({
            "contentType": "text/html",
            "contentLength": 1024,
            "textLength": 50,
            "bodyBytes": 2048,
            "sourceLength": 20,
            "hasDocumentPath": true
        });
        assert_eq!(redact_value(&value), value);
    }

    #[test]
    fn preserves_non_object_primitives_and_operational_fields() {
        let value = json!({
            "source": "frontend",
            "category": "runtime.performance",
            "operation": "runtime.snapshot",
            "durationMs": 3.5,
            "status": "ok",
            "details": [null, true, 7, "plain diagnostic"]
        });
        assert_eq!(redact_value(&value), value);
    }
}

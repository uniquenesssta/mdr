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
    let trimmed = value.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return "[path]".to_string();
    }
    trimmed
        .rsplit(['/', '\\'])
        .next()
        .filter(|component| !component.is_empty())
        .unwrap_or("[path]")
        .to_string()
}

const REDACTED: &str = "[redacted]";
const MAX_DEPTH: usize = 8;
const MAX_NODES: usize = 512;

// Only code-shaped envelope labels and a small set of diagnostic enums are strings
// with a defined logging contract. Arbitrary text cannot be made safe by key guessing.
fn allowed_string(key: &str, value: &str, envelope: bool) -> bool {
    if envelope {
        match key {
            "source" => return matches!(value, "frontend" | "rust"),
            "status" => return matches!(value, "ok" | "error" | "cancelled" | "skipped"),
            "category" => return matches!(value,
                "app.lifecycle"
                | "content.operation"
                | "document.error"
                | "document.model"
                | "document.operation"
                | "editor.hybrid"
                | "editor.input"
                | "export.operation"
                | "link.preview"
                | "native.command"
                | "native.roundtrip"
                | "render.pipeline"
                | "runtime.diagnostic"
                | "runtime.error"
                | "runtime.event-timing"
                | "runtime.performance"
                | "sidebar.file-tree"
                | "sync.selection"
                | "ui.interaction"
                | "ui.layout"
                | "ui.operation"
            ),
            "operation" => return matches!(value,
                "abort_document_snapshot_upload"
                | "app.exit"
                | "app.ready"
                | "app.start"
                | "append_document_snapshot_chunk"
                | "applySettings"
                | "applySplit"
                | "autoSave"
                | "begin_document_snapshot_upload"
                | "browser.event.change"
                | "browser.event.click"
                | "browser.event.contextmenu"
                | "browser.event.dblclick"
                | "browser.event.drop"
                | "browser.event.focusin"
                | "browser.event.focusout"
                | "browser.event.input"
                | "browser.event.keydown"
                | "browser.event.mousedown"
                | "browser.event.mouseup"
                | "browser.event.pointerdown"
                | "browser.event.pointerup"
                | "closeDocument"
                | "commit_document_snapshot_upload"
                | "confirmImageInsert"
                | "confirmMermaidInsert"
                | "convertAndInsert"
                | "delete_document_state"
                | "document.file-save-error"
                | "document.save-as-error"
                | "document.snapshot"
                | "downloadExportImage"
                | "duplicateDocument"
                | "editor.pointer-position-corrected"
                | "exportFile"
                | "exportHTML"
                | "exportPDF"
                | "exportWord"
                | "fetch_url"
                | "findNext"
                | "frontend.bootstrap"
                | "hybrid.block-dispatch-failure"
                | "hybrid.component-state-transition"
                | "hybrid.decoration-build-failure"
                | "hybrid.html-range-fallback"
                | "hybrid.invalid-block-range"
                | "hybrid.slow-decoration-build"
                | "hybrid.source-edit-close"
                | "hybrid.widget-build-failure"
                | "hybrid.widget-geometry"
                | "initial_file_path"
                | "insertHeading"
                | "insertTable"
                | "instrumentation.ready"
                | "interaction.change"
                | "interaction.click"
                | "interaction.contextmenu"
                | "interaction.dblclick"
                | "interaction.drop"
                | "interaction.focusin"
                | "interaction.focusout"
                | "interaction.input"
                | "interaction.input.frame"
                | "interaction.keydown"
                | "interaction.mousedown"
                | "interaction.mouseup"
                | "interaction.pointerdown"
                | "interaction.pointerup"
                | "interaction.scroll.burst"
                | "interaction.shortcut"
                | "layout.compact-shell-change"
                | "layout.system-fullscreen-error"
                | "layout.toolbar-boundary-change"
                | "layout.window-resize-settled"
                | "list_text_file_tree"
                | "loadFile"
                | "loadTextContentAsDocument"
                | "load_document_manifest"
                | "load_document_state"
                | "native.abort_document_snapshot_upload"
                | "native.append_document_snapshot_chunk"
                | "native.begin_document_snapshot_upload"
                | "native.commit_document_snapshot_upload"
                | "native.delete_document_state"
                | "native.fetch_url"
                | "native.initial_file_path"
                | "native.list_text_file_tree"
                | "native.load_document_manifest"
                | "native.load_document_state"
                | "native.open-directory-dialog"
                | "native.open-file-dialog"
                | "native.open_external_url"
                | "native.read_document_chunk"
                | "native.read_dropped_file"
                | "native.read_local_image"
                | "native.save-file-dialog"
                | "native.save_document_state"
                | "native.search_document_state"
                | "native.write_local_binary_file"
                | "native.write_local_text_file"
                | "native.write_performance_logs"
                | "newDocument"
                | "openDocument"
                | "open_external_url"
                | "prefixLines"
                | "preview.mermaid-render-failure"
                | "preview.mermaid-render-result"
                | "read_document_chunk"
                | "read_dropped_file"
                | "read_local_image"
                | "redo"
                | "renameDocument"
                | "render.preview-layout-refresh"
                | "renderMermaidBlocks"
                | "renderOutline"
                | "replaceAll"
                | "replaceOne"
                | "runtime.error"
                | "runtime.long-task"
                | "runtime.navigation"
                | "runtime.snapshot"
                | "runtime.unhandled-rejection"
                | "saveAsMarkdown"
                | "saveCurrentDocumentState"
                | "saveToLocal"
                | "save_document_state"
                | "search_document_state"
                | "selection.sync-anomaly"
                | "selection.sync-result"
                | "setAppTheme"
                | "setLanguage"
                | "setLayoutMode"
                | "setupDocuments"
                | "togglePane"
                | "toggleSidebar"
                | "undo"
                | "updatePreview"
                | "window.close-error"
                | "window.close-handler-error"
                | "wrapSelection"
                | "write_local_binary_file"
                | "write_local_text_file"
                | "write_performance_logs"
            ),
            "sessionId" => {
                return value.len() == 36
                    && value.bytes().enumerate().all(|(i, b)| {
                        if matches!(i, 8 | 13 | 18 | 23) { b == b'-' } else { b.is_ascii_hexdigit() }
                    });
            }
            _ => {}
        }
    }
    match key {
        "contentType" => matches!(value, "text/html" | "text/plain" | "text/markdown" | "application/json"),
        "side" | "sourceSide" | "targetSide" => matches!(value, "editor" | "preview" | ""),
        "mode" | "presentationMode" => matches!(value, "source" | "hybrid" | "preview"),
        _ => false,
    }
}

fn redact_path_value(value: &Value, depth: usize, remaining: &mut usize) -> Value {
    if depth > MAX_DEPTH || *remaining == 0 {
        return Value::String(REDACTED.into());
    }
    *remaining -= 1;
    match value {
        // A path may also carry a query, credential or serialized object. In that case
        // do not mistake its final slash-delimited fragment for a safe file name.
        Value::String(path) => {
            let name = terminal_path_component(path);
            if name.len() > 160
                || name.chars().any(|c| c.is_control() || "?&#=\"{}[]<>:".contains(c))
            {
                Value::String(REDACTED.into())
            } else {
                Value::String(name)
            }
        }
        Value::Array(values) => Value::Array(
            values.iter().take(20).map(|v| redact_path_value(v, depth + 1, remaining)).collect(),
        ),
        Value::Object(_) => redact_nested(value, "", depth + 1, remaining, false),
        _ => value.clone(),
    }
}

fn redact_nested(value: &Value, key: &str, depth: usize, remaining: &mut usize, envelope: bool) -> Value {
    if depth > MAX_DEPTH || *remaining == 0 {
        return Value::String(REDACTED.into());
    }
    *remaining -= 1;
    match value {
        Value::Object(object) => {
            let mut redacted = Map::new();
            for (key, nested) in object.iter().take(64) {
                if *remaining == 0 { break; }
                if is_body_field(key) || is_sensitive_field(key) {
                    continue;
                }
                // Diagnostic field names are identifiers, never caller-supplied prose/paths.
                if key.len() > 64 || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b)) {
                    continue;
                }
                let value = if is_path_field(key) {
                    redact_path_value(nested, depth + 1, remaining)
                } else {
                    redact_nested(nested, key, depth + 1, remaining, envelope)
                };
                redacted.insert(key.clone(), value);
            }
            Value::Object(redacted)
        }
        Value::Array(values) => Value::Array(
            values.iter().take(20).map(|v| redact_nested(v, "", depth + 1, remaining, false)).collect(),
        ),
        Value::String(text) => {
            // Legacy/double-encoded JSON is still recursively filtered. Invalid, truncated
            // or ordinary free text is withheld, including error/message/reason/stack.
            if text.len() <= 16 * 1024 {
                if let Ok(decoded) = serde_json::from_str::<Value>(text) {
                    if decoded.is_object() || decoded.is_array() || decoded.is_string() {
                        return redact_nested(&decoded, "", depth + 1, remaining, false);
                    }
                }
            }
            if allowed_string(key, text, envelope && depth == 1) {
                Value::String(text.clone())
            } else {
                Value::String(REDACTED.into())
            }
        }
        _ => value.clone(),
    }
}

pub(super) fn redact_value(value: &Value) -> Value {
    let mut remaining = MAX_NODES;
    redact_nested(value, "", 0, &mut remaining, true)
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
        assert_eq!(redact_value(&value), json!({ "nested": {}, "safe": "[redacted]" }));
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
            "sessionId": "12345678-1234-4234-8234-123456789abc"
        });
        assert_eq!(
            redact_value(&value),
            json!({ "nested": {}, "sessionId": "12345678-1234-4234-8234-123456789abc" })
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
                "relative": "[redacted]"
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
    fn preserves_metrics_and_operational_fields_while_withholding_prose() {
        let value = json!({
            "source": "frontend",
            "category": "runtime.performance",
            "operation": "runtime.snapshot",
            "durationMs": 3.5,
            "status": "ok",
            "details": [null, true, 7, "plain diagnostic"]
        });
        let mut expected = value.clone();
        expected["details"][3] = json!("[redacted]");
        assert_eq!(redact_value(&value), expected);
    }

    #[test]
    fn decodes_legacy_json_strings_before_recursive_redaction() {
        let value = json!({ "nested": r#"{"body":"SECRET","token":"TOKEN","path":"C:\\Private\\note.md","count":7}"# });
        assert_eq!(redact_value(&value), json!({ "nested": {"path":"note.md","count":7} }));
    }

    #[test]
    fn withholds_free_error_text_and_unknown_strings() {
        let value = json!({ "error":"C:\\Private SECRET", "message":"body", "reason":"token", "stack":"secret", "other":"private prose" });
        let result = redact_value(&value);
        for key in ["error", "message", "reason", "stack", "other"] {
            assert_eq!(result[key], "[redacted]");
        }
    }

    #[test]
    fn nested_envelope_names_cannot_bypass_redaction() {
        let value = json!({"operation":"runtime.error","details":{"operation":"runtime.error","source":"rust","status":"ok"}});
        assert_eq!(redact_value(&value), json!({"operation":"runtime.error","details":{"operation":"[redacted]","source":"[redacted]","status":"[redacted]"}}));
    }

    #[test]
    fn unknown_envelope_labels_do_not_leak_caller_strings() {
        let value = json!({"operation":"SECRET_TOKEN","category":"SECRET_BODY","source":"secret","status":"private","sessionId":"private document title"});
        let result = redact_value(&value);
        for key in ["operation", "category", "source", "status", "sessionId"] {
            assert_eq!(result[key], "[redacted]");
        }
    }

    #[test]
    fn invalid_or_truncated_encoded_json_fails_closed() {
        let value = json!({"payload":"{\"token\":\"SECRET", "array":["SECRET", {"password":"SECRET","count":2}]});
        assert_eq!(redact_value(&value), json!({"payload":"[redacted]","array":["[redacted]",{"count":2}]}));
    }

    #[test]
    fn limits_nested_and_encoded_diagnostic_work() {
        let mut value = json!({"token":"SECRET"});
        for _ in 0..30 { value = json!({"nested":value}); }
        let result = redact_value(&value).to_string();
        assert!(!result.contains("SECRET"));
        assert!(result.contains("[redacted]"));
        let value = json!({"items":vec![json!({"count":1}); 1000]});
        assert_eq!(redact_value(&value)["items"].as_array().unwrap().len(), 20);
    }

    #[test]
    fn withholds_path_queries_credentials_and_malformed_path_payloads() {
        let value = json!({"path":"https://host/file?token=SECRET", "paths":["C:\\x\\ok.md", "{\"token\":\"SECRET\"}"]});
        assert_eq!(redact_value(&value), json!({"path":"[redacted]","paths":["ok.md","[redacted]"]}));
    }

    #[test]
    fn nested_json_encodings_and_numeric_metrics_are_handled_separately() {
        let encoded = serde_json::to_string(&json!({"token":"SECRET","durationMs":3.5})).unwrap();
        let twice = serde_json::to_string(&encoded).unwrap();
        let value = json!({"encoded":twice,"count":7,"active":true,"empty":null});
        assert_eq!(redact_value(&value), json!({"encoded":{"durationMs":3.5},"count":7,"active":true,"empty":null}));
    }

}

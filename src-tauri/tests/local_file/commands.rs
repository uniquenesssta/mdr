//! R12-08 exercises the real command functions, runtime and filesystem; production I/O.

use super::{commands, operations, tree_limits::MAX_FILE_TREE_DEPTH};
use serde_json::{json, to_value};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::async_runtime::block_on;

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new(label: &str) -> Self {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos();
        let path = std::env::temp_dir().join(format!("mdr-command-{label}-{}-{nonce}", std::process::id()));
        fs::create_dir(&path).expect("create fixture directory");
        Self(path)
    }

    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }

    fn write(&self, name: &str, content: &[u8]) -> PathBuf {
        let path = self.path(name);
        fs::write(&path, content).expect("write fixture");
        path
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.0) {
            eprintln!("command fixture cleanup failed: {error}");
        }
    }
}

fn wire_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[test]
fn dropped_text_preserves_unicode_content_name_and_nullable_data_url() {
    let dir = TestDirectory::new("text");
    let path = dir.write("中文.MD", "标题 🚀".as_bytes());
    let result = commands::read_dropped_file(wire_path(&path)).expect("read through command");
    assert_eq!(
        to_value(result).expect("serialize"),
        json!({
            "name": "中文.MD", "path": wire_path(&path), "kind": "text",
            "content": "标题 🚀", "dataUrl": null
        })
    );
}

#[test]
fn dropped_image_preserves_mime_and_nullable_text_content() {
    let dir = TestDirectory::new("image");
    let path = dir.write("pixel.PNG", &[0, 1, 2]);
    let result = commands::read_dropped_file(wire_path(&path)).expect("read image command");
    assert_eq!(
        to_value(result).expect("serialize"),
        json!({
            "name": "pixel.PNG", "path": wire_path(&path), "kind": "image",
            "content": null, "dataUrl": "data:image/png;base64,AAEC"
        })
    );
}

#[test]
fn dropped_file_rejects_directory_unsupported_kind_and_invalid_utf8() {
    let dir = TestDirectory::new("drop-errors");
    assert_eq!(
        commands::read_dropped_file(wire_path(&dir.0)).expect_err("directory"),
        "只支持拖入文件，不支持拖入文件夹"
    );
    let unknown = dir.write("unknown.bin", &[0]);
    assert_eq!(
        commands::read_dropped_file(wire_path(&unknown)).expect_err("unsupported"),
        "不支持该文件类型，请拖入 Markdown、文本或图片文件"
    );
    let invalid = dir.write("invalid.txt", &[0xff, 0xfe]);
    assert!(commands::read_dropped_file(wire_path(&invalid))
        .expect_err("invalid UTF-8")
        .starts_with("无法读取文本文件："));
}

#[test]
fn embedded_image_resolves_document_relative_path_and_serializes_exact_fields() {
    let dir = TestDirectory::new("relative");
    let document = dir.write("document.md", b"text");
    let image = dir.write("cover.svg", b"<svg/>");
    let result = block_on(commands::read_local_image(
        "cover.svg".into(),
        Some(wire_path(&document)),
    ))
    .expect("read relative image through blocking command");
    assert_eq!(
        to_value(result).expect("serialize"),
        json!({
            "path": wire_path(&image), "dataUrl": "data:image/svg+xml;base64,PHN2Zy8+", "bytes": 6
        })
    );
}

#[test]
fn embedded_image_rejects_oversize_before_unsupported_kind() {
    let dir = TestDirectory::new("image-errors");
    let path = dir.write("oversized.bin", &[]);
    fs::File::options()
        .write(true)
        .open(&path)
        .expect("open sparse file")
        .set_len(super::image_reader::MAX_EMBEDDED_IMAGE_BYTES + 1)
        .expect("set sparse length");
    assert_eq!(
        block_on(commands::read_local_image(wire_path(&path), None)).expect_err("oversized"),
        "图片超过 20MB，混合编辑模式暂不加载"
    );
    assert_eq!(
        block_on(commands::read_local_image(wire_path(&dir.0), None)).expect_err("directory"),
        "图片路径不是文件"
    );
}

#[test]
fn text_writer_preserves_utf8_byte_count_and_overwrite() {
    let dir = TestDirectory::new("write-text");
    let path = dir.write("document.md", b"old text to replace");
    let text = "中文 🚀";
    let result = block_on(commands::write_local_text_file(wire_path(&path), text.into())).expect("write text");
    assert_eq!(
        to_value(result).expect("serialize"),
        json!({"path": wire_path(&path), "bytes": text.len()})
    );
    assert_eq!(fs::read_to_string(&path).expect("read written file"), text);
}

#[test]
fn binary_writer_preserves_decoded_bytes_and_result_fields() {
    let dir = TestDirectory::new("write-binary");
    let path = dir.path("file.bin");
    let result =
        block_on(commands::write_local_binary_file(wire_path(&path), "AAEC/w==".into())).expect("write binary");
    assert_eq!(
        to_value(result).expect("serialize"),
        json!({"path": wire_path(&path), "bytes": 4})
    );
    assert_eq!(fs::read(&path).expect("read binary"), [0, 1, 2, 255]);
}

#[test]
fn binary_decode_failure_precedes_path_validation_and_has_no_write_side_effect() {
    let dir = TestDirectory::new("decode-error");
    let path = dir.write("existing.bin", b"keep");
    for target in [String::new(), wire_path(&path)] {
        assert!(block_on(commands::write_local_binary_file(target, "%%%".into()))
            .expect_err("invalid Base64")
            .starts_with("文件数据解码失败："));
    }
    assert_eq!(fs::read(&path).expect("read preserved bytes"), b"keep");
    assert_eq!(
        block_on(commands::write_local_binary_file(String::new(), "AA==".into())).expect_err("blank path"),
        "保存路径不能为空"
    );
}

#[test]
fn write_failures_preserve_operation_errors_and_never_create_parent_directories() {
    let dir = TestDirectory::new("write-errors");
    let parent = dir.path("missing");
    let path = parent.join("file.md");
    assert!(
        block_on(commands::write_local_text_file(wire_path(&path), "text".into()))
            .expect_err("missing parent")
            .starts_with("无法写入文本文件：")
    );
    assert!(
        block_on(commands::write_local_binary_file(wire_path(&path), "AA==".into()))
            .expect_err("missing parent")
            .starts_with("无法写入文件：")
    );
    assert!(!parent.exists());
    assert_eq!(
        block_on(commands::write_local_text_file(String::new(), "text".into())).expect_err("blank path"),
        "保存路径不能为空"
    );
}

#[test]
fn tree_command_preserves_default_limits_and_call_isolation() {
    let dir = TestDirectory::new("tree");
    let current = dir.write("current.md", b"text");
    let mut nested = dir.0.clone();
    for _ in 0..=MAX_FILE_TREE_DEPTH {
        nested = nested.join("d");
        fs::create_dir(&nested).expect("create nested directory");
    }
    fs::write(nested.join("deep.md"), b"deep").expect("write deep file");
    let first = block_on(commands::list_text_file_tree(wire_path(&current))).expect("scan truncated tree");
    assert!(first.truncated);
    assert_eq!(first.file_count, 1);
    let value = to_value(first).expect("serialize tree");
    for key in [
        "rootPath",
        "rootName",
        "nodes",
        "fileCount",
        "directoryCount",
        "skippedCount",
        "truncated",
    ] {
        assert!(value.get(key).is_some(), "missing wire field: {key}");
    }
    fs::remove_dir_all(dir.path("d")).expect("remove nested fixture");
    let second = block_on(commands::list_text_file_tree(wire_path(&current))).expect("scan clean tree");
    assert!(!second.truncated);
    assert_eq!(second.file_count, 1);
    assert_eq!(second.directory_count, 0);
}

#[test]
fn tree_command_preserves_empty_document_error_without_wrapping_it_as_a_task_failure() {
    assert_eq!(
        block_on(commands::list_text_file_tree("   ".into())).expect_err("empty document"),
        "当前文档尚未关联本地文件"
    );
}

#[test]
fn startup_selection_keeps_first_existing_text_path_and_no_process_global_mutation() {
    let dir = TestDirectory::new("startup");
    let missing = dir.path("missing.md");
    let image = dir.write("skip.png", &[0]);
    let first = dir.write("先.TXT", b"first");
    let second = dir.write("next.md", b"second");
    let arguments: Vec<OsString> = [&missing, &image, &dir.0, &first, &second]
        .into_iter()
        .map(|path| path.as_os_str().to_owned())
        .collect();
    assert_eq!(operations::select_initial_file_path(arguments), Some(wire_path(&first)));
    assert_eq!(operations::select_initial_file_path(Vec::<OsString>::new()), None);
    assert_eq!(
        commands::initial_file_path(),
        operations::select_initial_file_path(std::env::args_os().skip(1))
    );
}

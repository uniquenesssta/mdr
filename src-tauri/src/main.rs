#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod document_store;
mod external_link;
mod local_file;
mod performance_log;
mod web_fetch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    performance_log::record_lifecycle("app.start");
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(document_store::DocumentStore::default())
        .invoke_handler(tauri::generate_handler![
            web_fetch::fetch_url,
            external_link::open_external_url,
            document_store::save_document_state,
            document_store::begin_document_snapshot_upload,
            document_store::append_document_snapshot_chunk,
            document_store::commit_document_snapshot_upload,
            document_store::abort_document_snapshot_upload,
            document_store::load_document_state,
            document_store::load_document_manifest,
            document_store::read_document_chunk,
            document_store::search_document_state,
            document_store::delete_document_state,
            local_file::read_dropped_file,
            local_file::list_text_file_tree,
            local_file::read_local_image,
            local_file::write_local_text_file,
            local_file::write_local_binary_file,
            local_file::initial_file_path,
            performance_log::write_performance_logs
        ])
        .run(tauri::generate_context!());
    performance_log::record_lifecycle("app.exit");
    result.expect("error while running Markdown Editor");
}

fn main() {
    run();
}

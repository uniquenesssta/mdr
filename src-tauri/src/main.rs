#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_launch;
mod document_store;
mod external_link;
mod local_file;
mod performance_log;
mod web_fetch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use tauri::Manager;
    let context = tauri::generate_context!();
    let (launch_root, first_request) =
        app_launch::prepare(&context.config().identifier).expect("无法创建启动请求");
    #[cfg(windows)]
    let _instance_guard = match app_launch::InstanceGuard::acquire(&context.config().identifier)
        .expect("无法锁定应用实例")
    {
        Some(guard) => guard,
        None => return,
    };
    let launch_state =
        app_launch::LaunchState::new(launch_root, first_request).expect("无法读取多开设置");
    let alive = Arc::new(AtomicBool::new(true));
    let setup_alive = alive.clone();
    performance_log::record_lifecycle("app.start");
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(document_store::DocumentStore::default())
        .manage(web_fetch::requests::WebFetchRequests::default())
        .manage(launch_state)
        .setup(move |app| {
            app_launch::install(app.handle(), setup_alive.clone())
                .map_err(std::io::Error::other)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Focused(true)) {
                if let Ok(mut state) = window.state::<app_launch::LaunchState>().0.try_lock() {
                    state.preferred = window.label().into();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_launch::launch_commands::read_launch_context,
            app_launch::launch_commands::set_single_instance,
            app_launch::launch_commands::peek_launch_request,
            app_launch::launch_commands::ack_launch_request,
            web_fetch::command::fetch_url,
            external_link::command::open_external_url,
            document_store::commands::save::save_document_state,
            document_store::commands::snapshot_upload::begin_document_snapshot_upload,
            document_store::commands::snapshot_upload::append_document_snapshot_chunk,
            document_store::commands::snapshot_upload::commit_document_snapshot_upload,
            document_store::commands::snapshot_upload::abort_document_snapshot_upload,
            document_store::commands::load::load_document_state,
            document_store::commands::load::load_document_manifest,
            document_store::commands::load::read_document_chunk,
            document_store::commands::search::search_document_state,
            document_store::commands::delete::delete_document_state,
            local_file::commands::read_dropped_file,
            local_file::commands::list_text_file_tree,
            local_file::commands::read_local_image,
            local_file::commands::write_local_text_file,
            local_file::commands::write_local_binary_file,
            local_file::commands::initial_file_path,
            performance_log::command::write_performance_logs,
            performance_log::command::write_performance_log_batch,
            web_fetch::command::cancel_fetch_url
        ])
        .build(context)
        .map(|app| {
            app.run(move |_, event| {
                if matches!(event, tauri::RunEvent::Exit) {
                    alive.store(false, Ordering::Relaxed);
                }
            })
        });
    performance_log::record_lifecycle("app.exit");
    result.expect("error while running Markdown Editor");
}

fn main() {
    run();
}

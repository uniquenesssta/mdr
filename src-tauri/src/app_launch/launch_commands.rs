//! Launch IPC is scoped to the calling local webview; renderers cannot acknowledge another window's queue.
use super::{inbox, policy, LaunchState};
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchContext {
    window_label: String,
    enabled: bool,
    window_count: usize,
}

#[tauri::command]
pub fn read_launch_context(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LaunchState>,
) -> Result<LaunchContext, String> {
    let state = state.0.lock().map_err(|_| "启动状态锁定失败")?;
    Ok(LaunchContext {
        window_label: window.label().into(),
        enabled: state.enabled,
        window_count: window.app_handle().webview_windows().len(),
    })
}
#[tauri::command]
pub fn set_single_instance(
    enabled: bool,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LaunchState>,
) -> Result<bool, String> {
    let mut state = state.0.lock().map_err(|_| "启动状态锁定失败")?;
    if enabled && window.app_handle().webview_windows().len() > 1 {
        return Err("请先关闭其他窗口，再开启限制多开。".into());
    }
    policy::write(&state.root, enabled)?;
    state.enabled = enabled;
    Ok(enabled)
}
#[tauri::command]
pub fn peek_launch_request(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LaunchState>,
) -> Result<Option<inbox::OpenRequest>, String> {
    let state = state.0.lock().map_err(|_| "启动状态锁定失败")?;
    Ok(inbox::read_requests(&state.root.join("open-requests"))?
        .into_iter()
        .find(|r| {
            state
                .assigned
                .get(&r.id)
                .is_some_and(|label| label == window.label())
        }))
}
#[tauri::command]
pub fn ack_launch_request(
    id: String,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LaunchState>,
) -> Result<(), String> {
    let mut state = state.0.lock().map_err(|_| "启动状态锁定失败")?;
    if state
        .assigned
        .get(&id)
        .is_none_or(|label| label != window.label())
    {
        return Err("不能确认其他窗口的打开请求".into());
    }
    let request = inbox::read_requests(&state.root.join("open-requests"))?
        .into_iter()
        .find(|r| r.id == id)
        .ok_or("打开请求不存在")?;
    inbox::acknowledge(&state.root.join("open-requests"), &request)?;
    state.assigned.remove(&id);
    Ok(())
}

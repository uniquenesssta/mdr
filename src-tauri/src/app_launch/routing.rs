//! Main-thread window routing; each launch is assigned until its renderer acknowledges actual import.
use super::{
    inbox::{self, OpenRequest},
    policy,
};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};

pub struct Coordinator {
    pub root: PathBuf,
    pub enabled: bool,
    pub assigned: HashMap<String, String>,
    pub preferred: String,
    pub first_request: String,
    pub serial: u64,
}
pub struct LaunchState(pub Mutex<Coordinator>);
impl LaunchState {
    pub fn new(root: PathBuf, first_request: String) -> Result<Self, String> {
        let enabled = policy::read(&root)?;
        Ok(Self(Mutex::new(Coordinator {
            root,
            enabled,
            assigned: HashMap::new(),
            preferred: "main".into(),
            first_request,
            serial: 0,
        })))
    }
}

fn target(
    app: &tauri::AppHandle,
    state: &mut Coordinator,
    request: &OpenRequest,
) -> Result<String, String> {
    if request.id == state.first_request && app.get_webview_window("main").is_some() {
        return Ok("main".into());
    }
    if state.enabled {
        if app.get_webview_window(&state.preferred).is_some() {
            return Ok(state.preferred.clone());
        }
        return app
            .webview_windows()
            .keys()
            .next()
            .cloned()
            .ok_or_else(|| "没有可用窗口".into());
    }
    state.serial += 1;
    let label = format!("session-{}-{}", std::process::id(), state.serial);
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .ok_or("缺少主窗口配置")?
        .clone();
    config.label = label.clone();
    config.create = true;
    tauri::WebviewWindowBuilder::from_config(app, &config)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    Ok(label)
}

fn route(app: &tauri::AppHandle) -> Result<(), String> {
    let owner = app.state::<LaunchState>();
    let mut state = owner.0.lock().map_err(|_| "启动状态锁定失败")?;
    let requests = inbox::read_requests(&state.root.join("open-requests"))?;
    for request in requests {
        if let Some(label) = state.assigned.get(&request.id) {
            if app.get_webview_window(label).is_some() {
                continue;
            }
        }
        let label = target(app, &mut state, &request)?;
        state.assigned.insert(request.id.clone(), label.clone());
        if let Some(window) = app.get_webview_window(&label) {
            window.unminimize().map_err(|e| e.to_string())?;
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
            window
                .emit("mdr:launch-pending", ())
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn install(app: &tauri::AppHandle, alive: Arc<AtomicBool>) -> Result<(), String> {
    // Verify the pre-builder Windows directory against Tauri's actual path resolver.
    if app.path().app_config_dir().map_err(|e| e.to_string())?
        != app
            .state::<LaunchState>()
            .0
            .lock()
            .map_err(|_| "启动状态锁定失败")?
            .root
    {
        return Err("启动配置目录不一致".into());
    }
    route(app)?;
    let handle = app.clone();
    std::thread::spawn(move || {
        while alive.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(300));
            let app = handle.clone();
            if handle
                .run_on_main_thread(move || {
                    if let Err(error) = route(&app) {
                        eprintln!("Launch routing failed: {error}");
                    }
                })
                .is_err()
            {
                break;
            }
        }
    });
    Ok(())
}

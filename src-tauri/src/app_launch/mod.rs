//! Launch coordination boundary: durable inbox, native window routing and IPC policy.
mod inbox;
mod instance_guard;
pub mod launch_commands;
mod policy;
mod routing;
#[cfg(test)]
mod tests;
#[cfg(windows)]
pub use instance_guard::InstanceGuard;
pub use routing::{install, LaunchState};

pub fn prepare(identifier: &str) -> Result<(std::path::PathBuf, String), String> {
    let base = std::env::var_os("APPDATA").ok_or("无法确定项目应用配置目录")?;
    let root = std::path::PathBuf::from(base).join(identifier);
    let request = inbox::enqueue(
        &root.join("open-requests"),
        std::env::args_os().skip(1),
        &std::env::current_dir().map_err(|e| e.to_string())?,
    )?;
    Ok((root, request))
}

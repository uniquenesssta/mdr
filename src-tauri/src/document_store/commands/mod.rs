//! Tauri command subsystem aggregator.
//!
//! Responsibility: expose the command-owning submodules so `main.rs` can register each command
//! by its full path in `tauri::generate_handler!`. Tauri's `#[tauri::command]` macro generates
//! hidden per-command artifacts tied to the function's defining module, so a `use` re-export of
//! the function name alone does not carry them — the modules stay `pub(crate)` and unaggregated
//! here rather than re-exported, matching Tauri's own documented pattern for multi-module
//! commands. Owns no state, IO, or policy itself.

pub(crate) mod delete;
pub(crate) mod load;
pub(crate) mod save;
pub(crate) mod search;
pub(crate) mod snapshot_upload;

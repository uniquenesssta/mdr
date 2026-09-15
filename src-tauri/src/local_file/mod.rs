//! Public local-file capability boundary.
//!
//! Declares private policy, I/O, use-case and wire-type modules and exposes the stable command
//! boundary and DTOs. This entry has no business branches, runtime state or side effects.

mod binary_writer;
pub(crate) mod commands;
mod directory_tree;
mod file_kind;
mod image_reader;
mod operations;
mod path_policy;
mod text_reader;
mod text_writer;
mod tree_limits;
mod types;

// Preserve both historical tree DTO paths; current callers infer node values through TextFileTree.
#[allow(unused_imports)]
pub use directory_tree::{TextFileTree, TextFileTreeNode};
pub use types::{DroppedFile, LocalImageData, LocalWriteResult};

#[cfg(test)]
#[path = "../../tests/local_file/legacy.rs"]
mod tests;

#[cfg(test)]
#[path = "../../tests/local_file/stage_12.rs"]
mod stage_12_tests;

#[cfg(test)]
#[path = "../../tests/local_file/commands.rs"]
mod command_tests;

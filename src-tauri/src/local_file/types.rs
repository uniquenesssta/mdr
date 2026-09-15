//! Stable Serde wire results for local-file reads and writes.
//!
//! Data definitions only: preserves camelCase fields, nullable content/Data URL values and
//! byte counts. No validation, filesystem access, transport or mutable state is owned here.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedFile {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub content: Option<String>,
    pub data_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalImageData {
    pub path: String,
    pub data_url: String,
    pub bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalWriteResult {
    pub path: String,
    pub bytes: usize,
}

//! ATX heading and fence-marker detection.
//!
//! Responsibility: recognize a single Markdown line as an ATX heading (`#` through `######`) or
//! a fenced-code delimiter (backtick/tilde, 3+ repeats), and derive a heading's stable id. No
//! whole-document indexing, checkpoints, or line/whitespace counting — those remain with
//! `builder`.

use crate::document_store::snapshot::fnv1a64;

pub(in crate::document_store) fn heading_id(line: usize, level: u8, text: &str) -> String {
    format!("native-h-{line}-{level}-{}", fnv1a64(text.as_bytes()))
}

pub(in crate::document_store) fn parse_atx_heading(line: &str) -> Option<(u8, String)> {
    let trimmed = line.trim_start();
    let level = trimmed.chars().take_while(|ch| *ch == '#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let remainder = &trimmed[level..];
    if remainder
        .chars()
        .next()
        .is_some_and(|ch| !ch.is_whitespace())
    {
        return None;
    }
    let text = remainder.trim().trim_end_matches('#').trim().to_string();
    if text.is_empty() {
        return None;
    }
    Some((level as u8, text))
}

pub(in crate::document_store) fn fence_marker(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start();
    let marker = trimmed.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let count = trimmed.chars().take_while(|ch| *ch == marker).count();
    if count >= 3 {
        Some((marker, count))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heading_id_is_stable_for_the_same_line_level_and_text() {
        assert_eq!(heading_id(3, 2, "标题😀"), heading_id(3, 2, "标题😀"));
        assert_ne!(heading_id(3, 2, "标题😀"), heading_id(4, 2, "标题😀"));
    }

    #[test]
    fn parse_atx_heading_accepts_one_through_six_hashes_and_trims_trailing_hashes() {
        assert_eq!(parse_atx_heading("# 标题 #"), Some((1, "标题".to_string())));
        assert_eq!(
            parse_atx_heading("###### 六级"),
            Some((6, "六级".to_string()))
        );
    }

    #[test]
    fn parse_atx_heading_rejects_seven_hashes_empty_text_and_missing_space() {
        assert_eq!(parse_atx_heading("####### 太深"), None);
        assert_eq!(parse_atx_heading("# "), None);
        assert_eq!(parse_atx_heading("#标题"), None);
    }

    #[test]
    fn fence_marker_requires_three_or_more_backticks_or_tildes() {
        assert_eq!(fence_marker("```md"), Some(('`', 3)));
        assert_eq!(fence_marker("~~~~"), Some(('~', 4)));
        assert_eq!(fence_marker("``"), None);
        assert_eq!(fence_marker("# not a fence"), None);
    }
}

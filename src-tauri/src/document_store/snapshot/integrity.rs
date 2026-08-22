//! Snapshot content integrity: FNV-1a hashing and byte-for-byte validation against declared
//! metadata.
//!
//! Responsibility: compute the FNV-1a64 hex digest used across the store, and decide whether
//! read-back content matches its declared byte count and hash. No file IO, meta struct
//! construction/parsing, slot selection, or recovery/journal policy — those remain with their
//! dedicated Stage 11 atomics.

pub(in crate::document_store) fn fnv1a64(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

pub(in crate::document_store) fn content_integrity_valid(
    content: &str,
    expected_bytes: usize,
    expected_hash: &str,
) -> bool {
    content.len() == expected_bytes && fnv1a64(content.as_bytes()) == expected_hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv1a64_matches_known_reference_digests() {
        assert_eq!(fnv1a64(b""), "cbf29ce484222325");
        assert_eq!(fnv1a64(b"a"), "af63dc4c8601ec8c");
    }

    #[test]
    fn content_integrity_valid_requires_both_byte_count_and_hash_to_match() {
        let content = "甲😀乙";
        let hash = fnv1a64(content.as_bytes());
        assert!(content_integrity_valid(content, content.len(), &hash));
        assert!(!content_integrity_valid(content, content.len() + 1, &hash));
        assert!(!content_integrity_valid(
            content,
            content.len(),
            "0000000000000000"
        ));
    }
}

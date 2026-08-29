//! Snapshot A/B slot selection.
//!
//! Responsibility: decide which slot to write into next (always the inactive slot), and which
//! of two read candidates is the active slot on load, falling back to the other slot when one
//! failed validation. No file IO, hashing, metadata parsing, or recovery/journal policy — those
//! remain with their dedicated Stage 11 atomics.

pub(in crate::document_store) fn next_snapshot_slot(current: Option<char>) -> char {
    if current == Some('a') {
        'b'
    } else {
        'a'
    }
}

pub(in crate::document_store) fn select_active_slot<T>(
    a: Option<T>,
    b: Option<T>,
    version_of: impl Fn(&T) -> u64,
) -> Option<T> {
    match (a, b) {
        (Some(left), Some(right)) => {
            if version_of(&left) >= version_of(&right) {
                Some(left)
            } else {
                Some(right)
            }
        }
        (Some(item), None) | (None, Some(item)) => Some(item),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alternates_snapshot_slots_without_overwriting_current_snapshot() {
        assert_eq!(next_snapshot_slot(None), 'a');
        assert_eq!(next_snapshot_slot(Some('a')), 'b');
        assert_eq!(next_snapshot_slot(Some('b')), 'a');
    }

    #[test]
    fn select_active_slot_prefers_higher_version_and_breaks_ties_toward_a() {
        assert_eq!(
            select_active_slot(Some(('a', 3)), Some(('b', 5)), |item| item.1)
                .unwrap()
                .0,
            'b'
        );
        assert_eq!(
            select_active_slot(Some(('a', 5)), Some(('b', 3)), |item| item.1)
                .unwrap()
                .0,
            'a'
        );
        assert_eq!(
            select_active_slot(Some(('a', 4)), Some(('b', 4)), |item| item.1)
                .unwrap()
                .0,
            'a'
        );
    }

    #[test]
    fn select_active_slot_falls_back_to_the_only_present_candidate() {
        assert_eq!(
            select_active_slot(Some('a'), None::<char>, |_| 0).unwrap(),
            'a'
        );
        assert_eq!(
            select_active_slot(None::<char>, Some('b'), |_| 0).unwrap(),
            'b'
        );
    }

    #[test]
    fn select_active_slot_returns_none_when_neither_candidate_is_present() {
        assert!(select_active_slot(None::<char>, None::<char>, |_| 0).is_none());
    }
}

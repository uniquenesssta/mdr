//! Test-only deterministic IO boundary failures. Real filesystem refusals have separate tests.
use std::{cell::RefCell, path::Path};

thread_local! {
    static FAILURE: RefCell<Option<(String, &'static str)>> = const { RefCell::new(None) };
}

pub(crate) fn arm(filename: &str, stage: &'static str) {
    FAILURE.with(|failure| *failure.borrow_mut() = Some((filename.into(), stage)));
}

pub(crate) fn check(path: &Path, stage: &'static str) -> Result<(), String> {
    FAILURE.with(|failure| {
        let mut failure = failure.borrow_mut();
        if failure.as_ref().is_some_and(|(filename, point)| {
            path.file_name().and_then(|name| name.to_str()) == Some(filename.as_str()) && *point == stage
        }) {
            *failure = None;
            Err(format!("INJECTED_IO_FAILURE:{stage}"))
        } else {
            Ok(())
        }
    })
}

pub(crate) fn assert_consumed() {
    FAILURE.with(|failure| assert!(failure.borrow().is_none(), "fault boundary was not exercised"));
}

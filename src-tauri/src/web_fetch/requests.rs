//! App-owned native request cancellation. No URLs/content are retained here.
//! Bounded early-cancel entries handle IPC reordering; guards release active entries on all exits.
use futures_util::future::{AbortHandle, AbortRegistration, Abortable};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_ENTRIES: usize = 64;
const EARLY_CANCEL_TTL: Duration = Duration::from_secs(30);
const CANCELLED: &str = "WEB_FETCH_CANCELLED";

enum Entry {
    Active(AbortHandle),
    EarlyCancel(Instant),
}

#[derive(Default)]
pub(crate) struct WebFetchRequests {
    entries: Mutex<HashMap<String, Entry>>,
}

struct RequestGuard<'a> {
    owner: &'a WebFetchRequests,
    id: String,
}

impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut entries) = self.owner.entries.lock() {
            entries.remove(&self.id);
        }
    }
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("Invalid web request identifier".into());
    }
    Ok(())
}

fn validate_fresh_request(id: &str) -> Result<(), String> {
    let issued = id
        .split_once('-')
        .and_then(|(time, _)| time.parse::<u128>().ok())
        .ok_or("Invalid web request timestamp")?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Web request clock unavailable")?
        .as_millis();
    // Same-machine timestamps stop an IPC request delayed beyond early-cancel retention
    // from starting after its cancellation record has expired.
    if issued > now || now - issued >= EARLY_CANCEL_TTL.as_millis() {
        return Err(CANCELLED.into());
    }
    Ok(())
}

fn prune(entries: &mut HashMap<String, Entry>) {
    entries.retain(|_, entry| match entry {
        Entry::Active(_) => true,
        Entry::EarlyCancel(time) => time.elapsed() < EARLY_CANCEL_TTL,
    });
}

impl WebFetchRequests {
    fn start(&self, id: String) -> Result<(RequestGuard<'_>, AbortRegistration), String> {
        validate_id(&id)?;
        let mut entries = self.entries.lock().map_err(|_| "Web request state unavailable")?;
        prune(&mut entries);
        match entries.get(&id) {
            Some(Entry::EarlyCancel(_)) => {
                entries.remove(&id);
                return Err(CANCELLED.into());
            }
            Some(Entry::Active(_)) => return Err("Duplicate web request identifier".into()),
            None => {}
        }
        if entries.len() >= MAX_ENTRIES {
            return Err("Too many web requests".into());
        }
        let (handle, registration) = AbortHandle::new_pair();
        entries.insert(id.clone(), Entry::Active(handle));
        Ok((RequestGuard { owner: self, id }, registration))
    }

    pub(super) async fn run<T>(
        &self,
        id: Option<String>,
        future: impl std::future::Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        let Some(id) = id else {
            return future.await;
        };
        validate_fresh_request(&id)?;
        let (_guard, registration) = self.start(id)?;
        Abortable::new(future, registration)
            .await
            .map_err(|_| CANCELLED.to_string())?
    }

    pub(super) fn cancel(&self, id: &str) -> Result<(), String> {
        validate_id(id)?;
        let mut entries = self.entries.lock().map_err(|_| "Web request state unavailable")?;
        prune(&mut entries);
        match entries.get(id) {
            Some(Entry::Active(handle)) => handle.abort(),
            Some(Entry::EarlyCancel(_)) => {}
            None => {
                if entries.len() >= MAX_ENTRIES {
                    return Err("Too many web requests".into());
                }
                entries.insert(id.to_string(), Entry::EarlyCancel(Instant::now()));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_before_start_never_polls_and_releases_entry() {
        let owner = WebFetchRequests::default();
        let id = format!(
            "{}-early",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis()
        );
        owner.cancel(&id).unwrap();
        let never = std::future::poll_fn(|_| -> std::task::Poll<Result<(), String>> {
            panic!("cancelled work must not start");
        });
        let result = tauri::async_runtime::block_on(owner.run(Some(id), never));
        assert_eq!(result, Err(CANCELLED.into()));
        assert!(owner.entries.lock().unwrap().is_empty());
    }
    #[test]
    fn duplicate_active_ids_are_rejected_and_guard_cleans_up() {
        let owner = WebFetchRequests::default();
        let (guard, _) = owner.start("active".into()).unwrap();
        assert!(owner.start("active".into()).is_err());
        owner.cancel("active").unwrap();
        drop(guard);
        assert!(owner.entries.lock().unwrap().is_empty());
    }
    #[test]
    fn early_cancels_are_bounded_expire_and_reject_invalid_ids() {
        let owner = WebFetchRequests::default();
        assert!(owner.cancel("").is_err());
        assert_eq!(validate_fresh_request("0-expired"), Err(CANCELLED.into()));
        for i in 0..MAX_ENTRIES {
            owner.cancel(&format!("id-{i}")).unwrap();
        }
        assert!(owner.cancel("overflow").is_err());
        owner
            .entries
            .lock()
            .unwrap()
            .insert("id-0".into(), Entry::EarlyCancel(Instant::now() - EARLY_CANCEL_TTL));
        owner.cancel("after-expiry").unwrap();
        assert_eq!(owner.entries.lock().unwrap().len(), MAX_ENTRIES);
    }
}

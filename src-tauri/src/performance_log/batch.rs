//! Process-local bounded receipt ledger. Eviction never authorizes replay of an old sequence.
use super::{
    paths::log_file_path,
    writer::{self, LogFile},
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, VecDeque},
    fs::OpenOptions,
    sync::{Mutex, OnceLock},
};

const MAX_BATCHES: usize = 200;
const MAX_SESSIONS: usize = 32;
const MAX_LEDGER_BYTES: usize = 4 * 1024 * 1024;
pub(super) struct Request<'a> {
    pub id: &'a str,
    pub offset: usize,
    pub attempt: u32,
    pub total: usize,
}
struct Batch {
    id: String,
    rows: Vec<Vec<u8>>,
    accepted: usize,
    attempt: u32,
    uncertain: bool,
    reason: &'static str,
}
#[derive(Default)]
pub(super) struct Ledger {
    batches: VecDeque<Batch>,
    sessions: BTreeMap<String, u64>,
    bytes: usize,
    blocked: bool,
}
fn identity(id: &str) -> Option<(&str, u64)> {
    let (session, sequence) = id.rsplit_once("-batch-")?;
    if session.is_empty()
        || session.len() > 160
        || !session
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
    {
        return None;
    }
    let sequence = sequence.parse::<u64>().ok()?;
    (sequence > 0 && sequence <= 9_007_199_254_740_991).then_some((session, sequence))
}
fn valid(request: &Request<'_>) -> bool {
    identity(request.id).is_some()
        && request.total > 0
        && request.total <= 250
        && request.offset <= request.total
        && (1..=8).contains(&request.attempt)
}
fn receipt(request: &Request<'_>, accepted: usize, state: &str, reason: &str) -> Value {
    json!({"batchId":request.id,"attempt":request.attempt,"acceptedCount":accepted,"state":state,"reason":reason})
}
impl Ledger {
    pub(super) fn query(&self, request: &Request<'_>) -> Value {
        match self.batches.iter().find(|batch| batch.id == request.id) {
            Some(batch) if batch.rows.len() == request.total => receipt(
                request,
                batch.accepted,
                if batch.uncertain {
                    "uncertain"
                } else if batch.accepted == batch.rows.len() {
                    "complete"
                } else {
                    "partial"
                },
                batch.reason,
            ),
            _ => receipt(request, 0, "missing", "unknown-batch"),
        }
    }
    fn reserve(&mut self, bytes: usize) -> bool {
        while self.batches.len() >= MAX_BATCHES || self.bytes + bytes > MAX_LEDGER_BYTES {
            let Some(index) = self
                .batches
                .iter()
                .position(|b| !b.uncertain && b.accepted == b.rows.len())
            else {
                return false;
            };
            let old = self.batches.remove(index).unwrap();
            self.bytes -= old.rows.iter().map(Vec::len).sum::<usize>();
        }
        true
    }
    pub(super) fn append(&mut self, request: &Request<'_>, rows: Vec<Vec<u8>>, file: &mut impl LogFile) -> Value {
        if !valid(request) || rows.len() != request.total - request.offset {
            return receipt(request, 0, "rejected", "invalid-request");
        }
        let index = match self.batches.iter().position(|b| b.id == request.id) {
            Some(index) => index,
            None => {
                let (session, sequence) = identity(request.id).unwrap();
                if request.offset != 0 || self.sessions.get(session).is_some_and(|last| sequence <= *last) {
                    return receipt(request, 0, "expired", "sequence-expired");
                }
                if !self.sessions.contains_key(session) && self.sessions.len() >= MAX_SESSIONS {
                    return receipt(request, 0, "rejected", "session-limit");
                }
                let bytes = rows.iter().map(Vec::len).sum();
                if !self.reserve(bytes) {
                    return receipt(request, 0, "rejected", "ledger-limit");
                }
                self.bytes += bytes;
                self.sessions.insert(session.into(), sequence);
                self.batches.push_back(Batch {
                    id: request.id.into(),
                    rows: rows.clone(),
                    accepted: 0,
                    attempt: request.attempt,
                    uncertain: false,
                    reason: "ok",
                });
                self.batches.len() - 1
            }
        };
        let batch = &mut self.batches[index];
        if batch.rows.len() != request.total
            || request.offset > batch.accepted
            || request.attempt < batch.attempt
            || batch.rows[request.offset..] != rows[..]
        {
            return receipt(request, batch.accepted, "rejected", "batch-mismatch");
        }
        if batch.uncertain || self.blocked {
            return receipt(request, batch.accepted, "uncertain", "sink-isolated");
        }
        batch.attempt = request.attempt;
        if batch.accepted < batch.rows.len() {
            let progress = writer::append_prepared(file, &batch.rows[batch.accepted..]);
            batch.accepted += progress.accepted;
            batch.reason = progress.reason;
            batch.uncertain = progress.uncertain;
            self.blocked |= progress.uncertain;
        }
        self.query(request)
    }
}
static LEDGER: OnceLock<Mutex<Ledger>> = OnceLock::new();
pub(super) fn submit(
    entries: Vec<Value>,
    id: &str,
    offset: usize,
    attempt: u32,
    total: usize,
    query: bool,
) -> Result<Value, String> {
    let request = Request {
        id,
        offset,
        attempt,
        total,
    };
    // Release returns before validation, path resolution, ledger allocation or file I/O.
    if !cfg!(debug_assertions) {
        let safe = Request {
            id: if identity(id).is_some() { id } else { "[redacted]" },
            offset,
            attempt,
            total,
        };
        return Ok(receipt(&safe, 0, "disabled", "release-disabled"));
    }
    if !valid(&request) {
        return Err("invalid log batch metadata".into());
    }
    let mut ledger = LEDGER
        .get_or_init(|| Mutex::new(Ledger::default()))
        .lock()
        .map_err(|_| "log ledger unavailable")?;
    if query {
        return Ok(ledger.query(&request));
    }
    if entries.len() != total - offset {
        return Err("invalid log suffix".into());
    }
    let rows = writer::prepare(&entries, 250)?;
    let _guard = writer::write_lock().lock().map_err(|_| "log writer unavailable")?;
    if writer::blocked() {
        return Ok(receipt(&request, 0, "uncertain", "sink-isolated"));
    }
    let path = match log_file_path() {
        Ok(path) => path,
        Err(_) => return Ok(receipt(&request, offset, "partial", "directory")),
    };
    let mut file = match OpenOptions::new().create(true).write(true).truncate(false).open(path) {
        Ok(file) => file,
        Err(_) => return Ok(receipt(&request, offset, "partial", "open")),
    };
    let result = ledger.append(&request, rows, &mut file);
    if ledger.blocked {
        writer::block();
    }
    Ok(result)
}

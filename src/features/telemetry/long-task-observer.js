/** Own one injected long-task observer and its generation. No globals, timers or transport. */
export function createLongTaskObserver({ getObserver, record, isEnabled = () => true, onError = () => {} } = {}) {
  for (const [name, value] of Object.entries({ getObserver, record, isEnabled, onError })) {
    if (typeof value !== 'function') throw new TypeError(`LongTaskObserver requires ${name}`);
  }
  let observer = null, generation = 0, state = 'idle', startedBefore = false, cleanupFailed = false;
  let recordedEntries = 0, skippedEntries = 0, failures = 0, lastFailure = '';
  const increment = value => Math.min(Number.MAX_SAFE_INTEGER, value + 1);
  const current = token => generation === token && (state === 'starting' || state === 'running');
  function report(phase) {
    failures = increment(failures); lastFailure = phase;
    try { onError(phase); } catch (_) { /* The diagnostic port cannot interrupt application work. */ }
  }
  function disconnect(candidate) {
    if (!candidate) return;
    try { candidate.disconnect(); }
    catch (_) { cleanupFailed = true; report('disconnect'); }
  }
  function stop() {
    if (state === 'destroyed' || state === 'stopping') return;
    generation++; state = 'stopping';
    const previous = observer; observer = null;
    disconnect(previous);
    if (state === 'stopping') state = 'stopped';
  }
  function allowed() {
    try { return Boolean(isEnabled()); }
    catch (_) { report('enabled'); return false; }
  }
  function receive(list, token) {
    if (!current(token) || state !== 'running') return;
    if (!allowed()) { if (current(token)) stop(); return; }
    if (!current(token) || state !== 'running') return;
    let entries;
    try { entries = list.getEntries(); if (!Array.isArray(entries)) throw new TypeError('Invalid entries'); }
    catch (_) { report('entries'); return; }
    for (const entry of entries) {
      if (!current(token) || state !== 'running') break;
      if (!allowed()) { if (current(token)) stop(); break; }
      if (!current(token) || state !== 'running') break;
      let type, duration, startTime;
      try { type = entry.entryType; duration = entry.duration; startTime = entry.startTime; }
      catch (_) { skippedEntries = increment(skippedEntries); report('entry'); continue; }
      if (!current(token) || state !== 'running') break;
      if (type !== 'longtask' || !Number.isFinite(duration) || duration < 0 || !Number.isFinite(startTime) || startTime < 0) {
        skippedEntries = increment(skippedEntries); continue;
      }
      try {
        record('runtime.long-task', { category: 'runtime.performance', durationMs: duration,
          details: { startTime: Number(startTime.toFixed(3)) } });
        recordedEntries = increment(recordedEntries);
      } catch (_) { report('record'); }
    }
  }
  function start() {
    if (state === 'destroyed' || cleanupFailed || state === 'starting' || state === 'stopping') return false;
    if (state === 'running') return true;
    const token = ++generation; state = 'starting';
    if (!allowed()) { if (current(token)) state = 'stopped'; return false; }
    if (!current(token)) return false;
    let Constructor;
    try {
      Constructor = getObserver();
      if (!current(token)) return false;
      const types = Constructor?.supportedEntryTypes;
      if (!current(token)) return false;
      if (typeof Constructor !== 'function' || (types !== undefined && (!Array.isArray(types) || !types.includes('longtask')))) {
        state = 'unsupported'; return false;
      }
    } catch (_) { if (current(token)) { state = 'failed'; report('support'); } return false; }
    let candidate;
    try { candidate = new Constructor(list => receive(list, token)); }
    catch (_) { if (current(token)) { state = 'failed'; report('construct'); } return false; }
    if (!current(token)) { disconnect(candidate); return false; }
    observer = candidate;
    try { candidate.observe({ type: 'longtask', buffered: !startedBefore }); }
    catch (_) {
      if (current(token)) { generation++; state = 'failed'; observer = null; disconnect(candidate); report('observe'); }
      return false;
    }
    if (!current(token)) return false;
    startedBefore = true; state = 'running'; return true;
  }
  function destroy() {
    if (state === 'destroyed') return;
    stop(); generation++; state = 'destroyed';
  }
  return Object.freeze({ start, stop, destroy, getState: () => Object.freeze({ state,
    observerAttached: observer !== null, recordedEntries, skippedEntries, failures, lastFailure, cleanupFailed }) });
}

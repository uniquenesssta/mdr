/** Own automatic telemetry resources. Injected schedulers must be asynchronous one-shot ports. */
export function createTelemetryLifecycle({ getWindow, getDocument, isEnabled, install, startOwners, stopOwners,
  destroyOwners, drain, flush, schedule, cancel, requestFrame, cancelFrame, onError = () => {},
  aggregateMs = 1500, flushMs = 2000 } = {}) {
  for (const [name, value] of Object.entries({ getWindow, getDocument, isEnabled, install, startOwners, stopOwners,
    destroyOwners, drain, flush, schedule, cancel, requestFrame, cancelFrame, onError })) {
    if (typeof value !== 'function') throw new TypeError(`TelemetryLifecycle requires ${name}`);
  }
  for (const value of [aggregateMs, flushMs]) if (!Number.isInteger(value) || value < 1000 || value > 300000) throw new TypeError('Invalid telemetry period');
  const resources = new Set(), controls = new Set(), timers = new Set(), frames = new Set();
  let state = 'idle', generation = 0, mounted = false, mounting = false, pageHidden = false, destroying = false;
  let destroyRequested = false;
  let cleanupFailed = false, failures = 0, lastFailure = '', report = null;
  const current = token => token === generation && (state === 'starting' || state === 'running');
  function fail(phase) { failures = Math.min(Number.MAX_SAFE_INTEGER, failures + 1); lastFailure = phase; try { onError(phase); } catch (_) {} }
  function invoke(fn, phase) { try { return fn(); } catch (_) { fail(phase); } }
  function allowed() { try { return Boolean(isEnabled()); } catch (_) { fail('enabled'); return false; } }
  function visible() { try { return getDocument()?.visibilityState !== 'hidden'; } catch (_) { fail('visibility'); return false; } }
  function own(set, dispose) {
    let active = true;
    const release = () => { if (!active) return; active = false; set.delete(release); try { dispose(); } catch (_) { cleanupFailed = true; fail('cleanup'); } };
    set.add(release); return release;
  }
  function clear(set) { for (const release of [...set].reverse()) release(); }
  function listen(set, target, type, callback, options) {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const release = own(set, () => target.removeEventListener(type, callback, capture));
    try { target.addEventListener(type, callback, options); } catch (error) { release(); throw error; }
    if (state === 'destroyed' || destroying) try { target.removeEventListener(type, callback, capture); } catch (_) { cleanupFailed = true; fail('cleanup'); }
    return release;
  }
  function stop() {
    if (state === 'destroyed' || state === 'stopping' || state === 'stopped' || state === 'idle') return;
    generation++; state = 'stopping'; clear(resources); clear(timers); clear(frames);
    try { stopOwners(); } catch (_) { cleanupFailed = true; fail('stop-owners'); }
    if (state === 'stopping') state = 'stopped';
    if (destroyRequested) { destroyRequested = false; destroy(); }
  }
  function flushNow() {
    if (state === 'destroyed' || destroying) return Promise.resolve(getState());
    invoke(drain, 'drain');
    return Promise.resolve(invoke(flush, 'flush')).catch(() => { fail('flush'); return getState(); });
  }
  function pause() { if (state === 'running' || state === 'starting') { void flushNow(); stop(); } }
  function mount() {
    if (state === 'destroyed' || destroying || mounting || cleanupFailed) return false;
    if (mounted) return true;
    mounting = true;
    try {
      const win = getWindow(), doc = getDocument();
      const control = fn => () => { if (state !== 'destroyed' && !destroying) invoke(fn, 'control'); };
      listen(controls, win, 'pagehide', control(() => { pageHidden = true; pause(); }));
      if (state === 'destroyed' || destroying) return false;
      listen(controls, win, 'pageshow', control(() => { pageHidden = false; start(); }));
      if (state === 'destroyed' || destroying) return false;
      listen(controls, doc, 'visibilitychange', control(() => { if (visible()) start(); else pause(); }));
      if (state === 'destroyed' || destroying) return false;
      mounted = true; return true;
    } catch (_) { fail('controls'); clear(controls); return false; }
    finally { mounting = false; if (state === 'destroyed' || destroying) clear(controls); }
  }
  function scopeFor(token) {
    const active = () => current(token) && allowed() && current(token);
    const guard = fn => function (...args) {
      if (!active()) return;
      try { return fn.apply(this, args); } catch (_) { fail('callback'); }
    };
    function retain(dispose) {
      if (typeof dispose !== 'function') throw new TypeError('Invalid telemetry disposer');
      const release = own(resources, dispose);
      if (!current(token)) release();
      else if (resources.size > 256) { release(); throw new Error('Telemetry resource budget exceeded'); }
      return release;
    }
    function later(callback, delay, frame) {
      if (!active()) return () => {};
      if (typeof callback !== 'function' || (!frame && (!Number.isInteger(delay) || delay < 0 || delay > 300000))) throw new TypeError('Invalid telemetry callback');
      const set = frame ? frames : timers;
      if (set.size >= (frame ? 64 : 1000)) { fail('schedule-budget'); return () => {}; }
      let id = null, scheduling = true, synchronous = false;
      const port = frame ? requestFrame : schedule, undo = frame ? cancelFrame : cancel;
      const release = own(set, () => { if (id !== null) undo(id); });
      const deliver = (...args) => {
        if (scheduling) { synchronous = true; return; }
        // Completion releases bookkeeping, without cancelling an already fired handle.
        id = null; release(); guard(callback)(...args);
      };
      try { id = port(deliver, delay); } catch (error) { release(); throw error; }
      scheduling = false;
      if (synchronous) { release(); throw new Error('Telemetry scheduler must be asynchronous'); }
      if (!current(token) || !set.has(release)) { const lateId = id; id = null; if (lateId !== null) try { undo(lateId); } catch (_) { cleanupFailed = true; fail('cleanup'); } }
      return release;
    }
    function observe(Constructor, callback, options) {
      let release;
      try {
        if (!active() || typeof Constructor !== 'function') return false;
        const observer = new Constructor(guard(callback));
        release = retain(() => observer.disconnect());
        if (!current(token)) return false;
        observer.observe(options);
        if (!current(token)) { try { observer.disconnect(); } catch (_) { cleanupFailed = true; fail('cleanup'); } return false; }
        return true;
      } catch (_) { release?.(); fail('observer'); return false; }
    }
    return Object.freeze({ active, guard, own: retain, timeout: (fn, delay) => later(fn, delay, false),
      frame: fn => later(fn, 0, true), observe,
      listen(target, type, fn, options) {
        if (!active()) return () => {};
        const callback = guard(fn);
        const release = retain(() => target.removeEventListener(type, callback, typeof options === 'boolean' ? options : Boolean(options?.capture)));
        if (!current(token)) return release;
        try { target.addEventListener(type, callback, options); } catch (error) { release(); throw error; }
        if (!current(token)) { release(); try { target.removeEventListener(type, callback, typeof options === 'boolean' ? options : Boolean(options?.capture)); } catch (_) { cleanupFailed = true; fail('cleanup'); } }
        return release;
      } });
  }
  function start() {
    if (destroying || state === 'destroyed' || state === 'stopping' || cleanupFailed || pageHidden || !allowed() || !visible()) return false;
    if (state === 'running') return true;
    if (state === 'starting' || !mount()) return false;
    const token = ++generation; state = 'starting'; const scope = scopeFor(token);
    function repeat(fn, period) {
      const again = () => { if (scope.active()) scope.timeout(() => {
        if (!scope.active()) return;
        Promise.resolve(invoke(fn, 'periodic')).catch(() => fail('periodic')).then(() => {
          if (scope.active()) try { again(); } catch (_) { fail('schedule'); stop(); }
        });
      }, period); };
      again();
    }
    try {
      install(scope);
      if (!current(token)) return false;
      startOwners();
      if (!current(token)) return false;
      repeat(drain, aggregateMs); repeat(flush, flushMs);
      if (!current(token)) return false;
      state = 'running'; return true;
    } catch (_) { fail('start'); if (current(token)) stop(); return false; }
  }
  function getState() { return Object.freeze({ state, generation, mounted, activeResources: resources.size,
    controlListeners: controls.size, activeTimers: timers.size, activeFrames: frames.size, cleanupFailed, failures, lastFailure }); }
  function destroy() {
    if (report || destroying) return report;
    if (state === 'stopping') { destroyRequested = true; return null; }
    destroying = true; stop(); generation++; state = 'destroyed'; clear(controls); mounted = false;
    let handoff;
    try { handoff = destroyOwners(); } catch (_) { cleanupFailed = true; fail('destroy-owners'); }
    report = Object.freeze({ ...getState(), handoff: handoff ?? null }); return report;
  }
  return Object.freeze({ mount, start, stop, flushNow, destroy, getState });
}

import { redactTelemetryDetails, redactTelemetryLabel, redactTelemetryIdentity } from './telemetry-redaction.js';

/** Own bounded aggregation, queued entries, acknowledgements and retry timers. No file I/O. */
export function createAggregationBuffer({ now, createEntry, writeBatch, schedule, cancel, batchPrefix,
  enabled = false, maxEntries = 1000, maxGroups = 200, batchSize = 250, windowMs = 1500,
  flushThreshold = 50, retryBaseMs = 250, retryMaxMs = 30000, onError = () => {} } = {}) {
  for (const [name, value] of Object.entries({ now, createEntry, writeBatch, schedule, cancel, onError })) {
    if (typeof value !== 'function') throw new TypeError(`AggregationBuffer requires ${name}`);
  }
  if (redactTelemetryLabel(batchPrefix) === '[redacted]') throw new TypeError('AggregationBuffer requires a batchPrefix');
  for (const [name, value, maximum] of [['maxEntries', maxEntries, 1000], ['maxGroups', maxGroups, 200],
    ['batchSize', batchSize, 250], ['windowMs', windowMs, 60000], ['flushThreshold', flushThreshold, 1000],
    ['retryBaseMs', retryBaseMs, 30000], ['retryMaxMs', retryMaxMs, 30000]]) {
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new TypeError(`Invalid ${name}`);
  }
  batchSize = Math.min(batchSize, maxEntries);
  flushThreshold = Math.min(flushThreshold, maxEntries);
  if (retryBaseMs < 250 || retryMaxMs < retryBaseMs) throw new TypeError('Invalid retry interval');
  const queue = [], aggregates = new Map(), batches = new Map(), completed = new Map();
  let sequence = 0, inFlight = null, timer = null, failures = 0, nextAttemptAt = 0;
  let destroyed = false, draining = false, overflowEntries = 0, overflowSamples = 0, acknowledgedEntries = 0, lastError = '', logPath = '';
  let destroyReport = null;
  const pendingCount = () => queue.length + [...batches.values()].reduce((sum, b) => sum + b.entries.length, 0);
  const readyBatch = () => [...batches.values()].find(b => b.state === 'ready');
  const stats = () => Object.freeze({ queueLength: queue.length, aggregateCount: aggregates.size,
    retainedEntries: pendingCount(), unconfirmedEntries: [...batches.values()].filter(b => b.state === 'unconfirmed').reduce((s,b) => s+b.entries.length,0),
    inFlightEntries: [...batches.values()].filter(b => b.state === 'in-flight').reduce((s,b) => s+b.entries.length,0),
    overflowEntries, overflowSamples, acknowledgedEntries, failures, nextAttemptAt, retryScheduled: timer !== null, destroyed });
  function cancelRetry() { if (timer !== null) { cancel(timer); timer = null; } }
  function arm(delay) {
    if (destroyed || !enabled || timer !== null || !(readyBatch() || queue.length)) return;
    timer = schedule(() => { timer = null; if (!destroyed) void flush(); }, Math.max(0, delay));
  }
  function backoff() {
    failures = Math.min(failures + 1, 32);
    nextAttemptAt = now() + Math.min(retryMaxMs, retryBaseMs * 2 ** Math.min(failures - 1, 16));
  }
  function dropped(entry) {
    overflowEntries = Math.min(Number.MAX_SAFE_INTEGER, overflowEntries + 1);
    const samples = Number(entry?.details?.samples);
    overflowSamples = Math.min(Number.MAX_SAFE_INTEGER, overflowSamples + (Number.isFinite(samples) && samples > 0 ? Math.ceil(samples) : 1));
  }
  function enqueue(entry) {
    if (destroyed || !entry) return false;
    const { operation, category, status, durationMs, details, timestampMs } = entry;
    const safe = createEntry(operation, { category, status, durationMs: durationMs ?? undefined, details });
    if (destroyed || !safe) return false;
    if (Number.isFinite(timestampMs)) safe.timestampMs = timestampMs;
    while (pendingCount() >= maxEntries && queue.length) dropped(queue.shift());
    if (pendingCount() >= maxEntries) { dropped(safe); return false; }
    queue.push(safe);
    if (!draining && enabled && queue.length >= flushThreshold) void flush();
    return true;
  }
  function emitMetric(metric) {
    const hasDuration = metric.durationCount > 0;
    const entry = createEntry(metric.operation, { category: metric.category, status: metric.status,
      durationMs: hasDuration ? metric.average : undefined,
      details: { ...metric.details, samples: metric.count,
        averageMs: hasDuration ? Number((metric.average).toFixed(3)) : null,
        minMs: hasDuration ? Number(metric.min.toFixed(3)) : null,
        maxMs: hasDuration ? Number(metric.max.toFixed(3)) : null,
        periodMs: Math.max(0,metric.lastTimestampMs - metric.firstTimestampMs) } });
    if (!entry) return false;
    const overflowBefore = overflowEntries;
    return enqueue(entry) || overflowEntries > overflowBefore;
  }
  function aggregate(operation, options = {}) {
    if (destroyed || typeof operation !== 'string' || !operation.trim()) return;
    const details = redactTelemetryDetails(options.details);
    if (destroyed) return;
    const category = redactTelemetryLabel(options.category || 'ui.operation'), status = redactTelemetryLabel(options.status || 'ok');
    const inputDuration = Number(options.durationMs);
    const duration = Number.isFinite(inputDuration) ? Math.max(0,inputDuration) : NaN;
    operation = redactTelemetryLabel(operation);
    const time = now();
    if (!Number.isFinite(time)) throw new TypeError('AggregationBuffer time must be finite');
    if (destroyed) return;
    const bucket = Math.floor(time / windowMs);
    const key = JSON.stringify([category, operation, status, bucket]);
    // Drain older windows first; every group is accounted for, even when capacity overflows.
    draining = true;
    try {
      for (const [oldKey, metric] of aggregates) if (metric.bucket !== bucket && emitMetric(metric)) aggregates.delete(oldKey);
      if (!aggregates.has(key) && aggregates.size >= maxGroups) {
        const [oldKey, metric] = aggregates.entries().next().value;
        if (emitMetric(metric)) aggregates.delete(oldKey);
        else { dropped({details:{samples:1}}); return; }
      }
      const metric = aggregates.get(key) || { operation, category, status, bucket, count:0, durationCount:0, average:0,
        min:Infinity, max:-Infinity, firstTimestampMs:time, lastTimestampMs:time, details:{} };
      metric.count++; metric.lastTimestampMs = time;
      if (Number.isFinite(duration)) { metric.durationCount++; metric.average += (duration - metric.average) / metric.durationCount; metric.min = Math.min(metric.min,duration); metric.max = Math.max(metric.max,duration); }
      metric.details = details; aggregates.set(key,metric);
    } finally { draining = false; }
    if (enabled && queue.length >= flushThreshold) void flush();
  }
  function drainAggregates(automatic = true) {
    if (destroyed) return;
    draining = true;
    try { for (const [key, metric] of aggregates) if (emitMetric(metric)) aggregates.delete(key); }
    finally { draining = false; }
    if (automatic && enabled && queue.length >= flushThreshold) void flush();
  }
  function normalizeAck(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    try { return { batchId:value.batchId, attempt:value.attempt, acceptedCount:value.acceptedCount, logPath:value.logPath }; }
    catch (_) { return null; }
  }
  function applyAck(batch, ack) {
    if (!ack || ack.batchId !== batch.id || ack.attempt !== batch.attempt || !Number.isInteger(ack.acceptedCount)
      || ack.acceptedCount < batch.offset || ack.acceptedCount > batch.offset + batch.entries.length) return false;
    const delta = ack.acceptedCount - batch.offset;
    batch.entries.splice(0,delta);
    acknowledgedEntries = Math.min(Number.MAX_SAFE_INTEGER,acknowledgedEntries + delta);
    batch.offset = ack.acceptedCount;
    if (typeof ack.logPath === 'string') logPath = ack.logPath;
    if (!batch.entries.length) {
      batches.delete(batch.id); completed.set(batch.id, {attempt:batch.attempt,acceptedCount:batch.offset});
      if (completed.size > 200) completed.delete(completed.keys().next().value);
      failures = 0; nextAttemptAt = 0; lastError = '';
    } else { batch.state = 'ready'; backoff(); }
    return true;
  }
  function resolveBatch(ack) {
    if (destroyed) return false;
    ack = normalizeAck(ack);
    if (!ack) return false;
    const done = completed.get(ack.batchId);
    if (done) return done.attempt === ack.attempt && done.acceptedCount === ack.acceptedCount;
    const batch = batches.get(ack.batchId);
    if (!batch || batch.state === 'in-flight' || !applyAck(batch, ack)) return false;
    arm(Math.max(0, nextAttemptAt - now())); return true;
  }
  function flush() {
    if (destroyed || !enabled) return Promise.resolve(stats());
    drainAggregates(false);
    if (inFlight) return inFlight;
    if (now() < nextAttemptAt) { arm(nextAttemptAt - now()); return Promise.resolve(stats()); }
    cancelRetry();
    let batch = readyBatch();
    if (!batch && queue.length) {
      batch = { id:`${batchPrefix}-batch-${++sequence}`, entries:queue.splice(0,batchSize), offset:0, attempt:0, state:'ready' };
      batches.set(batch.id,batch);
    }
    if (!batch) return Promise.resolve(stats());
    batch.state = 'in-flight'; batch.attempt++; batch.dispatched = false;
    const meta = Object.freeze({batchId:batch.id, offset:batch.offset, attempt:batch.attempt});
    // Always dispatch asynchronously, so a synchronous port rejection has the same ownership.
    inFlight = Promise.resolve().then(() => {
      if (destroyed) return null;
      batch.dispatched = true;
      return writeBatch(JSON.parse(JSON.stringify(batch.entries)),meta);
    })
      .then(ack => {
        if (destroyed) return;
        if (!applyAck(batch,normalizeAck(ack))) throw new Error('Invalid batch acknowledgement');
      }).catch(error => {
        if (destroyed) return;
        batch.state = 'unconfirmed'; backoff();
        let identity;
        try { identity = redactTelemetryIdentity(error?.message || error,240); } catch (_) { identity = 'invalid-error'; }
        if (identity !== lastError) { lastError = identity; try { onError('[redacted]'); } catch (_) {} }
      }).finally(() => {
        inFlight = null;
        if (!destroyed && enabled && (readyBatch() || queue.length >= flushThreshold)) arm(Math.max(0,nextAttemptAt-now()));
      }).then(() => stats());
    return inFlight;
  }
  function snapshot() {
    const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
    return freeze({ ...stats(), batchPrefix, pendingAggregates: JSON.parse(JSON.stringify([...aggregates.values()])), pending: JSON.parse(JSON.stringify([
      ...queue.map(entry => ({state:'queued',entry})),
      ...[...batches.values()].flatMap(b => b.entries.map((entry,index) => ({state:b.state,batchId:b.id,offset:b.offset+index,attempt:b.attempt,dispatched:Boolean(b.dispatched),entry})))
    ])) });
  }
  function destroy() {
    if (destroyReport) return destroyReport;
    drainAggregates(false); destroyed = true; enabled = false; cancelRetry();
    destroyReport = snapshot(); return destroyReport;
  }
  return Object.freeze({ enqueue, aggregate, drainAggregates, flush, resolveBatch, getStats:stats, snapshot,
    getLogPath:() => logPath, setEnabled(active) { if (destroyed) return; enabled = Boolean(active); if (!enabled) cancelRetry(); else if (queue.length >= flushThreshold || readyBatch()) void flush(); }, destroy });
}

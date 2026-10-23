/** Explicit recording boundary. The runtime owns the recorder and its lifetime. */
let connection = null;

export function connectTelemetryRecorder(recorder) {
  if (typeof recorder?.record !== 'function' || typeof recorder?.diagnostic !== 'function') {
    throw new TypeError('Telemetry connection requires record and diagnostic');
  }
  if (connection) throw new Error('Telemetry recorder is already connected');
  const owner = Object.freeze({ record: recorder.record, diagnostic: recorder.diagnostic });
  connection = owner;
  return () => { if (connection === owner) connection = null; };
}

export const telemetry = Object.freeze({
  record: (...args) => connection?.record(...args),
  diagnostic: (...args) => connection?.diagnostic(...args)
});

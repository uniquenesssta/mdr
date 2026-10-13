// Pure frontend minimization before diagnostic state, aggregation or log queue retention.
const MARKERS = new Set(['[redacted]', '[circular]', '[truncated]', '[unserializable]']);
const ENUMS = {
  contentType: new Set(['text/html', 'text/plain', 'text/markdown', 'application/json']),
  side: new Set(['editor', 'preview', '']), sourceSide: new Set(['editor', 'preview', '']),
  targetSide: new Set(['editor', 'preview', '']),
  mode: new Set(['source', 'hybrid', 'preview']), presentationMode: new Set(['source', 'hybrid', 'preview']),
  status: new Set(['ok', 'error', 'warning', 'cancelled', 'skipped', 'rendered', 'cached', 'failed']),
  origin: new Set(['user', 'programmatic', 'layout', 'compensation']),
  extension: new Set(['', 'md', 'markdown', 'txt', 'html', 'htm', 'doc', 'docx', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'])
};
const normalizeKey = key => key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
function privateField(key) {
  const name = normalizeKey(key);
  return ['body', 'content', 'html', 'markdown', 'text', 'password', 'passwd', 'passphrase', 'secret',
    'token', 'authorization', 'cookie', 'apikey', 'credential', 'credentials', 'privatekey', 'path', 'paths']
    .some(suffix => name.endsWith(suffix)) || ['file', 'files', 'filename', 'directory', 'dir', 'cwd', 'workingdirectory'].includes(name);
}

/** Retain code-shaped envelope identifiers, never prose, HTML, URLs or filesystem paths. */
export function redactTelemetryLabel(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/.test(value) ? value : '[redacted]';
}

/** Bounded opaque dedupe identity. This minimizes retained hints; it is not cryptographic anonymization. */
export function redactTelemetryIdentity(value, limit) {
  const maximum = Math.min(500, Math.max(1, Number(limit) || 500));
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
  let left = 2166136261, right = 5381;
  for (let i = 0; i < text.length; i++) {
    left = Math.imul(left ^ text.charCodeAt(i), 16777619);
    right = Math.imul(right, 33) ^ text.charCodeAt(i);
  }
  return `identity-${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

/** Redact recursively, preserving bounded numeric/boolean metrics and explicit safe enums. */
export function redactTelemetryDetails(details) {
  if (!details || typeof details !== 'object') return {};
  const ancestors = new WeakSet();
  let remaining = 512;
  const visit = (value, depth, key = '') => {
    if (--remaining < 0 || depth > 8) return '[truncated]';
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      // Decode structured/double-encoded diagnostics before filtering, without copying raw strings.
      if (value.length <= 16 * 1024) {
        try {
          const decoded = JSON.parse(value);
          if (decoded && (typeof decoded === 'object' || typeof decoded === 'string')) return visit(decoded, depth + 1);
        } catch (_) {}
      }
      return MARKERS.has(value) || (Object.hasOwn(ENUMS, key) && ENUMS[key].has(value)) ? value : '[redacted]';
    }
    if (typeof value !== 'object') return undefined;
    if (ancestors.has(value)) return '[circular]';
    ancestors.add(value);
    try {
      if (Array.isArray(value)) return value.slice(0, 20).map(item => visit(item, depth + 1) ?? null);
      const safe = Object.create(null);
      for (const name of Object.keys(value).slice(0, 64)) {
        if (remaining <= 0) break;
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) continue;
        if (privateField(name)) {
          if (/^has[A-Z]/.test(name)) {
            const flag = value[name];
            if (typeof flag === 'boolean') safe[name] = flag;
          }
          continue;
        }
        const nested = visit(value[name], depth + 1, name);
        if (nested !== undefined) safe[name] = nested;
      }
      return safe;
    } catch (_) {
      return '[unserializable]';
    } finally {
      ancestors.delete(value);
    }
  };
  return visit(details, 0);
}

/**
 * Atomic 8.12 Mermaid async render request state.
 * Allowed imports: none. Forbidden imports: DOM, CodeMirror, Preview, Session and application globals.
 * API: createMermaidRenderIdentity(), createMermaidRenderState(). State: source, monotonic request serial, current source/theme/position identity and terminal destroyed flag. Side effects: none.
 */
function normalizeSourceFrom(value) {
  return Math.max(0, Number(value) || 0);
}

export function createMermaidRenderIdentity(source, theme, sourceFrom) {
  return `${normalizeSourceFrom(sourceFrom)}\0${String(theme || 'default')}\0${String(source ?? '')}`;
}

export function createMermaidRenderState(options = {}) {
  const sourceFrom = normalizeSourceFrom(options.sourceFrom);
  let source = String(options.source ?? '');
  let serial = 0;
  let currentIdentity = '';
  let destroyed = false;

  const isCurrent = request => Boolean(request)
    && !destroyed
    && request.serial === serial
    && request.identity === currentIdentity;

  return Object.freeze({
    get sourceFrom() { return sourceFrom; },
    get source() { return source; },
    get destroyed() { return destroyed; },
    setSource(value) {
      if (destroyed) return false;
      source = String(value ?? '');
      return source;
    },
    begin(value = source, theme = 'default') {
      if (destroyed) return null;
      source = String(value ?? '');
      const normalizedTheme = String(theme || 'default');
      serial += 1;
      currentIdentity = createMermaidRenderIdentity(source, normalizedTheme, sourceFrom);
      return Object.freeze({
        serial,
        identity: currentIdentity,
        source,
        theme: normalizedTheme,
        sourceFrom,
        cacheKey: `hybrid:${sourceFrom}`
      });
    },
    isCurrent,
    commit(request, publish) {
      if (!isCurrent(request)) return false;
      if (typeof publish !== 'function') throw new TypeError('Mermaid publish callback is required');
      publish();
      return true;
    },
    invalidate() {
      if (destroyed) return false;
      serial += 1;
      currentIdentity = '';
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      serial += 1;
      currentIdentity = '';
    }
  });
}

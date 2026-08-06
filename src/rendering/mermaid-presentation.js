const MERMAID_CACHE_LIMIT = 32;
const mermaidRenderCache = new Map();
let renderSerial = 0;

function readCache(key) {
  if (!key) return null;
  const value = mermaidRenderCache.get(key);
  if (!value) return null;
  mermaidRenderCache.delete(key);
  mermaidRenderCache.set(key, value);
  return value;
}

function writeCache(key, value) {
  if (!key || !value?.svg) return;
  mermaidRenderCache.delete(key);
  mermaidRenderCache.set(key, value);
  while (mermaidRenderCache.size > MERMAID_CACHE_LIMIT) {
    const oldestKey = mermaidRenderCache.keys().next().value;
    if (oldestKey === undefined) break;
    mermaidRenderCache.delete(oldestKey);
  }
}

export function getMermaidTheme(root = globalThis.document?.body) {
  return root?.getAttribute?.('data-theme') === 'dark' ? 'dark' : 'default';
}

export async function loadMermaidRenderer() {
  const existing = globalThis.window?.mermaid;
  if (existing) return existing;
  const loader = globalThis.window?.markdownEditorVendors?.loadMermaid;
  if (typeof loader !== 'function') throw new Error('Mermaid 渲染器不可用');
  const renderer = await loader();
  if (!renderer || typeof renderer.render !== 'function') throw new Error('Mermaid 渲染器不可用');
  return renderer;
}

export function normalizeMermaidSvg(container, options = {}) {
  const svg = container?.querySelector?.('svg');
  if (!(svg instanceof SVGElement)) throw new Error('Mermaid 未返回有效 SVG');
  svg.removeAttribute('height');
  svg.style.removeProperty('max-width');
  if (!svg.getAttribute('style')?.trim()) svg.removeAttribute('style');
  svg.classList.add('f-mermaid-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', options.ariaLabel || 'Mermaid 图表');
  return svg;
}

export function mountMermaidResult(container, result, options = {}) {
  if (!(container instanceof Element)) throw new TypeError('Mermaid render target must be an Element');
  const svg = typeof result === 'string' ? result : result?.svg;
  if (!svg) throw new Error('Mermaid returned an empty SVG');
  container.innerHTML = svg;
  normalizeMermaidSvg(container, options);
  if (typeof result?.bindFunctions === 'function') result.bindFunctions(container);
  container.dataset.mermaidRendered = 'true';
  container.dataset.mermaidTheme = String(options.theme || getMermaidTheme());
  return container;
}

export async function renderMermaidDiagram(container, source, options = {}) {
  if (!(container instanceof Element)) throw new TypeError('Mermaid render target must be an Element');
  const sourceText = String(source || '').trim();
  if (!sourceText) throw new Error('Mermaid 图表源码为空');
  const isCancelled = typeof options.isCancelled === 'function' ? options.isCancelled : () => false;
  const theme = options.theme || getMermaidTheme();
  const cacheKey = options.cacheKey ? `${theme}\0${options.cacheKey}\0${sourceText}` : '';
  const cached = readCache(cacheKey);
  if (cached) {
    if (isCancelled()) return { status: 'cancelled', theme, cached: true };
    mountMermaidResult(container, cached, { ...options, theme });
    return { status: 'cached', theme, cached: true, svg: cached.svg };
  }

  const renderer = await loadMermaidRenderer();
  if (isCancelled()) return { status: 'cancelled', theme, cached: false };
  if (globalThis.window.__markdownEditorMermaidTheme !== theme) {
    renderer.initialize({ startOnLoad: false, theme });
    globalThis.window.__markdownEditorMermaidTheme = theme;
  }

  const prefix = String(options.renderIdPrefix || 'markdown-editor-mermaid');
  const renderId = `${prefix}-${Date.now().toString(36)}-${++renderSerial}`;
  const result = await renderer.render(renderId, sourceText);
  if (isCancelled()) return { status: 'cancelled', theme, cached: false };
  mountMermaidResult(container, result, { ...options, theme });
  writeCache(cacheKey, { svg: typeof result === 'string' ? result : result?.svg, bindFunctions: result?.bindFunctions });
  return {
    status: 'rendered',
    theme,
    cached: false,
    svg: typeof result === 'string' ? result : result?.svg
  };
}

export function clearMermaidRenderCache() {
  mermaidRenderCache.clear();
}

export function createMermaidPresentationApi() {
  return Object.freeze({
    getTheme: getMermaidTheme,
    loadRenderer: loadMermaidRenderer,
    mountResult: mountMermaidResult,
    renderDiagram: renderMermaidDiagram,
    clearCache: clearMermaidRenderCache
  });
}

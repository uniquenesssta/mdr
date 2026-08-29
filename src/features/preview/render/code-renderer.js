/**
 * Responsibility: Enhance preview fenced-code DOM with shared syntax presentation and one delegated copy interaction.
 * Imports: None.
 * Exports: createCodeRenderer().
 * State/side effects: Owns one root mousedown/click listener pair and weak code-source presentation state only.
 * Lifecycle: Explicit start/destroy; destroy removes both listeners and invalidates retained weak state.
 */
function normalizeRoots(roots, fallbackRoot) {
  return Array.isArray(roots) && roots.length ? roots.filter(Boolean) : [fallbackRoot];
}

function collectCodeElements(roots) {
  const elements = [];
  const seen = new Set();
  const add = code => {
    if (!code || seen.has(code)) return;
    const pre = code.parentElement || code.closest?.('pre');
    if (!pre || pre.dataset?.previewCodeEnhanced === 'true') return;
    seen.add(code);
    elements.push(code);
  };
  for (const root of roots) {
    if (!root) continue;
    if (root.matches?.('pre > code')) add(root);
    if (root.matches?.('code') && root.parentElement?.matches?.('pre')) add(root);
    if (root.matches?.('pre')) add(root.querySelector?.(':scope > code'));
    root.querySelectorAll?.('pre > code').forEach(add);
  }
  return elements;
}

function classNames(element) {
  try {
    return Array.from(element?.classList || []);
  } catch {
    return String(element?.className || '').split(/\s+/).filter(Boolean);
  }
}

function languageFor(code, highlighter) {
  const languageClass = classNames(code).find(name => name.startsWith('language-')) || '';
  const language = languageClass.slice('language-'.length) || 'text';
  return {
    language,
    normalized: highlighter.getNormalizedCodeLanguage?.(language) || language.toLowerCase()
  };
}

function resolveCodeSourceStart(pre, documentModel) {
  const sourceStart = Number(pre?.dataset?.sourceStartIndex);
  const sourceEnd = Number(pre?.dataset?.sourceEndIndex);
  if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) return null;
  const source = documentModel?.sliceText?.(sourceStart, sourceEnd);
  if (typeof source !== 'string') return null;
  const firstLineEnd = source.indexOf('\n');
  if (firstLineEnd < 0) return null;
  const firstLine = source.slice(0, firstLineEnd);
  if (!/^\s*(`{3,}|~{3,})/.test(firstLine)) return null;
  return sourceStart + firstLineEnd + 1;
}

function createBrowserCopyText(documentRef) {
  return async value => {
    const text = String(value ?? '');
    const clipboard = documentRef.defaultView?.navigator?.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return;
    }
    const textarea = documentRef.createElement('textarea');
    textarea.value = text;
    textarea.className = 'c-clipboard-buffer';
    textarea.setAttribute?.('readonly', '');
    documentRef.body?.appendChild?.(textarea);
    textarea.select?.();
    const copied = documentRef.execCommand?.('copy');
    textarea.remove?.();
    if (!copied) throw new Error('无法复制代码');
  };
}

export function createCodeRenderer({
  root,
  documentRef,
  documentModel,
  presentation,
  copyText,
  notify = () => {}
} = {}) {
  const codePresentation = presentation?.code;
  if (!root || typeof root.addEventListener !== 'function' || typeof root.removeEventListener !== 'function') {
    throw new TypeError('Code Renderer requires an event-capable preview root.');
  }
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('Code Renderer requires documentRef.');
  }
  if (!codePresentation || typeof codePresentation.renderHighlightedCodeRows !== 'function') {
    throw new TypeError('Code Renderer requires presentation.code.renderHighlightedCodeRows.');
  }
  if (typeof notify !== 'function') throw new TypeError('Code Renderer notify must be a function.');
  const copy = typeof copyText === 'function' ? copyText : createBrowserCopyText(documentRef);
  let sourceByPre = new WeakMap();
  let started = false;
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Code Renderer is destroyed.');
  };
  const resolveButton = target => target?.closest?.('.preview-code-copy') || null;
  const inRoot = node => !root.contains || root.contains(node);

  const onMouseDown = event => {
    const button = resolveButton(event?.target);
    if (button && inRoot(button)) event.preventDefault?.();
  };
  const onClick = async event => {
    const button = resolveButton(event?.target);
    if (!button || !inRoot(button)) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    const pre = button.closest?.('pre') || button.parentElement;
    const source = sourceByPre.get(pre);
    if (typeof source !== 'string') return;
    try {
      await copy(source);
      notify('代码已复制');
    } catch (error) {
      notify(error?.message || '复制失败');
    }
  };

  return Object.freeze({
    start() {
      assertActive();
      if (started) return false;
      root.addEventListener('mousedown', onMouseDown);
      root.addEventListener('click', onClick);
      started = true;
      return true;
    },
    render(roots = null) {
      assertActive();
      if (!started) throw new Error('Code Renderer must be started before render().');
      let rendered = 0;
      for (const code of collectCodeElements(normalizeRoots(roots, root))) {
        const pre = code.parentElement || code.closest?.('pre');
        if (!pre) continue;
        const { language, normalized } = languageFor(code, codePresentation);
        if (normalized === 'mermaid') continue;
        const source = String(code.textContent || '');
        const result = codePresentation.renderHighlightedCodeRows(code, source, language, {
          variant: 'preview',
          includeSourceNewlines: true
        });
        if (!result) continue;

        const button = documentRef.createElement('button');
        button.type = 'button';
        button.className = 'preview-code-copy';
        button.setAttribute?.('aria-label', '复制代码');
        button.title = '复制代码';

        code.classList?.add?.('preview-code-body');
        pre.classList?.add?.('preview-code-widget');
        pre.dataset.previewCodeEnhanced = 'true';
        pre.dataset.codeLanguage = normalized || language || 'text';
        const codeSourceStart = resolveCodeSourceStart(pre, documentModel);
        if (Number.isFinite(codeSourceStart)) pre.dataset.codeSourceStartIndex = String(codeSourceStart);
        sourceByPre.set(pre, source);
        pre.insertBefore?.(button, code);
        rendered += 1;
      }
      return rendered;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (started) {
        root.removeEventListener('mousedown', onMouseDown);
        root.removeEventListener('click', onClick);
      }
      started = false;
      sourceByPre = new WeakMap();
    }
  });
}

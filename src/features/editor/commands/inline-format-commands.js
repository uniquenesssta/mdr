/**
 * Responsibility: Build basic inline Markdown/HTML marker and inline-color replacements from the neutral editor adapter.
 * Imports: None.
 * Exports: createInlineFormatCommands.
 * State/side effects: None beyond one neutral editor transaction per command; owns no UI or selection cache.
 * Lifecycle: Pure command factory; no independent resources.
 */
function selectionRange(editor, supplied = null) {
  const value = supplied || editor.getSelection();
  return { start: Math.max(0, Number(value.start) || 0), end: Math.max(0, Number(value.end) || 0) };
}

function wrapSelection(editor, before, after, supplied = null) {
  const { start, end } = selectionRange(editor, supplied);
  const selected = editor.sliceText(start, end);
  return editor.replaceRange(before + selected + after, start, end, 'select');
}

function parseStyles(styleText) {
  const styles = {};
  String(styleText || '').split(';').forEach(declaration => {
    const separator = declaration.indexOf(':');
    if (separator < 0) return;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!value) return;
    if (property === 'color') styles.color = value;
    if (property === 'background' || property === 'background-color') styles['background-color'] = value;
  });
  return styles;
}

function findColorChain(editor, start, end) {
  const beforeStart = Math.max(0, start - 512);
  const before = editor.sliceText(beforeStart, start);
  const after = editor.sliceText(end, Math.min(editor.getTextLength(), end + 64));
  const chainMatch = before.match(/(?:<span\s+style="[^"]*">)+$/i);
  if (!chainMatch) return null;
  const openings = Array.from(chainMatch[0].matchAll(/<span\s+style="([^"]*)">/gi));
  if (!openings.length || !after.startsWith('</span>'.repeat(openings.length))) return null;
  const styles = {};
  openings.forEach(match => Object.assign(styles, parseStyles(match[1])));
  if (!styles.color && !styles['background-color']) return null;
  return { start: start - chainMatch[0].length, end: end + 7 * openings.length, styles };
}

function colorMarkup(styles, selected) {
  const declarations = [];
  if (styles.color) declarations.push(`color:${styles.color}`);
  if (styles['background-color']) declarations.push(`background-color:${styles['background-color']}`);
  if (!declarations.length) return { opening: '', value: selected };
  const opening = `<span style="${declarations.join(';')}">`;
  return { opening, value: `${opening}${selected}</span>` };
}

export function createInlineFormatCommands(editor) {
  return Object.freeze({
    bold: options => wrapSelection(editor, '**', '**', options?.selection),
    italic: options => wrapSelection(editor, '*', '*', options?.selection),
    underline: options => wrapSelection(editor, '<u>', '</u>', options?.selection),
    strikethrough: options => wrapSelection(editor, '~~', '~~', options?.selection),
    subscript: options => wrapSelection(editor, '<sub>', '</sub>', options?.selection),
    superscript: options => wrapSelection(editor, '<sup>', '</sup>', options?.selection),
    setColor(kind, color, options = {}) {
      const property = kind === 'highlight' ? 'background-color' : kind === 'text' ? 'color' : '';
      if (!property) throw new TypeError('Inline color kind must be text or highlight.');
      const normalizedColor = String(color || '').trim();
      if (!normalizedColor || /["';<>]/.test(normalizedColor)) throw new TypeError('Inline color value is invalid.');
      const { start, end } = selectionRange(editor, options.selection);
      const selected = editor.sliceText(start, end);
      if (!selected.trim()) return Object.freeze({ applied: false, reason: 'empty-selection' });
      if (/\n\s*\n/.test(selected)) return Object.freeze({ applied: false, reason: 'cross-paragraph' });
      const chain = findColorChain(editor, start, end);
      const styles = { ...(chain?.styles || {}), [property]: normalizedColor };
      const markup = colorMarkup(styles, selected);
      const from = chain?.start ?? start;
      const to = chain?.end ?? end;
      const innerStart = from + markup.opening.length;
      if (typeof editor.applyTransaction === 'function') {
        editor.applyTransaction({
          changes: { from, to, insert: markup.value },
          selection: options.collapse ? { anchor: innerStart + selected.length } : { anchor: innerStart, head: innerStart + selected.length }
        });
      } else {
        editor.replaceRange(markup.value, from, to, options.collapse ? 'end' : 'select');
      }
      return Object.freeze({ applied: true, color: normalizedColor, kind, selection: Object.freeze({ start: innerStart, end: innerStart + selected.length }) });
    },
    clearColor(kind, options = {}) {
      const property = kind === 'highlight' ? 'background-color' : kind === 'text' ? 'color' : '';
      if (!property) throw new TypeError('Inline color kind must be text or highlight.');
      const { start, end } = selectionRange(editor, options.selection);
      const selected = editor.sliceText(start, end);
      if (!selected.trim()) return Object.freeze({ applied: false, reason: 'empty-selection' });
      const chain = findColorChain(editor, start, end);
      if (!chain?.styles?.[property]) return Object.freeze({ applied: false, reason: 'not-applied' });
      const styles = { ...chain.styles };
      delete styles[property];
      const markup = colorMarkup(styles, selected);
      const innerStart = chain.start + markup.opening.length;
      if (typeof editor.applyTransaction === 'function') {
        editor.applyTransaction({
          changes: { from: chain.start, to: chain.end, insert: markup.value },
          selection: options.collapse ? { anchor: innerStart + selected.length } : { anchor: innerStart, head: innerStart + selected.length }
        });
      } else {
        editor.replaceRange(markup.value, chain.start, chain.end, options.collapse ? 'end' : 'select');
      }
      return Object.freeze({ applied: true, cleared: true, kind, selection: Object.freeze({ start: innerStart, end: innerStart + selected.length }) });
    }
  });
}

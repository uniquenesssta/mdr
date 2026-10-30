import { createEventScope, createSafeElement } from '../../../ui/dom/index.js';

const ACTIONS = [['undo', '撤销', 'Ctrl+Z'], ['redo', '重做', 'Ctrl+Y'], ['cut', '剪切', 'Ctrl+X'],
  ['copy', '复制', 'Ctrl+C'], ['paste', '粘贴', 'Ctrl+V'], ['select-all', '全选', 'Ctrl+A'], ['find', '查找', 'Ctrl+F']];

/** Context-sensitive document operations; native page/browser commands never enter this view. */
export function createTextContextMenuView({ documentRef: doc, overlayRoot, editorCommands, settings, commitWidth, clipboard }) {
  const events = createEventScope();
  const menu = createSafeElement(doc, 'div', { id: 'text-context-menu', className: 'context-menu text-context-menu',
    attributes: { role: 'menu', 'aria-label': '文档操作', hidden: true } });
  const buttons = new Map();
  for (const [action, label, shortcut] of ACTIONS) {
    const b = createSafeElement(doc, 'button', { attributes: { type: 'button', role: 'menuitem' }, dataset: { textContextAction: action } });
    b.append(createSafeElement(doc, 'span', { text: label }), createSafeElement(doc, 'span', { text: shortcut, className: 'text-context-shortcut' }));
    menu.append(b); buttons.set(action, b);
  }
  const widthGroup = createSafeElement(doc, 'div', { className: 'text-context-width', attributes: { role: 'group', 'aria-label': '正文宽度' } });
  widthGroup.append(createSafeElement(doc, 'span', { text: '正文宽度' }));
  const choices = createSafeElement(doc, 'div', { className: 'text-context-width-choices' });
  for (const [value, label] of [['third', '1/3 屏'], ['half', '1/2 屏'], ['full', '满屏']]) choices.append(createSafeElement(doc, 'button', {
    text: label, attributes: { type: 'button', role: 'menuitemradio', 'aria-checked': 'false' }, dataset: { readingWidth: value }
  }));
  widthGroup.append(choices); menu.append(widthGroup); overlayRoot.append(menu);
  let context = null, destroyed = false, selectionFrame = 0;
  const close = () => { menu.hidden = true; menu.classList.remove('show'); };
  const notifyError = error => {
    if (!destroyed && editorCommands.has('notify')) editorCommands.invoke('notify', `操作未完成：${error.message}`);
  };
  function open(event) {
    const target = event.target;
    if (menu.contains(target)) return;
    const control = target?.closest?.('input:not([type]),input:is([type=text],[type=search],[type=url],[type=tel],[type=password]),textarea');
    const inEditor = Boolean(target?.closest?.('#editor'));
    const preview = target?.closest?.('#preview');
    if (!control && !inEditor && !preview) { close(); return; }
    const kind = control ? 'control' : preview ? 'preview' : 'editor';
    const editable = kind === 'control' ? !control.readOnly && !control.disabled : kind === 'editor' && !doc.body.classList.contains('preview-only-mode');
    const intent = kind === 'editor' ? editorCommands.invoke('captureTextContext') : null;
    const selection = doc.defaultView.getSelection();
    const range = kind === 'preview' && selection?.rangeCount && preview.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
    const selected = control ? control.value.slice(control.selectionStart || 0, control.selectionEnd || 0) : range?.toString() || '';
    context = { kind, control, preview, editable, intent, range, selected, returnFocus: doc.activeElement,
      start: control?.selectionStart, end: control?.selectionEnd, original: control?.value };
    // WebView2 may finish CodeMirror's right-click caret placement after contextmenu.
    // Capture that settled target before a menu action, without moving the selection ourselves.
    if (selectionFrame) doc.defaultView.cancelAnimationFrame(selectionFrame);
    const opened = context;
    selectionFrame = kind === 'editor' ? doc.defaultView.requestAnimationFrame(() => {
      selectionFrame = 0;
      if (destroyed || menu.hidden || context !== opened) return;
      opened.intent = editorCommands.invoke('captureTextContext');
      for (const action of ['copy', 'cut']) buttons.get(action).disabled = opened.intent.selection.start === opened.intent.selection.end;
    }) : 0;
    if (editorCommands.has('closeAppMenus')) editorCommands.invoke('closeAppMenus');
    for (const [action, button] of buttons) {
      button.hidden = ['undo', 'redo', 'cut', 'paste'].includes(action) ? !editable : action === 'find' && kind === 'control';
      button.disabled = ['copy', 'cut'].includes(action) && !(intent ? intent.selection.end > intent.selection.start : selected.length);
    }
    widthGroup.hidden = kind !== 'preview' || !doc.body.classList.contains('preview-only-mode');
    for (const b of choices.children) b.setAttribute('aria-checked', String(b.dataset.readingWidth === settings.get('readingWidth')));
    menu.dataset.context = kind; menu.hidden = false; menu.classList.add('show');
    const rect = menu.getBoundingClientRect();
    const parentRect = target.getBoundingClientRect();
    const x = event.clientX || parentRect.left, y = event.clientY || parentRect.top;
    menu.style.left = Math.max(8, Math.min(x, doc.defaultView.innerWidth - rect.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, doc.defaultView.innerHeight - rect.height - 8)) + 'px';
  }
  async function run(action, current) {
    if (action === 'find') return editorCommands.invoke('openFind', false);
    if (current.kind === 'editor') return editorCommands.invoke('runTextContextAction', action, current.intent);
    if (current.kind === 'preview') {
      if (action === 'copy') return clipboard.writeText(current.selected);
      if (action === 'select-all') {
        const selection = doc.defaultView.getSelection(), range = doc.createRange();
        range.selectNodeContents(current.preview); selection.removeAllRanges(); selection.addRange(range);
      }
      return;
    }
    const input = current.control;
    const valid = () => !destroyed && input.isConnected && input.value === current.original;
    if (action === 'copy' || action === 'cut') {
      await clipboard.writeText(current.selected);
      if (action === 'copy' || !current.editable || !valid()) return;
    }
    const text = action === 'paste' ? await clipboard.readText() : '';
    if (!valid()) return;
    if (action === 'paste' && !text.length) return;
    input.focus();
    if (action === 'select-all') { input.select(); return; }
    if (!current.editable) return;
    input.setSelectionRange(current.start, current.end);
    if (action === 'undo' || action === 'redo') { doc.execCommand(action); return; }
    if (['paste', 'cut'].includes(action)) {
      if (!doc.execCommand('insertText', false, text)) {
        input.setRangeText(text, current.start, current.end, 'end');
        input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
      }
    }
  }
  events.listen(doc, 'contextmenu', open);
  events.listen(menu, 'pointerdown', event => event.preventDefault());
  events.listen(menu, 'click', event => {
    const width = event.target.closest('[data-reading-width]');
    const action = event.target.closest('[data-text-context-action]');
    const current = context;
    if (!current) return;
    if (width) { close(); try { commitWidth(width.dataset.readingWidth); } catch (error) { notifyError(error); } }
    else if (action && !action.disabled) { close(); void run(action.dataset.textContextAction, current).catch(notifyError); }
  });
  events.listen(doc, 'pointerdown', event => { if (!menu.contains(event.target)) close(); }, true);
  events.listen(doc, 'keydown', event => {
    if (menu.hidden) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      close();
      context?.returnFocus?.focus?.({ preventScroll: true });
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const available = [...menu.querySelectorAll('button')].filter(b => !b.hidden && !b.disabled && b.getBoundingClientRect().width > 0);
      const index = available.indexOf(doc.activeElement), step = event.key === 'ArrowUp' ? -1 : 1;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : (index + step + available.length) % available.length;
      available[next]?.focus();
    }
  });
  events.listen(doc.defaultView, 'resize', close);
  events.listen(doc, 'scroll', close, true);
  return Object.freeze({ destroy() {
    destroyed = true;
    if (selectionFrame) doc.defaultView.cancelAnimationFrame(selectionFrame);
    events.destroy(); menu.remove(); context = null;
  } });
}

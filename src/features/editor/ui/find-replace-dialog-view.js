/**
 * Responsibility: Own Find/Replace dialog presentation and send search/replace commands while reflecting matches through Selection/Focus services.
 * Imports: Shared DOM event scope only.
 * Exports: createFindReplaceDialogView.
 * State/side effects: Owns dialog listeners/status text only; search cursor stays in the command layer.
 * Lifecycle: Explicit View with idempotent destroy(); closes the modal and removes listeners.
 */
import { createEventScope } from '../../../ui/dom/index.js';
import { PopoverShell } from '../../../ui/components/popover-shell.js';
import { createSafeElement } from '../../../ui/dom/index.js';
import { createIconView } from '../../../ui/components/icon-view.js';


export function createFindReplaceDialogView({ root, commands, selection, focus, isReadOnly = () => false, getSearchOptions = () => ({}), onMatch = () => {}, labels = {} } = {}) {
  if (!root?.ownerDocument) throw new TypeError('Find/Replace Dialog View requires a modal root.');
  if (!commands || typeof commands.findNext !== 'function' || typeof commands.replaceOne !== 'function' || typeof commands.replaceAll !== 'function') {
    throw new TypeError('Find/Replace Dialog View requires Find/Replace commands.');
  }
  const events = createEventScope();
  const panel = root.firstElementChild;
  root.className = 'c-popover writing-find-panel';
  panel.className = 'writing-find-content';
  panel.setAttribute('role', 'search');
  panel.setAttribute('aria-label', '查找与替换');
  const shell = new PopoverShell(root, { anchor: root.ownerDocument.querySelector('.writing-actions [data-editor-action="open-find"]'), alignToViewport: true });
  try {
  const findInput = root.querySelector('#find-input');
  const replaceInput = root.querySelector('#replace-input');
  const status = root.querySelector('#find-status');
  const doc = root.ownerDocument;
  const row = className => createSafeElement(doc, 'div', { className });
  const findRow = row('writing-find-row'), replaceRow = row('writing-find-row'), optionsRow = row('writing-find-options');
  const navigation = row('writing-find-navigation');
  const previous = createSafeElement(doc, 'button', { attributes: { type: 'button', 'data-find-action': 'previous', 'aria-label': '上一个匹配' } });
  previous.append(createIconView(doc, 'icon-chevron-left'));
  const next = root.querySelector('[data-find-action="next"]');
  next.removeAttribute('data-i18n'); next.textContent = ''; next.setAttribute('aria-label', '下一个匹配'); next.append(createIconView(doc, 'icon-chevron-right'));
  const closeButton = root.querySelector('[data-find-action="close"]'); closeButton.setAttribute('aria-label', '关闭查找');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  navigation.append(status, previous, next, closeButton);
  findInput.setAttribute('aria-label', '查找'); replaceInput.setAttribute('aria-label', '替换为');
  findRow.append(findInput, navigation);
  const replaceActions = row('writing-find-navigation writing-find-replacements');
  replaceActions.append(root.querySelector('[data-find-action="replace-one"]'), root.querySelector('[data-find-action="replace-all"]'));
  replaceRow.append(replaceInput, replaceActions);
  const filters = {};
  const errorStatus = createSafeElement(doc, 'span', { className: 'writing-find-error', attributes: { role: 'status', 'aria-live': 'polite' } });
  for (const [key, label] of [['caseSensitive', '区分大小写'], ['wholeWord', '全词匹配'], ['regularExpression', '正则表达式']]) {
    const button = createSafeElement(doc, 'button', { text: label, attributes: { type: 'button', 'aria-pressed': 'false' } });
    filters[key] = button;
    events.listen(button, 'click', () => { button.setAttribute('aria-pressed', button.getAttribute('aria-pressed') !== 'true' ? 'true' : 'false'); void findNext(); });
    optionsRow.append(button);
  }
  optionsRow.append(errorStatus);
  panel.replaceChildren(findRow, replaceRow, optionsRow);
  let destroyed = false;
  let requestGeneration = 0;
  const replacementButtons = [...replaceActions.querySelectorAll('button')];
  const setAvailable = available => {
    for (const button of replacementButtons) button.disabled = !available || isReadOnly();
    previous.disabled = next.disabled = !available;
  };

  const setStatus = value => {
    const message = String(value || '');
    const counter = /^\d+\s*\/\s*\d+$/.test(message);
    status.textContent = counter ? message : '0 / 0';
    status.setAttribute('aria-label', message || '尚未查找');
    errorStatus.textContent = counter ? '' : message;
    errorStatus.classList.toggle('is-error', findInput.getAttribute('aria-invalid') === 'true');
  };
  const showMatch = match => {
    if (match === undefined) return false;
    if (!match) { setAvailable(false); setStatus(labels.noMatch || '未找到匹配项'); return false; }
    setAvailable(true);
    selection?.restore?.({ anchor: match.from, head: match.to, start: match.from, end: match.to }, { scrollIntoView: true });
    onMatch(match);
    setStatus(match.total ? `${match.index} / ${match.total}` : (labels.found || '已找到匹配项'));
    return true;
  };
  const searchOptions = () => ({ ...getSearchOptions({ setStatus }), ...Object.fromEntries(Object.entries(filters).map(([key, button]) => [key, button.getAttribute('aria-pressed') === 'true'])) });
  const findNext = async (direction = 'forward') => {
    const generation = ++requestGeneration;
    const query = String(findInput?.value || '');
    setAvailable(false);
    findInput.setAttribute('aria-invalid', 'false');
    if (!query) { setStatus(''); return null; }
    try {
      const match = await commands.findNext(query, { ...searchOptions(), direction });
      if (destroyed || generation !== requestGeneration) return undefined;
      showMatch(match);
      return match;
    } catch (error) {
      if (destroyed || generation !== requestGeneration) return undefined;
      findInput.setAttribute('aria-invalid', 'true');
      setAvailable(false);
      setStatus(error instanceof SyntaxError ? '表达式无效' : error?.message || String(error));
      return null;
    }
  };
  const replaceOne = async () => {
    if (isReadOnly()) return undefined;
    const query = String(findInput?.value || '');
    if (!query) { setStatus(''); return null; }
    try {
      const result = await commands.replaceOne(query, String(replaceInput?.value || ''), searchOptions());
      if (result === undefined) return result;
      showMatch(result?.match || null);
      return result;
    } catch (error) { setStatus(error?.message || String(error)); return null; }
  };
  const replaceAll = () => {
    if (isReadOnly()) return 0;
    const query = String(findInput?.value || '');
    if (!query) { setStatus(''); return 0; }
    let count;
    try { count = commands.replaceAll(query, String(replaceInput?.value || ''), searchOptions()); }
    catch (error) { setStatus(error?.message || String(error)); return 0; }
    setStatus(count ? (labels.replacedAll?.(count) || `已替换 ${count} 处`) : (labels.noMatch || '未找到匹配项'));
    setAvailable(false);
    return count;
  };
  const close = () => shell.close('feature-close');
  const open = (replace = false) => {
    replaceRow.hidden = isReadOnly();
    setAvailable(false);
    setStatus('');
    const snapshot = selection?.snapshot?.();
    const selected = snapshot ? selection?.selectedText?.(snapshot) : '';
    if (selected && findInput) findInput.value = selected;
    const request = { options: { initialFocus: findInput, onClose: reason => { setStatus(''); if (reason !== 'outside') focus?.focus?.({ preventScroll: true }); } } };
    shell.open(null, request.options);
    findInput?.select?.();
    return true;
  };

  events.listen(root, 'click', event => {
    const action = event.target?.closest?.('[data-find-action]')?.dataset?.findAction;
    if (!action) return;
    event.preventDefault?.();
    if (action === 'close') close();
    else if (action === 'next') void findNext();
    else if (action === 'previous') void findNext('backward');
    else if (action === 'replace-one') void replaceOne();
    else if (action === 'replace-all') replaceAll();
  });
  events.listen(findInput, 'keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault?.();
    void findNext(event.shiftKey ? 'backward' : 'forward');
  });
  events.listen(findInput, 'input', () => { void findNext(); });

  return Object.freeze({
    open,
    close,
    findNext,
    replaceOne,
    replaceAll,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      requestGeneration += 1;
      const errors = []; for (const action of [() => close(), () => events.destroy(), () => shell.destroy()]) try { action(); } catch (error) { errors.push(error); } if (errors.length) throw new AggregateError(errors, 'Editor dialog cleanup failed.');
    }
  });
  } catch (error) {
    const errors = [error];
    try { events.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    try { shell.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    if (errors.length > 1) throw new AggregateError(errors, 'Editor dialog construction failed.');
    throw error;
  }
}

/**
 * Responsibility: Own Find/Replace dialog presentation and send search/replace commands while reflecting matches through Selection/Focus services.
 * Imports: Shared DOM event scope only.
 * Exports: createFindReplaceDialogView.
 * State/side effects: Owns dialog listeners/status text only; search cursor stays in the command layer.
 * Lifecycle: Explicit View with idempotent destroy(); closes the modal and removes listeners.
 */
import { createEventScope } from '../../../ui/dom/index.js';
import { ModalShell } from '../../../ui/components/modal-shell.js';


export function createFindReplaceDialogView({ root, commands, selection, focus, getSearchOptions = () => ({}), onMatch = () => {}, labels = {} } = {}) {
  if (!root?.ownerDocument) throw new TypeError('Find/Replace Dialog View requires a modal root.');
  if (!commands || typeof commands.findNext !== 'function' || typeof commands.replaceOne !== 'function' || typeof commands.replaceAll !== 'function') {
    throw new TypeError('Find/Replace Dialog View requires Find/Replace commands.');
  }
  const events = createEventScope();
  const shell = new ModalShell(root, { panel: root.firstElementChild });
  try {
  const findInput = root.querySelector('#find-input');
  const replaceInput = root.querySelector('#replace-input');
  const replaceSection = root.querySelector('#replace-section');
  const status = root.querySelector('#find-status');
  let destroyed = false;

  const setStatus = value => { if (status) status.textContent = String(value || ''); };
  const showMatch = match => {
    if (match === undefined) return false;
    if (!match) { setStatus(labels.noMatch || '未找到匹配项'); return false; }
    selection?.restore?.({ anchor: match.from, head: match.to, start: match.from, end: match.to }, { scrollIntoView: true });
    focus?.focus?.({ preventScroll: true });
    onMatch(match);
    setStatus(labels.found || '已找到匹配项');
    return true;
  };
  const searchOptions = () => getSearchOptions({ setStatus });
  const findNext = async () => {
    const query = String(findInput?.value || '');
    if (!query) { setStatus(''); return null; }
    const match = await commands.findNext(query, searchOptions());
    showMatch(match);
    return match;
  };
  const replaceOne = async () => {
    const query = String(findInput?.value || '');
    if (!query) { setStatus(''); return null; }
    const result = await commands.replaceOne(query, String(replaceInput?.value || ''), searchOptions());
    if (result === undefined) return result;
    showMatch(result?.match || null);
    return result;
  };
  const replaceAll = () => {
    const query = String(findInput?.value || '');
    if (!query) { setStatus(''); return 0; }
    const count = commands.replaceAll(query, String(replaceInput?.value || ''));
    setStatus(count ? (labels.replacedAll?.(count) || `已替换 ${count} 处`) : (labels.noMatch || '未找到匹配项'));
    return count;
  };
  const close = () => shell.close('feature-close');
  const open = (replace = false) => {
    setStatus('');
    const snapshot = selection?.snapshot?.();
    const selected = snapshot ? selection?.selectedText?.(snapshot) : '';
    if (selected && findInput) findInput.value = selected;
    if (replaceSection) replaceSection.style.display = replace ? '' : 'none';
    const request = { options: { initialFocus: findInput, onClose: () => { setStatus(''); focus?.focus?.({ preventScroll: true }); } } };
    shell.open(null, { ariaLabel: '查找与替换', ...request.options });
    findInput?.select?.();
    return true;
  };

  events.listen(root, 'click', event => {
    const action = event.target?.closest?.('[data-find-action]')?.dataset?.findAction;
    if (!action) return;
    event.preventDefault?.();
    if (action === 'close') close();
    else if (action === 'next') void findNext();
    else if (action === 'replace-one') void replaceOne();
    else if (action === 'replace-all') replaceAll();
  });
  events.listen(findInput, 'keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault?.();
    void findNext();
  });

  return Object.freeze({
    open,
    close,
    findNext,
    replaceOne,
    replaceAll,
    destroy() {
      if (destroyed) return;
      destroyed = true;
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

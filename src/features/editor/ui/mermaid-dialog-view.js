/**
 * Responsibility: Own Mermaid dialog template/form state and send one Mermaid insertion command on confirmation.
 * Imports: Shared DOM event scope only.
 * Exports: createMermaidDialogView.
 * State/side effects: Owns modal form/listeners only; no editor text or renderer state.
 * Lifecycle: Explicit View with idempotent destroy(); closes modal and removes listeners.
 */
import { createEventScope } from '../../../ui/dom/index.js';
const OPEN_EVENT = 'markdown-editor:modal-shell-open';
const CLOSE_EVENT = 'markdown-editor:modal-shell-close';
const TEMPLATES = Object.freeze({
  mindmap: `mindmap\n  root((主题))\n    子主题 A\n      子节点 A1\n      子节点 A2\n    子主题 B\n      子节点 B1`,
  flowchart: `flowchart TD\n    A[开始] --> B{判断}\n    B -->|是| C[执行]\n    B -->|否| D[结束]`
});
function modal(root, type, detail) {
  const EventCtor = root.ownerDocument?.defaultView?.CustomEvent || globalThis.CustomEvent;
  root.dispatchEvent(new EventCtor(type, { detail }));
  if (detail.error) throw detail.error;
}
export function createMermaidDialogView({ root, insertMermaid, notify = () => {}, messages = {} } = {}) {
  if (!root?.ownerDocument) throw new TypeError('Mermaid Dialog View requires a modal root.');
  if (typeof insertMermaid !== 'function') throw new TypeError('Mermaid Dialog View requires insertMermaid command.');
  const events = createEventScope();
  const type = root.querySelector('#mermaid-type');
  const code = root.querySelector('#mermaid-code');
  const text = Object.freeze({
    empty: messages.empty || 'Mermaid 内容不能为空',
    inserted: messages.inserted || '已插入 Mermaid 图表'
  });
  let destroyed = false;
  const updateTemplate = () => { if (code) code.value = TEMPLATES[type?.value] || TEMPLATES.mindmap; };
  const close = () => modal(root, CLOSE_EVENT, { reason: 'feature-close' });
  const open = () => {
    if (type) type.value = 'mindmap';
    updateTemplate();
    modal(root, OPEN_EVENT, { options: { initialFocus: code } });
  };
  const confirm = () => {
    const source = String(code?.value || '').trim();
    if (!source) { notify(text.empty); return false; }
    insertMermaid(source);
    close();
    notify(text.inserted);
    return true;
  };
  events.listen(type, 'change', updateTemplate);
  events.listen(root, 'click', event => {
    const action = event.target?.closest?.('[data-mermaid-action]')?.dataset?.mermaidAction;
    if (!action) return;
    event.preventDefault?.();
    if (action === 'close' || action === 'cancel') close();
    if (action === 'confirm') confirm();
  });
  return Object.freeze({ open, close, updateTemplate, confirm, destroy() { if (destroyed) return; destroyed = true; try { close(); } catch (_) {} events.destroy(); } });
}

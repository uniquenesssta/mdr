/** Native-policy toggle presentation; pending/error state belongs to the injected application controller. */
import { createSafeElement, createEventScope } from '../../../ui/dom/index.js';
export function createLaunchPolicyFieldView(parent, onChange) {
  const doc = parent.ownerDocument, events = createEventScope();
  const root = createSafeElement(doc, 'label', { className: 'settings-check settings-card-check' });
  const input = createSafeElement(doc, 'input', { id: 'setting-single-instance', attributes: { type: 'checkbox' }, dataset: { nativeSetting: 'single-instance' } });
  const text = createSafeElement(doc, 'span');
  const hint = createSafeElement(doc, 'small', { text: '开启后，新打开的文档加入已有窗口的会话。' });
  text.append(createSafeElement(doc, 'b', { text: '限制多开' }), hint);
  root.append(input, text); parent.append(root);
  input.disabled = true; input.checked = true;
  events.listen(input, 'change', () => onChange(input.checked));
  return Object.freeze({
    render({ enabled, busy = false, supported = true, message = '' }) {
      input.checked = enabled; input.disabled = busy || !supported;
      input.setAttribute('aria-busy', String(busy));
      hint.textContent = message || (supported ? '开启后，新打开的文档加入已有窗口的会话。' : '仅桌面版支持。');
    },
    destroy() { events.destroy(); root.remove(); }
  });
}

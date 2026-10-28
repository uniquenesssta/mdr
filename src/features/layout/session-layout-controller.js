/**
 * Responsibility: Project active-document availability into workspace mode controls.
 * Imports: None; the document session and layout command remain caller-owned.
 * State/side effects: Owns availability projection and one session subscription.
 * Lifecycle: Explicit start and idempotent destroy restoring adopted controls.
 */
export function createSessionLayoutController({ session, controls, applyWritingMode }) {
  const adopted = [...controls].map(button => ({ button, disabled: button.disabled, title: button.title }));
  let unsubscribe = null;
  let destroyed = false;
  let previousAvailability;
  const render = () => {
    const available = Boolean(session.activeId);
    for (const { button, title } of adopted) {
      button.disabled = !available;
      button.title = available ? title : '新建或打开文档后可切换模式';
    }
    if (available !== previousAvailability) {
      const resetMode = !available || previousAvailability === false;
      previousAvailability = available;
      if (resetMode) applyWritingMode();
    }
  };
  return Object.freeze({
    get hasDocument() { return Boolean(session.activeId); },
    start() {
      if (destroyed) throw new Error('Session layout controller has been destroyed.');
      if (unsubscribe) return;
      unsubscribe = session.subscribe(render);
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      unsubscribe = null;
      for (const { button, disabled, title } of adopted) {
        button.disabled = disabled;
        button.title = title;
      }
    }
  });
}

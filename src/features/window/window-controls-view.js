/**
 * Responsibility: Project WindowState into desktop window-control DOM and own control click listeners.
 * Imports: None.
 * Exports: createWindowControlsView().
 * State/side effects: Holds DOM references only; reads WindowState and invokes injected commands.
 * Lifecycle: Explicit idempotent start/destroy; destroy removes listeners/subscription and resets owned DOM.
 */

function requireObject(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} is required.`);
  return value;
}
function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value;
}

export function createWindowControlsView({
  state,
  root,
  controls,
  minimizeButton,
  maximizeButton,
  closeButton,
  onMinimize,
  onToggleMaximize,
  onClose,
  reportError = (message, error) => console.error(message, error)
} = {}) {
  requireObject(state, 'Window Controls WindowState');
  requireFunction(state.subscribe, 'Window Controls WindowState.subscribe');
  requireObject(root, 'Window Controls root');
  requireObject(controls, 'Window Controls container');
  requireObject(minimizeButton, 'Window minimize button');
  requireObject(maximizeButton, 'Window maximize button');
  requireObject(closeButton, 'Window close button');
  requireFunction(onMinimize, 'Window Controls onMinimize');
  requireFunction(onToggleMaximize, 'Window Controls onToggleMaximize');
  requireFunction(onClose, 'Window Controls onClose');
  requireFunction(reportError, 'Window Controls reportError');

  let started = false;
  let destroyed = false;
  let unsubscribe = null;

  function assertActive() {
    if (destroyed) throw new Error('Window Controls View is destroyed.');
  }

  function project(snapshot) {
    const available = Boolean(snapshot?.available);
    const maximized = available && Boolean(snapshot?.maximized);
    controls.hidden = !available;
    root.classList.toggle('tauri-shell', available);
    root.classList.toggle('window-maximized', maximized);
    maximizeButton.dataset.maximized = maximized ? 'true' : 'false';
    maximizeButton.title = maximized ? '还原窗口' : '最大化';
    maximizeButton.setAttribute('aria-label', maximized ? '还原窗口' : '最大化');
    const use = maximizeButton.querySelector?.('use');
    use?.setAttribute('href', maximized ? '/assets/icons.svg#icon-restore' : '/assets/icons.svg#icon-maximize');
  }

  function invoke(label, action) {
    try {
      const result = action();
      if (result && typeof result.then === 'function') {
        void result.catch(error => reportError(label, error));
      }
    } catch (error) {
      reportError(label, error);
    }
  }

  const handleMinimize = () => invoke('Window minimize command failed.', onMinimize);
  const handleMaximize = () => invoke('Window maximize command failed.', onToggleMaximize);
  const handleClose = () => invoke('Window close command failed.', onClose);

  const view = Object.freeze({
    start() {
      assertActive();
      if (started) return false;
      started = true;
      project(state.snapshot);
      unsubscribe = state.subscribe(event => {
        if (destroyed || !started) return;
        project(event.snapshot);
      });
      requireFunction(unsubscribe, 'Window Controls state disposer');
      minimizeButton.addEventListener('click', handleMinimize);
      maximizeButton.addEventListener('click', handleMaximize);
      closeButton.addEventListener('click', handleClose);
      return true;
    },
    render() {
      assertActive();
      project(state.snapshot);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      started = false;
      minimizeButton.removeEventListener('click', handleMinimize);
      maximizeButton.removeEventListener('click', handleMaximize);
      closeButton.removeEventListener('click', handleClose);
      unsubscribe?.();
      unsubscribe = null;
      project({ available: false, maximized: false });
    }
  });
  return view;
}

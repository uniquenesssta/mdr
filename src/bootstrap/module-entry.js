import { mountCurrentShell } from '../ui/compatibility/mount-current-shell.js';

const CURRENT_SHELL_URL = '/compatibility/current-shell.html';
const I18N_SCRIPT_URL = '/i18n.js';
const starts = new WeakMap();

async function fetchCurrentShell(fetchImpl) {
  const response = await fetchImpl(CURRENT_SHELL_URL, { cache: 'no-store' });
  if (!response?.ok) {
    throw new Error(`Failed to load current shell: ${response?.status ?? 'unknown'}`);
  }
  return response.text();
}

function loadClassicScript(documentRef, src) {
  return new Promise((resolve, reject) => {
    const script = documentRef.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.stageBootstrap = 'classic-script';
    script.onload = () => resolve(script);
    script.onerror = () => {
      script.remove();
      reject(new Error(`Failed to load ${src}`));
    };
    documentRef.body.appendChild(script);
  });
}

export function startModuleEntry({
  documentRef = globalThis.document,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  importApplication = () => import('../main.js')
} = {}) {
  if (!documentRef) return Promise.reject(new Error('Document is unavailable.'));
  if (typeof fetchImpl !== 'function') return Promise.reject(new Error('Fetch is unavailable.'));

  const existing = starts.get(documentRef);
  if (existing) return existing;

  const transition = (async () => {
    const root = documentRef.getElementById('app-root');
    if (!root) throw new Error('Application root is missing.');

    const markup = await fetchCurrentShell(fetchImpl);
    const shellMount = mountCurrentShell(root, markup);
    let classicScript = null;
    try {
      classicScript = await loadClassicScript(documentRef, I18N_SCRIPT_URL);
      await importApplication();
    } catch (error) {
      classicScript?.remove();
      shellMount.destroy();
      starts.delete(documentRef);
      throw error;
    }

    let destroyed = false;
    return Object.freeze({
      destroy() {
        if (destroyed) return;
        destroyed = true;
        classicScript?.remove();
        shellMount.destroy();
        starts.delete(documentRef);
      }
    });
  })();

  starts.set(documentRef, transition);
  transition.catch(() => starts.delete(documentRef));
  return transition;
}

function reportStartupFailure(error, documentRef = globalThis.document) {
  console.error(error);
  if (!documentRef) return;
  documentRef.documentElement.classList.add('app-start-failed');
  const root = documentRef.getElementById('app-root');
  if (!root) return;
  root.hidden = false;
  root.textContent = error?.message || 'Application failed to start.';
}

if (typeof document !== 'undefined') {
  void startModuleEntry().catch(error => reportStartupFailure(error));
}

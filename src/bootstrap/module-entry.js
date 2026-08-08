import { createUI } from '../ui/create-ui.js';
import { createCompatibilityBusinessContentPort } from '../ui/compatibility/index.js';
import { localeRegistry, mountClassicLocalePort } from '../i18n/index.js';

const COMPATIBILITY_CONTENT_URL = '/compatibility/business-content.html';
const starts = new WeakMap();

async function fetchCompatibilityContent(fetchImpl) {
  const response = await fetchImpl(COMPATIBILITY_CONTENT_URL, { cache: 'no-store' });
  if (!response?.ok) {
    throw new Error(`Failed to load compatibility business content: ${response?.status ?? 'unknown'}`);
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

function destroyStartupResources({ classicScript, localePort, contentPort, ui }) {
  const errors = [];
  try { classicScript?.remove(); } catch (error) { errors.push(error); }
  try { localePort?.destroy(); } catch (error) { errors.push(error); }
  try { contentPort?.destroy(); } catch (error) { errors.push(error); }
  try { ui?.destroy(); } catch (error) { errors.push(error); }
  return errors;
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

    let ui = null;
    let contentPort = null;
    let localePort = null;
    let classicScript = null;
    try {
      ui = createUI(root);
      contentPort = createCompatibilityBusinessContentPort(root, ui);
      const markup = await fetchCompatibilityContent(fetchImpl);
      contentPort.mount(markup);
      const portsHost = documentRef.getElementById('compatibility-business-ports');
      localePort = mountClassicLocalePort(portsHost, localeRegistry);
      classicScript = await loadClassicScript(documentRef, '/help-content.js');
      await importApplication();
    } catch (error) {
      const cleanupErrors = destroyStartupResources({ classicScript, localePort, contentPort, ui });
      starts.delete(documentRef);
      if (!cleanupErrors.length) throw error;
      throw new AggregateError([error, ...cleanupErrors], 'Application startup failed and cleanup was incomplete.');
    }

    let destroyed = false;
    return Object.freeze({
      destroy() {
        if (destroyed) return;
        destroyed = true;
        const errors = destroyStartupResources({ classicScript, localePort, contentPort, ui });
        starts.delete(documentRef);
        if (errors.length) throw new AggregateError(errors, 'Application bootstrap cleanup failed.');
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

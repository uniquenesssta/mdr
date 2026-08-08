import { createUI } from '../ui/create-ui.js';
import { createCompatibilityBusinessContentPort } from '../ui/compatibility/index.js';
import { createHelpFeature, mountClassicHelpPort } from '../features/help/index.js';
import { createSettingsRepository, mountClassicSettingsRepositoryPort } from '../features/settings/index.js';
import { createI18nService, createTranslationBindings, localeRegistry, mountClassicI18nPort } from '../i18n/index.js';

const COMPATIBILITY_CONTENT_URL = '/compatibility/business-content.html';
const starts = new WeakMap();

async function fetchCompatibilityContent(fetchImpl) {
  const response = await fetchImpl(COMPATIBILITY_CONTENT_URL, { cache: 'no-store' });
  if (!response?.ok) {
    throw new Error(`Failed to load compatibility business content: ${response?.status ?? 'unknown'}`);
  }
  return response.text();
}

function destroyStartupResources({ helpPort, settingsPort, i18nPort, translationBindings, helpController, i18nService, contentPort, ui }) {
  const errors = [];
  try { helpPort?.destroy(); } catch (error) { errors.push(error); }
  try { settingsPort?.destroy(); } catch (error) { errors.push(error); }
  try { i18nPort?.destroy(); } catch (error) { errors.push(error); }
  try { translationBindings?.destroy(); } catch (error) { errors.push(error); }
  try { helpController?.destroy(); } catch (error) { errors.push(error); }
  try { i18nService?.destroy(); } catch (error) { errors.push(error); }
  try { contentPort?.destroy(); } catch (error) { errors.push(error); }
  try { ui?.destroy(); } catch (error) { errors.push(error); }
  return errors;
}

export function startModuleEntry({
  documentRef = globalThis.document,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = documentRef?.defaultView?.localStorage,
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
    let i18nService = null;
    let helpController = null;
    let translationBindings = null;
    let i18nPort = null;
    let settingsPort = null;
    let helpPort = null;
    try {
      ui = createUI(root);
      contentPort = createCompatibilityBusinessContentPort(root, ui);
      const markup = await fetchCompatibilityContent(fetchImpl);
      contentPort.mount(markup);
      const portsHost = documentRef.getElementById('compatibility-business-ports');
      i18nService = createI18nService(localeRegistry);
      helpController = createHelpFeature({
        menuRoot: ui.menu,
        overlayRoot: ui.overlay,
        i18n: i18nService,
        storage
      });
      translationBindings = createTranslationBindings(i18nService, ui, {
        documentElement: documentRef.documentElement
      });
      i18nPort = mountClassicI18nPort(portsHost, i18nService);
      const settingsRepository = createSettingsRepository({ storage });
      settingsPort = mountClassicSettingsRepositoryPort(portsHost, settingsRepository);
      helpPort = mountClassicHelpPort(portsHost, helpController);
      await importApplication();
    } catch (error) {
      const cleanupErrors = destroyStartupResources({ helpPort, settingsPort, i18nPort, translationBindings, helpController, i18nService, contentPort, ui });
      starts.delete(documentRef);
      if (!cleanupErrors.length) throw error;
      throw new AggregateError([error, ...cleanupErrors], 'Application startup failed and cleanup was incomplete.');
    }

    let destroyed = false;
    return Object.freeze({
      destroy() {
        if (destroyed) return;
        destroyed = true;
        const errors = destroyStartupResources({ helpPort, settingsPort, i18nPort, translationBindings, helpController, i18nService, contentPort, ui });
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

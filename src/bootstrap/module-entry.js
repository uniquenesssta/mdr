import { createUI } from '../ui/create-ui.js';
import { createWorkspaceContent } from './workspace-content.js';
import { createApplicationLifetime } from './application-lifetime.js';
import { createCommandRegistry } from '../shared/commands/command-registry.js';
import { createPlatform } from '../platform/index.js';
import { telemetry } from '../features/telemetry/index.js';
import { createDocumentSessionStore, createDocumentEmptyView, createRecentFilesReadSource, normalizeRecentFilePath, createWindowSessionStorage } from '../features/documents/index.js';
import { createHelpFeature } from '../features/help/index.js';
import { createExportDialogView } from '../features/export/index.js';
import { MENU_COMMAND_IDS, createMenuActions, createMenuCommandBindings, createMenuController,
  createMenuState, createMenuView, createSubmenuPositioner, createWorkspaceActionsView } from '../features/menu/index.js';
import { SETTINGS_CHANGED_EVENT, createSettingsApplyCoordinator, createSettingsFeature,
  createSettingsRepository, createSettingsStore } from '../features/settings/index.js';
import { createI18nService, createSettingsLocaleController, createTranslationBindings, localeRegistry } from '../i18n/index.js';
import { createThemeService, createThemeToggleController } from '../theme/index.js';
import { createBrowserInteractionPolicy, createTextContextMenuView } from '../features/menu/index.js';
import { createReadingWidthView } from '../features/preview/index.js';

const starts = new WeakMap();

/** Assemble explicit feature owners and release them in reverse dependency order. */
export function startModuleEntry({ documentRef = globalThis.document,
  storage = documentRef?.defaultView?.localStorage,
  importApplication = () => import('../main.js') } = {}) {
  if (!documentRef) return Promise.reject(new Error('Document is unavailable.'));
  const existing = starts.get(documentRef);
  if (existing) return existing;
  const transition = (async () => {
    const root = documentRef.getElementById('app-root');
    if (!root) throw new Error('Application root is missing.');
    const lifetime = createApplicationLifetime();
    const own = owner => { lifetime.own(() => owner.destroy()); return owner; };
    try {
      const ui = own(createUI(root));
      own(createWorkspaceContent(ui));
      const runtime = documentRef.defaultView;
      own(createBrowserInteractionPolicy(documentRef));
      const platform = createPlatform({ runtime, now: () => runtime.performance.now(),
        record: (operation, entry) => telemetry.record?.(operation, entry) });
      lifetime.own(() => { void platform.destroy().catch(error => console.error('Platform cleanup failed:', error)); });
      const launchContext = platform.capabilities.isDesktop ? await platform.launch.readContext() : { windowLabel: 'main' };
      const documentStorage = createWindowSessionStorage(storage, launchContext.windowLabel);
      const documentSessionStore = own(createDocumentSessionStore());
      const settingsRepository = createSettingsRepository({ storage });
      const settingsStore = own(createSettingsStore({ initialSnapshot: settingsRepository.load(),
        persist: changes => settingsRepository.save(changes) }));
      const i18nService = own(createI18nService(localeRegistry, { initialLocale: settingsStore.get('language') }));
      const helpController = own(createHelpFeature({ menuRoot: ui.menu, overlayRoot: ui.overlay,
        i18n: i18nService, storage }));
      own(createTranslationBindings(i18nService, ui, { documentElement: documentRef.documentElement }));
      const SettingsCustomEvent = runtime?.CustomEvent || globalThis.CustomEvent;
      if (typeof SettingsCustomEvent !== 'function') throw new Error('CustomEvent is unavailable for committed Settings commands.');
      const settingsCommands = own(createSettingsApplyCoordinator({ store: settingsStore,
        publish: event => documentRef.dispatchEvent(new SettingsCustomEvent(SETTINGS_CHANGED_EVENT, { detail: event })) }));
      own(createSettingsLocaleController({ i18n: i18nService, eventTarget: documentRef, eventType: SETTINGS_CHANGED_EVENT }));
      own(createThemeService({ root: documentRef.body, eventTarget: documentRef, initialSnapshot: settingsStore.snapshot }));
      own(createThemeToggleController({ trigger: documentRef.querySelector('[data-theme-toggle]'),
        readTheme: () => settingsStore.get('theme'), commitTheme: theme => settingsCommands.commit({ theme }).theme }));
      const settingsController = own(createSettingsFeature({ menuRoot: ui.menu, overlayRoot: ui.overlay,
        workspaceRoot: ui.workspace, documentRef, store: settingsStore, platform }));
      const editorCommands = own(createCommandRegistry('Editor commands'));
      const documentCommands = own(createCommandRegistry('Document commands'));
      const menuState = own(createMenuState());
      const menuCommandBindings = own(createMenuCommandBindings());
      lifetime.own(menuCommandBindings.register(MENU_COMMAND_IDS.HELP_OPEN, () => helpController.open()));
      lifetime.own(menuCommandBindings.register(MENU_COMMAND_IDS.SETTINGS_OPEN, payload => {
        const opened = settingsController.open(payload?.page);
        return opened;
      }));
      const closeMenus = () => editorCommands.has('closeAppMenus') ? editorCommands.invoke('closeAppMenus') : false;
      const menuController = own(createMenuController({ state: menuState, bindings: menuCommandBindings,
        view: createMenuView({ root: ui.menu }), closeMenus,
        reportError(message, error) { console.error(message, error); } }));
      const submenuPositioner = own(createSubmenuPositioner({ root: ui.menu, runtime }));
      const { startApplication } = await importApplication();
      if (typeof startApplication !== 'function') throw new Error('Application factory is unavailable.');
      const application = own(await startApplication({ platform, documentSessionStore, settingsStore, documentStorage,
        i18nService, helpController, menuController, submenuPositioner, editorCommands, documentCommands }));
      const menuActions = own(createMenuActions({ bindings: menuCommandBindings, editorCommands, documentCommands,
        exportCommands: application.exportCommands, recentFiles: application.recentFiles,
        normalizeRecentPath: normalizeRecentFilePath }));
      menuActions.start();
      own(createReadingWidthView({ root: ui.preview.querySelector('#preview'), settings: settingsStore,
        eventTarget: documentRef, eventType: SETTINGS_CHANGED_EVENT }));
      own(createTextContextMenuView({ documentRef, overlayRoot: ui.overlay, editorCommands, settings: settingsStore,
        commitWidth: value => settingsCommands.commit({ readingWidth: value }), clipboard: platform.clipboard }));
      own(createDocumentEmptyView({root:ui.workspace.querySelector('.l-split-pane'),session:documentSessionStore,onNew:()=>menuController.execute(MENU_COMMAND_IDS.DOCUMENT_NEW)}));
      own(createWorkspaceActionsView({ sidebar: ui.sidebar, overlayRoot: ui.overlay, commands: menuController,
        recentSource: createRecentFilesReadSource(application.recentFiles), desktopAvailable: platform.capabilities.desktop.fileSystem }));
      own(createExportDialogView({ overlayRoot: ui.overlay, trigger: ui.menu.querySelector('[data-workspace-export]'), commands: application.exportCommands, beforeOpen: closeMenus,
        readInput: () => ({ name: documentSessionStore.records.find(record => record.id === documentSessionStore.activeId)?.title || '未命名文档.md', directory: settingsStore.get('exportDirectory') }) }));
      submenuPositioner.start();
      menuController.start();
      application.activate();
      let destroyed = false;
      const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        starts.delete(documentRef);
        lifetime.destroy();
      };
      lifetime.listen(runtime, 'pagehide', destroy, { once: true });
      return Object.freeze({ destroy });
    } catch (error) {
      starts.delete(documentRef);
      try { lifetime.destroy(); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Application startup failed and cleanup was incomplete.');
      }
      throw error;
    }
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

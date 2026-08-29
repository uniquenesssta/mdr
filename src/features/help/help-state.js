/**
 * Responsibility: Own the normalized active Help page.
 * Imports: None.
 * Exports: stable page IDs, page normalization and createHelpState().
 * State/side effects: In-memory page state only. Lifecycle: explicit destroyable instance.
 */
export const HELP_PAGE_IDS = Object.freeze(['start', 'views', 'files', 'shortcuts', 'markdown', 'about']);

const HELP_PAGE_SET = new Set(HELP_PAGE_IDS);
const DEFAULT_HELP_PAGE = 'start';

export function normalizeHelpPage(value) {
  const page = String(value || '').trim();
  return HELP_PAGE_SET.has(page) ? page : DEFAULT_HELP_PAGE;
}

export function createHelpState({ initialPage = DEFAULT_HELP_PAGE } = {}) {
  let activePage = normalizeHelpPage(initialPage);
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Help state has been destroyed.');
  };

  return Object.freeze({
    get activePage() {
      assertActive();
      return activePage;
    },
    navigate(page) {
      assertActive();
      activePage = normalizeHelpPage(page);
      return activePage;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
    }
  });
}

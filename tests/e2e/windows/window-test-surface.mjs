const HELP_MODAL_SELECTOR = '#help-modal';
const HELP_CLOSE_SELECTOR = '#help-modal .modal-header button';
const APPLICATION_INIT_PROMISE = '__markdownEditorInitPromise';

async function waitForApplicationInitialization(browser) {
  await browser.waitUntil(
    () => browser.execute(key => {
      const pending = window[key];
      return Boolean(pending && typeof pending.then === 'function');
    }, APPLICATION_INIT_PROMISE),
    {
      timeout: 10_000,
      interval: 100,
      timeoutMsg: 'Application initialization promise did not become available before Windows automation.'
    }
  );

  await browser.execute(async key => {
    const pending = window[key];
    if (!pending || typeof pending.then !== 'function') {
      throw new Error('Application initialization promise disappeared before Windows automation.');
    }
    await pending;
  }, APPLICATION_INIT_PROMISE);
}

async function readHelpSurface(browser) {
  return browser.execute(selector => {
    const modal = document.querySelector(selector);
    if (!modal) return { exists: false, open: false, className: '' };
    return {
      exists: true,
      open: modal.classList.contains('show'),
      className: typeof modal.className === 'string' ? modal.className : ''
    };
  }, HELP_MODAL_SELECTOR);
}

export async function prepareWindowTestSurface(browser) {
  await waitForApplicationInitialization(browser);

  const before = await readHelpSurface(browser);
  if (!before.open) {
    return {
      initialHelpOpen: false,
      helpClosedThroughUi: false,
      before,
      after: before
    };
  }

  const closeButton = await browser.$(HELP_CLOSE_SELECTOR);
  if (!(await closeButton.isDisplayed())) {
    throw new Error('First-run help modal is open but its normal close button is not visible.');
  }

  await closeButton.click();
  await browser.waitUntil(
    async () => !(await readHelpSurface(browser)).open,
    {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: 'First-run help modal did not close through its normal UI path.'
    }
  );

  const after = await readHelpSurface(browser);
  if (after.open) {
    throw new Error('First-run help modal remained open after the close transition completed.');
  }

  return {
    initialHelpOpen: true,
    helpClosedThroughUi: true,
    before,
    after
  };
}

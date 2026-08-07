const HELP_MODAL_SELECTOR = '#help-modal';
const HELP_CLOSE_SELECTOR = '#help-modal .modal-header button';

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

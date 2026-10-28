/**
 * Responsibility: Own Help dialog DOM, page rendering and its ModalShell lifecycle.
 * Imports: Generic UI components/DOM primitives only; no application or storage state.
 * Exports: createHelpDialogView().
 * State/side effects: Owns overlay DOM and scoped close listeners. Lifecycle: explicit destroyable view.
 */
import { ModalShell } from '../../../ui/components/modal-shell.js';
import { createIconView } from '../../../ui/components/icon-view.js';
import { createEventScope, createSafeElement, requireElementRef } from '../../../ui/dom/index.js';

function appendTrustedHtml(documentRef, target, html) {
  const template = documentRef.createElement('template');
  template.innerHTML = String(html || '');
  target.append(template.content);
}

export function createHelpDialogView(overlayRoot, { onRequestClose } = {}) {
  requireElementRef(overlayRoot, 'help overlay root');
  if (typeof onRequestClose !== 'function') throw new TypeError('Help dialog requires a close-request handler.');
  const documentRef = overlayRoot.ownerDocument;
  const events = createEventScope();

  const root = createSafeElement(documentRef, 'div', { id: 'help-modal', className: 'modal-overlay' });
  const panel = createSafeElement(documentRef, 'div', {
    className: 'modal preferences-modal help-preferences-modal',
    attributes: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'help-title' }
  });
  const header = createSafeElement(documentRef, 'div', { className: 'modal-header preferences-header' });
  const headingGroup = createSafeElement(documentRef, 'div');
  const heading = createSafeElement(documentRef, 'h3', { id: 'help-title' });
  heading.append(
    createIconView(documentRef, 'icon-book', { className: 'icon icon-lg' }),
    documentRef.createTextNode(' '),
    createSafeElement(documentRef, 'span', { text: '使用帮助', attributes: { 'data-i18n': 'helpTitle' } })
  );
  const dialogSummary = createSafeElement(documentRef, 'p', { attributes: { hidden: true } });
  headingGroup.append(heading, dialogSummary);

  const closeButton = createSafeElement(documentRef, 'button', { attributes: { type: 'button' } });
  closeButton.append(createIconView(documentRef, 'icon-close'));
  header.append(headingGroup, closeButton);

  const layout = createSafeElement(documentRef, 'div', { className: 'preferences-layout' });
  const navigationRoot = createSafeElement(documentRef, 'nav', { className: 'preferences-nav' });
  const contentRoot = createSafeElement(documentRef, 'div', { id: 'help-body', className: 'preferences-content help-content' });
  layout.append(navigationRoot, contentRoot);

  panel.append(header, layout);
  root.append(panel);

  let modal = null;
  try {
    modal = new ModalShell(root, { panel });
    overlayRoot.append(root);
    events.listen(closeButton, 'click', () => onRequestClose('feature-close'));
  } catch (error) {
    const errors = [error];
    try { events.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    try { modal?.destroy(); } catch (cleanupError) { errors.push(cleanupError); }
    try { root.remove(); } catch (cleanupError) { errors.push(cleanupError); }
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Failed to construct Help dialog view cleanly.');
  }
  let destroyed = false;
  let helpDocument = null;

  const assertActive = () => {
    if (destroyed) throw new Error('Help dialog view has been destroyed.');
  };

  return Object.freeze({
    root,
    navigationRoot,
    renderDocument(document) {
      assertActive();
      helpDocument = document;
      dialogSummary.textContent = document.dialogSummary;
      closeButton.setAttribute('aria-label', document.closeLabel);
      navigationRoot.setAttribute('aria-label', document.navigationLabel);
    },
    renderPage(page) {
      assertActive();
      panel.dataset.page = page.id;
      const section = createSafeElement(documentRef, 'section', {
        className: 'preferences-page active',
        attributes: {
          'data-help-page-panel': page.id,
          'aria-labelledby': `help-${page.id}-title`
        }
      });
      const pageHeading = createSafeElement(documentRef, 'div', { className: 'preferences-page-heading' });
      pageHeading.append(
        createSafeElement(documentRef, 'h4', { id: `help-${page.id}-title`, text: page.title }),
        createSafeElement(documentRef, 'p', { text: page.summary })
      );
      section.append(pageHeading);
      let detailRoot = section;
      if (page.id === 'start' && helpDocument?.locale === 'zh-CN') {
        pageHeading.firstElementChild.textContent = '常用快捷键';
        const shortcuts = createSafeElement(documentRef, 'div', { className: 'help-quick-shortcuts' });
        for (const [label, key] of [['新建文档', 'Ctrl+N'], ['打开文件', 'Ctrl+O'], ['保存', 'Ctrl+S'], ['查找', 'Ctrl+F'], ['加粗', 'Ctrl+B'], ['插入链接', 'Ctrl+K']]) {
          const row = createSafeElement(documentRef, 'div', { className: 'help-shortcut-row' });
          row.append(createSafeElement(documentRef, 'span', { text: label }), createSafeElement(documentRef, 'kbd', { text: key }));
          shortcuts.append(row);
        }
        section.append(shortcuts);
        detailRoot = createSafeElement(documentRef, 'details', { className: 'help-start-details' });
        detailRoot.append(createSafeElement(documentRef, 'summary', { text: '开始写作' }));
        section.append(detailRoot);
      }
      if (page.introHtml) appendTrustedHtml(documentRef, detailRoot, page.introHtml);
      for (const topic of page.topics) {
        const card = createSafeElement(documentRef, 'div', { className: 'help-topic-card' });
        if (topic.title) card.append(createSafeElement(documentRef, 'h5', { text: topic.title }));
        appendTrustedHtml(documentRef, card, topic.bodyHtml);
        detailRoot.append(card);
      }
      if (page.bodyHtml) appendTrustedHtml(documentRef, section, page.bodyHtml);
      contentRoot.replaceChildren(section);
      contentRoot.scrollTo?.({ top: 0, behavior: 'auto' });
    },
    open({ initialFocus = null, onClose = null } = {}) {
      assertActive();
      return modal.open(null, { labelledBy: 'help-title', initialFocus, onClose });
    },
    close(reason = 'feature-close') {
      assertActive();
      return modal.close(reason);
    },
    isOpen() {
      assertActive();
      return modal.isOpen();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors = [];
      try { events.destroy(); } catch (error) { errors.push(error); }
      try { modal.destroy(); } catch (error) { errors.push(error); }
      try { root.remove(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Failed to destroy Help dialog view cleanly.');
    }
  });
}

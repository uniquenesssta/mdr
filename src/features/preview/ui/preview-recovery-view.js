/**
 * Responsibility: Project Preview recovery UI without owning Preview state, rendering, editor text or persistence.
 * Imports: None.
 * Exports: createPreviewRecoveryView().
 * State/side effects: Owns only the lightweight recovery body it creates under the injected preview root.
 * Lifecycle: recover()/inspect() reject after destroy(); destroy releases owned references without mutating editor or stable preview DOM.
 */
const DEFAULT_RECOVERY_MESSAGE = '后台预览恢复中，编辑内容与自动保存不受影响…';

function childCount(node) {
  if (!node) return 0;
  const count = Number(node.childElementCount);
  if (Number.isFinite(count) && count >= 0) return count;
  return Array.from(node.children || []).length;
}

export function createPreviewRecoveryView({ root, documentRef } = {}) {
  if (!root || typeof root.querySelector !== 'function' || typeof root.replaceChildren !== 'function') {
    throw new TypeError('Preview Recovery View requires a preview root.');
  }
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('Preview Recovery View requires documentRef.');
  }

  let destroyed = false;
  let ownedRecoveryBody = null;
  const assertActive = () => {
    if (destroyed) throw new Error('Preview Recovery View is destroyed.');
  };

  const currentBody = () => root.querySelector('.markdown-body');
  const isRecoveryBody = body => Boolean(
    body
    && (
      body === ownedRecoveryBody
      || body.dataset?.previewRecovery === 'true'
      || body.classList?.contains?.('preview-loading')
    )
  );

  return Object.freeze({
    inspect() {
      assertActive();
      const body = currentBody();
      return Object.freeze({
        present: Boolean(body),
        recovery: isRecoveryBody(body),
        empty: !body || childCount(body) === 0
      });
    },

    recover({ preserveStable = false, message = DEFAULT_RECOVERY_MESSAGE } = {}) {
      assertActive();
      const body = currentBody();
      if (preserveStable && body && !isRecoveryBody(body)) {
        return Object.freeze({
          body,
          preserved: true,
          replaced: false,
          recovery: false
        });
      }

      const recoveryBody = documentRef.createElement('div');
      recoveryBody.className = 'markdown-body preview-loading';
      recoveryBody.dataset ??= {};
      recoveryBody.dataset.previewRecovery = 'true';
      recoveryBody.textContent = String(message || DEFAULT_RECOVERY_MESSAGE);
      root.replaceChildren(recoveryBody);
      ownedRecoveryBody = recoveryBody;
      return Object.freeze({
        body: recoveryBody,
        preserved: false,
        replaced: true,
        recovery: true
      });
    },

    isRecoveryBody(body) {
      assertActive();
      return isRecoveryBody(body);
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      ownedRecoveryBody = null;
    }
  });
}

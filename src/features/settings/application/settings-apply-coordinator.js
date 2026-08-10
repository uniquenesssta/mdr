/**
 * Responsibility: Commit the current Settings draft and publish one immutable post-commit change notification.
 * Imports: Settings Schema metadata only; Store and publisher are injected.
 * Exports: SETTINGS_CHANGED_EVENT and createSettingsApplyCoordinator().
 * State/side effects: Owns no Settings values; persistence remains Store-owned. Publishes only after a successful Store apply and is explicitly destroyable.
  * Lifecycle: Explicit destroyable coordinator; destroy prevents further commits/publications.
 */
import { SETTING_IDS, getSettingDefinition } from '../domain/settings-schema.js';

export const SETTINGS_CHANGED_EVENT = 'markdown-editor:settings-changed';

function valuesEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => value === right[index]);
  }
  return left === right;
}

function freezeValue(value) {
  return Array.isArray(value) ? Object.freeze([...value]) : value;
}

function freezeSnapshot(snapshot) {
  return Object.freeze(Object.fromEntries(
    SETTING_IDS.map(id => [id, freezeValue(snapshot[id])])
  ));
}

export function createSettingsApplyCoordinator({ store, publish } = {}) {
  if (!store || typeof store.applyDraft !== 'function' || typeof store.commit !== 'function' || !store.snapshot) {
    throw new TypeError('Settings Apply Coordinator requires an active Settings Store.');
  }
  if (typeof publish !== 'function') {
    throw new TypeError('Settings Apply Coordinator requires a publish callback.');
  }

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Settings Apply Coordinator has been destroyed.');
  };

  function publishTransition(previousSnapshot, nextSnapshot) {
    const previous = freezeSnapshot(previousSnapshot);
    const snapshot = freezeSnapshot(nextSnapshot);
    const changedIds = Object.freeze(
      SETTING_IDS.filter(id => !valuesEqual(previous[id], snapshot[id]))
    );
    if (changedIds.length) {
      const changes = Object.freeze(Object.fromEntries(
        changedIds.map(id => [id, freezeValue(snapshot[id])])
      ));
      const impactEvents = Object.freeze([...new Set(
        changedIds.map(id => getSettingDefinition(id).impactEvent)
      )]);
      publish(Object.freeze({
        type: SETTINGS_CHANGED_EVENT,
        previous,
        snapshot,
        changes,
        changedIds,
        impactEvents
      }));
    }
    return snapshot;
  }

  return Object.freeze({
    applyDraft() {
      assertActive();
      const previous = store.snapshot;
      return publishTransition(previous, store.applyDraft());
    },
    commit(changes) {
      assertActive();
      const previous = store.snapshot;
      return publishTransition(previous, store.commit(changes));
    },
    destroy() {
      destroyed = true;
    }
  });
}

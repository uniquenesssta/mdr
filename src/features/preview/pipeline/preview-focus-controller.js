/**
 * Responsibility: Own Preview focus request generations, chapter-crossing refresh and request-safe preview positioning.
 * Imports: None; Preview Scheduler and browser-specific focus capabilities are injected.
 * Exports: createPreviewFocusController().
 * State/side effects: Owns focus request generation plus one deduplicated scope-refresh promise; scheduling and DOM effects stay behind injected ports.
 * Lifecycle: connect() is one-time; cancel() invalidates pending focus requests; destroy() is terminal.
 */

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`Preview Focus Controller requires ${label}().`);
  return value;
}

function normalizeLine(value) {
  return Math.max(1, Math.floor(Number(value) || 1));
}

function normalizeBehavior(value) {
  return value === 'smooth' ? 'smooth' : 'auto';
}

function sectionContainsLine(section, line) {
  if (!section) return false;
  const startLine = normalizeLine(section.startLine);
  const endLine = Math.max(startLine, normalizeLine(section.endLine));
  return line >= startLine && line <= endLine;
}

export function createPreviewFocusController(options = {}) {
  const scheduler = options.scheduler;
  if (!scheduler
    || typeof scheduler.schedule !== 'function'
    || typeof scheduler.cancel !== 'function'
    || typeof scheduler.hasPending !== 'function') {
    throw new TypeError('Preview Focus Controller requires Preview Scheduler.');
  }
  const focusDelay = Math.max(0, Number(options.focusDelay) || 0);

  let capabilities = null;
  let destroyed = false;
  let requestGeneration = 0;
  let pendingRefreshPromise = null;
  let pendingRefreshTarget = 0;

  const assertActive = () => {
    if (destroyed) throw new Error('Preview Focus Controller is destroyed.');
  };
  const assertConnected = () => {
    assertActive();
    if (!capabilities) throw new Error('Preview Focus Controller is not connected.');
  };
  const isCurrent = generation => !destroyed && generation === requestGeneration;

  function scopeContainsLine(line) {
    const targetLine = normalizeLine(line);
    if (capabilities.isVirtualWindowActive()) {
      return Boolean(capabilities.virtualWindowContainsLine(targetLine));
    }
    if (capabilities.getMode() !== 'chapter') return true;
    return sectionContainsLine(capabilities.getFocusSection(), targetLine);
  }

  async function refreshScope(line, generation) {
    scheduler.cancel('focus');
    scheduler.cancel('input');

    let pending = pendingRefreshPromise;
    if (!pending || pendingRefreshTarget !== line) {
      pendingRefreshTarget = line;
      pending = Promise.resolve(capabilities.refreshPreview({ line, generation }));
      pendingRefreshPromise = pending;
      void pending.then(
        () => {
          if (pendingRefreshPromise === pending) {
            pendingRefreshPromise = null;
            pendingRefreshTarget = 0;
          }
        },
        () => {
          if (pendingRefreshPromise === pending) {
            pendingRefreshPromise = null;
            pendingRefreshTarget = 0;
          }
        }
      );
    }

    try {
      await pending;
    } catch (error) {
      if (isCurrent(generation)) throw error;
      return false;
    }
    return isCurrent(generation);
  }

  return Object.freeze({
    connect(value = {}) {
      assertActive();
      if (capabilities) throw new Error('Preview Focus Controller is already connected.');
      capabilities = Object.freeze({
        isSuspended: requireFunction(value.isSuspended, 'isSuspended'),
        isCursorTrackingEligible: requireFunction(value.isCursorTrackingEligible, 'isCursorTrackingEligible'),
        getFocusSection: requireFunction(value.getFocusSection, 'getFocusSection'),
        getMode: requireFunction(value.getMode, 'getMode'),
        isVirtualWindowActive: requireFunction(value.isVirtualWindowActive, 'isVirtualWindowActive'),
        virtualWindowContainsLine: requireFunction(value.virtualWindowContainsLine, 'virtualWindowContainsLine'),
        refreshPreview: requireFunction(value.refreshPreview, 'refreshPreview'),
        ensureLineVisible: requireFunction(value.ensureLineVisible, 'ensureLineVisible'),
        invalidateAnchors: requireFunction(value.invalidateAnchors, 'invalidateAnchors'),
        scrollToLine: requireFunction(value.scrollToLine, 'scrollToLine')
      });
      return true;
    },

    scheduleCursorFocus(line) {
      assertConnected();
      const targetLine = normalizeLine(line);
      if (capabilities.isSuspended()
        || !capabilities.isCursorTrackingEligible()
        || scheduler.hasPending('input')
        || sectionContainsLine(capabilities.getFocusSection(), targetLine)) {
        return false;
      }
      scheduler.schedule('focus', () => capabilities.refreshPreview({ line: targetLine, reason: 'cursor-chapter-crossing' }), {
        kind: 'timeout',
        delay: focusDelay
      });
      return true;
    },

    async focusLine(line, optionsValue = {}) {
      assertConnected();
      const targetLine = normalizeLine(line);
      const generation = ++requestGeneration;
      const behavior = normalizeBehavior(optionsValue.behavior);
      const shouldScroll = optionsValue.scroll !== false;
      scheduler.cancel('focus');

      const needsScopeRefresh = capabilities.getMode() === 'chapter' && !scopeContainsLine(targetLine);
      if (needsScopeRefresh) {
        const refreshed = await refreshScope(targetLine, generation);
        if (!refreshed) return false;
      }
      if (!isCurrent(generation)) return false;

      if (capabilities.isVirtualWindowActive()) {
        const anchor = capabilities.ensureLineVisible(targetLine);
        if (!isCurrent(generation)) return false;
        if (!anchor && capabilities.getMode() === 'chapter') return false;
        capabilities.invalidateAnchors();
      }
      if (!isCurrent(generation)) return false;

      if (shouldScroll) capabilities.scrollToLine(targetLine, behavior, 0.5);
      return true;
    },

    cancel() {
      assertActive();
      requestGeneration += 1;
      scheduler.cancel('focus');
      return true;
    },

    destroy() {
      if (destroyed) return;
      requestGeneration += 1;
      scheduler.cancel('focus');
      capabilities = null;
      pendingRefreshPromise = null;
      pendingRefreshTarget = 0;
      destroyed = true;
    }
  });
}

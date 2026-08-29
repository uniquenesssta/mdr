/**
 * Atomic 8.6 reusable widget toolbar primitives.
 * Owns only shared toolbar/action-group DOM structure and presentation metadata.
 */
function joinClasses(baseClass, extraClass) {
  const extra = String(extraClass || '').trim();
  return extra ? `${baseClass} ${extra}` : baseClass;
}

export function createWidgetToolbar(options = {}) {
  const toolbar = document.createElement('header');
  toolbar.className = joinClasses('cm-hybrid-block-toolbar', options.className);
  if (options.doubleZone) {
    toolbar.dataset.hybridDoubleZone = String(options.doubleZone);
  }
  return toolbar;
}

export function createWidgetActionGroup(className = '') {
  const group = document.createElement('span');
  group.className = joinClasses('cm-hybrid-block-actions', className);
  return group;
}

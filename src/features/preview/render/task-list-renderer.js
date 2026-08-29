/**
 * Responsibility: Apply preview task-list presentation classes to checkbox list items.
 * Imports: None.
 * Exports: createTaskListRenderer().
 * State/side effects: Mutates only task-list CSS classes inside the injected preview root.
 * Lifecycle: render() rejects after destroy(); destroy owns no external resources.
 */
function normalizeRoots(roots, fallbackRoot) {
  return Array.isArray(roots) && roots.length ? roots.filter(Boolean) : [fallbackRoot];
}

function collectCheckboxes(roots) {
  const checkboxes = [];
  const seen = new Set();
  const add = checkbox => {
    if (!checkbox || seen.has(checkbox) || !checkbox.matches?.('input[type="checkbox"]')) return;
    seen.add(checkbox);
    checkboxes.push(checkbox);
  };
  for (const root of roots) {
    add(root);
    root?.querySelectorAll?.('input[type="checkbox"]').forEach(add);
  }
  return checkboxes;
}

export function createTaskListRenderer({ root } = {}) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    throw new TypeError('Task List Renderer requires a preview root.');
  }
  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Task List Renderer is destroyed.');
  };

  return Object.freeze({
    render(roots = null) {
      assertActive();
      let styled = 0;
      for (const checkbox of collectCheckboxes(normalizeRoots(roots, root))) {
        const item = checkbox.closest?.('li');
        if (!item) continue;
        item.classList?.add?.('task-item');
        const list = item.closest?.('ul, ol');
        if (String(list?.tagName || '').toUpperCase() === 'UL') list.classList?.add?.('task-list');
        styled += 1;
      }
      return styled;
    },
    destroy() {
      destroyed = true;
    }
  });
}

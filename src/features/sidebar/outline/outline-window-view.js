import { collectOutlineWindowRows, outlineWindowRange } from './outline-window-model.js';

/** Own the large-outline viewport, mounted rows, keyboard boundary and observer lifetime. */
export function createOutlineWindowView({ documentRef, panel, list, isCollapsed, createRow, rowByHeadingId }) {
  const runtime = documentRef.defaultView;
  let rows = [], total = 0, root = null, frame = 0, observer = null;
  let active = false, destroyed = false;
  const mounted = new Map();
  let indexById = new Map();
  const rowHeight = 36;
  const focusedAction = () => {
    const element = documentRef.activeElement?.closest?.('[data-outline-action]');
    return element && list.contains(element) ? { id: element.dataset.outlineId, action: element.dataset.outlineAction } : null;
  };
  function project(force = false) {
    if (!active || destroyed) return;
    const focus = focusedAction();
    const range = outlineWindowRange(rows.length, panel.scrollTop || 0, panel.clientHeight || 36);
    const wanted = new Set(rows.slice(range.start, range.end).map(row => row.node.id));
    // Wheel scrolling must not detach the button that currently owns keyboard focus.
    if (focus && rows.some(row => row.node.id === focus.id)) wanted.add(focus.id);
    for (const [id, item] of mounted) {
      if (force || !wanted.has(id)) { item.remove(); mounted.delete(id); rowByHeadingId.delete(id); }
    }
    let cursor = root.firstChild;
    for (const id of [...wanted].sort((a, b) => indexById.get(a) - indexById.get(b))) {
      const index = indexById.get(id), row = rows[index];
      let item = mounted.get(id);
      if (!item) { item = createRow(row.node); mounted.set(id, item); }
      if (item !== cursor) root.insertBefore(item, cursor);
      cursor = item.nextSibling;
      item.style.top = `${index * rowHeight}px`;
      item.style.left = `${row.depth * 16}px`;
      item.setAttribute('aria-posinset', String(index + 1));
      item.setAttribute('aria-setsize', String(rows.length));
    }
    if (focus) mounted.get(focus.id)?.querySelector(`[data-outline-action="${focus.action}"]`)?.focus({ preventScroll: true });
  }
  function schedule() {
    if (!active || destroyed || frame) return;
    frame = runtime.requestAnimationFrame(() => { frame = 0; project(); });
  }
  function onKeyDown(event) {
    if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target?.closest?.('[data-outline-action]');
    if (!target || !list.contains(target)) return;
    const index = rows.findIndex(row => row.node.id === target.dataset.outlineId);
    if (index < 0) return;
    // Preserve the normal toggle -> link tab order within each row.
    if ((!event.shiftKey && target.dataset.outlineAction === 'toggle')
      || (event.shiftKey && target.dataset.outlineAction === 'navigate' && rows[index].node.children?.length)) return;
    const next = index + (event.shiftKey ? -1 : 1);
    if (next < 0 || next >= rows.length) return;
    event.preventDefault();
    if (next * rowHeight < panel.scrollTop) panel.scrollTop = next * rowHeight;
    else if ((next + 1) * rowHeight > panel.scrollTop + panel.clientHeight) panel.scrollTop = (next + 1) * rowHeight - panel.clientHeight;
    project();
    const item = mounted.get(rows[next].node.id);
    const action = event.shiftKey || !rows[next].node.children?.length ? 'navigate' : 'toggle';
    item?.querySelector(`[data-outline-action="${action}"]`)?.focus();
  }
  function stop() {
    if (frame) runtime.cancelAnimationFrame(frame);
    frame = 0; observer?.disconnect(); observer = null;
    if (active) { panel.removeEventListener('scroll', schedule); list.removeEventListener('keydown', onKeyDown); }
    active = false; mounted.clear(); indexById.clear(); root = null; rows = []; total = 0;
  }
  return Object.freeze({
    render(tree) {
      const next = collectOutlineWindowRows(tree, isCollapsed);
      if (next.total <= 200 || !runtime?.requestAnimationFrame) { stop(); return null; }
      rows = next.rows; total = next.total;
      indexById = new Map(rows.map((row, index) => [row.node.id, index]));
      if (!active) {
        active = true; root = documentRef.createElement('ul'); root.className = 'outline-tree outline-window-tree';
        rowByHeadingId.clear(); list.replaceChildren(root);
        panel.addEventListener('scroll', schedule, { passive: true }); list.addEventListener('keydown', onKeyDown);
        if (runtime.ResizeObserver) { observer = new runtime.ResizeObserver(schedule); observer.observe(panel); }
      }
      root.style.height = `${rows.length * rowHeight}px`;
      panel.scrollTop = Math.min(panel.scrollTop || 0, Math.max(0, rows.length * rowHeight - (panel.clientHeight || 36)));
      project(true);
      return { headings: total, rows: mounted.size };
    },
    destroy() { if (destroyed) return; stop(); destroyed = true; }
  });
}

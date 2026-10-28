/** Own native policy read/write/rollback. Local Settings snapshots never duplicate this authority. */
export function createLaunchPolicyController({ launch, view, supported }) {
  let alive = true, enabled = true, busy = false, loaded = false;
  const render = (message = '') => { if (alive) view.render({ enabled, busy: busy || (supported && !loaded), supported, message }); };
  async function refresh() {
    if (!supported || busy || !alive) return;
    busy = true; render();
    try { const context = await launch.readContext(); enabled = context.enabled; loaded = true; }
    catch (error) { render('读取失败：' + (error?.message || String(error))); throw error; }
    finally { busy = false; }
    render();
  }
  async function change(value) {
    if (!supported || busy || !loaded || !alive) return false;
    busy = true; render();
    let message = '';
    try { enabled = await launch.setSingleInstance(Boolean(value)); return true; }
    catch (error) { message = error?.message || String(error); return false; }
    finally { busy = false; render(message); }
  }
  render();
  return Object.freeze({ refresh, change,
    async reset(resetLocal) {
      if (!supported) return resetLocal();
      if (!loaded) { try { await refresh(); } catch { return false; } }
      const previous = enabled;
      if (!await change(true)) return false;
      try {
        if (resetLocal() === false) { await change(previous); return false; }
        return true;
      } catch (error) { await change(previous); throw error; }
    },
    destroy() { alive = false; }
  });
}

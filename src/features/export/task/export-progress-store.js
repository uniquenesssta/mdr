/** Read-only UI projection; task identity, progress and cancellation remain controller-owned. */
export function createExportProgressStore(controller) {
  if (!controller || typeof controller.getSnapshot !== 'function' || typeof controller.subscribe !== 'function') {
    throw new TypeError('Export progress requires a task snapshot and subscription source.');
  }
  let destroyed = false;
  const subscriptions = new Set();
  const project = snapshot => {
    const disposed = destroyed || snapshot.destroyed;
    const task = disposed ? null : snapshot.activeTask;
    return Object.freeze({
      visible: Boolean(task), taskId: task?.id ?? null,
      title: task?.title ?? '正在准备导出', progress: task?.progress ?? 0, message: task?.message ?? '',
      cancelEnabled: Boolean(task && task.cancelable && !task.cancelled),
      cancelLabel: task?.cancelled ? '正在取消…' : task && !task.cancelable ? '正在生成文件…' : '取消导出',
      closeReason: disposed ? 'export-destroyed' : 'export-finished', destroyed: Boolean(disposed)
    });
  };
  const getSnapshot = () => project(controller.getSnapshot());
  return Object.freeze({
    getSnapshot,
    subscribe(listener) {
      if (destroyed) throw new Error('Export progress store has been destroyed.');
      if (typeof listener !== 'function') throw new TypeError('Export progress listener is required.');
      const record = { listener, release: null, active: true };
      subscriptions.add(record);
      try {
        record.release = controller.subscribe(snapshot => {
          if (!destroyed && record.active) listener(project(snapshot));
        });
        if (typeof record.release !== 'function') throw new TypeError('Export progress subscription requires a disposer.');
        // An initial observer can dispose the store before subscribe returns its release.
        if (!record.active) record.release();
      } catch (error) { record.active = false; subscriptions.delete(record); throw error; }
      return () => {
        if (!record.active) return;
        record.active = false;
        subscriptions.delete(record);
        record.release?.();
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const records = [...subscriptions], errors = [];
      subscriptions.clear();
      for (const record of records) {
        record.active = false;
        try { record.release?.(); } catch (error) { errors.push(error); }
      }
      const snapshot = getSnapshot();
      for (const record of records) {
        try { record.listener(snapshot); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Failed to destroy export progress store cleanly.');
    }
  });
}

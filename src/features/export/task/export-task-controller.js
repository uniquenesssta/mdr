import { assertExportNonCancelablePhase, createExportCancellationToken } from './export-cancellation.js';

const workPhases = new Set(['preparing', 'building', 'enhancing', 'serializing', 'printing', 'loading', 'images', 'encoding', 'writing']);

/** Sole owner of export task identity, progress, cancellation and phase; no DOM or I/O. */
export function createExportTaskController() {
  let active = null, lastTaskId = 0, destroyed = false, notificationRevision = 0;
  const states = new WeakMap(), listeners = new Set();
  const snapshotTask = state => Object.freeze({
    id: state.id, title: state.title, progress: state.progress, message: state.message,
    cancelable: state.cancelable, cancelled: state.cancelled, phase: state.phase
  });
  const getSnapshot = () => Object.freeze({ activeTask: active ? snapshotTask(active) : null, lastTaskId, destroyed });
  const requireAlive = () => { if (destroyed) throw new Error('Export task controller has been destroyed.'); };
  const isCurrent = state => !destroyed && active === state;
  const canUpdate = state => isCurrent(state) && !state.cancelled;
  const subscribe = listener => {
    requireAlive();
    if (typeof listener !== 'function') throw new TypeError('Export task listener is required.');
    listeners.add(listener);
    try { listener(getSnapshot()); } catch (error) { listeners.delete(listener); throw error; }
    return () => listeners.delete(listener);
  };
  const notify = () => {
    const revision = ++notificationRevision;
    const snapshot = getSnapshot();
    let failure;
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      // A previous subscriber may have replaced, finished or destroyed the task.
      if (revision !== notificationRevision) break;
      try { listener(snapshot); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  };
  return Object.freeze({
    getSnapshot,
    begin(title) {
      requireAlive();
      if (typeof title !== 'string' || !title.trim()) throw new TypeError('Export task title is required.');
      if (active && !active.cancelable) return null;
      if (active) { active.cancelled = true; active.phase = 'replaced'; }
      const state = { id: ++lastTaskId, title, progress: 2, message: '正在准备文档…', cancelable: true, cancelled: false, phase: 'preparing' };
      const token = createExportCancellationToken({
        taskId: state.id,
        readState: () => ({ cancelled: !canUpdate(state), reason: canUpdate(state) ? null : destroyed ? 'destroyed' : state.phase }),
        subscribe
      });
      const task = Object.freeze({
        token,
        get id() { return state.id; }, get title() { return state.title; },
        get progress() { return state.progress; }, get message() { return state.message; },
        get cancelable() { return state.cancelable; }, get cancelled() { return state.cancelled; },
        get phase() { return state.phase; }, get current() { return isCurrent(state); },
        update(progress, message, phase = state.phase) {
          if (!canUpdate(state)) return false;
          if (!workPhases.has(phase)) throw new TypeError('Unknown export task phase.');
          if (!state.cancelable && phase !== state.phase) throw new Error('Locked export phase cannot be changed.');
          state.progress = Math.max(0, Math.min(100, Number(progress) || 0));
          state.message = message ? String(message) : '正在处理…';
          state.phase = phase;
          notify();
          return true;
        },
        lockCancellation(phase) {
          if (!canUpdate(state)) return false;
          assertExportNonCancelablePhase(phase);
          if (!state.cancelable) {
            if (phase !== state.phase) throw new Error('Locked export phase cannot be changed.');
            return true;
          }
          state.cancelable = false;
          state.phase = phase;
          notify();
          return true;
        }
      });
      states.set(task, state);
      active = state;
      try { notify(); } catch (error) {
        // Opening/projection failures cannot strand an active task or progress modal.
        state.cancelled = true; state.phase = 'failed';
        if (active === state) {
          active = null;
          try { notify(); } catch { /* preserve the original view failure */ }
        }
        throw error;
      }
      return task;
    },
    finish(task, outcome = 'completed') {
      const state = states.get(task);
      if (!state || !isCurrent(state)) return false;
      if (!['completed', 'failed'].includes(outcome)) throw new TypeError('Unknown export task outcome.');
      state.phase = state.cancelled ? 'cancelled' : outcome;
      active = null;
      notify();
      return true;
    },
    cancel() {
      if (!active || !active.cancelable || active.cancelled || destroyed) return false;
      active.cancelled = true; active.phase = 'cancelled';
      active.progress = 0; active.message = '正在取消导出…';
      notify();
      return true;
    },
    subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (active) { active.cancelled = true; active.phase = 'destroyed'; active = null; }
      try { notify(); } finally { listeners.clear(); }
    }
  });
}

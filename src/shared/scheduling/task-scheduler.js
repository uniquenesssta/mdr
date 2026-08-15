/**
 * Responsibility: Schedule cancellable background work across feature boundaries without exposing a global runtime service.
 * Imports: None.
 * Exports: TaskScheduler, createTaskScheduler().
 * State/side effects: Owns only queued task handles and AbortControllers; browser timing primitives are injected.
 * Lifecycle: destroy() cancels every pending task and is idempotent.
 */
const PRIORITY_TIMEOUTS = Object.freeze({
  immediate: 0,
  visible: 80,
  background: 320,
  idle: 1200
});

function normalizePriority(value) {
  return Object.hasOwn(PRIORITY_TIMEOUTS, value) ? value : 'background';
}

export class TaskScheduler {
  constructor(options = {}) {
    const runtime = options.runtime || globalThis;
    this.runtime = runtime;
    this.now = typeof options.now === 'function'
      ? options.now
      : () => runtime.performance?.now?.() ?? Date.now();
    this.tasks = new Map();
    this.sequence = 0;
    this.destroyed = false;
  }

  createDeadline(didTimeout = false) {
    const started = this.now();
    return Object.freeze({
      didTimeout,
      timeRemaining: () => Math.max(0, 8 - (this.now() - started))
    });
  }

  schedule(key, callback, options = {}) {
    if (this.destroyed) throw new Error('Task Scheduler is destroyed.');
    if (typeof callback !== 'function') throw new TypeError('Task callback must be a function');
    const taskKey = String(key || `task-${++this.sequence}`);
    this.cancel(taskKey);

    const priority = normalizePriority(options.priority);
    const delay = Math.max(0, Number(options.delay) || 0);
    const timeout = Math.max(0, Number(options.timeout) || PRIORITY_TIMEOUTS[priority]);
    const controller = new AbortController();
    const task = {
      key: taskKey,
      priority,
      controller,
      handle: null,
      timer: null,
      started: false,
      createdAt: this.now()
    };
    this.tasks.set(taskKey, task);

    const run = async deadline => {
      if (controller.signal.aborted || task.started || this.destroyed) return;
      task.started = true;
      try {
        await callback({
          signal: controller.signal,
          deadline: deadline || this.createDeadline(true),
          priority,
          queuedMs: this.now() - task.createdAt
        });
      } catch (error) {
        if (!controller.signal.aborted) console.error(`Background task failed: ${taskKey}`, error);
      } finally {
        if (this.tasks.get(taskKey) === task) this.tasks.delete(taskKey);
      }
    };

    const arm = () => {
      if (controller.signal.aborted || this.destroyed) return;
      if (priority === 'immediate') {
        this.runtime.queueMicrotask(() => run(this.createDeadline(false)));
      } else if (priority === 'visible') {
        task.handle = this.runtime.requestAnimationFrame(() => run(this.createDeadline(false)));
      } else if (typeof this.runtime.requestIdleCallback === 'function') {
        task.handle = this.runtime.requestIdleCallback(run, { timeout });
      } else {
        task.handle = this.runtime.setTimeout(() => run(this.createDeadline(true)), priority === 'idle' ? 48 : 16);
      }
    };

    if (delay > 0) task.timer = this.runtime.setTimeout(arm, delay);
    else arm();

    return Object.freeze({
      key: taskKey,
      signal: controller.signal,
      cancel: () => this.cancel(taskKey)
    });
  }

  cancel(key) {
    const taskKey = String(key || '');
    const task = this.tasks.get(taskKey);
    if (!task) return false;
    task.controller.abort();
    if (task.timer !== null) this.runtime.clearTimeout(task.timer);
    if (task.handle !== null) {
      if (task.priority === 'visible') this.runtime.cancelAnimationFrame(task.handle);
      else if ((task.priority === 'background' || task.priority === 'idle') && typeof this.runtime.cancelIdleCallback === 'function') {
        this.runtime.cancelIdleCallback(task.handle);
      } else if (task.priority !== 'immediate') {
        this.runtime.clearTimeout(task.handle);
      }
    }
    this.tasks.delete(taskKey);
    return true;
  }

  cancelPrefix(prefix) {
    const normalized = String(prefix || '');
    for (const key of [...this.tasks.keys()]) {
      if (key.startsWith(normalized)) this.cancel(key);
    }
  }

  getStats() {
    const byPriority = { immediate: 0, visible: 0, background: 0, idle: 0 };
    for (const task of this.tasks.values()) byPriority[task.priority] += 1;
    return Object.freeze({ pending: this.tasks.size, byPriority: Object.freeze(byPriority) });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const key of [...this.tasks.keys()]) this.cancel(key);
  }
}

export function createTaskScheduler(options) {
  return new TaskScheduler(options);
}

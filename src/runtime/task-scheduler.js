const PRIORITY_TIMEOUTS = {
  immediate: 0,
  visible: 80,
  background: 320,
  idle: 1200
};

function normalizePriority(value) {
  return Object.prototype.hasOwnProperty.call(PRIORITY_TIMEOUTS, value) ? value : 'background';
}

function createDeadline(didTimeout = false) {
  const started = performance.now();
  return {
    didTimeout,
    timeRemaining() {
      return Math.max(0, 8 - (performance.now() - started));
    }
  };
}

export class TaskScheduler {
  constructor() {
    this.tasks = new Map();
    this.sequence = 0;
  }

  schedule(key, callback, options = {}) {
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
      createdAt: performance.now()
    };
    this.tasks.set(taskKey, task);

    const run = async deadline => {
      if (controller.signal.aborted || task.started) return;
      task.started = true;
      try {
        await callback({
          signal: controller.signal,
          deadline: deadline || createDeadline(true),
          priority,
          queuedMs: performance.now() - task.createdAt
        });
      } catch (error) {
        if (!controller.signal.aborted) console.error(`Background task failed: ${taskKey}`, error);
      } finally {
        if (this.tasks.get(taskKey) === task) this.tasks.delete(taskKey);
      }
    };

    const arm = () => {
      if (controller.signal.aborted) return;
      if (priority === 'immediate') {
        task.handle = queueMicrotask(() => run(createDeadline(false)));
      } else if (priority === 'visible') {
        task.handle = requestAnimationFrame(() => run(createDeadline(false)));
      } else if ('requestIdleCallback' in window) {
        task.handle = requestIdleCallback(run, { timeout });
      } else {
        task.handle = setTimeout(() => run(createDeadline(true)), priority === 'idle' ? 48 : 16);
      }
    };

    if (delay > 0) task.timer = setTimeout(arm, delay);
    else arm();

    return {
      key: taskKey,
      signal: controller.signal,
      cancel: () => this.cancel(taskKey)
    };
  }

  cancel(key) {
    const taskKey = String(key || '');
    const task = this.tasks.get(taskKey);
    if (!task) return false;
    task.controller.abort();
    if (task.timer) clearTimeout(task.timer);
    if (task.handle !== null) {
      if (task.priority === 'visible') cancelAnimationFrame(task.handle);
      else if ((task.priority === 'background' || task.priority === 'idle') && 'cancelIdleCallback' in window) cancelIdleCallback(task.handle);
      else if (task.priority !== 'immediate') clearTimeout(task.handle);
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
    return { pending: this.tasks.size, byPriority };
  }

  destroy() {
    for (const key of [...this.tasks.keys()]) this.cancel(key);
  }
}

export function createTaskScheduler() {
  return new TaskScheduler();
}

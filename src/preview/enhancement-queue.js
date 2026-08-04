let enhancementScheduleId = 0;

function scheduleIdle(callback) {
  const scheduler = window.markdownEditorTaskScheduler;
  if (scheduler?.schedule) {
    const task = scheduler.schedule(`preview-enhancement-${++enhancementScheduleId}`, ({ deadline }) => callback(deadline), {
      priority: 'background',
      timeout: 180
    });
    return { type: 'scheduler', cancel: task.cancel };
  }
  if ('requestIdleCallback' in window) {
    return { type: 'idle', id: requestIdleCallback(callback, { timeout: 180 }) };
  }
  return { type: 'timeout', id: setTimeout(() => callback({ timeRemaining: () => 8, didTimeout: true }), 16) };
}

function cancelScheduled(handle) {
  if (!handle) return;
  if (handle.type === 'scheduler') handle.cancel?.();
  else if (handle.type === 'idle' && 'cancelIdleCallback' in window) cancelIdleCallback(handle.id);
  else clearTimeout(handle.id);
}

function nodeLineRange(node) {
  const anchor = node?.closest?.('[data-source-line]') || node;
  const start = Number(anchor?.dataset?.sourceLine);
  const end = Number(anchor?.dataset?.sourceEndLine);
  return {
    start: Number.isFinite(start) ? start : 1,
    end: Number.isFinite(end) ? end : (Number.isFinite(start) ? start : 1)
  };
}

function intersects(range, priorityRange) {
  if (!priorityRange) return false;
  return range.end >= priorityRange.startLine && range.start <= priorityRange.endLine;
}

export class PreviewEnhancementQueue {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.version = 0;
    this.priorityRange = null;
    this.jobs = [];
    this.handle = null;
    this.running = false;
    this.seenMath = new WeakSet();
    this.seenMermaid = new WeakSet();
  }

  begin(version) {
    this.version = Number(version) || this.version + 1;
    this.priorityRange = null;
    this.jobs = [];
    // 已经进入 Mermaid 的任务无法硬中断。保留 running 状态，
    // 让新版本等待当前任务退出，避免两个重型渲染并发占用主线程。
    cancelScheduled(this.handle);
    this.handle = null;
    this.seenMath = new WeakSet();
    this.seenMermaid = new WeakSet();
  }

  setPriorityRange(range) {
    this.priorityRange = range && Number.isFinite(Number(range.startLine))
      ? {
          startLine: Math.max(1, Number(range.startLine) || 1),
          endLine: Math.max(1, Number(range.endLine) || Number(range.startLine) || 1)
        }
      : null;
  }

  enqueue(nodes, changedNodes = nodes) {
    const roots = Array.from(nodes || []).filter(Boolean);
    if (!roots.length) return;
    this.handlers.styleTasks?.(roots);
    this.handlers.animate?.(Array.from(changedNodes || []).filter(Boolean));

    for (const root of roots) {
      const lineRange = nodeLineRange(root);
      const handlerPriority = Number(this.handlers.getPriority?.(root, lineRange));
      const priority = Number.isFinite(handlerPriority)
        ? Math.max(0, handlerPriority)
        : (intersects(lineRange, this.priorityRange) ? 0 : 1);
      const rootText = root.textContent || '';
      const hasMath = window.markdownEditorMath?.containsMath?.(rootText)
        ?? (rootText.includes('$') || rootText.includes('\\[') || rootText.includes('\\('));
      if (hasMath && !this.seenMath.has(root)) {
        this.seenMath.add(root);
        this.jobs.push({ type: 'math', root, priority, version: this.version });
      }
      const hasMermaid = Boolean(
        root.matches?.('pre') && root.querySelector?.('code.language-mermaid')
        || root.querySelector?.('pre code.language-mermaid')
      );
      if (hasMermaid && !this.seenMermaid.has(root)) {
        this.seenMermaid.add(root);
        this.jobs.push({ type: 'mermaid', root, priority, version: this.version });
      }
    }

    this.jobs.sort((left, right) => left.priority - right.priority || (left.type === 'math' ? -1 : 1));
    this.schedule();
  }

  schedule() {
    if (this.handle || this.running || !this.jobs.length) return;
    const version = this.version;
    this.handle = scheduleIdle(deadline => {
      this.handle = null;
      this.process(deadline, version);
    });
  }

  async process(deadline, version) {
    if (version !== this.version || this.running) return;
    this.running = true;
    try {
      let processed = 0;
      while (this.jobs.length && version === this.version) {
        if (processed > 0 && !deadline.didTimeout && deadline.timeRemaining() < 3) break;
        const job = this.jobs.shift();
        if (!job || job.version !== this.version) continue;
        if (!job.root.isConnected) continue;
        const cancelled = () => version !== this.version || !job.root.isConnected;
        if (job.type === 'math') {
          this.handlers.renderMath?.([job.root], cancelled);
        } else if (job.type === 'mermaid') {
          await this.handlers.renderMermaid?.([job.root], cancelled);
        }
        if (!cancelled()) this.handlers.onBatchComplete?.(job.type, job.root);
        processed += 1;
        if (job.type === 'mermaid') break;
      }
    } finally {
      this.running = false;
      if (this.jobs.length) this.schedule();
    }
  }

  cancel() {
    this.begin(this.version + 1);
  }

  getStats() {
    return {
      version: this.version,
      pending: this.jobs.length,
      priorityRange: this.priorityRange
    };
  }
}

export function createPreviewEnhancementQueue(handlers) {
  return new PreviewEnhancementQueue(handlers);
}

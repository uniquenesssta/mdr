/**
 * Responsibility: Own cancellable Preview enhancement ordering and scheduling after the primary DOM render.
 * Imports: None; Preview Scheduler and browser/renderer capabilities are injected.
 * Exports: createPreviewEnhancementCoordinator().
 * State/side effects: Owns enhancement generation, priority queue and postprocess queue only; DOM inspection/rendering stay behind injected capabilities.
 * Lifecycle: connect() is one-time; begin()/cancel() invalidate stale work; destroy() is terminal.
 */

const TYPE_RANK = Object.freeze({ style: 0, math: 1, mermaid: 2, finish: 3 });

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`Preview Enhancement Coordinator requires ${label}().`);
  return value;
}

function normalizeRange(value) {
  if (!value || !Number.isFinite(Number(value.startLine))) return null;
  const startLine = Math.max(1, Math.floor(Number(value.startLine) || 1));
  const endLine = Math.max(startLine, Math.floor(Number(value.endLine) || startLine));
  return Object.freeze({ startLine, endLine });
}

function intersects(range, priorityRange) {
  return Boolean(range && priorityRange && range.end >= priorityRange.startLine && range.start <= priorityRange.endLine);
}

function normalizePriority(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

export function createPreviewEnhancementCoordinator(options = {}) {
  const scheduler = options.scheduler;
  if (!scheduler
    || typeof scheduler.schedule !== 'function'
    || typeof scheduler.cancel !== 'function'
    || typeof scheduler.hasPending !== 'function') {
    throw new TypeError('Preview Enhancement Coordinator requires Preview Scheduler.');
  }
  const thresholds = options.thresholds || {};
  const idleTimeoutMs = Math.max(0, Number(thresholds.idleTimeoutMs) || 0);
  const fallbackMs = Math.max(0, Number(thresholds.fallbackMs) || 0);
  const minimumTimeRemainingMs = Math.max(0, Number(thresholds.minimumTimeRemainingMs) || 0);

  let capabilities = null;
  let destroyed = false;
  let version = 0;
  let generation = 0;
  let priorityRange = null;
  let jobs = [];
  let scheduledKind = null;
  let running = false;
  let sequence = 0;
  let seenMath = new WeakSet();
  let seenMermaid = new WeakSet();

  const assertActive = () => {
    if (destroyed) throw new Error('Preview Enhancement Coordinator is destroyed.');
  };
  const assertConnected = () => {
    assertActive();
    if (!capabilities) throw new Error('Preview Enhancement Coordinator is not connected.');
  };
  const isCurrent = (jobGeneration, jobVersion = version) => !destroyed
    && jobGeneration === generation
    && jobVersion === version
    && capabilities.isVersionCurrent(jobVersion);

  function sortJobs() {
    jobs.sort((left, right) => {
      if (left.phase !== right.phase) return left.phase === 'frame' ? -1 : 1;
      return left.priority - right.priority
        || (TYPE_RANK[left.type] ?? 99) - (TYPE_RANK[right.type] ?? 99)
        || left.sequence - right.sequence;
    });
  }

  function scheduleNext(forceFrame = false) {
    if (destroyed || !capabilities || running || !jobs.length) return false;
    const wantsFrame = forceFrame || jobs.some(job => job.phase === 'frame');
    const nextKind = wantsFrame ? 'frame' : 'background';
    if (scheduledKind === nextKind) return true;
    if (scheduledKind) {
      scheduler.cancel('enhancement');
      scheduledKind = null;
    }
    scheduledKind = nextKind;
    scheduler.schedule('enhancement', task => process(task, nextKind), nextKind === 'frame'
      ? { kind: 'frame' }
      : { kind: 'background', timeout: idleTimeoutMs, fallbackMs });
    return true;
  }

  function requeueForInput(task, kind) {
    if (!scheduler.hasPending('input')) return false;
    const options = kind === 'frame'
      ? { kind: 'background', timeout: idleTimeoutMs, fallbackMs }
      : { kind: 'background', timeout: idleTimeoutMs, fallbackMs };
    scheduledKind = kind;
    task.schedule(nextTask => process(nextTask, kind), options);
    return true;
  }

  async function runJob(job) {
    if (!isCurrent(job.generation, job.version)) return;
    if (job.type === 'postprocess') {
      job.run();
      if (!isCurrent(job.generation, job.version)) return;
      if (job.deferFinish && job.finish) {
        jobs.push({
          type: 'finish',
          phase: 'background',
          priority: 3,
          sequence: ++sequence,
          generation: job.generation,
          version: job.version,
          finish: job.finish
        });
        sortJobs();
      } else {
        job.finish?.();
      }
      return;
    }
    if (job.type === 'finish') {
      job.finish?.();
      return;
    }

    if (!capabilities.isConnected(job.root)) return;
    if (job.type === 'style') {
      capabilities.styleRoots([job.root]);
      if (job.animate) capabilities.animate([job.root]);
    } else if (job.type === 'math') {
      capabilities.renderMath([job.root]);
    } else if (job.type === 'mermaid') {
      await capabilities.renderMermaid([job.root], () => !isCurrent(job.generation, job.version) || !capabilities.isConnected(job.root));
    }
    if (isCurrent(job.generation, job.version) && capabilities.isConnected(job.root)) {
      capabilities.onBatchComplete(job.type, job.root);
    }
  }

  async function process(task, kind) {
    if (destroyed) return;
    scheduledKind = null;
    if (requeueForInput(task, kind)) return;
    running = true;
    try {
      let processed = 0;
      while (jobs.length) {
        if (scheduler.hasPending('input')) break;
        sortJobs();
        const nextIndex = jobs.findIndex(job => kind !== 'frame' || job.phase === 'frame');
        if (nextIndex < 0) break;
        if (processed > 0
          && kind !== 'frame'
          && task.deadline
          && !task.deadline.didTimeout
          && task.deadline.timeRemaining() < minimumTimeRemainingMs) break;
        const [job] = jobs.splice(nextIndex, 1);
        await runJob(job);
        processed += 1;
        if (job?.type === 'mermaid') break;
      }
    } finally {
      running = false;
      if (!destroyed && jobs.length) scheduleNext();
    }
  }

  return Object.freeze({
    connect(value = {}) {
      assertActive();
      if (capabilities) throw new Error('Preview Enhancement Coordinator is already connected.');
      capabilities = Object.freeze({
        getLineRange: requireFunction(value.getLineRange, 'getLineRange'),
        getPriority: requireFunction(value.getPriority, 'getPriority'),
        hasMath: requireFunction(value.hasMath, 'hasMath'),
        hasMermaid: requireFunction(value.hasMermaid, 'hasMermaid'),
        isConnected: requireFunction(value.isConnected, 'isConnected'),
        styleRoots: requireFunction(value.styleRoots, 'styleRoots'),
        renderMath: requireFunction(value.renderMath, 'renderMath'),
        renderMermaid: requireFunction(value.renderMermaid, 'renderMermaid'),
        animate: requireFunction(value.animate, 'animate'),
        onBatchComplete: requireFunction(value.onBatchComplete, 'onBatchComplete'),
        isVersionCurrent: requireFunction(value.isVersionCurrent, 'isVersionCurrent')
      });
      return true;
    },

    begin(nextVersion) {
      assertConnected();
      version = Number(nextVersion) || version + 1;
      generation += 1;
      priorityRange = null;
      jobs = [];
      seenMath = new WeakSet();
      seenMermaid = new WeakSet();
      scheduler.cancel('enhancement');
      scheduledKind = null;
      return version;
    },

    setPriorityRange(value) {
      assertConnected();
      priorityRange = normalizeRange(value);
      return priorityRange;
    },

    enqueue(nodes, changedNodes = nodes) {
      assertConnected();
      const roots = Array.from(nodes || []).filter(Boolean);
      if (!roots.length) return 0;
      const changed = new Set(Array.from(changedNodes || []).filter(Boolean));
      const jobGeneration = generation;
      const jobVersion = version;
      for (const root of roots) {
        const lineRange = capabilities.getLineRange(root);
        const fallbackPriority = intersects(lineRange, priorityRange) ? 1 : 2;
        const priority = normalizePriority(capabilities.getPriority(root, lineRange), fallbackPriority);
        jobs.push({
          type: 'style', phase: 'background', root, priority, animate: changed.has(root),
          sequence: ++sequence, generation: jobGeneration, version: jobVersion
        });
        if (capabilities.hasMath(root) && !seenMath.has(root)) {
          seenMath.add(root);
          jobs.push({
            type: 'math', phase: 'background', root, priority,
            sequence: ++sequence, generation: jobGeneration, version: jobVersion
          });
        }
        if (capabilities.hasMermaid(root) && !seenMermaid.has(root)) {
          seenMermaid.add(root);
          jobs.push({
            type: 'mermaid', phase: 'background', root, priority,
            sequence: ++sequence, generation: jobGeneration, version: jobVersion
          });
        }
      }
      sortJobs();
      scheduleNext();
      return roots.length;
    },

    schedulePostprocess({ renderVersion, run, finish = null, deferFinish = false } = {}) {
      assertConnected();
      if (typeof run !== 'function') throw new TypeError('Preview Enhancement Coordinator postprocess run must be a function.');
      if (finish !== null && typeof finish !== 'function') throw new TypeError('Preview Enhancement Coordinator postprocess finish must be a function.');
      jobs.push({
        type: 'postprocess', phase: 'frame', priority: -1,
        sequence: ++sequence, generation, version: Number(renderVersion) || version,
        run, finish, deferFinish: Boolean(deferFinish)
      });
      sortJobs();
      scheduleNext(true);
      return true;
    },

    cancel() {
      assertActive();
      generation += 1;
      version += 1;
      priorityRange = null;
      jobs = [];
      seenMath = new WeakSet();
      seenMermaid = new WeakSet();
      scheduler.cancel('enhancement');
      scheduledKind = null;
      return true;
    },

    getStats() {
      if (destroyed) return Object.freeze({ version, pending: 0, priorityRange: null, running: false });
      return Object.freeze({ version, pending: jobs.length, priorityRange, running });
    },

    destroy() {
      if (destroyed) return;
      generation += 1;
      jobs = [];
      scheduler.cancel('enhancement');
      scheduledKind = null;
      priorityRange = null;
      capabilities = null;
      destroyed = true;
    }
  });
}

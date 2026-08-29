/**
 * Responsibility: Own independent generation tokens for Preview scheduling channels and gate stale task commits.
 * Imports: None.
 * Exports: createPreviewCancellation().
 * State/side effects: In-memory channel generations only; no DOM, timers, Worker, storage or rendering access.
 * Lifecycle: destroy() invalidates every token and makes future mutation terminal.
 */
const PREVIEW_SCHEDULING_CHANNELS = Object.freeze(['input', 'focus', 'layout', 'enhancement']);
const CHANNEL_SET = new Set(PREVIEW_SCHEDULING_CHANNELS);

function normalizeChannel(value) {
  const channel = String(value || '');
  if (!CHANNEL_SET.has(channel)) {
    throw new RangeError(`Unsupported Preview scheduling channel: ${channel || '<empty>'}.`);
  }
  return channel;
}

function normalizeToken(value) {
  if (!value || typeof value !== 'object') return null;
  const channel = String(value.channel || '');
  const generation = Number(value.generation);
  if (!CHANNEL_SET.has(channel) || !Number.isSafeInteger(generation) || generation < 1) return null;
  return { channel, generation };
}

export function createPreviewCancellation() {
  const generations = new Map(PREVIEW_SCHEDULING_CHANNELS.map(channel => [channel, 0]));
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Preview Cancellation is destroyed.');
  };

  function issue(channelValue) {
    assertActive();
    const channel = normalizeChannel(channelValue);
    const generation = generations.get(channel) + 1;
    generations.set(channel, generation);
    return Object.freeze({ channel, generation });
  }

  function isCurrent(tokenValue) {
    if (destroyed) return false;
    const token = normalizeToken(tokenValue);
    return Boolean(token && generations.get(token.channel) === token.generation);
  }

  function cancel(channelValue) {
    assertActive();
    const channel = normalizeChannel(channelValue);
    generations.set(channel, generations.get(channel) + 1);
    return generations.get(channel);
  }

  function cancelAll() {
    assertActive();
    for (const channel of PREVIEW_SCHEDULING_CHANNELS) {
      generations.set(channel, generations.get(channel) + 1);
    }
  }

  function commit(token, callback) {
    if (typeof callback !== 'function') throw new TypeError('Preview Cancellation commit callback must be a function.');
    if (!isCurrent(token)) return false;
    callback();
    return true;
  }

  return Object.freeze({
    issue,
    isCurrent,
    cancel,
    cancelAll,
    commit,
    destroy() {
      if (destroyed) return;
      for (const channel of PREVIEW_SCHEDULING_CHANNELS) {
        generations.set(channel, generations.get(channel) + 1);
      }
      destroyed = true;
    }
  });
}

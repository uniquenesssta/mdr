/** Deterministic print-document adapter; product surfaces/exporters are never replaced. */
export function createExportPrintDom({ onPrint = () => {}, fontFaces = [] } = {}) {
  const timers = [], frames = [], cleared = [], events = new Map();
  const makeNode = tag => {
    const classes = new Set();
    const node = { tagName: tag.toUpperCase(), dataset: {}, style: {}, children: [], attributes: {}, textContent: '', innerHTML: '',
      classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) },
      setAttribute(key, value) { this.attributes[key] = value; },
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      removeChild(child) { this.children = this.children.filter(x => x !== child); child.parentNode = null; },
      replaceChildren(...children) { for (const c of this.children) c.parentNode = null; this.children = []; for (const c of children) this.appendChild(c); },
      querySelectorAll() { return []; } };
    return node;
  };
  const document = { body: makeNode('body'), createElement(tag) {
    const node = makeNode(tag);
    if (tag === 'iframe') {
      const listeners = new Map();
      const doc = { head: makeNode('head'), body: makeNode('body'), documentElement: {}, fonts: Object.assign([...fontFaces], { ready: Promise.resolve() }),
        createElement: makeNode, importNode(source) { const copy = makeNode('div'); copy.innerHTML = source.innerHTML; copy.className = source.className; return copy; } };
      node.contentDocument = doc;
      node.contentWindow = { addEventListener(name, callback) { listeners.set(name, callback); events.set(name, callback); },
        removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); if (events.get(name) === callback) events.delete(name); },
        dispatchEvent(event) { listeners.get(event.type)?.(); },
        print() { return onPrint(node); } };
      node.listeners = listeners; frames.push(node);
    }
    return node;
  } };
  const setTimer = (callback, delay) => { timers.push({ callback, delay, cancelled: false }); return timers.length; };
  const clearTimer = handle => { if (timers[handle - 1]) timers[handle - 1].cancelled = true; cleared.push(handle); };
  const nextTimer = delay => timers.find(x => x.delay === delay && !x.cancelled);
  async function fire(delay) {
    const timer = nextTimer(delay); if (!timer) throw new Error('No pending print timer: ' + delay);
    timer.cancelled = true; await timer.callback();
  }
  async function untilScheduled() {
    for (let i = 0; i < 2000; i++) { if (nextTimer(80)) return; await Promise.resolve(); }
    throw new Error('PDF preparation did not schedule printing.');
  }
  return { document, timers, frames, cleared, events, makeNode, setTimer, clearTimer, nextTimer, fire, untilScheduled };
}

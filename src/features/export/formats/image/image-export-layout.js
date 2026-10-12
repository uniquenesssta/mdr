import { EXPORT_IMAGE_RATIOS } from './image-ratio-presets.js';
import { ExportCancelledError } from '../../task/export-cancellation.js';

/** Pure pixel geometry. CSS owns box sizing, height/min-height and clipping. */
export function calculateImageLayout(options, naturalHeight) {
  const preset = options && typeof options === 'object' && typeof options.ratio === 'string' && Object.hasOwn(EXPORT_IMAGE_RATIOS, options.ratio) ? EXPORT_IMAGE_RATIOS[options.ratio] : null;
  if (!preset || Array.isArray(options) || options.width !== preset.width || options.height !== preset.height
    || typeof options.cropFit !== 'boolean') throw new TypeError('Canonical image layout options are required.');
  if (naturalHeight !== undefined && (!Number.isFinite(naturalHeight) || naturalHeight < 0 || naturalHeight > Number.MAX_SAFE_INTEGER)) {
    throw new TypeError('Image natural height must be a finite nonnegative pixel measurement.');
  }
  const measured = naturalHeight === undefined ? null : Math.ceil(naturalHeight);
  const mode = measured === null ? 'measure' : measured < preset.height ? 'pad' : options.cropFit ? 'crop' : 'long';
  return Object.freeze({ ratio: options.ratio, width: preset.width, targetHeight: preset.height,
    cropFit: options.cropFit, naturalHeight: measured, mode,
    captureHeight: measured === null ? null : mode === 'long' ? measured : preset.height,
    paddingBlock: Math.round(preset.width * 0.04), paddingInline: Math.round(preset.width * 0.045),
    fontSize: Math.round(preset.width / 36) });
}

const MARKER = 'data-export-image-layout';
const ROOT_PROPS = ['--export-image-width', '--export-image-height', '--export-image-padding-block', '--export-image-padding-inline', '--export-image-font-size'];
const STAGE_PROPS = ['--export-image-width', '--export-image-height'];
function requireRoot(root) {
  if (!root || !['getAttribute', 'hasAttribute', 'setAttribute', 'removeAttribute'].every(key => typeof root[key] === 'function')
    || !['getPropertyValue', 'getPropertyPriority', 'setProperty', 'removeProperty'].every(key => typeof root.style?.[key] === 'function')) {
    throw new TypeError('Image layout requires DOM roots with CSS declaration capabilities.');
  }
}
function capture(root, properties) {
  const marker = root.hasAttribute(MARKER) ? root.getAttribute(MARKER) : null;
  const values = properties.map(name => ({ name, value: root.style.getPropertyValue(name), priority: root.style.getPropertyPriority(name) }));
  return () => {
    const errors = [];
    for (const { name, value, priority } of values) {
      try { if (value) root.style.setProperty(name, value, priority); else root.style.removeProperty(name); }
      catch (error) { errors.push(error); }
    }
    try { if (marker === null) root.removeAttribute(MARKER); else root.setAttribute(MARKER, marker); }
    catch (error) { errors.push(error); }
    return errors;
  };
}

/** Own only reversible layout leases; document, task, assets and encoding belong to their existing owners. */
export function createImageExportLayout() {
  const leases = new Set(), roots = new Map();
  let destroyed = false;
  const requireAlive = () => { if (destroyed) throw new ExportCancelledError('destroyed'); };
  function mount({ root, stage, options } = {}) {
    requireAlive();
    const initial = calculateImageLayout(options);
    requireRoot(root); requireRoot(stage);
    const rootLease = roots.get(root), stageLease = roots.get(stage);
    if (root === stage || (rootLease && rootLease !== stageLease)) throw new Error('Image layout root overlaps another active stage.');
    if (root.ownerDocument && stage.ownerDocument && root.ownerDocument !== stage.ownerDocument) throw new TypeError('Image layout roots must share one document.');
    // A replaced preparation task may still be unwinding; release its stage lease before capturing the next one.
    stageLease?.release();
    const restoreRoot = capture(root, ROOT_PROPS), restoreStage = capture(stage, STAGE_PROPS);
    const snapshot = Object.freeze({ ratio: initial.ratio, width: initial.width, height: initial.targetHeight, cropFit: initial.cropFit });
    let released = false, current = initial;
    const release = () => {
      if (released) return;
      released = true;
      leases.delete(lease);
      if (roots.get(root) === lease) roots.delete(root);
      if (roots.get(stage) === lease) roots.delete(stage);
      const errors = [...restoreRoot(), ...restoreStage()];
      if (errors.length) throw new AggregateError(errors, 'Failed to release image layout cleanly.');
    };
    const project = layout => {
      requireAlive();
      if (released) throw new ExportCancelledError('destroyed');
      root.setAttribute(MARKER, layout.mode); stage.setAttribute(MARKER, layout.mode);
      for (const target of [root, stage]) {
        target.style.setProperty('--export-image-width', layout.width + 'px');
        target.style.setProperty('--export-image-height', layout.captureHeight === null ? 'auto' : layout.captureHeight + 'px');
      }
      root.style.setProperty('--export-image-padding-block', layout.paddingBlock + 'px');
      root.style.setProperty('--export-image-padding-inline', layout.paddingInline + 'px');
      root.style.setProperty('--export-image-font-size', layout.fontSize + 'px');
      current = layout;
      return layout;
    };
    const lease = Object.freeze({ get layout() { return current; }, measure() {
      requireAlive();
      if (released) throw new ExportCancelledError('destroyed');
      try {
        // Reset to natural geometry before reading; remeasuring a cropped root must not reuse a fixed height.
        project(initial);
        const height = root.scrollHeight;
        return project(calculateImageLayout(snapshot, height));
      } catch (error) { try { release(); } catch {} throw error; }
    }, release });
    leases.add(lease); roots.set(root, lease); roots.set(stage, lease);
    try { project(initial); } catch (error) { try { release(); } catch {} throw error; }
    return lease;
  }
  return Object.freeze({ mount, destroy() {
    if (destroyed) return;
    destroyed = true;
    const errors = [];
    for (const lease of [...leases]) { try { lease.release(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Failed to destroy image layout cleanly.');
  } });
}

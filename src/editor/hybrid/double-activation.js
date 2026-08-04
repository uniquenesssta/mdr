export const STRICT_DOUBLE_ACTIVATION_INTERVAL_MS = 420;
export const STRICT_DOUBLE_ACTIVATION_DISTANCE_PX = 8;

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function evaluateStrictDoubleActivation(firstClick, secondClick, options = {}) {
  if (!firstClick || !secondClick) {
    return {
      accepted: false,
      reason: 'missing-click',
      intervalMs: null,
      distancePx: null
    };
  }

  const maxIntervalMs = Math.max(120, finiteNumber(
    options.maxIntervalMs,
    STRICT_DOUBLE_ACTIVATION_INTERVAL_MS
  ));
  const maxDistancePx = Math.max(1, finiteNumber(
    options.maxDistancePx,
    STRICT_DOUBLE_ACTIVATION_DISTANCE_PX
  ));
  const intervalMs = finiteNumber(secondClick.timestamp) - finiteNumber(firstClick.timestamp);
  const deltaX = finiteNumber(secondClick.clientX) - finiteNumber(firstClick.clientX);
  const deltaY = finiteNumber(secondClick.clientY) - finiteNumber(firstClick.clientY);
  const distancePx = Math.hypot(deltaX, deltaY);

  if (firstClick.button !== secondClick.button || secondClick.button !== 0) {
    return { accepted: false, reason: 'button-mismatch', intervalMs, distancePx };
  }
  if (firstClick.targetKey !== secondClick.targetKey) {
    return { accepted: false, reason: 'target-mismatch', intervalMs, distancePx };
  }
  if (intervalMs < 0 || intervalMs > maxIntervalMs) {
    return { accepted: false, reason: 'interval-exceeded', intervalMs, distancePx };
  }
  if (distancePx > maxDistancePx) {
    return { accepted: false, reason: 'distance-exceeded', intervalMs, distancePx };
  }

  return {
    accepted: true,
    reason: 'accepted',
    intervalMs: Number(intervalMs.toFixed(1)),
    distancePx: Number(distancePx.toFixed(1)),
    targetKey: secondClick.targetKey
  };
}

function getClickPoint(event, targetKey) {
  return {
    timestamp: finiteNumber(event.timeStamp, globalThis.performance?.now?.() || Date.now()),
    clientX: finiteNumber(event.clientX),
    clientY: finiteNumber(event.clientY),
    button: finiteNumber(event.button),
    targetKey: String(targetKey || 'root')
  };
}

export function bindStrictDoubleActivation(element, onActivate, options = {}) {
  if (!element?.addEventListener || typeof onActivate !== 'function') {
    throw new TypeError('严格双击绑定需要有效元素和处理函数');
  }

  let firstClick = null;
  const isExcluded = event => Boolean(options.exclude?.(event));
  const resolveTargetKey = event => String(options.getTargetKey?.(event) || 'root');

  const handleClick = event => {
    if (event.defaultPrevented || event.button !== 0 || isExcluded(event)) {
      firstClick = null;
      return;
    }

    const detail = Number(event.detail) || 0;
    const clickPoint = getClickPoint(event, resolveTargetKey(event));
    if (detail === 1) {
      firstClick = clickPoint;
      return;
    }
    if (detail !== 2) {
      firstClick = null;
      return;
    }

    const result = evaluateStrictDoubleActivation(firstClick, clickPoint, options);
    firstClick = null;
    if (!result.accepted) {
      options.onRejected?.(result, event);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onActivate(event, result);
  };

  const suppressNativeDoubleClick = event => {
    if (isExcluded(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  element.addEventListener('click', handleClick);
  element.addEventListener('dblclick', suppressNativeDoubleClick);
  return () => {
    firstClick = null;
    element.removeEventListener('click', handleClick);
    element.removeEventListener('dblclick', suppressNativeDoubleClick);
  };
}

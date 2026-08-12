/**
 * Responsibility: Pure native-path comparison and parent-directory policy for Folder Tree.
 * Imports: None.
 * Exports: normalizeNativePath, isSameNativePath, isNativePathWithinDirectory, getNativeParentPath.
 * State/side effects: None.
 * Lifecycle: Pure.
 */

export function normalizeNativePath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function isWindowsLikePath(value) {
  const path = String(value || '');
  return /^[a-z]:[\\/]/i.test(path) || /^\\\\/.test(path);
}

function comparableNativePath(value) {
  const normalized = normalizeNativePath(value);
  if (!normalized) return '';
  return isWindowsLikePath(value) ? normalized.toLocaleLowerCase() : normalized;
}

export function isSameNativePath(left, right) {
  const normalizedLeft = comparableNativePath(left);
  const normalizedRight = comparableNativePath(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function isNativePathWithinDirectory(filePath, directoryPath) {
  const file = comparableNativePath(filePath);
  const directory = comparableNativePath(directoryPath);
  if (!file || !directory) return false;
  return file === directory || file.startsWith(`${directory}/`);
}

export function getNativeParentPath(value) {
  const path = String(value || '').trim().replace(/[\\/]+$/, '');
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (separatorIndex < 0) return '';
  if (separatorIndex === 2 && /^[a-z]:/i.test(path)) return path.slice(0, 3);
  if (separatorIndex === 0) return path.slice(0, 1);
  return path.slice(0, separatorIndex);
}

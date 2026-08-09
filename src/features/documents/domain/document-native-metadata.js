/**
 * Responsibility: Canonicalize native document-store metadata without narrowing values accepted by the legacy runtime.
 * State/side effects: Pure.
 */
export function normalizeDocumentNativeMetadata({ nativeBacked = false, nativeVersion = 0 } = {}) {
  return Object.freeze({
    nativeBacked: Boolean(nativeBacked),
    nativeVersion: Number(nativeVersion) || 0
  });
}

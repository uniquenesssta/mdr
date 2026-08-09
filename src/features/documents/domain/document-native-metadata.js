/**
 * Responsibility: Canonicalize native document-store metadata used by document records and storage sessions.
 * State/side effects: Pure.
 */
export function normalizeDocumentNativeMetadata({ nativeBacked = false, nativeVersion = 0 } = {}) {
  const numericVersion = Number(nativeVersion);
  const normalizedVersion = Number.isFinite(numericVersion)
    ? Math.max(0, Math.trunc(numericVersion))
    : 0;
  return Object.freeze({
    nativeBacked: Boolean(nativeBacked),
    nativeVersion: normalizedVersion
  });
}

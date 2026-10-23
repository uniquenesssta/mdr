import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BUILD_FINGERPRINT_FILE, assertFingerprintEntries, createSourceFingerprint, fingerprintEntries, fingerprintFiles } from '../../../scripts/build/source-fingerprint.mjs';

function rejectBuild(reason, detail = '') {
  const error = new Error('Built dist is stale or was not produced from the current source. [' + reason + ']'
    + (detail ? ' ' + detail + '.' : '') + ' Run npm run build before npm run test:browser.');
  error.code = 'STALE_DIST'; error.reason = reason;
  throw error;
}

export async function verifyBuiltApplication({ projectRoot, distRoot = resolve(projectRoot, 'dist') }) {
  let text, manifest;
  try { text = await readFile(resolve(distRoot, BUILD_FINGERPRINT_FILE), 'utf8'); }
  catch (error) { rejectBuild(error.code === 'ENOENT' ? 'manifest-missing' : 'manifest-unreadable'); }
  try {
    manifest = JSON.parse(text);
    if (manifest.schemaVersion !== 1) throw new Error('Unsupported manifest');
    assertFingerprintEntries(manifest.source.files);
    assertFingerprintEntries(manifest.outputs);
    if (manifest.source.sha256 !== fingerprintEntries(manifest.source.files)
      || !manifest.outputs.some(entry => entry.path === 'index.html')
      || manifest.outputs.some(entry => entry.path === BUILD_FINGERPRINT_FILE)) throw new Error('Invalid manifest');
  } catch { rejectBuild('manifest-invalid'); }
  const sourceNow = async () => {
    try { return await createSourceFingerprint(projectRoot); }
    catch { rejectBuild('source-unreadable'); }
  };
  const source = await sourceNow();
  if (source.sha256 !== manifest.source.sha256) {
    const old = new Map(manifest.source.files.map(entry => [entry.path, entry.sha256]));
    const current = new Map(source.files.map(entry => [entry.path, entry.sha256]));
    const changed = [...new Set([...old.keys(), ...current.keys()])].sort().filter(path => old.get(path) !== current.get(path));
    rejectBuild('source-changed', changed.slice(0, 5).join(', ') + (changed.length > 5 ? ' (and more)' : ''));
  }
  for (const entry of manifest.outputs) {
    let actual;
    try { [actual] = await fingerprintFiles(distRoot, [entry.path]); }
    catch { rejectBuild('output-missing', entry.path); }
    if (actual.sha256 !== entry.sha256) rejectBuild('output-changed', entry.path);
  }
  if ((await sourceNow()).sha256 !== source.sha256) rejectBuild('source-changed-during-check');
  return { accepted: true, sourceSha256: source.sha256, sourceFiles: source.files.length, outputFiles: manifest.outputs.length };
}

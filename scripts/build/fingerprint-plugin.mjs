import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BUILD_FINGERPRINT_FILE, createSourceFingerprint, fingerprintFiles } from './source-fingerprint.mjs';

// One build-local snapshot. Never install a browser global or collect runtime data.
export function buildFingerprintPlugin() {
  let root, outDir, source;
  return {
    name: 'build-fingerprint',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { root = config.root; outDir = resolve(root, config.build.outDir); },
    async buildStart() { source = await createSourceFingerprint(root); },
    async writeBundle(options, bundle) {
      const current = await createSourceFingerprint(root);
      if (!source || current.sha256 !== source.sha256) throw new Error('[build-fingerprint] Source changed during build; run npm run build again.');
      const names = new Set(Object.values(bundle).map(item => item.fileName));
      for (const file of source.files) if (file.path.startsWith('public/')) names.add(file.path.slice('public/'.length));
      if (names.has(BUILD_FINGERPRINT_FILE)) throw new Error('[build-fingerprint] Reserved output filename: ' + BUILD_FINGERPRINT_FILE);
      const directory = options.dir ? resolve(root, options.dir) : outDir;
      const outputs = await fingerprintFiles(directory, names);
      if (!outputs.some(entry => entry.path === 'index.html')) throw new Error('[build-fingerprint] Missing emitted index.html');
      await writeFile(resolve(directory, BUILD_FINGERPRINT_FILE), JSON.stringify({ schemaVersion: 1, source, outputs }, null, 2) + '\n');
    }
  };
}

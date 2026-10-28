import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const target = /[\\/]@codemirror[\\/]language[\\/]dist[\\/]index\.js$/;
const slices = ['100 /* Work.Slice */', '25 /* Work.MinSlice */'];

/** The installed 6.12.4 parser exposes no scheduling-budget option. Change
 * only its two idle-slice constants; keep grammar, incremental parsing, total
 * work budget and progress checks intact. Dependency drift fails the build.
 */
export function applyCodeMirrorParseBudget(source) {
  if (!source.includes('class ParseWorker') || !source.includes('field.context.work(() =>')) {
    throw new Error('Unsupported CodeMirror parser scheduler; review the scheduling patch.');
  }
  for (const marker of slices) {
    if (source.split(marker).length !== 2) throw new Error('CodeMirror scheduling seam changed: ' + marker);
  }
  return source.replace(slices[0], '8 /* Work.Slice */').replace(slices[1], '8 /* Work.MinSlice */');
}

export function codeMirrorParseBudgetPlugin() {
  async function patch(source, path) {
    const metadata = JSON.parse(await readFile(resolve(dirname(path), '../package.json'), 'utf8'));
    if (metadata.version !== '6.12.4') throw new Error('Review CodeMirror parse budget for version ' + metadata.version);
    return applyCodeMirrorParseBudget(source);
  }
  return {
    name: 'codemirror-parse-budget', enforce: 'pre',
    config() {
      return { optimizeDeps: { esbuildOptions: { plugins: [{ name: 'codemirror-parse-budget', setup(build) {
        build.onLoad({ filter: target }, async ({ path }) => ({ contents: await patch(await readFile(path, 'utf8'), path), loader: 'js', resolveDir: dirname(path) }));
      } }] } } };
    },
    async transform(source, id) {
      const path = id.split('?')[0];
      return target.test(path) ? { code: await patch(source, path), map: null } : null;
    }
  };
}

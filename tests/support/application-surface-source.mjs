// R16-02 assertion-intent routing: retired classic surfaces resolve to their current ESM owners.
// No historical source fallback; missing current owners always fail. Filesystem access/existence tests stay native.
import { readFile as read } from 'node:fs/promises';
import { readFileSync as readSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
export const applicationSurfaceOwners = Object.freeze({
  "public/app/core.js": [
    "src/features/documents/ui/document-workspace.js",
    "src/features/menu/shell-menus.js",
    "src/features/persistence/ui/workspace-status.js",
    "src/features/layout/workspace-preferences.js"
  ],
  "public/app/bootstrap.js": [
    "src/bootstrap/workspace-startup.js"
  ],
  "public/app/editor-tools.js": [
    "src/features/layout/workspace-preferences.js"
  ],
  "public/app/events.js": [
    "src/bootstrap/application-events.js"
  ],
  "public/app/web-clipper.js": [
    "src/features/editor/application/find-preview-commands.js"
  ]
});
function paths(path) {
  const text = path instanceof URL ? fileURLToPath(path) : String(path);
  const normalized = text.replaceAll('\\', '/');
  const key = Object.keys(applicationSurfaceOwners).find(key => normalized === key || normalized.endsWith('/' + key));
  return key ? applicationSurfaceOwners[key].map(owner => new URL(owner, root)) : [path];
}
export async function readFile(path, options) {
  const targets = paths(path);
  if (targets.length === 1) return read(targets[0], options);
  const values = await Promise.all(targets.map(target => read(target, options)));
  return typeof values[0] === 'string' ? values.join('\n') : Buffer.concat(values);
}
export function readFileSync(path, options) {
  const values = paths(path).map(target => readSync(target, options));
  return typeof values[0] === 'string' ? values.join('\n') : Buffer.concat(values);
}

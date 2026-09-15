/** Archive the new Linux-only Tauri schema produced by an isolated CI build.
 * Never touch tracked files, symbolic links, different schema content or other outputs.
 * The caller owns the clean pre-build check and the final unchanged-worktree gate.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function archiveTauriLinuxSchema(root, evidenceDirectory) {
  const relativePath = 'src-tauri/gen/schemas/linux-schema.json';
  const generated = join(root, relativePath);
  let stat;
  try {
    stat = lstatSync(generated);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Refusing non-regular generated schema');
  const tracked = execFileSync('git', ['ls-files', '--', relativePath], { cwd: root, encoding: 'utf8' });
  if (tracked.trim()) throw new Error('Refusing tracked schema');
  const bytes = readFileSync(generated);
  const desktop = readFileSync(join(root, 'src-tauri/gen/schemas/desktop-schema.json'));
  if (!bytes.equals(desktop)) throw new Error('Generated Linux schema differs from desktop schema');
  const destination = join(evidenceDirectory, 'generated-schemas', 'linux-schema.json');
  if (existsSync(destination)) throw new Error('Refusing to overwrite existing schema evidence');
  mkdirSync(join(evidenceDirectory, 'generated-schemas'), { recursive: true });
  renameSync(generated, destination);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.RUNNER_TEMP) throw new Error('RUNNER_TEMP is required for CI evidence');
  const evidence = join(process.env.RUNNER_TEMP, 'r12-08');
  console.log(archiveTauriLinuxSchema(process.cwd(), evidence)
    ? 'Archived generated linux-schema.json after exact desktop-schema comparison'
    : 'No new Linux schema to archive');
}

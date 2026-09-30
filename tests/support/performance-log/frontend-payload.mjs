// Exercise the actual runtime and desktop adapter without installing DOM observers.
// Rust executes this producer too; no hand-written replacement payload is used.
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createPerformanceLogClient } from '../../../src/platform/desktop/performance-log-client.js';

export const secrets = ['AUDIT_BODY_SECRET', 'AUDIT_TOKEN_SECRET', 'AUDIT_ERROR_SECRET', 'C:\\PrivateRoot', '/private/root', 'AUDIT_STACK_SECRET', 'AUDIT_CAUSE_SECRET', 'AUDIT_PASSWORD_SECRET', 'AUDIT_GETTER_SECRET'];
export async function producePayload() {
  const path = new URL('../../../src/runtime/performance.js', import.meta.url);
  const source = (await readFile(path, 'utf8')).replaceAll('export function ', 'function ')
    .replaceAll('import.meta.env.DEV', 'false');
  const context = vm.createContext({ crypto: { randomUUID }, console, performance, setTimeout, clearTimeout });
  vm.runInContext(source + '\n;globalThis.runtime = {configurePerformancePlatform, record, diagnostic, measure, flush};', context, {filename: fileURLToPath(path)});
  const batches = [];
  const logs = createPerformanceLogClient({ invoke: async (command, args, details, options) => {
    if (command !== 'write_performance_logs' || options.record !== false) throw new Error('Wrong log command boundary');
    batches.push(JSON.parse(JSON.stringify(args.entries)));
    return 'test-log-path';
  }});
  const runtime = context.runtime;
  runtime.configurePerformancePlatform({logs, enabled: true});
  const nested = { body: secrets[0], token: secrets[1], path: secrets[3] + '\\note.md', count: 7 };
  const cycle = {}; cycle.self = cycle;
  const exceptional = Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error(secrets[8]); } });
  runtime.record('runtime.snapshot', { category:'runtime.performance', durationMs: 12.5, details: {
    nested, encoded: JSON.stringify(nested), twice: JSON.stringify(JSON.stringify(nested)),
    error: 'Cannot open ' + secrets[3] + '; token=' + secrets[2],
    message: secrets[0], reason: secrets[1], stack: secrets[5],
    errorChain: { message: secrets[2], count: 2, cause: {
      reason: secrets[6], password: secrets[7], path: secrets[3] + '\\cause.md', count: 1,
      causes: [{ stack: secrets[5], token: secrets[1], count: 4 }]
    } },
    exceptional,
    array: [nested, secrets[0], { path: secrets[4] + '/other.md', count: 3 }],
    cycle, invalid: 1n, notFinite: Infinity, items: Array(50).fill({count:1}),
    contentType:'text/html', contentLength:2048, hasDocumentPath:true
  }});
  runtime.diagnostic('runtime.error', {category:'runtime.error', status:'warning', details:{message:secrets[2], nested}});
  try { runtime.measure('runtime.error', () => { throw new Error(secrets[2]); }, {category:'runtime.error'}); } catch {}
  await runtime.flush();
  return { entries: batches.flat(), secrets };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await producePayload()));
}

// Earlier extraction tests still compare frozen whole-file layouts. Reassemble
// only the R12-17 moved imports/bodies from their CURRENT owners for those tests.
// Never load baseline bytes here. The R12-17 suite checks the actual files,
// complete inventory and registration paths without this historical projection.
import { readFile as readActual } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const modules = ['external_link', 'web_fetch', 'performance_log'];
const descriptions = {
  external_link: 'External-link Tauri command: validate once, then delegate to the private operating-system opener.',
  web_fetch: 'HTTP fetch orchestration and command telemetry; delegates input, client and response handling.',
  performance_log: 'Performance log command and backend measurement/lifecycle envelopes; delegates session paths and JSONL persistence.'
};
export async function readFileBeforeRegistry(input, encoding) {
  const absolute = input instanceof URL ? fileURLToPath(input) : path.resolve(input);
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  const module = modules.find(name => relative === `src-tauri/src/${name}.rs`);
  if (module) {
    const [entry, command] = await Promise.all(['mod', 'command'].map(name => readActual(path.join(root, `src-tauri/src/${module}/${name}.rs`), 'utf8')));
    let text = entry.replace('pub(crate) mod command;\n', '').replaceAll('../../tests/', '../tests/');
    const body = command.slice(command.indexOf(module === 'web_fetch' ? 'async fn fetch_url_inner' : '#[tauri::command]')).trimEnd() + '\n\n';
    if (module === 'external_link') {
      text = text.replace('#[cfg(test)]\nuse command::open_external_url;\n#[cfg(test)]\n', 'use opener::open_platform_url;\n');
      text = text.replace('#[cfg(test)]\nmod tests', body + '#[cfg(test)]\nmod tests');
    } else if (module === 'web_fetch') {
      text = 'use serde_json::json;\n' + text.replace('#[cfg(test)]\nuse command::fetch_url;\n', 'use client::build_client;\nuse response::read_response;\n')
        .replace('#[cfg(test)]\nuse validation::normalize_url;', 'use validation::normalize_url;');
      text = text.replace('// R12-01', body + '// R12-01');
    } else {
      text = text.replace('#[cfg(test)]\nuse command::write_performance_logs;\n', '');
      text = text.replace('#[cfg(all(test, debug_assertions))]', body + '#[cfg(all(test, debug_assertions))]');
    }
    return text;
  }
  let text = await readActual(input, encoding);
  if (relative === 'src-tauri/src/main.rs') return text.replaceAll('::command::', '::');
  if (relative === 'src-tauri/tests/stage_12_security_compatibility.rs') {
    text = text.replace('    include_str!("../src/performance_log/mod.rs"),\n', '');
    for (const name of modules) text = text.replaceAll(`../src/${name}/command.rs`, `../src/${name}.rs`);
  }
  if (relative === 'tests/architecture/fixtures/production-modules.json') {
    return JSON.stringify(inventoryBeforeRegistryExtraction(JSON.parse(text)));
  }
  return text;
}

export function inventoryBeforeRegistryExtraction(input) {
  const inventory = { ...input };
    inventory.modules = inventory.modules.filter(row => !modules.some(name => row[0] === `src-tauri/src/${name}/command.rs`)).map(row => {
      const name = modules.find(name => row[0] === `src-tauri/src/${name}/mod.rs`);
      if (!name) return row;
      const restored = [...row];
      restored[0] = `src-tauri/src/${name}.rs`;
      restored[3] = descriptions[name];
      return restored;
    });
  return inventory;
}

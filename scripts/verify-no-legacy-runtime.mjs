import { checkLegacyRuntime, writeArchitectureBaseline } from './architecture/checks.mjs';
import { runArchitectureCli } from './architecture/cli.mjs';

await runArchitectureCli({
  name: 'verify-no-legacy-runtime',
  check: checkLegacyRuntime,
  writeBaseline: writeArchitectureBaseline
});

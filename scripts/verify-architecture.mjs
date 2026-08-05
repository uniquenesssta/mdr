import { checkArchitecture, writeArchitectureBaseline } from './architecture/checks.mjs';
import { runArchitectureCli } from './architecture/cli.mjs';

await runArchitectureCli({
  name: 'verify-architecture',
  check: checkArchitecture,
  writeBaseline: writeArchitectureBaseline
});

import { checkGeneratedFiles } from './architecture/checks.mjs';
import { runArchitectureCli } from './architecture/cli.mjs';

await runArchitectureCli({
  name: 'verify-generated-files',
  check: checkGeneratedFiles
});

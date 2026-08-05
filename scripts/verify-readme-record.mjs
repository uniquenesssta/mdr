import { checkReadmeRecord } from './architecture/checks.mjs';
import { runArchitectureCli } from './architecture/cli.mjs';

await runArchitectureCli({
  name: 'verify-readme-record',
  check: checkReadmeRecord
});

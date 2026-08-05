import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

export function parseArchitectureArguments(argv = process.argv.slice(2)) {
  const values = {};
  for (const argument of argv) {
    if (argument === '--write-baseline') values.writeBaseline = true;
    else if (argument.startsWith('--root=')) values.root = resolve(argument.slice('--root='.length));
    else if (argument.startsWith('--baseline=')) values.baselinePath = argument.slice('--baseline='.length);
    else if (argument.startsWith('--output=')) values.output = argument.slice('--output='.length);
    else throw new Error(`Unknown architecture verification argument: ${argument}`);
  }
  return values;
}

function issueLocation(issue) {
  const line = issue.line ? `:${issue.line}` : '';
  const column = issue.column ? `:${issue.column}` : '';
  return `${issue.path}${line}${column}`;
}

export async function runArchitectureCli({ name, check, writeBaseline = null }) {
  try {
    const options = parseArchitectureArguments();
    if (options.writeBaseline) {
      if (typeof writeBaseline !== 'function') {
        throw new Error(`${name} does not support --write-baseline.`);
      }
      const baseline = await writeBaseline(options);
      console.log(`[${name}] wrote exact migration baseline for ${baseline.sourceCommit || 'unknown commit'}.`);
      return;
    }

    const issues = await check(options);
    if (options.output) {
      const output = resolve(options.root || process.cwd(), options.output);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify({
        checker: name,
        status: issues.length === 0 ? 'passed' : 'failed',
        issueCount: issues.length,
        issues
      }, null, 2)}\n`, 'utf8');
    }
    if (issues.length === 0) {
      console.log(`[${name}] passed.`);
      return;
    }
    for (const issue of issues) {
      console.error(`[${name}] ${issue.rule} ${issueLocation(issue)} - ${issue.message}`);
      if (issue.detail) console.error(`  ${typeof issue.detail === 'string' ? issue.detail : JSON.stringify(issue.detail)}`);
    }
    console.error(`[${name}] failed with ${issues.length} architecture violation(s).`);
    process.exitCode = 1;
  } catch (error) {
    console.error(`[${name}] ${error.stack || error.message || error}`);
    process.exitCode = 1;
  }
}

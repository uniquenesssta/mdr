import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChromium } from './lib/cdp-browser.mjs';
import { createApplicationDriver } from './lib/application-driver.mjs';
import { startBuiltApplicationHost } from './lib/built-application-host.mjs';
import { runFigmaUiChecks } from './lib/figma-ui-checks.mjs';
import { verifyBuiltApplication } from './lib/built-application-check.mjs';
import { resolve } from 'node:path';

const artifacts = process.env.E2E_ARTIFACT_DIR || await mkdtemp(join(tmpdir(), 'mdr-figma-ui-'));
await mkdir(artifacts, { recursive: true });
const suppliedUrl = process.argv.find(arg => arg.startsWith('--url='))?.slice(6);
const buildDirectory = process.argv.find(arg => arg.startsWith('--dist='))?.slice(7) || 'dist';
const admission = suppliedUrl ? null : await verifyBuiltApplication({ projectRoot: process.cwd(), distRoot: resolve(buildDirectory) });
const host = suppliedUrl ? null : await startBuiltApplicationHost(buildDirectory);
const browser = await launchChromium({ width: 1440, height: 960 });
try {
  const page = browser.page;
  await page.addInitScript(`localStorage.setItem('md_editor_help_shown','true');`);
  await page.connection.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(artifacts, 'downloads') });
  await page.navigate((suppliedUrl || host.origin) + '/?e2e=1');
  await page.waitFor(() => document.documentElement.classList.contains('app-ready'), { timeoutMs: 20000 });
  const report = await runFigmaUiChecks({ page, app: createApplicationDriver(page), artifacts });
  report.environment = await page.connection.send('Browser.getVersion');
  report.source = { type: suppliedUrl ? 'external-server' : 'local-built-bytes', url: suppliedUrl || host.origin, buildDirectory: suppliedUrl ? null : buildDirectory };
  report.admission = admission;
  await writeFile(join(artifacts, 'figma-ui-results.json'), JSON.stringify(report, null, 2));
  console.log(`Figma UI: ${report.checks.length} checks passed. Evidence: ${artifacts}`);
} catch (error) {
  await browser.page.screenshot(join(artifacts, 'figma-failure.png'));
  await writeFile(join(artifacts, 'figma-ui-failure.json'), JSON.stringify({ error: error.stack, exceptions: browser.page.exceptions, console: browser.page.consoleMessages.filter(row => row.type === 'error') }, null, 2));
  throw error;
} finally {
  await browser.page.connection.send('Browser.close').catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 500));
  await browser.close(); await host?.close();
}

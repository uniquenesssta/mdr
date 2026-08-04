import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function replaceExactly(path, before, after, label) {
  const absolutePath = resolve(path);
  const source = await readFile(absolutePath, 'utf8');
  if (source.includes(after)) {
    console.log(`${label}: already applied`);
    return false;
  }
  const first = source.indexOf(before);
  const last = source.lastIndexOf(before);
  if (first < 0) throw new Error(`${label}: expected source block was not found`);
  if (first !== last) throw new Error(`${label}: expected source block is not unique`);
  await writeFile(absolutePath, source.slice(0, first) + after + source.slice(first + before.length), 'utf8');
  console.log(`${label}: applied`);
  return true;
}

const changes = [];

changes.push(await replaceExactly(
  'tests/e2e/run-browser-tests.mjs',
  `      await browser.page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type="code"]')), { description: 'closed code widget' });
      await browser.page.waitFor(() => document.getElementById('editor')?.virtualEditor?.getPresentationStats?.().sourceActiveLines === 1, { description: 'trailing source active line' });
      const snapshot = await browser.page.evaluate`,
  `      await browser.page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type="code"]')), { description: 'closed code widget' });
      const trailingPoint = await browser.page.evaluate(\`(()=>{
        const widget=document.querySelector('[data-hybrid-block-type="code"]');
        const scroller=document.querySelector('.cm-scroller');
        if(!widget||!scroller)return null;
        const widgetRect=widget.getBoundingClientRect();
        const scrollerRect=scroller.getBoundingClientRect();
        return {
          x:Math.max(scrollerRect.left+12,Math.min(scrollerRect.right-12,widgetRect.left+24)),
          y:Math.max(widgetRect.bottom+8,Math.min(scrollerRect.bottom-12,widgetRect.bottom+24))
        };
      })()\`);
      if (!trailingPoint) throw new Error('Unable to resolve trailing editor click point');
      await browser.page.clickAt(trailingPoint.x, trailingPoint.y);
      await browser.page.waitFor(() => {
        const editor=document.getElementById('editor');
        return editor?.selectionStart===editor?.textLength
          && editor?.virtualEditor?.getPresentationStats?.().sourceActiveLines===1;
      }, { description: 'trailing source active line' });
      const snapshot = await browser.page.evaluate`,
  'real trailing-line pointer activation'
));

changes.push(await replaceExactly(
  'tests/e2e/lib/cdp-browser.mjs',
  `export async function launchChromium(options = {}) {`,
  `async function removeProfileDirectory(path, attempts = 8) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code) || attempt >= attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)));
    }
  }
  if (lastError) throw lastError;
}

export async function launchChromium(options = {}) {`,
  'bounded Chromium profile cleanup helper'
));

changes.push(await replaceExactly(
  'tests/e2e/lib/cdp-browser.mjs',
  `        await rm(profileDir, { recursive: true, force: true });`,
  `        await removeProfileDirectory(profileDir);`,
  'successful Chromium profile cleanup'
));

changes.push(await replaceExactly(
  'tests/e2e/lib/cdp-browser.mjs',
  `    await rm(profileDir, { recursive: true, force: true });
    throw new Error`,
  `    await removeProfileDirectory(profileDir);
    throw new Error`,
  'failed-launch Chromium profile cleanup'
));

console.log(changes.some(Boolean)
  ? 'Pointer and Chromium cleanup fixes updated the working tree.'
  : 'Pointer and Chromium cleanup fixes made no changes.');

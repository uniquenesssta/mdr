import assert from 'node:assert/strict';
import { join } from 'node:path';
/** Compare content geometry, rather than only checking that a CSS rule changed. */
export async function runQuoteHeightChecks({ page, app, artifacts }) {
  const checks = [];
  for (const width of [1280, 600]) {
    await page.setViewport({ width, height: 860 });
    for (const [name, quote] of [['single', '> 单行引用。'], ['wrapped', '> ' + '随内容自然换行，保留一致的上下间距。'.repeat(8)], ['multiline', '> 第一行。\n> 第二行。']]) {
      await app.loadMarkdown('# 引用高度\n\n' + quote, { layout: 'hybrid', selection: 0 });
      await app.waitForIdle();
      const geometry = await page.evaluate(`(()=>{const q=[...document.querySelectorAll('.cm-hybrid-blockquote')];const first=q[0],last=q.at(-1);return {height:last.getBoundingClientRect().bottom-first.getBoundingClientRect().top,top:parseFloat(getComputedStyle(first).paddingTop),bottom:parseFloat(getComputedStyle(last).paddingBottom),line:parseFloat(getComputedStyle(first).lineHeight),count:q.length};})()`);
      assert.equal(geometry.top, 24); assert.equal(geometry.bottom, 24);
      if (name === 'single') assert.equal(geometry.height, geometry.line + 48, `${width}: single-line quote has no spare line`);
      else assert.ok(geometry.height >= geometry.line * 2 + 48);
      checks.push(`content-driven quote ${name} at ${width}`);
    }
    await page.screenshot(join(artifacts, `quotes-${width}.png`));
  }
  return checks;
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './lib/cdp-browser.mjs';
import { installVirtualFileHost } from './lib/virtual-file-host.mjs';

const fixtures = JSON.parse(await readFile(new URL('../fixtures/stage-13-html-markdown/cases.json', import.meta.url), 'utf8'));
const imports = {};
for (const name of ['dompurify', 'marked']) imports[name] = 'data:text/javascript;base64,' + (await readFile(new URL(import.meta.resolve(name)))).toString('base64');
const browser = await launchChromium();
let host;
try {
  host = await installVirtualFileHost(browser.page, { root: fileURLToPath(new URL('../../', import.meta.url)), origin: 'https://markdown-editor.test' });
  await browser.page.setDocumentContent(`<!doctype html><head><script type="importmap">${JSON.stringify({ imports })}</script></head><body></body>`);
  const results = await browser.page.evaluate(`(async () => {
    const base = ${JSON.stringify(host.origin)};
    const { htmlToMarkdown, convertExtractedHtml, extractHtml } = await import(base + '/src/features/import/index.js');
    const { marked } = await import('marked');
    const { createPreviewDomRenderer } = await import(base + '/src/features/preview/render/preview-dom-renderer.js');
    const { createPreviewBlockView } = await import(base + '/src/features/preview/render/preview-block-view.js');
    const { renderHtmlBlockSource } = await import(base + '/src/features/hybrid-editor/widgets/html/html-block-view.js');
    const parse = html => { const template = document.createElement('template'); template.innerHTML = html; return template.content; };
    const outputs = ${JSON.stringify(fixtures)}.map(item => htmlToMarkdown(parse(item.html)));
    const metadata = convertExtractedHtml({ content: parse('<h1>Title</h1><p>Body</p>'), meta: {title: 'Title', author: '[x](javascript:alert(1))', published: 'today\\n# forged'} });
    const prefix = convertExtractedHtml({ content: parse('<h1>Title extended</h1>'), meta: {title: 'Title'} });
    window.attackCount = 0;
    const hostile = '<article><p>&lt;img src=x onerror=window.attackCount++&gt; **literal**</p><a href="jav&#97;script:window.attackCount++" onclick="window.attackCount++">bad</a><img src="javascript:window.attackCount++" onerror="window.attackCount++" alt="bad"><script>window.attackCount++</script><p>safe <strong>bold</strong></p></article>';
    const attackMarkdown = convertExtractedHtml(extractHtml(hostile));
    const encoded = ['javascript:alert(1)', 'java&#10;script:alert(1)', 'data:text/html,bad', 'vbscript:bad', '//evil.test', 'javascript%3Aalert(1)'].map(url => htmlToMarkdown(parse('<a href="' + url + '">link</a><img src="' + url + '" alt="image">')));
    const raster = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    const normal = htmlToMarkdown(parse('<h2>Heading</h2><p><strong>bold</strong><img src="' + raster + '" alt="pixel"></p><pre><code class="language-js">const x = 1;</code></pre><table><tr><th>A</th></tr><tr><td>B</td></tr></table>'));
    const blockView = createPreviewBlockView({ documentRef: document });
    const preview = document.createElement('div'), hybrid = document.createElement('div');
    document.body.append(preview, hybrid);
    const renderer = createPreviewDomRenderer({ root: preview, documentRef: document, blockView });
    const html = marked.parse(attackMarkdown + '\\n\\n' + normal, { gfm: true });
    renderer.patchHtml(html);
    renderHtmlBlockSource(hybrid, html, document);
    for (const root of [preview, hybrid]) for (const anchor of root.querySelectorAll('a')) anchor.click();
    await new Promise(resolve => setTimeout(resolve, 50));
    const surfaces = [preview, hybrid].map(root => ({
      active: Boolean(root.querySelector('script,iframe,svg,[onclick],[onerror],a[href^="javascript:"]')),
      text: root.textContent, image: root.querySelector('img')?.getAttribute('src'),
      table: root.querySelector('table')?.textContent, code: root.querySelector('pre code')?.textContent,
      bold: root.querySelector('strong')?.textContent
    }));
    let invalid = false; try { htmlToMarkdown(null); } catch (error) { invalid = error instanceof TypeError; }
    renderer.destroy(); blockView.destroy();
    return { outputs, metadata, prefix, encoded, surfaces, attackCount: window.attackCount, raster, invalid };
  })()`);
  fixtures.forEach((fixture, index) => assert.equal(results.outputs[index], fixture.markdown, fixture.name));
  assert.equal(results.metadata, '# Title\n\n> 作者：\\[x\\]\\(javascript:alert\\(1\\)\\) | 发布时间：today \\# forged\n\nBody');
  assert.equal(results.prefix, '# Title\n\n# Title extended');
  // The shared image URL policy allows relative image paths; encoded scheme text stays a path, never a script scheme.
  results.encoded.slice(0, 5).forEach(value => assert.equal(value, 'linkimage'));
  assert.equal(results.encoded[5], 'link![image](javascript%3Aalert%281%29)');
  assert.equal(results.attackCount, 0); assert.equal(results.invalid, true);
  for (const surface of results.surfaces) {
    assert.equal(surface.active, false); assert.equal(surface.image, results.raster);
    assert.match(surface.text, /<img src=x onerror=window.attackCount\+\+>/);
    assert.match(surface.text, /\*\*literal\*\*/); assert.match(surface.table, /A/); assert.match(surface.table, /B/);
    assert.equal(surface.code, 'const x = 1;\n'); assert.equal(surface.bold, 'bold');
  }
  assert.deepEqual(host.errors, []);
  console.log('ok - R13.11 fixed Markdown fixtures and conversion through actual Preview/Hybrid HTML sinks');
} finally {
  try { await host?.close(); } finally { await browser.close(); }
}

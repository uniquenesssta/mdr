import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { launchChromium } from './lib/cdp-browser.mjs';

const require = createRequire(import.meta.url);
const sources = new Map(await Promise.all([
  ['/src/features/import/web-clipper/html-extractor.js', new URL('../../src/features/import/web-clipper/html-extractor.js', import.meta.url)],
  ['/src/shared/security/document-html.js', new URL('../../src/shared/security/document-html.js', import.meta.url)],
  ['/purify.js', require.resolve('dompurify').replace(/purify\.cjs\.js$/, 'purify.es.mjs')]
].map(async ([route, path]) => [route, await readFile(path, 'utf8')])));
const resourceRequests = [];
const server = createServer((request, response) => {
  if (request.url.startsWith('/probe')) resourceRequests.push(request.url);
  const source = sources.get(request.url);
  response.writeHead(200, { 'Content-Type': source ? 'text/javascript' : 'text/html' });
  response.end(source || '<!doctype html><script type="importmap">{"imports":{"dompurify":"/purify.js"}}</script>');
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await launchChromium();
  await browser.page.navigate(origin);
  await browser.page.waitFor(`location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`);
  const result = await browser.page.evaluate(`(async () => {
    const { extractHtml } = await import('/src/features/import/web-clipper/html-extractor.js');
    window.executed = 0;
    customElements.define('probe-element', class extends HTMLElement { constructor() { super(); window.executed++; } });
    const source = '<!doctype html><html><head><title> 标题 &amp; 测试 </title><meta name="author" content="作者"><meta name="date" content="2026-10-01"><link rel="stylesheet" href="/probe-css"></head><body><nav><article>导航</article></nav><main>次选</main><article><h1>正文</h1><p onclick="window.executed++" style="background:url(/probe-bg)">段落<strong>加粗</strong></p><a href="jav&#97;script:window.executed++">危险</a><a href="https://example.test/path">安全</a><a href="/relative">相对</a><img src="/probe-img" onerror="window.executed++"><iframe src="/probe-frame"></iframe><object data="/probe-object"></object><video poster="/probe-poster"></video><svg onload="window.executed++"></svg><script src="/probe-script">window.executed++</script><style>@import url(/probe-style)</style><probe-element>自定义正文</probe-element><div class="comments">评论</div><pre><code class="language-js">const x = 1;</code></pre><table><tr><td>表格</td></tr></table></article></body></html>';
    const extracted = extractHtml(source);
    const detached = !extracted.content.isConnected;
    document.body.append(extracted.content);
    await new Promise(resolve => setTimeout(resolve, 150));
    const links = [...extracted.content.querySelectorAll('a')].map(a => a.getAttribute('href'));
    const fallback = extractHtml('<p>片段 &amp; 内容</p>');
    const empty = extractHtml('');
    const priorities = ['article','[role="main"]','.post-content','.entry-content','.article-content','.content','#content','main'].map((selector, index) => {
      const opening = ['article','div role="main"','div class="post-content"','div class="entry-content"','div class="article-content"','div class="content"','div id="content"','main'][index];
      return extractHtml('<p>外部</p><' + opening + '>候选</' + opening.split(' ')[0] + '>').content.textContent;
    });
    let invalid = false; try { extractHtml(null); } catch (error) { invalid = error instanceof TypeError; }
    return { meta: extracted.meta, text: extracted.content.textContent, html: extracted.content.innerHTML, links, detached, executed: window.executed, fallback: fallback.content.textContent, empty: empty.content.textContent, priorities, invalid };
  })()`);
  assert.deepEqual(result.meta, { title: '标题 & 测试', author: '作者', published: '2026-10-01' });
  assert.equal(result.detached, true); assert.equal(result.executed, 0);
  assert.deepEqual(resourceRequests, []);
  assert.deepEqual(result.links, [null, 'https://example.test/path', null]);
  assert.doesNotMatch(result.html, /onclick|onerror|javascript:|probe-|<script|<style|<img|<iframe|<object|<svg|评论|导航|次选/i);
  assert.match(result.html, /<strong>加粗<\/strong>/); assert.match(result.html, /language-js/); assert.match(result.html, /<table>/);
  assert.equal(result.fallback, '片段 & 内容'); assert.equal(result.empty, '');
  assert.deepEqual(result.priorities, Array(8).fill('候选')); assert.equal(result.invalid, true);
  console.log('ok - R13.10 actual browser inert parsing, metadata/candidates, shared sanitizer and zero resource requests');
} finally {
  try { await browser?.close(); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

import assert from 'node:assert/strict';

const imageSelector = '#editor [data-hybrid-block-type="image"]';
const beforeText = '图片前的说明段落。';
const asSvgUrl = source => 'data:image/svg+xml;base64,' + Buffer.from(source).toString('base64');

function svgSource(padding = 500) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="360" viewBox="0 0 960 360">'
    + '<rect width="960" height="360" fill="#5577dd"/><text x="80" y="180" font-size="48" fill="white">Markdown Editor</text>'
    + '<!--' + 'x'.repeat(padding) + '--></svg>';
}

async function waitForImage(page) {
  await page.waitFor(() => {
    const image = document.querySelector('#editor [data-hybrid-block-type="image"] img');
    return image?.naturalWidth === 960 && !image.closest('.is-loading');
  }, { description: 'embedded SVG image loaded' });
  await page.waitForElementStable(imageSelector);
}

async function geometry(page) {
  return page.evaluate(`(()=>{const widget=document.querySelector(${JSON.stringify(imageSelector)});
    return {top:widget.getBoundingClientRect().top,scrollTop:document.querySelector('#editor .cm-scroller').scrollTop};})()`);
}

export async function runHybridImageScrollChecks(page, app) {
  let cycles = 0;
  try {
    for (const viewport of [{ width: 1280, height: 860 }, { width: 2560, height: 1400 }, { width: 600, height: 860 }]) {
      await page.setViewport(viewport);
      for (const padding of [500, 2500]) {
        const markdownImage = `![SVG drift fixture](${asSvgUrl(svgSource(padding))} "内嵌 SVG 图片")`;
        const source = Array.from({ length: 30 }, (_, i) => `前文段落 ${i}\n\n`).join('')
          + `## 6. 图片\n\n${beforeText}\n\n${markdownImage}\n\n图片下方文字。\n\n`
          + Array.from({ length: 40 }, (_, i) => `后文段落 ${i}\n\n`).join('');
        await app.loadMarkdown(source, { layout: 'hybrid', selection: 0 });
        await app.revealPosition(source.indexOf(markdownImage), { preserveSelection: true, viewportRatio: 0.32 });
        await waitForImage(page);
        const baseline = await geometry(page), version = (await app.snapshot()).documentVersion;
        for (let i = 0; i < 8; i += 1) {
          if (i % 2) await page.click(imageSelector + ' .cm-hybrid-widget-action');
          else await page.click(imageSelector + ' img', { count: 2 });
          await app.waitForIdle();
          assert.equal(await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(imageSelector)}))`), false);
          const outside = await page.evaluate(`(()=>{const row=Array.from(document.querySelectorAll('#editor .cm-line'))
            .find(node=>node.textContent===${JSON.stringify(beforeText)}),rect=row.getBoundingClientRect();
            return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`);
          assert.ok(outside.y > 0 && outside.y < viewport.height, 'The source exit click must stay inside the window');
          await page.clickAt(outside.x, outside.y);
          await waitForImage(page);
          await app.waitForIdle();
          const current = await geometry(page);
          assert.ok(Math.abs(current.top - baseline.top) < 1,
            JSON.stringify({ viewport, padding, cycle: i + 1, baseline, current }));
          assert.ok(Math.abs(current.scrollTop - baseline.scrollTop) < 1, 'Source toggles must not accumulate scroll offsets');
          assert.equal(await app.getEditorValue(), source);
          assert.equal((await app.snapshot()).documentVersion, version);
          cycles += 1;
        }
      }
    }
    return { viewports: 3, sourceSizes: 2, cycles };
  } finally {
    await page.setViewport({ width: 1440, height: 1000 });
  }
}

export async function runImagePresentationChecks(page, app) {
  const requests = [];
  await page.connection.send('Network.enable');
  const unlisten = page.connection.on('Network.requestWillBeSent', event => {
    if (event.request.url.includes('/svg-passive-external-probe')) requests.push(event.request.url);
  });
  try {
    const origin = await page.evaluate('location.origin');
    const passiveSvg = asSvgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40" onload="parent.__svgProbeCount++">'
      + '<rect width="80" height="40" fill="red"/><script><![CDATA[parent.__svgProbeCount++]]></script>'
      + `<image href="${origin}/svg-passive-external-probe" width="10" height="10"/>`
      + '<foreignObject width="20" height="20"><div xmlns="http://www.w3.org/1999/xhtml">'
      + `<img src="${origin}/svg-passive-external-probe-foreign" onerror="parent.__svgProbeCount++"/>`
      + '</div></foreignObject></svg>');
    const safeSvg = asSvgUrl(svgSource(0));
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    const source = `# 图片一致性\n\n![safe SVG](${safeSvg})\n\n![passive SVG](${passiveSvg})\n\n![PNG](${png})\n\n`
      + '<svg onload="window.__svgProbeCount++"><script>window.__svgProbeCount++</script></svg>\n';
    await page.evaluate('window.__svgProbeCount=0');
    await app.loadMarkdown(source, { layout: 'hybrid', selection: 0 });
    for (const layout of ['hybrid', 'both', 'preview']) {
      await app.setLayout(layout);
      const selector = layout === 'hybrid' ? '#editor [data-hybrid-block-type="image"]' : '.f-preview-pane .markdown-body';
      await page.waitFor(`(()=>{const images=Array.from(document.querySelectorAll(${JSON.stringify(selector + ' img')}));
        return images.length===3&&images.every(image=>image.complete&&image.naturalWidth>0);})()`,
      { description: `${layout} SVG and PNG image decoding` });
      const result = await page.evaluate(`(()=>{const roots=Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        return {images:roots.flatMap(root=>Array.from(root.querySelectorAll('img')).map(image=>({alt:image.alt,src:image.getAttribute('src')}))),
          forbidden:roots.reduce((count,root)=>count+root.querySelectorAll('svg,script,iframe,object,embed').length,0),
          executions:window.__svgProbeCount};})()`);
      assert.deepEqual(result.images, [{ alt: 'safe SVG', src: safeSvg }, { alt: 'passive SVG', src: passiveSvg }, { alt: 'PNG', src: png }]);
      assert.equal(result.forbidden, 0);
      assert.equal(result.executions, 0);
      assert.deepEqual(requests, [], 'An SVG loaded as an image must not fetch nested external resources');
      assert.equal(await app.getEditorValue(), source);
    }
    return { layouts: 3, imagesPerLayout: 3, executions: 0, externalRequests: requests.length };
  } finally {
    unlisten();
    await page.connection.send('Network.disable');
    await page.evaluate('delete window.__svgProbeCount');
  }
}

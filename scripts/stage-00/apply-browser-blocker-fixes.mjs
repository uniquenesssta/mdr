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
  'src/editor/hybrid/inline-presentation.js',
  `  for (const range of editableRanges) {
    if (!range.revealBlock) continue;
    let line = view.state.doc.lineAt(Math.min(view.state.doc.length, range.from));
    while (line.from <= range.to) {
      if (shouldDecorateSourceActiveLine(editableRanges, blockRanges, line.from, line.to)) {
        addLineClass(lineClasses, line.from, 'cm-hybrid-source-active');
      }
      if (line.number >= view.state.doc.lines) break;
      line = view.state.doc.line(line.number + 1);
    }
  }

  let headingLines = 0;`,
  `  for (const range of editableRanges) {
    if (!range.revealBlock) continue;
    let line = view.state.doc.lineAt(Math.min(view.state.doc.length, range.from));
    while (line.from <= range.to) {
      if (shouldDecorateSourceActiveLine(editableRanges, blockRanges, line.from, line.to)) {
        addLineClass(lineClasses, line.from, 'cm-hybrid-source-active');
      }
      if (line.number >= view.state.doc.lines) break;
      line = view.state.doc.line(line.number + 1);
    }
  }

  // At the final empty line, Lezer resolves a left-biased document-end caret
  // into the preceding fenced block. Keep the rendered block mounted, but mark
  // the real trailing line as active so the visual caret never appears on the
  // block placeholder itself.
  const mainSelection = view.state.selection.main;
  if (view.hasFocus !== false
    && mainSelection.empty
    && mainSelection.head === view.state.doc.length) {
    const trailingLine = view.state.doc.lineAt(view.state.doc.length);
    const trailingTo = Math.max(trailingLine.from + 1, trailingLine.to);
    if (trailingLine.from === view.state.doc.length
      && !overlapsRanges(blockRanges, trailingLine.from, trailingTo)) {
      addLineClass(lineClasses, trailingLine.from, 'cm-hybrid-source-active');
    }
  }

  let headingLines = 0;`,
  'trailing empty source line presentation'
));

changes.push(await replaceExactly(
  'src/editor/hybrid/widgets.js',
  `      void renderHybridMermaid(body, codeValue, view, renderState);`,
  `      requestAnimationFrame(() => {
        if (!body.isConnected) return;
        void renderHybridMermaid(body, codeValue, view, renderState);
      });`,
  'mounted Mermaid render start'
));

changes.push(await replaceExactly(
  'tests/e2e/run-browser-tests.mjs',
  `      await setAppLayout(browser.page, 'hybrid');
      await browser.page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type=\\"mermaid\\"] svg')), { timeoutMs: 10000, description: 'hybrid Mermaid SVG' });`,
  `      await setAppLayout(browser.page, 'hybrid');
      await browser.page.evaluate(\`window.__markdownEditorE2E.revealText('flowchart LR',{preserveSelection:true})\`);
      await browser.page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type=\\"mermaid\\"] svg')), { timeoutMs: 10000, description: 'hybrid Mermaid SVG' });`,
  'Mermaid virtual range reveal'
));

changes.push(await replaceExactly(
  'tests/e2e/run-browser-tests.mjs',
  `      assert.match(selectedSource, /plain code/);
      const outside = await getTextBoundary(browser.page, '.cm-line', 'alpha', 'start', 'selection alpha');`,
  `      assert.match(selectedSource, /plain code/);
      await browser.page.evaluate(\`window.__markdownEditorE2E.revealText('selection alpha',{preserveSelection:true})\`);
      const outside = await getTextBoundary(browser.page, '.cm-line', 'alpha', 'start', 'selection alpha');`,
  'outside pointer virtual range reveal'
));

if (changes.some(Boolean)) {
  console.log('Stage 0 browser blocker patch updated the working tree.');
} else {
  console.log('Stage 0 browser blocker patch made no changes.');
}

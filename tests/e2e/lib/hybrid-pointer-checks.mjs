import assert from 'node:assert/strict';

const TABLE = '| heading A | heading B |\n| --- | --- |\n| value A | value B |';

async function pointOnLine(page, text) {
  return page.evaluate(`(() => {
    const line = Array.from(document.querySelectorAll('#editor .cm-line')).find(node => node.textContent === ${JSON.stringify(text)});
    if (!line) throw Error('Missing visible editable line');
    const rect = line.getBoundingClientRect();
    const x = rect.left + 2, y = rect.top + rect.height / 2;
    if (!line.contains(document.elementFromPoint(x, y))) throw Error('Editable row is not reachable by pointer');
    return { x, y };
  })()`);
}

async function composeChinese(page) {
  for (const text of ['n', 'ni', '你']) {
    await page.connection.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  }
  await page.insertText('你');
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}

async function pressKey(page, key, code, keyCode) {
  for (const type of ['keyDown', 'keyUp']) {
    await page.connection.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  }
}

/** Real pointer/IME regression; only the public application driver changes the fixture. */
export async function runHybridPointerChecks(page, app) {
  const exceptionCount = page.exceptions.length, consoleCount = page.consoleMessages.length;
  const prefix = Array.from({ length: 88 }, (_, index) => `prefix ${index}`).join('\n') + '\n\n';
  const after = '\n\nafter table\nnext paragraph\n\n' + Array.from({ length: 217 }, (_, index) => `tail ${index}`).join('\n');
  const source = prefix + TABLE + after;
  const paragraph = source.indexOf('after table');
  await app.loadMarkdown(source, { layout: 'hybrid', selection: paragraph, tableVisualEditing: true });
  await page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type="table"]')));
  const boundary = await page.evaluate(`(() => {
    const widget = document.querySelector('[data-hybrid-block-type="table"]');
    return { before: widget.previousElementSibling?.textContent, after: widget.nextElementSibling?.textContent };
  })()`);
  assert.equal(boundary.after, 'after table', 'The table must lead to the actual paragraph, without hidden-source caret rows');
  let expected = source;
  for (const input of ['English', '你', ' text', '你']) {
    const text = expected.slice(paragraph, expected.indexOf('\n', paragraph));
    const point = await pointOnLine(page, text);
    await page.clickAt(point.x, point.y);
    assert.equal((await app.snapshot()).selectionStart, paragraph);
    if (input === '你') await composeChinese(page);
    else await page.insertText(input);
    expected = expected.slice(0, paragraph) + input + expected.slice(paragraph);
    assert.equal(await app.getEditorValue(), expected, 'IME text must stay in the clicked paragraph');
  }
  const next = await pointOnLine(page, 'next paragraph');
  await page.clickAt(next.x, next.y);
  const nextPosition = expected.indexOf('next paragraph');
  assert.equal((await app.snapshot()).selectionStart, nextPosition, 'Later clicks must not jump to EOF');
  await page.insertText('Z');
  expected = expected.slice(0, nextPosition) + 'Z' + expected.slice(nextPosition);
  assert.equal(await app.getEditorValue(), expected);
  const pastePosition = (await app.snapshot()).selectionStart;
  await page.evaluate(`(() => {
    const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify('Paste\ntext')});
    document.querySelector('#editor .cm-content').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  })()`);
  expected = expected.slice(0, pastePosition) + 'Paste\ntext' + expected.slice(pastePosition);
  assert.equal(await app.getEditorValue(), expected, 'Multiline paste must use the selected paragraph');
  const enterPosition = (await app.snapshot()).selectionStart;
  await pressKey(page, 'Enter', 'Enter', 13);
  assert.equal(await app.getEditorValue(), expected.slice(0, enterPosition) + '\n' + expected.slice(enterPosition));
  await pressKey(page, 'Backspace', 'Backspace', 8);
  assert.equal(await app.getEditorValue(), expected, 'Backspace must remove the just-entered newline');

  // Also exercise the IME protection independently of the corrected mouse path.
  await app.loadMarkdown(source, { layout: 'hybrid', selection: prefix.length + TABLE.length, tableVisualEditing: true });
  await composeChinese(page);
  assert.equal(await app.getEditorValue(), prefix + TABLE + '你' + after);
  await app.revealPosition((await app.getEditorValue()).indexOf('after table'));
  const recovered = await pointOnLine(page, 'after table');
  await page.clickAt(recovered.x, recovered.y);
  assert.equal((await app.snapshot()).selectionStart, paragraph + 1);

  for (const suffix of ['', '\n', '\n\n']) {
   for (const input of ['English', '你']) {
    await app.loadMarkdown(TABLE + suffix, { layout: 'hybrid', selection: 0, tableVisualEditing: true });
    await page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type="table"]')));
    const point = await page.evaluate(`(() => {
      const row = document.querySelector('[data-hybrid-block-type="table"]').nextElementSibling;
      if (!row?.matches('.cm-line')) throw Error('Missing append row after EOF table');
      const rect = row.getBoundingClientRect();
      return { x: rect.left + 2, y: rect.top + rect.height / 2 };
    })()`);
    await page.clickAt(point.x, point.y);
    assert.equal(await app.getEditorValue(), TABLE + suffix, 'Clicking an EOF table boundary must not edit source');
    if (input === '你') await composeChinese(page);
    else await page.insertText(input);
    assert.equal(await app.getEditorValue(), TABLE + '\n\n' + input);
    await page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type="table"]')));
   }
  }
  for (const input of ['English cell', '你']) {
    const document = TABLE + '\n\nafter table';
    await app.loadMarkdown(document, { layout: 'hybrid', selection: document.length, tableVisualEditing: true });
    await page.click('[data-hybrid-block-type="table"] td', { count: 2 });
    await page.waitFor(() => document.activeElement?.matches('[data-hybrid-table-cell-input]'), { description: 'table cell input focus' });
    if (input === '你') await composeChinese(page);
    else await page.insertText(input);
    await pressKey(page, 'Enter', 'Enter', 13);
    await app.waitForIdle();
    assert.equal(await app.getEditorValue(), document.replace('value A', input));
    const point = await pointOnLine(page, 'after table');
    await page.clickAt(point.x, point.y);
    await page.insertText('Z');
    assert.equal(await app.getEditorValue(), document.replace('value A', input).replace('after table', 'Zafter table'));
  }
  for (const input of ['English', '你']) {
    const document = TABLE + '\n\nafter table';
    await app.loadMarkdown(document, { layout: 'hybrid', selection: document.length, tableVisualEditing: true });
    await page.click('[data-hybrid-block-type="table"] .cm-hybrid-widget-action');
    await page.waitFor(() => !document.querySelector('[data-hybrid-block-type="table"]'));
    const point = await page.evaluate(`(() => {
      const last = Array.from(document.querySelectorAll('#editor .cm-line')).find(row => row.textContent === '| value A | value B |');
      const rect = last.nextElementSibling.getBoundingClientRect();
      return { x: rect.left + 2, y: rect.top + rect.height / 2 };
    })()`);
    await page.clickAt(point.x, point.y);
    assert.equal((await app.snapshot()).selectionStart, document.indexOf('after table'), 'Source exit must skip the table separator');
    if (input === '你') await composeChinese(page);
    else await page.insertText(input);
    assert.equal(await app.getEditorValue(), document.replace('after table', input + 'after table'));
  }
  const code = '```text\ncode body\n```';
  await app.loadMarkdown(code, { layout: 'hybrid', selection: 0, codeVisualEditing: true });
  await page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type="code"]')));
  const append = await page.evaluate(`(() => {
    const row = document.querySelector('[data-hybrid-block-type="code"]').nextElementSibling;
    const rect = row.getBoundingClientRect(); return { x: rect.left + 2, y: rect.top + rect.height / 2 };
  })()`);
  await page.clickAt(append.x, append.y);
  assert.equal(await app.getEditorValue(), code, 'An EOF append click must not create text');
  await composeChinese(page);
  assert.equal(await app.getEditorValue(), code + '\n你');
  const headingAndRuleCases = await checkHeadingAndRulePointers(page, app);
  const independentParagraphCases = await checkIndependentParagraphs(page, app);
  const sourceEndParagraphCases = await checkSourceEndParagraphs(page, app);
  const repeatedBlankClicks = await checkRepeatedBlankClicks(page, app);
  const quoteCaretCases = await checkQuoteCaretLines(page, app);
  const htmlClickUndo = await checkHtmlClickUndo(page, app);
  assert.deepEqual(page.exceptions.slice(exceptionCount), [], 'No editor exception may occur during pointer/IME input');
  assert.deepEqual(page.consoleMessages.slice(consoleCount).filter(record => record.type === 'error'), [], 'No rendering failure may be swallowed');
  return { paragraphInputs: 4, multilinePaste: 1, enterBackspace: 1, hiddenBoundaryComposition: 1, tableEofCases: 6,
    directCellInputs: 2, sourceExitInputs: 2, codeEofCases: 1, headingAndRuleCases, independentParagraphCases, sourceEndParagraphCases,
    repeatedBlankClicks, quoteCaretCases, htmlClickUndo };
}

async function checkHtmlClickUndo(page, app) {
  const html = '<div>\n<p>原生 HTML 容器：<mark>高亮文字</mark>、H<sub>2</sub>O、x<sup>2</sup></p>\n</div>';
  const source = html + '\n\n---\n\n## 11. 精准划选测试\n\nfooter';
  await app.loadMarkdown(source, { layout: 'hybrid', selection: source.length });
  const footer = await pointOnLine(page, 'footer');
  await page.clickAt(footer.x, footer.y); await page.insertText('Z');
  const edited = source.replace('footer', 'Zfooter');
  assert.equal(await app.getEditorValue(), edited);
  const clickBoundary = async expected => {
    const version = (await app.snapshot()).documentVersion;
    await page.waitFor(() => Boolean(document.querySelector('[data-hybrid-block-type="html"]')));
    const point = await page.evaluate(`(() => {
      const row=document.querySelector('[data-hybrid-block-type="html"]').nextElementSibling;
      if(!row?.matches('.cm-line'))throw Error('Missing rendered HTML separator');
      const rect=row.getBoundingClientRect();return {x:rect.left+20,y:rect.top+rect.height/2};
    })()`);
    for (let i = 0; i < 2; i += 1) {
      await page.clickAt(point.x, point.y);
      assert.equal(await app.getEditorValue(), expected, 'Even the first HTML boundary click must not add whitespace');
      assert.equal((await app.snapshot()).documentVersion, version, 'Click-only actions must not create a document version');
    }
  };
  const undo = async () => {
    for (const type of ['keyDown', 'keyUp']) await page.connection.send('Input.dispatchKeyEvent', {
      type, modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90
    });
    await app.waitForIdle();
  };
  await clickBoundary(edited);
  await undo();
  assert.equal(await app.getEditorValue(), source, 'Clicks must not occupy undo entries');
  await clickBoundary(source);
  await page.evaluate(`(() => {
    const data=new DataTransfer();data.setData('text/plain',${JSON.stringify('Paste\ntext')});
    document.querySelector('#editor .cm-content').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  })()`);
  assert.equal(await app.getEditorValue(), html + '\n\nPaste\ntext\n\n---\n\n## 11. 精准划选测试\n\nfooter');
  await undo();
  assert.equal(await app.getEditorValue(), source, 'One undo must remove the paste and its separators together');
  await clickBoundary(source);
  await composeChinese(page);
  assert.equal(await app.getEditorValue(), html + '\n\n你\n\n---\n\n## 11. 精准划选测试\n\nfooter');
  await undo();
  assert.equal(await app.getEditorValue(), source, 'One undo must remove the composed text and its separators together');
  await clickBoundary(source);
  await page.connection.send('Input.imeSetComposition', { text: 'n', selectionStart: 1, selectionEnd: 1 });
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await page.connection.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal(await app.getEditorValue(), source, 'Cancelled composition must leave no empty paragraph');
  await clickBoundary(source);
  return { clicks: 10, undoCases: 3, multilinePaste: 1, imeInput: 1, cancelledComposition: 1 };
}

async function checkRepeatedBlankClicks(page, app) {
  let clicks = 0;
  for (const prefix of ['> first quote\n> second quote', '- list item', '<div>raw HTML</div>', '<div>\n<p>原生 HTML 容器</p>\n</div>']) {
   for (const separator of ['\n\n', '\n\n\n']) {
    const source = prefix + separator + 'after';
    await app.loadMarkdown(source, { layout: 'hybrid', selection: source.length });
    const version = (await app.snapshot()).documentVersion;
    const boundary = () => page.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll('#editor .cm-line')).find(node => !node.textContent);
      if (!row) throw Error('Missing semantic separator row');
      const rect = row.getBoundingClientRect(); return { x: rect.left + 8, y: rect.top + rect.height / 2 };
    })()`);
    let point = await boundary();
    await page.clickAt(point.x, point.y);
    const created = await app.getEditorValue(), anchor = (await app.snapshot()).selectionStart;
    assert.equal(created, source, 'The first click must not change document text');
    assert.equal((await app.snapshot()).documentVersion, version);
    const scrollTop = await page.evaluate("document.querySelector('#editor .cm-scroller').scrollTop");
    for (let i = 0; i < 10; i += 1) {
      if (i < 5) point = await boundary();
      await page.clickAt(point.x, point.y);
      assert.equal(await app.getEditorValue(), created, 'Repeated blank clicks must not keep appending separators');
      assert.equal((await app.snapshot()).documentVersion, version);
      assert.equal((await app.snapshot()).selectionStart, anchor);
      assert.equal(await page.evaluate("document.querySelector('#editor .cm-scroller').scrollTop"), scrollTop);
      clicks += 1;
    }
    const input = separator.length === 2 ? 'English' : '你';
    if (input === '你') await composeChinese(page); else await page.insertText(input);
    assert.equal(await app.getEditorValue(), prefix + '\n\n' + input + '\n\nafter', 'The reused paragraph must retain both block separators');
   }
  }
  return clicks;
}

async function checkQuoteCaretLines(page, app) {
  let cases = 0;
  const first = '> 这是一份面向当前版本的综合展示与回归测试文档。';
  const second = '> 建议分别在**混合模式**、**仅编辑模式**和**编辑 + 预览模式**中查看，并测试滚动同步、双向跳选、源码切换、复制、导出和主题切换。';
  for (const target of [first, second]) {
    for (const input of ['English', '你']) {
      const source = '# Markdown Editor 全功能测试文档\n\n' + first + '\n' + second + '\n\nfooter';
      await app.loadMarkdown(source, { layout: 'hybrid', selection: source.length });
      const point = await page.evaluate(`(() => {
        const row = Array.from(document.querySelectorAll('#editor .cm-line')).find(node => node.textContent.includes(${JSON.stringify(target.slice(2, 7))}));
        if (!row) throw Error('Missing quote source row');
        const rect = row.getBoundingClientRect(); return { x: rect.left + 50, y: rect.bottom - 10 };
      })()`);
      await page.clickAt(point.x, point.y);
      const position = (await app.snapshot()).selectionStart;
      assert.equal(source.slice(0, position).split('\n').length, target === first ? 3 : 4);
      assert.deepEqual(await page.evaluate("Array.from(document.querySelectorAll('#editor .cm-hybrid-source-active')).map(row=>row.textContent)"), [target], 'A quote must highlight only the clicked source row');
      if (input === '你') await composeChinese(page); else await page.insertText(input);
      assert.equal(await app.getEditorValue(), source.slice(0, position) + input + source.slice(position));
      cases += 1;
    }
  }
  return cases;
}

async function checkSourceEndParagraphs(page, app) {
  let cases = 0;
  for (const [type, prefix] of [['code', '```text\ncode body\n```'], ['math', '$$\nx+y\n$$'],
    ['html', '<div>raw HTML</div>'], ['table', TABLE]]) {
    for (const suffix of ['', '\n', '\n\n']) {
      for (const input of ['English', '你']) {
        const source = prefix + suffix;
        await app.loadMarkdown(source, { layout: 'hybrid', selection: source.length, tableVisualEditing: true, codeVisualEditing: true });
        const selector = `[data-hybrid-block-type="${type}"]`;
        await page.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
        const action = await page.evaluate(`(() => {
          const button = Array.from(document.querySelectorAll(${JSON.stringify(selector + ' .cm-hybrid-widget-action')})).find(node => node.textContent.trim() === '编辑源码');
          if (!button) throw Error('Missing EOF source-edit action');
          const rect = button.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`);
        await page.clickAt(action.x, action.y);
        await page.waitFor(`!document.querySelector(${JSON.stringify(selector)})`);
        const point = await page.evaluate(`(() => {
          const row = Array.from(document.querySelectorAll('#editor .cm-line')).at(-1);
          const rect = row.getBoundingClientRect();
          return { x: rect.left + 2, y: ${suffix === ''} ? rect.bottom + 12 : rect.top + rect.height / 2 };
        })()`);
        await page.clickAt(point.x, point.y);
        const expected = prefix + '\n'.repeat(type === 'code' ? Math.max(1, suffix.length) : 2);
        assert.equal(await app.getEditorValue(), source, `SOURCE EOF click must not write separators (${type}/${suffix.length})`);
        if (input === '你') await composeChinese(page); else await page.insertText(input);
        assert.equal(await app.getEditorValue(), expected + input, `SOURCE EOF input must retain the preceding ${type} block`);
        await page.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
        cases += 1;
      }
    }
  }
  return cases;
}

async function checkIndependentParagraphs(page, app) {
  let cases = 0;
  const image = '![image](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAAAoCAYAAABpYH0BAAAAX0lEQVR4nO3QMQ0AIADAMCygGYkIAg88ZEmP/UvHXPvovfF7oB5AgADTAQQIMB1AgADTAQQIMB1AgADTAQQIMB1AgADTAQQIMB1AgADTAQQIMB1AgADTAQQIMB1AgADTAQQIMB1AgADTAQQIMB1AgADTAQQIMB1AgH+7euX8tAdMvQMAAAAASUVORK5CYII=)';
  for (const prefix of ['> quoted text', '- list item', image, '$$\nx+y\n$$', '<div>raw HTML</div>']) {
    for (const suffix of ['', '\n', '\n\n' + TABLE]) {
      for (const input of ['English', '你']) {
        const source = prefix + suffix;
        await app.loadMarkdown(source, { layout: 'hybrid', selection: source.length });
        const point = await page.evaluate(`(() => {
          const rows = Array.from(document.querySelectorAll('#editor .cm-line'));
          const row = ${suffix.includes('|')} ? rows.find(node => !node.textContent) : rows.at(-1);
          if (!row) throw Error('Missing block paragraph boundary');
          const rect = row.getBoundingClientRect();
          return { x: rect.left + 2, y: ${suffix === ''} ? rect.bottom + 12 : rect.top + rect.height / 2 };
        })()`);
        await page.clickAt(point.x, point.y);
        assert.equal(await app.getEditorValue(), source, 'A click below a block must not change Markdown source');
        if (input === '你') await composeChinese(page); else await page.insertText(input);
        assert.equal(await app.getEditorValue(), prefix + '\n\n' + input + (suffix.includes('|') ? '\n\n' + TABLE : ''));
        assert.deepEqual(await page.evaluate("Array.from(document.querySelectorAll('#editor .cm-hybrid-source-active')).map(row=>row.textContent)"), [input], 'The new text must be an independent paragraph, without revealing the preceding block');
        cases += 1;
      }
    }
  }
  return cases;
}

async function checkHeadingAndRulePointers(page, app) {
  let cases = 0;
  for (const block of [null, TABLE, '```text\nfirst\nsecond\nthird\n```']) {
    for (const target of ['rule', 'blank', 'heading']) {
      for (const input of ['English', '你']) {
        const source = (block || 'before') + '\n\n---\n\n## 6. 图片\n\nafter';
        await app.loadMarkdown(source, { layout: 'hybrid', selection: source.indexOf('after') });
        if (block) {
          const action = await page.evaluate(`(() => {
            const button = Array.from(document.querySelectorAll('[data-hybrid-block-type] .cm-hybrid-widget-action')).find(node => node.textContent.trim() === '编辑源码');
            if (!button) throw Error('Missing source-edit action');
            const rect = button.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          })()`);
          await page.clickAt(action.x, action.y);
          await page.waitFor(() => !document.querySelector('[data-hybrid-block-type]'), { description: 'source action reveals the block' });
        }
        const point = await page.evaluate(`(() => {
          const heading = document.querySelector('#editor .cm-hybrid-heading');
          const row = ${JSON.stringify(target)} === 'heading' ? heading
            : ${JSON.stringify(target)} === 'blank' ? heading.previousElementSibling
              : document.querySelector('#editor .cm-hybrid-rule-line');
          if (!row?.matches('.cm-line')) throw Error('Missing heading/rule target line');
          const rect = row.getBoundingClientRect();
          // Exercise the blank right side during SOURCE exit as in the log;
          // ordinary clicks use the line padding to avoid the rule widget.
          return { x: ${Boolean(block)} ? rect.right - 8 : rect.left + 2, y: rect.top + rect.height / 2 };
        })()`);
        const expectedPosition = target === 'rule' ? source.lastIndexOf('---')
          : target === 'heading' ? source.indexOf('## 6.') : source.indexOf('## 6.') - 1;
        const expectedLine = source.slice(0, expectedPosition).split('\n').length;
        await page.clickAt(point.x, point.y);
        await app.waitForIdle();
        const position = (await app.snapshot()).selectionStart;
        assert.equal(source.slice(0, position).split('\n').length, expectedLine, `Heading/rule pointer must stay on its original source line (${block ? 'SOURCE exit' : 'presented'} / ${target} / ${input})`);
        const activeLines = await page.evaluate(`Array.from(document.querySelectorAll('#editor .cm-hybrid-source-active')).map(row => row.textContent)`);
        assert.deepEqual(activeLines, [target === 'rule' ? '---' : target === 'heading' ? '## 6. 图片' : ''], 'Only the owned source line may have the active highlight');
        if (input === '你') await composeChinese(page);
        else await page.insertText(input);
        assert.equal(await app.getEditorValue(), source.slice(0, position) + input + source.slice(position), 'English/IME input must use the clicked line');
        const next = await pointOnLine(page, 'after');
        await page.clickAt(next.x, next.y);
        assert.equal((await app.snapshot()).selectionStart, source.indexOf('after') + input.length, 'Later pointer navigation must remain accurate');
        cases += 1;
      }
    }
  }
  return cases;
}

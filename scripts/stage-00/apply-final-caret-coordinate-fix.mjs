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

const changed = await replaceExactly(
  'tests/e2e/run-browser-tests.mjs',
  `      const trailingPoint = await browser.page.evaluate(\`(()=>{\n        const widget=document.querySelector('[data-hybrid-block-type="code"]');\n        const scroller=document.querySelector('.cm-scroller');\n        if(!widget||!scroller)return null;\n        const widgetRect=widget.getBoundingClientRect();\n        const scrollerRect=scroller.getBoundingClientRect();\n        return {\n          x:Math.max(scrollerRect.left+12,Math.min(scrollerRect.right-12,widgetRect.left+24)),\n          y:Math.max(widgetRect.bottom+8,Math.min(scrollerRect.bottom-12,widgetRect.bottom+24))\n        };\n      })()\`);\n      if (!trailingPoint) throw new Error('Unable to resolve trailing editor click point');\n      await browser.page.clickAt(trailingPoint.x, trailingPoint.y);\n      await browser.page.waitFor(() => {\n        const editor=document.getElementById('editor');\n        return editor?.selectionStart===editor?.textLength\n          && editor?.virtualEditor?.getPresentationStats?.().sourceActiveLines===1;\n      }, { description: 'trailing source active line' });`,
  `      const trailingPoint = await browser.page.evaluate(\`(()=>{\n        const editor=document.getElementById('editor');\n        const view=editor?.virtualEditor?.view;\n        const position=editor?.textLength;\n        if(!view||!Number.isInteger(position))return null;\n        editor.virtualEditor.scrollPositionIntoView(position,'auto',0.5);\n        const rect=view.coordsAtPos(position,1)||view.coordsAtPos(position,-1);\n        if(!rect)return null;\n        return {\n          x:Math.max(2,rect.left+2),\n          y:rect.top+Math.max(1,rect.bottom-rect.top)/2,\n          position\n        };\n      })()\`);\n      if (!trailingPoint) throw new Error('Unable to resolve final document caret point');\n      await browser.page.clickAt(trailingPoint.x, trailingPoint.y);\n      await browser.page.waitFor(() => {\n        const editor=document.getElementById('editor');\n        return editor?.selectionStart===trailingPoint.position\n          && editor?.selectionEnd===trailingPoint.position\n          && editor?.virtualEditor?.getPresentationStats?.().sourceActiveLines===1;\n      }, { description: 'trailing source active line' });`,
  'final document caret coordinate targeting'
);

console.log(changed
  ? 'Final caret coordinate fix updated the working tree.'
  : 'Final caret coordinate fix made no changes.');

import assert from 'node:assert/strict';

async function hover(page, selector) {
  const rect = await page.elementRect(selector);
  await page.connection.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, button: 'none', buttons: 0
  });
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Real Menu controllers with a read-only recent source; file I/O is a recorded port. */
export async function runRecentFilesPointerChecks(page, origin, setDocument) {
  const original = await page.evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
  let openCases = 0;
  try {
    for (const width of [1440, 600]) {
      await page.setViewport({ width, height: 900 });
      await setDocument(`<!doctype html><html${width < 860 ? ' class="is-compact-shell"' : ''}><head><base href="${origin}/"><link rel="stylesheet" href="${origin}/src/styles/index.css"></head>
        <body><nav id="recent-fixture" class="l-menu-bar"></nav><div id="recent-toast"></div></body></html>`);
      await page.waitFor(() => document.readyState === 'complete', { description: 'recent menu styles loaded' });
      await page.evaluate(`(async()=>{
        const [menu,{createShellMenus}]=await Promise.all([
          import('${origin}/src/features/menu/index.js'),import('${origin}/src/features/menu/shell-menus.js')]);
        const root=document.getElementById('recent-fixture'),content=menu.createMenuContentView({menu:root});
        const calls=[],errors=[],state=menu.createMenuState(),bindings=menu.createMenuCommandBindings();
        let snapshot={entries:['A','B','C'].map(name=>({path:'C:/Notes/'+name+'.md',name:name+'.md'}))};
        const listeners=new Set(),source={get snapshot(){return snapshot;},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}};
        const positioner=menu.createSubmenuPositioner({root,runtime:window});
        const shell=createShellMenus({document,window,toast:document.getElementById('recent-toast'),
          coreSubmenuPositionerPort:positioner,coreEditorUiCommandPort:{register:()=>()=>{}}});
        const commands=menu.createMenuController({state,bindings,view:menu.createMenuView({root}),closeMenus:()=>shell.closeAppMenus(),
          reportError:(message,error)=>errors.push(message+String(error))});
        bindings.register(menu.MENU_COMMAND_IDS.RECENT_FILE_OPEN,payload=>{calls.push(payload.path);return true;});
        bindings.register(menu.MENU_COMMAND_IDS.RECENT_FILES_CLEAR,()=>{calls.push('clear');snapshot={entries:[]};for(const listener of listeners)listener({snapshot});});
        const recent=menu.createRecentFilesMenuController({owner:document.getElementById('recent-files-menu-item'),
          list:document.getElementById('recent-files-menu'),source,commands,available:true});
        commands.start();recent.start();positioner.start();
        window.recentPointerHarness={calls,errors,destroy(){recent.destroy();commands.destroy();shell.destroy();positioner.destroy();bindings.destroy();state.destroy();content.destroy();}};
      })()`);
      for (let index = 1; index <= 3; index += 1) {
        await page.click('[data-menu-toggle="file-menu"]');
        const ownerPoint = await hover(page, '#recent-files-menu-item');
        const selector = `#recent-files-menu > .recent-file-item:nth-child(${index}) > span`;
        const before = await page.evaluate(`({open:document.getElementById('recent-files-menu-item').classList.contains('is-submenu-open'),rect:document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON(),ownerPoint:${JSON.stringify(ownerPoint)}})`);
        await hover(page, selector);
        const geometry = await page.evaluate(`(() => {
          const owner=document.getElementById('recent-files-menu-item'),list=document.getElementById('recent-files-menu'),row=document.querySelector(${JSON.stringify(selector)});
          const rect=row.getBoundingClientRect(),at=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
          return {open:owner.classList.contains('is-submenu-open'),owner:owner.getBoundingClientRect().toJSON(),list:list.getBoundingClientRect().toJSON(),row:rect.toJSON(),hit:at?.id||at?.className};
        })()`);
        assert.equal(geometry.open, true, JSON.stringify({ width, index, before, geometry }));
        await page.click(selector);
        assert.equal(await page.evaluate('window.recentPointerHarness.calls.length'), index, 'Every recent row must reach the real Menu controller');
        assert.equal(await page.evaluate("document.getElementById('file-menu').classList.contains('show')"), false);
        openCases += 1;
      }
      await page.click('[data-menu-toggle="file-menu"]');
      await hover(page, '#recent-files-menu-item');
      await page.click('#recent-files-menu > [data-recent-files-action="clear"]');
      assert.deepEqual(await page.evaluate('window.recentPointerHarness.calls'), ['C:/Notes/A.md', 'C:/Notes/B.md', 'C:/Notes/C.md', 'clear']);
      assert.deepEqual(await page.evaluate('window.recentPointerHarness.errors'), []);
      assert.equal(await page.evaluate("document.getElementById('recent-files-menu').textContent"), '暂无记录');
      await page.evaluate('window.recentPointerHarness.destroy();delete window.recentPointerHarness');
    }
    return { openCases, clearCases: 2 };
  } finally {
    await page.evaluate('window.recentPointerHarness?.destroy();delete window.recentPointerHarness');
    await page.setViewport(original);
  }
}

/** Native mouse movement on the actual menu bar; no synthetic DOM activation. */
export async function runMenuPointerChecks(page) {
  const latencies = [];
  const original = await page.evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
  try {
  for (const width of [1440, 600]) {
    await page.setViewport({ width, height: 900 });
    await page.click('.app-brand');
    await hover(page, '[data-menu-toggle="file-menu"]');
    assert.equal(await page.evaluate("document.querySelectorAll('.menu-dropdown > .menu-dropdown-list.show').length"), 0, 'Closed menus must not open on hover');
    await page.click('[data-menu-toggle="file-menu"]');
    for (const id of ['file-menu', 'edit-menu', 'app-view-menu', 'insert-menu']) {
      const started = await page.evaluate('performance.now()');
      await hover(page, `[data-menu-toggle="${id}"]`);
      const result = await page.evaluate(`(() => {
        const list = document.getElementById(${JSON.stringify(id)}), rect = list.getBoundingClientRect();
        return { elapsed: performance.now() - ${started}, open: list.classList.contains('show'),
          count: document.querySelectorAll('.menu-dropdown > .menu-dropdown-list.show').length,
          expanded: list.parentElement.querySelector('.menu-trigger').getAttribute('aria-expanded'),
          left: rect.left, right: rect.right, bottom: rect.bottom, viewport: innerWidth };
      })()`);
      assert.equal(result.open, true, 'After the initial click, hovering a peer must switch without another click');
      assert.equal(result.count, 1);
      assert.equal(result.expanded, 'true');
      assert.ok(result.left >= 0 && result.right <= result.viewport);
      latencies.push(result.elapsed);
    }
    const owners = '#insert-menu > .menu-submenu';
    await hover(page, `${owners}:first-child`);
    const first = await page.evaluate(`(() => {
      const owners=Array.from(document.querySelectorAll(${JSON.stringify(owners)}));
      return { count:owners.length, open:owners[0].classList.contains('is-submenu-open'),
        display:getComputedStyle(owners[0].querySelector('.menu-submenu-list')).display,
        animation:getComputedStyle(owners[0].querySelector('.menu-submenu-list')).animationName };
    })()`);
    assert.ok(first.count >= 2);
    assert.equal(first.open, true);
    assert.equal(first.display, 'flex');
    assert.equal(first.animation, 'none');
    const secondSelector = '#insert-menu > .menu-submenu:nth-last-child(2)';
    // The last submenu is math; Mermaid is the final direct command.
    await hover(page, secondSelector);
    const switched = await page.evaluate(`(() => {
      const owners=Array.from(document.querySelectorAll(${JSON.stringify(owners)}));
      return owners.map(owner=>({open:owner.classList.contains('is-submenu-open'),display:getComputedStyle(owner.querySelector('.menu-submenu-list')).display}));
    })()`);
    assert.equal(switched[0].open, false, 'The previous submenu must close in the same pointer transition');
    assert.equal(switched[0].display, 'none');
    assert.equal(switched.at(-1).open, true);
    assert.equal(switched.at(-1).display, 'flex');
    await page.click('.app-brand');
    assert.equal(await page.evaluate("document.querySelectorAll('.menu-dropdown > .menu-dropdown-list.show').length"), 0);
  }
  return { topLevelHoverCases: latencies.length, submenuSwitchCases: 2, hoverMs: latencies };
  } finally {
    await page.setViewport(original);
  }
}

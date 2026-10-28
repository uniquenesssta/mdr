/** Exercise the real menu/shortcut routes after removing duplicate header actions. */
export async function openWorkspaceExport(page) {
  const expanded=await page.evaluate("document.querySelector('[data-menu-toggle=\"file-menu\"]').getAttribute('aria-expanded')==='true'");
  if(!expanded)await page.click('[data-menu-toggle="file-menu"]');
  await page.click('#file-menu [data-workspace-export]');
}

export async function openWorkspaceFind(page) {
  await page.pressKey('f',{modifiers:2,code:'KeyF'});
}

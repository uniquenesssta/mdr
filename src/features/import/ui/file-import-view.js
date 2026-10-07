/** Own file-picker UI and its listeners; chosen sources enter the public Import controller. */
export function createFileImportView({ input, chooseFile, openPath, openBrowserFile, notify = () => {} } = {}) {
  if (!input?.addEventListener || typeof openPath !== 'function' || typeof openBrowserFile !== 'function') {
    throw new TypeError('File Import view requires an input and public import commands.');
  }
  let destroyed = false, generation = 0;
  const changed = () => {
    const file = input.files?.[0];
    input.value = '';
    if (!destroyed && file) void openBrowserFile(file);
  };
  input.addEventListener('change', changed);
  return Object.freeze({
    async open() {
      if (destroyed) throw new Error('File Import view is destroyed.');
      if (!chooseFile) { input.value = ''; input.click(); return false; }
      const id = ++generation;
      try {
        const path = await chooseFile({ title: '打开 Markdown 或文本文件',
          extensions: ['md', 'markdown', 'txt'], filterName: 'Markdown 和文本文件' });
        if (destroyed || id !== generation || !path) return false;
        return await openPath(path);
      } catch (error) {
        if (!destroyed && id === generation) notify(String(error?.message || error));
        return false;
      }
    },
    destroy() { if (destroyed) return; destroyed = true; generation++; input.removeEventListener('change', changed); }
  });
}

import { createExportRequest } from './export-request.js';
import { ExportCancelledError } from '../task/export-cancellation.js';

const profiles = Object.freeze({
  markdown: { label: 'Markdown', filterName: 'Markdown 文档', mimeType: 'text/markdown;charset=utf-8' },
  html: { label: 'HTML', filterName: 'HTML 文档', mimeType: 'text/html;charset=utf-8' },
  word: { label: 'Word', filterName: 'Word 文档', mimeType: 'application/msword;charset=utf-8' },
  image: { label: '图片', filterName: 'PNG 图片', mimeType: 'image/png' }
});

/** Owns export destination/output policy and pending dialog waits only.
 * Formats own content/source and task lifetime; Platform owns Blob/URL cleanup
 * and native safe replacement. Started writes are observed until settlement;
 * destroy suppresses late success without pretending to abort or undo disk I/O.
 */
export function createExportFileWriter({ platform } = {}) {
  if (!platform?.capabilities || typeof platform.dialogs?.saveFile !== 'function' || !platform.files) {
    throw new TypeError('Export File Writer requires public dialog and text/binary output capabilities.');
  }
  let destroyed = false;
  const pending = new Set();
  const alive = () => { if (destroyed) throw new ExportCancelledError('destroyed'); };
  async function write({ request: input, content, task, assertCurrent, wait } = {}) {
    alive();
    const request = createExportRequest(input && { ...input, imageOptions: input.imageOptions === null ? undefined : input.imageOptions });
    const profile = profiles[request.format];
    if (!profile) throw new TypeError('File Writer does not handle print output.');
    const binary = request.format === 'image';
    if (binary ? !(content instanceof Uint8Array) : typeof content !== 'string') throw new TypeError('Export output payload has the wrong type.');
    if (typeof platform.files[binary ? 'writeBinary' : 'writeText'] !== 'function') throw new TypeError('Export output transport is unavailable.');
    if (!['lockCancellation', 'update'].every(key => typeof task?.[key] === 'function')
      || typeof task.token?.throwIfCancelled !== 'function' || typeof assertCurrent !== 'function' || typeof wait !== 'function') {
      throw new TypeError('File Writer requires the caller task, source barrier and cancellable wait.');
    }
    const check = () => { alive(); task.token.throwIfCancelled(); assertCurrent(); };
    check();
    // Freeze caller-owned bytes before any picker await or reentrant notification.
    const payload = binary ? content.slice() : content;
    const nativeDialogs = Boolean(platform.capabilities.desktop?.dialogs), nativeFiles = Boolean(platform.capabilities.desktop?.fileSystem);
    if (nativeDialogs !== nativeFiles || (!nativeFiles && !platform.capabilities.browser?.fileDownload)) throw new Error(profile.label + ' 文件导出能力不可用');
    let stop;
    const stopped = new Promise((_resolve, reject) => { stop = () => reject(new ExportCancelledError('destroyed')); });
    stopped.catch(() => {});
    pending.add(stop);
    let path = request.name;
    try {
      check();
      if (nativeFiles) {
        path = await Promise.race([wait(platform.dialogs.saveFile(request.name, {
          title: request.format === 'image' ? '导出图片' : '导出 ' + profile.label, extension: request.extension, extensions: request.extensions,
          filterName: profile.filterName, defaultDirectory: request.directory
        })), stopped]);
        check();
        if (path === null || path === '') return Object.freeze({ status: 'cancelled', name: request.name });
        if (typeof path !== 'string') throw new TypeError(profile.label + ' 保存路径无效');
      }
      check(); task.lockCancellation('writing'); check();
      task.update(96, '正在写入' + profile.label + '，此阶段完成前不能立即取消…', 'writing'); check();
      const options = { extension: request.extension, reason: 'export', ...(!nativeFiles ? { mimeType: profile.mimeType } : {}) };
      // Do not race this irreversible promise against cancellation/destruction.
      if (binary) await platform.files.writeBinary(path, payload, options);
      else await platform.files.writeText(path, payload, options);
      check();
      return Object.freeze({ status: nativeFiles ? 'written' : 'downloaded', name: request.name, path });
    } catch (error) {
      try { check(); } catch (cancelled) { error = cancelled; }
      throw error;
    } finally { pending.delete(stop); }
  }
  return Object.freeze({ write, destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const stop of pending) stop();
  } });
}

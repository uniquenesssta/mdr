import { EXPORT_IMAGE_RATIOS } from '../formats/image/image-ratio-presets.js';
export { EXPORT_IMAGE_RATIOS } from '../formats/image/image-ratio-presets.js';

/** Pure export input policy. No model, DOM, task, platform or file side effects. */
const FORMATS = Object.freeze({
  markdown: Object.freeze({ extension: 'md', extensions: Object.freeze(['md', 'markdown']) }),
  html: Object.freeze({ extension: 'html', extensions: Object.freeze(['html', 'htm']) }),
  word: Object.freeze({ extension: 'doc', extensions: Object.freeze(['doc']) }),
  pdf: Object.freeze({ extension: 'pdf', extensions: Object.freeze(['pdf']) }),
  image: Object.freeze({ extension: 'png', extensions: Object.freeze(['png']) })
});

export class ExportRequestValidationError extends TypeError {
  constructor(field, message) {
    super(message);
    this.name = 'ExportRequestValidationError';
    this.code = 'EXPORT_REQUEST_INVALID';
    this.field = field;
  }
}

const invalid = (field, message) => { throw new ExportRequestValidationError(field, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, field, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) invalid(field, '导出参数必须是没有控制字符的文本');
  return value.trim();
}

function fileName(value, spec) {
  const cleaned = text(value, 'name').replace(/[\\/:*?"<>|]+/g, '_').replace(/[. ]+$/, '') || '未命名文档';
  const accepted = spec.extensions.some(extension => cleaned.toLowerCase().endsWith('.' + extension));
  let result = accepted ? cleaned : cleaned.replace(/\.(md|markdown|txt|html|htm|doc|docx|pdf|png)$/i, '') + '.' + spec.extension;
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(result)) result = '_' + result;
  if (result.length > 255) invalid('name', '导出文件名过长');
  return result;
}

/** Returns detached, deeply immutable metadata; the caller still owns document content. */
export function createExportRequest(input) {
  if (!object(input)) invalid('request', '导出请求无效');
  const format = text(input.format, 'format').toLowerCase();
  if (!Object.hasOwn(FORMATS, format)) invalid('format', '导出格式无效');
  const documentId = input.documentId;
  if (typeof documentId !== 'string' || !documentId.trim()) invalid('documentId', '请选择要导出的文档');
  const directory = text(input.directory, 'directory');
  const spec = FORMATS[format];
  const name = fileName(input.name, spec);
  let imageOptions = null;
  if (format === 'image') {
    const options = input.imageOptions === undefined ? {} : input.imageOptions;
    if (!object(options)) invalid('imageOptions', '图片导出选项无效');
    const ratio = text(options.ratio, 'imageOptions.ratio', '9:16');
    if (!Object.hasOwn(EXPORT_IMAGE_RATIOS, ratio)) invalid('imageOptions.ratio', '请选择有效的图片比例');
    const cropFit = options.cropFit === undefined ? false : options.cropFit;
    if (typeof cropFit !== 'boolean') invalid('imageOptions.cropFit', '图片裁切选项无效');
    imageOptions = Object.freeze({ ratio, ...EXPORT_IMAGE_RATIOS[ratio], cropFit });
  } else if (input.imageOptions !== undefined) {
    invalid('imageOptions', '该导出格式不支持图片选项');
  }
  return Object.freeze({ format, documentId, name, directory, extension: spec.extension, extensions: spec.extensions, imageOptions });
}
/** Bind current document identity to the canonical pure request policy without a host or copied state. */
export function createExportRequestPolicy({ getActiveDocumentId, hasDocument } = {}) {
  if (typeof getActiveDocumentId !== 'function' || typeof hasDocument !== 'function') throw new TypeError('Export request document readers are required.');
  return Object.freeze({
    imageRatios: EXPORT_IMAGE_RATIOS,
    createRequest(input) {
      if (input === null || typeof input !== 'object' || Array.isArray(input)) return createExportRequest(input);
      const request = createExportRequest({ ...input, documentId: input.documentId === undefined ? getActiveDocumentId() : input.documentId });
      if (!hasDocument(request.documentId)) throw new ExportRequestValidationError('documentId', '要导出的文档已不存在');
      return request;
    }
  });
}

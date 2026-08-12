import { marked } from 'marked';
import {
  IncrementalPreviewModel,
  protectMarkdownMathSource,
  restoreMarkdownMathSource
} from '../model-kernel/index.js';
import { PREVIEW_BEHAVIOR_THRESHOLDS } from '../features/preview/index.js';

marked.setOptions({ breaks: true, gfm: true });

const CHAPTER_THRESHOLDS = PREVIEW_BEHAVIOR_THRESHOLDS.chapter;

let source = '';
let version = 0;
let previousBlocks = [];
const htmlCache = new Map();
const sentHtmlRaw = new Map();
let referenceDefinitions = '';
let sentReferenceDefinitions = '';
const headingByBlockId = new Map();
const model = new IncrementalPreviewModel(marked.lexer.bind(marked));

function applyTransaction(text, transaction) {
  const changes = Array.isArray(transaction?.changes) ? transaction.changes : [];
  let next = text;
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    const from = Math.max(0, Math.min(next.length, Number(change.from) || 0));
    const to = Math.max(from, Math.min(next.length, Number(change.to) || from));
    next = next.slice(0, from) + String(change.insert ?? '') + next.slice(to);
  }
  return next;
}

function serializeBlock(record) {
  return {
    id: record.id,
    type: record.type,
    raw: record.raw,
    start: record.start,
    end: record.end,
    startLine: record.startLine,
    endLine: record.endLine
  };
}

function createBlockPayload(result) {
  const nextBlocks = result.blocks.map(serializeBlock);
  if (!previousBlocks.length) {
    previousBlocks = nextBlocks;
    return { fullBlocks: nextBlocks, blockPatch: null };
  }

  let prefix = 0;
  while (
    prefix < previousBlocks.length
    && prefix < nextBlocks.length
    && previousBlocks[prefix].id === nextBlocks[prefix].id
  ) prefix += 1;

  let oldSuffix = previousBlocks.length - 1;
  let newSuffix = nextBlocks.length - 1;
  while (
    oldSuffix >= prefix
    && newSuffix >= prefix
    && previousBlocks[oldSuffix].id === nextBlocks[newSuffix].id
  ) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }

  const suffixLength = previousBlocks.length - 1 - oldSuffix;
  let tailOffsetDelta = 0;
  let tailLineDelta = 0;
  if (suffixLength > 0) {
    const oldTail = previousBlocks[oldSuffix + 1];
    const newTail = nextBlocks[newSuffix + 1];
    tailOffsetDelta = newTail.start - oldTail.start;
    tailLineDelta = newTail.startLine - oldTail.startLine;
  }

  const removedBlockIds = previousBlocks.slice(prefix, oldSuffix + 1).map(block => block.id);
  const oldTailStartLine = suffixLength > 0 ? (previousBlocks[oldSuffix + 1]?.startLine || 0) : 0;
  const blockPatch = {
    start: prefix,
    deleteCount: Math.max(0, oldSuffix - prefix + 1),
    blocks: nextBlocks.slice(prefix, newSuffix + 1),
    tailOffsetDelta,
    tailLineDelta,
    removedBlockIds,
    oldTailStartLine
  };
  previousBlocks = nextBlocks;
  return { fullBlocks: null, blockPatch };
}

function stripHeadingMarkdown(text) {
  return String(text || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function serializeHeading(block) {
  if (!block || block.type !== 'heading') return null;
  const firstLine = String(block.raw || '').split('\n', 1)[0];
  const match = firstLine.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (!match) return null;
  const rawText = match[2].trim();
  return {
    id: `heading-${block.id}`,
    blockId: block.id,
    level: match[1].length,
    text: stripHeadingMarkdown(rawText) || rawText,
    line: Math.max(1, Number(block.startLine) || 1)
  };
}

function updateHeadingIndex(blockPayload) {
  if (Array.isArray(blockPayload.fullBlocks)) {
    headingByBlockId.clear();
    for (const block of blockPayload.fullBlocks) {
      const heading = serializeHeading(block);
      if (heading) headingByBlockId.set(block.id, heading);
    }
    return {
      headings: [...headingByBlockId.values()].sort((left, right) => left.line - right.line || left.level - right.level),
      headingPatch: null
    };
  }

  const patch = blockPayload.blockPatch;
  if (!patch) return { headings: null, headingPatch: null };
  const lineDelta = Number(patch.tailLineDelta) || 0;
  const oldTailStartLine = Number(patch.oldTailStartLine) || 0;
  if (lineDelta && oldTailStartLine > 0) {
    for (const [blockId, heading] of headingByBlockId) {
      if (heading.line >= oldTailStartLine) {
        headingByBlockId.set(blockId, { ...heading, line: Math.max(1, heading.line + lineDelta) });
      }
    }
  }
  for (const id of patch.removedBlockIds || []) headingByBlockId.delete(id);
  const insertedHeadings = [];
  for (const block of patch.blocks || []) {
    headingByBlockId.delete(block.id);
    const heading = serializeHeading(block);
    if (heading) {
      headingByBlockId.set(block.id, heading);
      insertedHeadings.push(heading);
    }
  }
  const hasPatch = Boolean((patch.removedBlockIds || []).length || insertedHeadings.length || lineDelta);
  return {
    headings: null,
    headingPatch: hasPatch ? {
      removedBlockIds: patch.removedBlockIds || [],
      headings: insertedHeadings,
      oldTailStartLine,
      tailLineDelta: lineDelta
    } : null
  };
}

function findBlockIndexAtLine(blocks, line) {
  if (!blocks.length) return 0;
  let low = 0;
  let high = blocks.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((blocks[middle].startLine || 1) <= line) low = middle;
    else high = middle - 1;
  }
  return low;
}

function findFocusChapter(blocks, focusLine) {
  if (!blocks.length) return null;
  const line = Math.max(1, Number(focusLine) || 1);
  const focusIndex = findBlockIndexAtLine(blocks, line);
  let headingIndex = -1;
  for (let index = focusIndex; index >= 0; index -= 1) {
    if (blocks[index].type === 'heading') {
      headingIndex = index;
      break;
    }
  }

  if (headingIndex < 0) {
    const nextHeading = blocks.findIndex(block => block.type === 'heading');
    return {
      startIndex: 0,
      endIndex: nextHeading > 0 ? nextHeading : blocks.length,
      focusIndex,
      startLine: 1,
      endLine: nextHeading > 0 ? Math.max(1, blocks[nextHeading].startLine - 1) : (blocks.at(-1)?.endLine || 1),
      headingId: ''
    };
  }

  const heading = blocks[headingIndex];
  const level = String(heading.raw || '').match(/^\s*(#{1,6})\s/)?.[1]?.length || 6;
  let endIndex = blocks.length;
  for (let index = headingIndex + 1; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.type !== 'heading') continue;
    const nextLevel = String(block.raw || '').match(/^\s*(#{1,6})\s/)?.[1]?.length || 6;
    if (nextLevel <= level) {
      endIndex = index;
      break;
    }
  }
  return {
    startIndex: headingIndex,
    endIndex,
    focusIndex,
    startLine: heading.startLine || 1,
    endLine: endIndex < blocks.length
      ? Math.max(heading.startLine || 1, (blocks[endIndex].startLine || 1) - 1)
      : (blocks.at(-1)?.endLine || heading.endLine || 1),
    headingId: heading.id
  };
}

function renderBlocksByIds(blocks, ids, definitions, forcePayload = false) {
  const blockById = new Map(blocks.map(block => [block.id, block]));
  const rendered = [];
  for (const id of ids || []) {
    const block = blockById.get(id);
    if (!block) continue;
    const cached = htmlCache.get(block.id);
    let html = cached?.raw === block.raw ? cached.html : '';
    if (!html) {
      try {
        const renderSource = definitions ? definitions + '\n' + block.raw : block.raw;
        const protectedMath = protectMarkdownMathSource(renderSource, 'WORKER_MATH');
        html = restoreMarkdownMathSource(marked.parse(protectedMath.text), protectedMath.placeholders);
      } catch (_) {
        html = `<pre class="f-raw-fallback">${block.raw.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char])}</pre>`;
      }
      htmlCache.set(block.id, { raw: block.raw, html });
    }
    if (forcePayload || sentHtmlRaw.get(block.id) !== block.raw) {
      rendered.push({ id: block.id, html });
      sentHtmlRaw.set(block.id, block.raw);
    }
  }
  return rendered;
}

function renderPriorityBlocks(result, focusChapter, definitions) {
  const requested = new Set();
  const blocks = result.blocks || [];
  if (result.incremental) {
    let changedChars = 0;
    for (const id of result.changedIds || []) {
      const block = blocks.find(item => item.id === id);
      if (!block) continue;
      requested.add(id);
      changedChars += block.raw.length;
      if (requested.size >= CHAPTER_THRESHOLDS.priorityBlocks || changedChars >= CHAPTER_THRESHOLDS.priorityChars) break;
    }
  }
  if (focusChapter) {
    const chapterStart = Math.max(0, focusChapter.startIndex);
    const chapterEnd = Math.min(blocks.length, focusChapter.endIndex);
    const focusIndex = Math.max(chapterStart, Math.min(chapterEnd - 1, focusChapter.focusIndex));
    let start = Math.max(chapterStart, focusIndex - Math.floor(CHAPTER_THRESHOLDS.priorityBlocks / 2));
    let end = Math.min(chapterEnd, start + CHAPTER_THRESHOLDS.priorityBlocks);
    start = Math.max(chapterStart, end - CHAPTER_THRESHOLDS.priorityBlocks);
    let chars = 0;
    for (let index = focusIndex; index < end && chars < CHAPTER_THRESHOLDS.priorityChars; index += 1) {
      requested.add(blocks[index].id);
      chars += blocks[index].raw.length;
    }
    for (let index = focusIndex - 1; index >= start && chars < CHAPTER_THRESHOLDS.priorityChars; index -= 1) {
      requested.add(blocks[index].id);
      chars += blocks[index].raw.length;
    }
  }

  const currentIds = new Set(blocks.map(block => block.id));
  for (const id of htmlCache.keys()) {
    if (!currentIds.has(id)) {
      htmlCache.delete(id);
      sentHtmlRaw.delete(id);
    }
  }

  return renderBlocksByIds(blocks, requested, definitions, false);
}

function serializeResult(result, focusLine, indexOnly = false) {
  const blockPayload = createBlockPayload(result);
  const headingPayload = updateHeadingIndex(blockPayload);
  const focusChapter = indexOnly ? null : findFocusChapter(result.blocks || [], focusLine);
  const nextDefinitions = result.wholeDocument
    ? (result.records || []).filter(record => record.type === 'def').map(record => record.raw).join('')
    : '';
  const referenceDefinitionsChanged = nextDefinitions !== referenceDefinitions;
  referenceDefinitions = nextDefinitions;
  if (referenceDefinitionsChanged) {
    htmlCache.clear();
    sentHtmlRaw.clear();
  }
  const changedIds = referenceDefinitionsChanged
    ? (result.blocks || []).map(block => block.id)
    : [...result.changedIds];
  const referenceDefinitionsPayload = referenceDefinitions !== sentReferenceDefinitions
    ? referenceDefinitions
    : null;
  sentReferenceDefinitions = referenceDefinitions;
  return {
    incremental: result.incremental,
    reason: result.reason,
    parsedChars: result.parsedChars,
    changedIds,
    removedIds: [...result.removedIds],
    ...blockPayload,
    renderedBlocks: indexOnly ? [] : renderPriorityBlocks(result, focusChapter, referenceDefinitions),
    focusChapter,
    headings: headingPayload.headings,
    headingPatch: headingPayload.headingPatch,
    statistics: {
      characters: source.length,
      lines: Math.max(1, result.records?.at(-1)?.endLine || result.blocks?.at(-1)?.endLine || 1),
      blocks: result.blocks?.length || 0,
      headings: headingByBlockId.size
    },
    tokens: [],
    globalSyntax: result.wholeDocument,
    referenceDefinitions: referenceDefinitionsPayload,
    referenceDefinitionsChanged,
    wholeDocument: false,
    wholeHtml: ''
  };
}

self.onmessage = (event) => {
  const message = event.data || {};
  const requestId = message.requestId;
  const started = performance.now();
  try {
    if (message.type === 'renderBlocks') {
      if (Number(message.version) !== version) {
        throw new Error('Preview worker prewarm version mismatch');
      }
      const renderedBlocks = renderBlocksByIds(previousBlocks, message.ids || [], referenceDefinitions, true);
      self.postMessage({
        type: 'prewarm-result',
        requestId,
        version,
        durationMs: performance.now() - started,
        renderedBlocks
      });
      return;
    }
    if (message.type === 'reset') {
      source = Array.isArray(message.sourceChunks)
        ? message.sourceChunks.map(chunk => String(chunk ?? '')).join('')
        : String(message.source ?? '');
      version = Math.max(0, Number(message.version) || 0);
      model.reset();
      previousBlocks = [];
      htmlCache.clear();
      sentHtmlRaw.clear();
      referenceDefinitions = '';
      sentReferenceDefinitions = '';
      headingByBlockId.clear();
    } else if (message.type === 'update') {
      const transactions = Array.isArray(message.transactions) ? message.transactions : [];
      for (const transaction of transactions) {
        source = applyTransaction(source, transaction);
        version = Math.max(version, Number(transaction.version) || version);
      }
      if (version !== Number(message.version)) {
        throw new Error('Preview worker document version mismatch');
      }
    }

    const result = model.update(source, { forceFull: Boolean(message.forceFull) });
    self.postMessage({
      type: 'result',
      requestId,
      version,
      durationMs: performance.now() - started,
      result: serializeResult(result, message.focusLine, Boolean(message.indexOnly))
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      version,
      message: error?.message || String(error)
    });
  }
};

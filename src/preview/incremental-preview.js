const NON_RENDERED_TOKEN_TYPES = new Set(['space', 'def']);
const REFERENCE_DEFINITION_RE = /^ {0,3}\[[^\]\n]+\]:\s*\S+/m;
const FENCE_RE = /^ {0,3}(?:`{3,}|~{3,})/m;

function commonPrefixLength(a, b) {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a.charCodeAt(index) === b.charCodeAt(index)) index += 1;
  return index;
}

function commonSuffixLength(a, b, prefixLength) {
  const max = Math.min(a.length, b.length) - prefixLength;
  let length = 0;
  while (
    length < max
    && a.charCodeAt(a.length - 1 - length) === b.charCodeAt(b.length - 1 - length)
  ) {
    length += 1;
  }
  return length;
}

function countNewlines(value) {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

function tokenEquals(a, b) {
  return Boolean(a && b && a.type === b.type && a.raw === b.raw);
}

function hasUnsafeGlobalSyntax(source) {
  return REFERENCE_DEFINITION_RE.test(source);
}

function getFenceBoundaryState(fragment) {
  let openFence = null;
  const lines = String(fragment || '').split('\n');
  for (const line of lines) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!match) continue;
    const marker = match[1];
    if (!openFence) {
      openFence = { character: marker[0], length: marker.length };
      continue;
    }
    if (
      marker[0] === openFence.character
      && marker.length >= openFence.length
      && match[2].trim() === ''
    ) {
      openFence = null;
    }
  }
  return openFence ? openFence.character + ':' + openFence.length : '';
}

function fenceStructureChanged(oldFragment, newFragment) {
  if (!FENCE_RE.test(oldFragment) && !FENCE_RE.test(newFragment)) return false;
  return getFenceBoundaryState(oldFragment) !== getFenceBoundaryState(newFragment);
}

export class IncrementalPreviewModel {
  constructor(lexer) {
    if (typeof lexer !== 'function') throw new TypeError('IncrementalPreviewModel requires a lexer');
    this.lexer = lexer;
    this.source = '';
    this.records = [];
    this.nextId = 1;
    this.referenceDefinitions = '';
  }

  reset() {
    this.source = '';
    this.records = [];
    this.nextId = 1;
    this.referenceDefinitions = '';
  }

  update(source, options = {}) {
    const nextSource = String(source ?? '');
    const forceFull = Boolean(options.forceFull);

    if (!this.records.length || forceFull || hasUnsafeGlobalSyntax(nextSource) || hasUnsafeGlobalSyntax(this.source)) {
      return this.fullUpdate(nextSource, forceFull ? 'forced' : 'initial-or-unsafe');
    }

    if (nextSource === this.source) {
      return this.createResult(false, [], [], 0, 'unchanged');
    }

    const prefixLength = commonPrefixLength(this.source, nextSource);
    const suffixLength = commonSuffixLength(this.source, nextSource, prefixLength);
    const oldChangeEnd = this.source.length - suffixLength;
    const newChangeEnd = nextSource.length - suffixLength;
    const delta = nextSource.length - this.source.length;

    let startIndex = this.findRecordIndexAt(prefixLength, 'start');
    let endIndex = this.findRecordIndexAt(oldChangeEnd, 'end');
    startIndex = Math.max(0, startIndex - 2);
    endIndex = Math.min(this.records.length - 1, endIndex + 2);

    const oldRegionStart = this.records[startIndex]?.start ?? 0;
    const oldRegionEnd = this.records[endIndex]?.end ?? this.source.length;
    const newRegionStart = Math.min(oldRegionStart, prefixLength);
    const newRegionEnd = Math.max(newChangeEnd, Math.min(nextSource.length, oldRegionEnd + delta));
    const oldFragment = this.source.slice(oldRegionStart, oldRegionEnd);
    const newFragment = nextSource.slice(newRegionStart, newRegionEnd);

    if (fenceStructureChanged(oldFragment, newFragment)) {
      return this.fullUpdate(nextSource, 'fence-structure');
    }

    let replacement;
    try {
      replacement = this.tokenize(newFragment, newRegionStart);
    } catch (_) {
      return this.fullUpdate(nextSource, 'fragment-lexer-fallback');
    }

    if (!this.coversSourceFragment(replacement, newFragment, newRegionStart)) {
      return this.fullUpdate(nextSource, 'fragment-coverage-fallback');
    }

    const oldRegionRecords = this.records.slice(startIndex, endIndex + 1);
    this.reuseStableIds(oldRegionRecords, replacement);
    replacement.forEach(record => {
      if (!record.id) record.id = this.allocateId();
    });

    const replacementIds = new Set(replacement.map(record => record.id));
    const previousById = new Map(oldRegionRecords.map(record => [record.id, record]));
    const removedIds = oldRegionRecords
      .filter(record => !replacementIds.has(record.id))
      .map(record => record.id);
    const changedIds = replacement
      .filter(record => !tokenEquals(previousById.get(record.id), record))
      .map(record => record.id);

    const before = this.records.slice(0, startIndex);
    const regionStartLine = oldRegionRecords[0]?.startLine || 1;
    this.assignFragmentLineRanges(replacement, regionStartLine);
    const lineDelta = countNewlines(newFragment) - countNewlines(oldFragment);
    const after = this.records.slice(endIndex + 1).map(record => ({
      ...record,
      start: record.start + delta,
      end: record.end + delta,
      startLine: Math.max(1, record.startLine + lineDelta),
      endLine: Math.max(1, record.endLine + lineDelta)
    }));

    this.source = nextSource;
    this.records = [...before, ...replacement, ...after];

    if (!this.coversWholeSource(nextSource, this.records)) {
      return this.fullUpdate(nextSource, 'document-coverage-fallback');
    }

    return this.createResult(true, changedIds, removedIds, newFragment.length, 'incremental');
  }

  fullUpdate(source, reason) {
    let nextRecords;
    try {
      nextRecords = this.tokenize(source, 0);
    } catch (error) {
      throw error;
    }

    this.reuseStableIds(this.records, nextRecords);
    nextRecords.forEach(record => {
      if (!record.id) record.id = this.allocateId();
    });

    const previousById = new Map(this.records.map(record => [record.id, record]));
    const previousIds = new Set(previousById.keys());
    const nextIds = new Set(nextRecords.map(record => record.id));
    const changedIds = nextRecords
      .filter(record => !tokenEquals(previousById.get(record.id), record))
      .map(record => record.id);
    const removedIds = [...previousIds].filter(id => !nextIds.has(id));

    this.source = source;
    this.records = nextRecords;
    this.assignFragmentLineRanges(this.records, 1);
    return this.createResult(false, changedIds, removedIds, source.length, reason);
  }

  tokenize(source, baseOffset) {
    const tokens = this.lexer(source) || [];
    const records = [];
    let cursor = 0;

    for (const token of tokens) {
      const raw = String(token?.raw ?? '');
      if (!raw) continue;
      let localStart = source.startsWith(raw, cursor) ? cursor : source.indexOf(raw, cursor);
      if (localStart < 0) localStart = cursor;
      const localEnd = Math.min(source.length, localStart + raw.length);
      records.push({
        id: '',
        type: token.type || 'unknown',
        raw,
        token,
        start: baseOffset + localStart,
        end: baseOffset + localEnd,
        startLine: 1,
        endLine: 1
      });
      cursor = localEnd;
    }

    if (!records.length && source) {
      records.push({
        id: '',
        type: 'paragraph',
        raw: source,
        token: { type: 'paragraph', raw: source, text: source },
        start: baseOffset,
        end: baseOffset + source.length,
        startLine: 1,
        endLine: 1
      });
    }

    return records;
  }

  coversSourceFragment(records, source, baseOffset) {
    if (!source) return records.length === 0;
    if (!records.length) return false;
    const first = records[0];
    const last = records[records.length - 1];
    if (first.start !== baseOffset || last.end !== baseOffset + source.length) return false;
    let cursor = 0;
    for (const record of records) {
      if (record.start !== baseOffset + cursor || record.end !== record.start + record.raw.length) return false;
      if (!source.startsWith(record.raw, cursor)) return false;
      cursor += record.raw.length;
    }
    return cursor === source.length;
  }

  coversWholeSource(source, records) {
    return this.coversSourceFragment(records, source, 0);
  }

  findRecordIndexAt(offset, side) {
    if (!this.records.length) return 0;
    const safeOffset = Math.max(0, Math.min(this.source.length, offset));
    let low = 0;
    let high = this.records.length - 1;
    if (side === 'start') {
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (this.records[middle].end >= safeOffset) high = middle;
        else low = middle + 1;
      }
      return low;
    }
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.records[middle].start <= safeOffset) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  reuseStableIds(previous, next) {
    let prefix = 0;
    while (prefix < previous.length && prefix < next.length && tokenEquals(previous[prefix], next[prefix])) {
      next[prefix].id = previous[prefix].id;
      prefix += 1;
    }

    let oldSuffix = previous.length - 1;
    let newSuffix = next.length - 1;
    while (oldSuffix >= prefix && newSuffix >= prefix && tokenEquals(previous[oldSuffix], next[newSuffix])) {
      next[newSuffix].id = previous[oldSuffix].id;
      oldSuffix -= 1;
      newSuffix -= 1;
    }

    const buckets = new Map();
    for (let index = prefix; index <= oldSuffix; index += 1) {
      const record = previous[index];
      const key = record.type + '\u0000' + record.raw;
      const bucket = buckets.get(key) || [];
      bucket.push(record.id);
      buckets.set(key, bucket);
    }
    for (let index = prefix; index <= newSuffix; index += 1) {
      if (next[index].id) continue;
      const key = next[index].type + '\u0000' + next[index].raw;
      const bucket = buckets.get(key);
      if (bucket?.length) next[index].id = bucket.shift();
    }
  }

  assignFragmentLineRanges(records, firstLine) {
    let line = Math.max(1, Number(firstLine) || 1);
    records.forEach(record => {
      record.startLine = line;
      const newlineCount = countNewlines(record.raw);
      const visibleNewlines = newlineCount - (record.raw.endsWith('\n') ? 1 : 0);
      record.endLine = line + Math.max(0, visibleNewlines);
      line += newlineCount;
    });
  }

  allocateId() {
    const id = 'preview-block-' + this.nextId;
    this.nextId += 1;
    return id;
  }

  createResult(incremental, changedIds, removedIds, parsedChars, reason) {
    const blocks = this.records.filter(record => record.raw && !NON_RENDERED_TOKEN_TYPES.has(record.type));
    const nextReferenceDefinitions = this.records
      .filter(record => record.type === 'def')
      .map(record => record.raw)
      .join('');
    const referenceDefinitionsChanged = nextReferenceDefinitions !== this.referenceDefinitions;
    this.referenceDefinitions = nextReferenceDefinitions;

    const changed = new Set(changedIds);
    // Reference definitions affect blocks whose own raw source is unchanged.
    // Invalidate every rendered block so local incremental preview and the
    // worker path resolve reference links with identical document context.
    if (referenceDefinitionsChanged) {
      for (const block of blocks) changed.add(block.id);
    }

    return {
      incremental,
      reason,
      parsedChars,
      changedIds: changed,
      removedIds: new Set(removedIds),
      records: this.records,
      blocks,
      tokens: this.records.filter(record => record.raw && record.type !== 'space').map(record => record.token),
      wholeDocument: hasUnsafeGlobalSyntax(this.source),
      referenceDefinitions: this.referenceDefinitions,
      referenceDefinitionsChanged
    };
  }
}

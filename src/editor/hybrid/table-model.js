function countLeadingWhitespace(value) {
  return String(value || '').match(/^[\t ]*/)?.[0]?.length || 0;
}

function countTrailingWhitespace(value) {
  return String(value || '').match(/[\t ]*$/)?.[0]?.length || 0;
}

function decodeTableCell(value) {
  const source = String(value || '');
  let result = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\' && source[index + 1] === '|') {
      result += '|';
      index += 1;
      continue;
    }
    result += character;
  }
  return result;
}

function splitRawSegments(value) {
  const segments = [];
  let segmentStart = 0;
  let escaped = false;
  let codeFence = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '`') {
      let count = 1;
      while (value[index + count] === '`') count += 1;
      if (codeFence === 0) codeFence = count;
      else if (codeFence === count) codeFence = 0;
      index += count - 1;
      continue;
    }
    if (character === '|' && codeFence === 0) {
      segments.push({ from: segmentStart, to: index });
      segmentStart = index + 1;
    }
  }
  segments.push({ from: segmentStart, to: value.length });
  return segments;
}

export function parseTableRow(line, lineFrom = 0) {
  const source = String(line || '');
  const outerLeading = countLeadingWhitespace(source);
  const outerTrailing = countTrailingWhitespace(source);
  const contentEnd = Math.max(outerLeading, source.length - outerTrailing);
  const content = source.slice(outerLeading, contentEnd);
  const hasLeadingPipe = content.startsWith('|');
  const hasTrailingPipe = content.endsWith('|');
  let segments = splitRawSegments(content);
  if (hasLeadingPipe && segments[0]?.from === 0 && segments[0]?.to === 0) segments = segments.slice(1);
  if (hasTrailingPipe) {
    const last = segments[segments.length - 1];
    if (last && last.from === content.length && last.to === content.length) segments = segments.slice(0, -1);
  }

  const cells = segments.map((segment, index) => {
    const raw = content.slice(segment.from, segment.to);
    const leading = countLeadingWhitespace(raw);
    const trailing = countTrailingWhitespace(raw);
    const rawEnd = Math.max(leading, raw.length - trailing);
    const contentFrom = outerLeading + segment.from + leading;
    const contentTo = outerLeading + segment.from + rawEnd;
    const rawValue = raw.slice(leading, rawEnd);
    return {
      index,
      value: decodeTableCell(rawValue),
      raw: rawValue,
      from: Math.max(0, Number(lineFrom) || 0) + contentFrom,
      to: Math.max(0, Number(lineFrom) || 0) + contentTo
    };
  });

  return {
    cells,
    hasLeadingPipe,
    hasTrailingPipe
  };
}

export function encodeTableCell(value) {
  return String(value ?? '')
    .replace(/\r\n?|\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

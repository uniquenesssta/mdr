function getLineRecords(source) {
  const text = String(source || '');
  const records = [];
  let from = 0;
  while (from <= text.length) {
    const newline = text.indexOf('\n', from);
    const to = newline >= 0 ? newline : text.length;
    records.push({ from, to, text: text.slice(from, to) });
    if (newline < 0) break;
    from = newline + 1;
  }
  return records;
}

/**
 * Return only unambiguous Markdown display-math ranges using \[ ... \].
 *
 * Markdown also uses a backslash to escape literal square brackets, so an
 * inline sequence such as `文字：\[方括号\]` must remain ordinary Markdown.
 * A backslash display formula is accepted only when the opening delimiter is
 * the first non-indentation content on its line and either closes at the end
 * of that same line or uses standalone opening/closing delimiter lines.
 */
export function collectBackslashDisplayMathRanges(value) {
  const source = String(value || '');
  const lines = getLineRecords(source);
  const ranges = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const sameLine = line.text.match(/^[ \t]{0,3}\\\[([\s\S]*?)\\\][ \t]*$/);
    if (sameLine) {
      ranges.push({ from: line.from, to: line.to });
      continue;
    }

    if (!/^[ \t]{0,3}\\\[[ \t]*$/.test(line.text)) continue;
    for (let closingIndex = index + 1; closingIndex < lines.length; closingIndex += 1) {
      const closing = lines[closingIndex];
      if (!/^[ \t]*\\\][ \t]*$/.test(closing.text)) continue;
      ranges.push({ from: line.from, to: closing.to });
      index = closingIndex;
      break;
    }
  }

  return ranges;
}

function replaceRangesWithPlaceholders(value, ranges, store) {
  const source = String(value || '');
  if (!ranges.length) return source;
  let cursor = 0;
  let output = '';
  for (const range of ranges) {
    if (range.from < cursor || range.to <= range.from) continue;
    output += source.slice(cursor, range.from);
    output += store(source.slice(range.from, range.to));
    cursor = range.to;
  }
  output += source.slice(cursor);
  return output;
}

export function protectMarkdownMathSource(value, prefix = 'MATH') {
  const placeholders = [];
  let counter = 0;
  const source = String(value || '');
  const parts = source.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g);
  const text = parts.map(part => {
    if (part.startsWith('```') || part.startsWith('~~~') || part.startsWith('`')) return part;
    part = part.replace(/\$\$[\s\S]*?\$\$/g, match => store(match));
    part = replaceRangesWithPlaceholders(part, collectBackslashDisplayMathRanges(part), store);
    part = part.replace(/\\\([^\n]*?\\\)/g, match => store(match));
    part = part.replace(/(^|[^\\])\$([^$\n]+?)\$/g, (match, leading) => leading + store(match.slice(leading.length)));
    return part;
  }).join('');
  return { text, placeholders };

  function store(match) {
    const key = `<!--${String(prefix || 'MATH')}_${counter++}-->`;
    placeholders.push({ key, value: match });
    return key;
  }
}

export function restoreMarkdownMathSource(html, placeholders) {
  let output = String(html || '');
  for (const placeholder of placeholders || []) {
    output = output.split(placeholder.key).join(placeholder.value);
  }
  return output;
}

export function containsMarkdownMath(value) {
  const source = String(value || '');
  if (source.includes('$') || source.includes('\\(')) return true;
  return collectBackslashDisplayMathRanges(source).length > 0;
}


const HEADING_FONT_SCALES = new Map([
  [1, '190%'], [2, '155%'], [3, '130%'], [4, '114%'], [5, '104%'], [6, '100%']
]);

export function addHeadingLinePresentation({
  lineClasses,
  lineStyles,
  lineFrom,
  level,
  addLineClass,
  addLineStyle
}) {
  addLineClass(lineClasses, lineFrom, `cm-hybrid-heading cm-hybrid-heading-${level}`);
  addLineStyle(lineStyles, lineFrom, 'font-size', HEADING_FONT_SCALES.get(level) || '100%');
}

export function applyAtxHeadingLine({
  line,
  content,
  contentOffset,
  lineClasses,
  lineStyles,
  replace,
  Decoration,
  addLineClass,
  addLineStyle
}) {
  const heading = String(content || '').match(/^(\s{0,3})(#{1,6})[\t ]+/);
  if (!heading) return null;
  const level = heading[2].length;
  addHeadingLinePresentation({
    lineClasses,
    lineStyles,
    lineFrom: line.from,
    level,
    addLineClass,
    addLineStyle
  });
  replace(
    line.from + contentOffset + heading[1].length,
    line.from + contentOffset + heading[0].length,
    Decoration.replace({ inclusive: false })
  );
  return { level, match: heading };
}

export function applySetextHeadingNode({
  view,
  name,
  from,
  lineClasses,
  lineStyles,
  addLineClass,
  addLineStyle
}) {
  if (name !== 'SetextHeading1' && name !== 'SetextHeading2') return false;
  const level = name === 'SetextHeading1' ? 1 : 2;
  const titleLine = view.state.doc.lineAt(from);
  addHeadingLinePresentation({
    lineClasses,
    lineStyles,
    lineFrom: titleLine.from,
    level,
    addLineClass,
    addLineStyle
  });
  if (titleLine.number < view.state.doc.lines) {
    const markerLine = view.state.doc.line(titleLine.number + 1);
    addLineClass(lineClasses, markerLine.from, 'cm-hybrid-setext-marker-line');
  }
  return true;
}

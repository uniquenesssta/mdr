
export function applyListLinePresentation({
  line,
  content,
  contentOffset,
  heading,
  lineClasses,
  addLineClass,
  replace,
  Decoration,
  TaskCheckboxWidget,
  HybridPrefixWidget
}) {
  const task = String(content || '').match(/^(\s*)([-+*])[\t ]+\[([ xX])\][\t ]+/);
  if (task) {
    addLineClass(lineClasses, line.from, 'cm-hybrid-list-line cm-hybrid-task-line');
    const markerFrom = line.from + contentOffset + task[0].indexOf('[') + 1;
    replace(
      line.from + contentOffset + task[1].length,
      line.from + contentOffset + task[0].length,
      Decoration.replace({
        widget: new TaskCheckboxWidget({
          checked: task[3].toLowerCase() === 'x',
          markerFrom
        })
      })
    );
    return true;
  }

  const unordered = String(content || '').match(/^(\s*)([-+*])[\t ]+/);
  if (unordered && !heading) {
    addLineClass(lineClasses, line.from, 'cm-hybrid-list-line');
    replace(
      line.from + contentOffset + unordered[1].length,
      line.from + contentOffset + unordered[0].length,
      Decoration.replace({ widget: new HybridPrefixWidget('bullet', { label: '•' }) })
    );
  }

  const ordered = String(content || '').match(/^(\s*)(\d+[.)])[\t ]+/);
  if (ordered) {
    addLineClass(lineClasses, line.from, 'cm-hybrid-list-line');
    replace(
      line.from + contentOffset + ordered[1].length,
      line.from + contentOffset + ordered[0].length,
      Decoration.replace({ widget: new HybridPrefixWidget('ordered', { label: ordered[2] }) })
    );
  }
  return false;
}

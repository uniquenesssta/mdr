
import { createHorizontalRuleWidgetType } from '../widgets/horizontal-rule/horizontal-rule-widget.js';
import { createInlineMathWidgetType } from '../widgets/math/inline-math-widget.js';
import { createHybridPrefixWidgetType } from '../widgets/prefix/prefix-widget.js';
import { createTaskCheckboxWidgetType } from '../widgets/prefix/task-checkbox-widget.js';
import {
  addHeadingLinePresentation,
  applyAtxHeadingLine,
  applySetextHeadingNode
} from './heading-presentation.js';
import {
  addExactHybridSelectionPresentation,
  applyFallbackInlinePresentation,
  applyInlineTreeNode
} from './inline-format-presentation.js';
import { applyHtmlInlinePresentation } from './html-inline-presentation.js';
import { applyListLinePresentation } from './list-presentation.js';
import {
  applyFallbackLinkToken,
  applyFallbackReferenceLinks,
  applyLinkPresentation,
  applyReferenceDefinitionPresentation,
  collectReferenceDefinitions
} from './link-presentation.js';
import {
  applyBlockquoteTreeNode,
  applyQuoteLinePresentation,
  parseQuotePrefix
} from './quote-presentation.js';

function requireFunction(name, value) {
  if (typeof value !== 'function') throw new TypeError(`Inline Presentation requires ${name}`);
  return value;
}

function isFullyInsideRevealRange(ranges, from, to) {
  return Array.from(ranges || []).some(range => Boolean(range?.revealBlock)
    && Number(range.from) <= from
    && to <= Number(range.to));
}

function addLineClass(lineClasses, lineFrom, className) {
  const classes = lineClasses.get(lineFrom) || new Set();
  classes.add(className);
  lineClasses.set(lineFrom, classes);
}

function addLineStyle(lineStyles, lineFrom, property, value) {
  const styles = lineStyles.get(lineFrom) || new Map();
  styles.set(property, value);
  lineStyles.set(lineFrom, styles);
}

function getTrailingEmptyCaretLineFrom(view) {
  const selection = view.state.selection.main;
  const documentLength = view.state.doc.length;
  if (view.hasFocus === false || !selection.empty || selection.head !== documentLength) return null;
  const trailingLine = view.state.doc.lineAt(documentLength);
  return trailingLine.from === documentLength && trailingLine.to === documentLength
    ? trailingLine.from
    : null;
}

export function createInlinePresentationCoordinator(options = {}) {
  const Decoration = options.Decoration;
  const WidgetType = options.WidgetType;
  if (!Decoration?.replace || !Decoration?.mark || !Decoration?.line) {
    throw new TypeError('Inline Presentation requires Decoration');
  }
  if (typeof WidgetType !== 'function') throw new TypeError('Inline Presentation requires WidgetType');

  const lexInline = requireFunction('lexInline', options.lexInline);
  const renderFormula = requireFunction('renderFormula', options.renderFormula);
  const collectInlineMathRanges = requireFunction('collectInlineMathRanges', options.collectInlineMathRanges);
  const collectVisibleLines = requireFunction('collectVisibleLines', options.collectVisibleLines);
  const intersectsRanges = requireFunction('intersectsRanges', options.intersectsRanges);
  const intersectsRevealRanges = requireFunction('intersectsRevealRanges', options.intersectsRevealRanges);
  const overlapsRanges = requireFunction('overlapsRanges', options.overlapsRanges);
  const shouldDecorateSourceActiveLine = requireFunction('shouldDecorateSourceActiveLine', options.shouldDecorateSourceActiveLine);

  const HybridPrefixWidget = createHybridPrefixWidgetType(WidgetType);
  const TaskCheckboxWidget = createTaskCheckboxWidgetType(WidgetType);
  const HorizontalRuleWidget = createHorizontalRuleWidgetType(WidgetType);
  const InlineMathWidget = createInlineMathWidgetType(WidgetType, {
    renderFormula,
    recordInteraction: options.recordMathInteraction,
    reportRenderFailure: options.reportMathRenderFailure
  });

  return function buildInlinePresentation(view, tree, editableRanges, blockRanges, activeSourceRanges = []) {
    const trailingEmptyCaretLineFrom = getTrailingEmptyCaretLineFrom(view);
    const ranges = [];
    const replacements = [];
    const lineClasses = new Map();
    const lineStyles = new Map();
    const visibleLines = collectVisibleLines(view);
    const referenceData = collectReferenceDefinitions({ view, tree, visibleLines });
    const visibleLineStarts = new Set(visibleLines.map(line => line.from));
    const semanticMarkKeys = new Set();

    const addSemanticMark = (from, to, className, attributes) => {
      if (to <= from || !className || overlapsRanges(blockRanges, from, to)) return false;
      const attributeKey = attributes ? JSON.stringify(attributes) : '';
      const key = `${from}:${to}:${className}:${attributeKey}`;
      if (semanticMarkKeys.has(key)) return false;
      semanticMarkKeys.add(key);
      ranges.push(Decoration.mark({ class: className, attributes }).range(from, to));
      return true;
    };

    const replace = (from, to, decoration) => {
      if (to <= from
        || intersectsRanges(editableRanges, from, to)
        || overlapsRanges(blockRanges, from, to)
        || overlapsRanges(replacements, from, to)) return false;
      replacements.push({ from, to });
      ranges.push(decoration.range(from, to));
      return true;
    };

    const replaceUncovered = (from, to, decoration) => {
      if (to <= from) return false;
      const covered = replacements
        .filter(range => range.from < to && from < range.to)
        .sort((left, right) => left.from - right.from || left.to - right.to);
      let cursor = from;
      let changed = false;
      for (const range of covered) {
        if (range.from > cursor) changed = replace(cursor, Math.min(to, range.from), decoration) || changed;
        cursor = Math.max(cursor, range.to);
        if (cursor >= to) break;
      }
      if (cursor < to) changed = replace(cursor, to, decoration) || changed;
      return changed;
    };

    const replaceProtectedWidget = (from, to, decoration) => {
      if (to <= from
        || intersectsRanges(activeSourceRanges, from, to)
        || overlapsRanges(blockRanges, from, to)
        || overlapsRanges(replacements, from, to)) return false;
      replacements.push({ from, to });
      ranges.push(decoration.range(from, to));
      return true;
    };

    const shouldDecoratePresentationSourceActiveLine = (from, to) => {
      if (trailingEmptyCaretLineFrom !== null) {
        const safeFrom = Math.max(0, Number(from) || 0);
        const safeTo = Math.max(safeFrom + 1, Number(to) || safeFrom);
        return safeFrom === trailingEmptyCaretLineFrom
          && !overlapsRanges(blockRanges, safeFrom, safeTo);
      }
      return shouldDecorateSourceActiveLine(editableRanges, blockRanges, from, to);
    };

    for (const math of collectInlineMathRanges(view, tree, activeSourceRanges, blockRanges)) {
      replaceProtectedWidget(
        math.from,
        math.to,
        Decoration.replace({ widget: new InlineMathWidget(math), inclusive: false })
      );
    }

    applyHtmlInlinePresentation({
      view,
      tree,
      blockRanges,
      editableRanges,
      ranges,
      replacements,
      addSemanticMark,
      replace,
      overlapsRanges,
      intersectsRevealRanges,
      Decoration
    });

    applyReferenceDefinitionPresentation({
      view,
      referenceData,
      editableRanges,
      blockRanges,
      visibleLineStarts,
      intersectsRevealRanges,
      overlapsRanges,
      addLineClass,
      lineClasses,
      replaceUncovered,
      Decoration
    });

    for (const line of visibleLines) {
      const text = line.text;
      if (overlapsRanges(blockRanges, line.from, Math.max(line.from + 1, line.to))) continue;
      if (shouldDecoratePresentationSourceActiveLine(line.from, line.to)) {
        addLineClass(lineClasses, line.from, 'cm-hybrid-source-active');
        continue;
      }

      const quote = parseQuotePrefix(text);
      const contentOffset = quote?.contentFrom || 0;
      const content = quote?.content ?? text;
      if (quote) {
        applyQuoteLinePresentation({
          view,
          line,
          quote,
          lineClasses,
          lineStyles,
          replace,
          Decoration,
          addLineClass,
          addLineStyle
        });
      }

      const heading = applyAtxHeadingLine({
        line,
        content,
        contentOffset,
        lineClasses,
        lineStyles,
        replace,
        Decoration,
        addLineClass,
        addLineStyle
      });

      if (applyListLinePresentation({
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
      })) continue;

      if (/^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(content)) {
        addLineClass(lineClasses, line.from, 'cm-hybrid-rule-line');
        replace(
          line.from + contentOffset,
          line.to,
          Decoration.replace({ widget: new HorizontalRuleWidget() })
        );
      }
    }

    for (const visible of view.visibleRanges) {
      tree.iterate({
        from: visible.from,
        to: visible.to,
        enter(nodeRef) {
          const { name, from, to } = nodeRef;
          if (overlapsRanges(blockRanges, from, to)) return false;
          if (isFullyInsideRevealRange(editableRanges, from, to)) return false;

          if (name === 'Link' && applyLinkPresentation({
            view,
            node: nodeRef.node,
            replace,
            addMark: addSemanticMark,
            referenceDefinitions: referenceData.definitions,
            Decoration
          })) return false;

          applySetextHeadingNode({
            view,
            name,
            from,
            lineClasses,
            lineStyles,
            addLineClass,
            addLineStyle
          });
          applyBlockquoteTreeNode({
            view,
            name,
            from,
            to,
            lineClasses,
            editableRanges,
            blockRanges,
            intersectsRevealRanges,
            overlapsRanges,
            addLineClass
          });
          applyInlineTreeNode({
            name,
            from,
            to,
            parentName: nodeRef.node?.parent?.name || '',
            addSemanticMark,
            replace,
            Decoration
          });
        }
      });
    }

    for (const line of visibleLines) {
      applyFallbackInlinePresentation({
        view,
        line,
        replaceUncovered,
        blockRanges,
        editableRanges,
        addMark: addSemanticMark,
        referenceDefinitions: referenceData.definitions,
        overlapsRanges,
        intersectsRevealRanges,
        lexInline,
        Decoration,
        applyFallbackLinkToken,
        applyFallbackReferenceLinks
      });
    }

    addExactHybridSelectionPresentation({ view, ranges, blockRanges, overlapsRanges, Decoration });

    for (const range of editableRanges) {
      if (!range.revealBlock) continue;
      let line = view.state.doc.lineAt(Math.min(view.state.doc.length, range.from));
      while (line.from <= range.to) {
        if (shouldDecoratePresentationSourceActiveLine(line.from, line.to)) {
          addLineClass(lineClasses, line.from, 'cm-hybrid-source-active');
        }
        if (line.number >= view.state.doc.lines) break;
        line = view.state.doc.line(line.number + 1);
      }
    }

    const mainSelection = view.state.selection.main;
    if (view.hasFocus !== false && mainSelection.empty && mainSelection.head === view.state.doc.length) {
      const trailingLine = view.state.doc.lineAt(view.state.doc.length);
      const trailingTo = Math.max(trailingLine.from + 1, trailingLine.to);
      if (trailingLine.from === view.state.doc.length
        && !overlapsRanges(blockRanges, trailingLine.from, trailingTo)) {
        addLineClass(lineClasses, trailingLine.from, 'cm-hybrid-source-active');
      }
    }

    let headingLines = 0;
    let sourceActiveLines = 0;
    for (const [lineFrom, classes] of lineClasses) {
      if ([...classes].some(className => className.includes('cm-hybrid-heading'))) headingLines += 1;
      if (classes.has('cm-hybrid-source-active')) sourceActiveLines += 1;
      const styles = lineStyles.get(lineFrom);
      const attributes = { class: [...classes].join(' ') };
      if (styles?.size && !classes.has('cm-hybrid-source-active')) {
        attributes.style = [...styles].map(([property, value]) => `${property}:${value}`).join(';');
      }
      ranges.push(Decoration.line({ attributes }).range(lineFrom));
    }

    return {
      ranges,
      stats: {
        visibleLines: visibleLines.length,
        decoratedLines: lineClasses.size,
        headingLines,
        sourceActiveLines,
        hiddenMarkers: replacements.length
      }
    };
  };
}

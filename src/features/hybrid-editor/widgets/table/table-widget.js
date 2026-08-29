/**
 * Atomic 8.9 Table WidgetType composition and interactive lifecycle.
 * Allowed imports: Table view/cell editor plus Hybrid Session/Activation/Lifecycle/Shared source primitives.
 * Forbidden imports: CodeMirror packages, model-kernel paths and application globals; WidgetType, frozen cell encoder and history annotation are injected by editor composition.
 * API: createTableBlockWidgetType(). State: only widget DOM/closer references; authoritative interaction mode remains in HybridComponentSession.
 */
import { bindStrictDoubleActivation } from '../../activation/strict-double-activation.js';
import {
  HYBRID_COMPONENT_MODES,
  closeHybridComponent,
  createHybridComponentKey,
  registerHybridComponentCloser,
  transitionHybridComponent
} from '../../state/hybrid-component-session.js';
import {
  attachHybridWidgetLifecycle,
  destroyHybridWidgetLifecycle
} from '../../lifecycle/widget-lifecycle.js';
import { scheduleHybridWidgetGeometry } from '../../lifecycle/widget-geometry-scheduler.js';
import { createWidgetButton } from '../shared/widget-button.js';
import { createWidgetToolbar } from '../shared/widget-toolbar.js';
import { bindWidgetSourceAction, openWidgetSource } from '../shared/widget-source-action.js';
import { createTableCellEditor } from './table-cell-editor.js';
import { createTableCellPresentation, createTableView } from './table-view.js';

export function createTableBlockWidgetType(WidgetType, options = {}) {
  if (typeof WidgetType !== 'function') throw new TypeError('WidgetType base is required');
  if (typeof options.encodeTableCell !== 'function') throw new TypeError('Table cell encoder is required');
  const scheduleFrame = typeof options.scheduleFrame === 'function'
    ? options.scheduleFrame
    : callback => globalThis.requestAnimationFrame(callback);
  const recordInteraction = typeof options.recordInteraction === 'function'
    ? options.recordInteraction
    : () => {};
  const reportEditFailure = typeof options.reportEditFailure === 'function'
    ? options.reportEditFailure
    : () => {};

  return class TableBlockWidget extends WidgetType {
    constructor(descriptor, widgetOptions = {}) {
      super();
      this.from = descriptor.from;
      this.to = descriptor.to;
      this.editFrom = descriptor.contentFrom ?? descriptor.from;
      this.headers = descriptor.headers;
      this.headerCells = descriptor.headerCells || [];
      this.alignments = descriptor.alignments;
      this.rows = descriptor.rows;
      this.rowCells = descriptor.rowCells || [];
      this.fingerprint = descriptor.fingerprint;
      this.visualEditing = Boolean(widgetOptions.visualEditing);
    }

    eq(other) {
      return other.from === this.from
        && other.to === this.to
        && other.fingerprint === this.fingerprint
        && other.visualEditing === this.visualEditing;
    }

    toDOM(view) {
      const section = document.createElement('section');
      section.className = 'cm-hybrid-block-widget cm-hybrid-table-widget';
      section.classList.toggle('is-cell-editing-enabled', this.visualEditing);
      section.dataset.hybridBlockType = 'table';
      section.dataset.hybridTableFrom = String(this.from);
      const componentKey = createHybridComponentKey('table', this.from);
      const editDescriptor = {
        componentType: 'table',
        from: this.from,
        to: this.to,
        editFrom: this.editFrom,
        editTo: this.editFrom,
        preferredPosition: this.editFrom
      };
      const disposeSourceAction = bindWidgetSourceAction(section, view, editDescriptor, {
        sourceKeys: [],
        title: this.visualEditing
          ? '双击单元格直接编辑；点击“编辑源码”编辑 Markdown 源码'
          : '双击编辑 Markdown 源码',
        exclude: event => this.visualEditing
          && event.target instanceof Element
          && Boolean(event.target.closest('.cm-hybrid-table-scroller')),
        onOpen: (trigger, gesture = {}) => recordInteraction('hybrid.table-source-open', {
          tableFrom: this.from,
          trigger,
          intervalMs: gesture.intervalMs ?? null,
          distancePx: gesture.distancePx ?? null
        })
      });

      const openTableSource = (activeInput = null, trigger = 'button') => {
        const anchorRect = section.getBoundingClientRect();
        activeInput?.__markdownEditorCommitTableCell?.();
        recordInteraction('hybrid.table-source-open', {
          tableFrom: this.from,
          trigger
        });
        scheduleFrame(() => {
          openWidgetSource(view, editDescriptor, {
            getBoundingClientRect: () => anchorRect
          });
        });
      };

      const toolbar = createWidgetToolbar({
        className: 'cm-hybrid-table-toolbar',
        doubleZone: 'table-toolbar'
      });
      const labelGroup = document.createElement('div');
      labelGroup.className = 'cm-hybrid-table-label-group';
      const label = document.createElement('span');
      label.textContent = `${this.headers.length} 列 · ${this.rows.length} 行`;
      labelGroup.appendChild(label);
      if (this.visualEditing) {
        const badge = document.createElement('span');
        badge.className = 'cm-hybrid-table-editing-badge';
        badge.textContent = '双击单元格编辑';
        labelGroup.appendChild(badge);
      }
      toolbar.appendChild(labelGroup);
      toolbar.appendChild(createWidgetButton('编辑源码', 'cm-hybrid-widget-action', () => {
        const activeInput = document.activeElement instanceof HTMLInputElement
          && section.contains(document.activeElement)
          ? document.activeElement
          : null;
        openTableSource(activeInput, 'button');
      }));
      section.appendChild(toolbar);

      const { scroller, cells, rowCount, columnCount } = createTableView({
        headers: this.headers,
        headerCells: this.headerCells,
        alignments: this.alignments,
        rows: this.rows,
        rowCells: this.rowCells
      }, { visualEditing: this.visualEditing });
      const activationCleanups = [];
      const closerDisposers = new Set();

      if (this.visualEditing) {
        for (const cellRecord of cells) {
          const { cellElement, cell, cellKey, rowIndex, columnIndex, isHeader } = cellRecord;
          const activateCellEditor = (activationOptions = {}) => {
            if (!cell || !Number.isInteger(cell.from) || !Number.isInteger(cell.to)) {
              openTableSource(null, 'missing-cell-doubleclick');
              return;
            }
            if (cellElement.querySelector('[data-hybrid-table-cell-input]')) return;
            const presentation = cellElement.querySelector('.cm-hybrid-table-cell-value');
            if (!(presentation instanceof HTMLElement)) return;
            transitionHybridComponent(view, {
              key: componentKey,
              type: 'table',
              from: this.from,
              mode: HYBRID_COMPONENT_MODES.DIRECT,
              reason: activationOptions.trigger || 'doubleclick',
              details: { row: rowIndex, column: columnIndex }
            });

            let input = null;
            let disposeCloser = () => {};
            input = createTableCellEditor(view, {
              cell,
              cellKey,
              tableFrom: this.from,
              rowIndex,
              columnIndex,
              rowCount,
              columnCount,
              ariaLabel: `${isHeader ? '表头' : `第 ${rowIndex} 行`}第 ${columnIndex + 1} 列`
            }, {
              documentRef: section.ownerDocument,
              encodeTableCell: options.encodeTableCell,
              createHistoryAnnotation: options.createHistoryAnnotation,
              recordInteraction,
              onFailure: reportEditFailure,
              scheduleFrame,
              onClose: result => {
                if (!input?.isConnected) return;
                recordInteraction('hybrid.table-cell-edit-close', {
                  tableFrom: this.from,
                  row: rowIndex,
                  column: columnIndex,
                  reason: result?.reason || 'unknown'
                });
                disposeCloser();
                closeHybridComponent(view, componentKey, result?.reason || 'direct-closed', {
                  componentType: 'table',
                  row: rowIndex,
                  column: columnIndex
                }, HYBRID_COMPONENT_MODES.DIRECT);
                input.replaceWith(createTableCellPresentation(
                  cell,
                  rowIndex,
                  columnIndex,
                  isHeader,
                  result?.value ?? cell?.value ?? ''
                ));
                cellElement.classList.remove('is-direct-edit-active');
                scheduleFrame(() => scheduleHybridWidgetGeometry(view, 'table-cell-edit-closed'));
              }
            });
            const unregisterCloser = registerHybridComponentCloser(view, componentKey, () => {
              if (input?.isConnected) input.blur();
            });
            disposeCloser = () => {
              unregisterCloser();
              closerDisposers.delete(disposeCloser);
            };
            closerDisposers.add(disposeCloser);
            presentation.replaceWith(input);
            cellElement.classList.add('is-direct-edit-active');
            recordInteraction('hybrid.table-cell-edit-open', {
              tableFrom: this.from,
              row: rowIndex,
              column: columnIndex,
              trigger: activationOptions.trigger || 'doubleclick',
              intervalMs: activationOptions.gesture?.intervalMs ?? null,
              distancePx: activationOptions.gesture?.distancePx ?? null
            });
            scheduleFrame(() => {
              if (!input.isConnected || input.disabled) return;
              input.focus({ preventScroll: true });
              if (activationOptions.select !== false) input.select();
              scheduleHybridWidgetGeometry(view, 'table-cell-edit-opened');
            });
          };

          cellElement.__markdownEditorActivateTableCell = activateCellEditor;
          activationCleanups.push(bindStrictDoubleActivation(cellElement, (event, gesture) => {
            activateCellEditor({ trigger: 'doubleclick', select: true, gesture });
          }, {
            exclude: event => event.target instanceof Element
              && Boolean(event.target.closest('input, textarea, button, a, select')),
            getTargetKey: () => `table-cell:${cellKey}`
          }));
        }
      }

      section.appendChild(scroller);
      const lifecycleCleanup = attachHybridWidgetLifecycle(section, view, 'table');
      let cleaned = false;
      section.__markdownEditorTableBlockCleanup = () => {
        if (cleaned) return;
        cleaned = true;
        disposeSourceAction();
        for (const dispose of activationCleanups.splice(0)) dispose?.();
        for (const dispose of [...closerDisposers]) dispose();
        closerDisposers.clear();
        for (const input of section.querySelectorAll('[data-hybrid-table-cell-input]')) {
          input.__markdownEditorDestroyTableCell?.();
        }
        for (const { cellElement } of cells) {
          delete cellElement.__markdownEditorActivateTableCell;
        }
        lifecycleCleanup();
      };
      return section;
    }

    destroy(dom) {
      dom?.__markdownEditorTableBlockCleanup?.();
      if (dom) delete dom.__markdownEditorTableBlockCleanup;
      destroyHybridWidgetLifecycle(dom);
    }

    ignoreEvent() {
      return true;
    }
  };
}

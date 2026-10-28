/**
 * Responsibility: Bind editor command controls, own only toolbar dropdown visibility, and dispatch editing/layout intents to injected boundaries.
 * Imports: Shared DOM event scope only.
 * Exports: createEditorToolbarView.
 * State/side effects: Owns toolbar listeners plus heading/view menu visibility; no editor/document state.
 * Lifecycle: Explicit View with idempotent destroy(); closes owned menus and removes listeners.
 */
import { createEventScope, mountStaticContent, createSafeElement } from '../../../ui/dom/index.js';
import { createSelectionToolbarView } from './selection-toolbar-view.js';
import { canRunEditorAction } from '../domain/reading-policy.js';

export function createEditorToolbarView({
  root,
  commandRoots = [],
  commands,
  dialogs = {},
  tableView = null,
  selection = null,
  getLayoutMode = () => 'both',
  toolbarPreferences = null,
  onCustomizeToolbar = () => {},
  formatLayoutLabel = mode => String(mode || '')
} = {}) {
  if (!root?.ownerDocument) throw new TypeError('Editor Toolbar View requires a toolbar root.');
  if (!commands || typeof commands.execute !== 'function') throw new TypeError('Editor Toolbar View requires an execute command boundary.');
  const events = createEventScope();
  const headingMenu = root.querySelector('#heading-menu');
  const viewMenu = root.querySelector('#view-menu');
  const moreMenu = root.querySelector('#format-more-menu');
  const formatGroup = root.querySelector('.format-group');
  const roots = [root, ...commandRoots.filter(value => value && value !== root)];
  let destroyed = false;
  const selectionView = selection && formatGroup && moreMenu ? createSelectionToolbarView({ root, selection, preferences: toolbarPreferences, getLayoutMode, customize: onCustomizeToolbar }) : null;

  const closeMenus = (keepMore = false) => {
    headingMenu?.classList.remove('show');
    viewMenu?.classList.remove('show');
    if (!keepMore) selectionView?.close();
  };
  const refreshLayoutLabel = mode => {
    const value = mode || getLayoutMode() || 'both';
    const label = root.querySelector('#view-dropdown > button [data-i18n="view"]');
    if (label) label.textContent = formatLayoutLabel(value) || formatLayoutLabel('both');
    for (const button of root.querySelectorAll('.writing-modes [data-mode]')) {
      button.classList.toggle('active', button.dataset.mode === value);
      button.setAttribute('aria-pressed', button.dataset.mode === value ? 'true' : 'false');
    }
    selectionView?.refresh();
  };
  const execute = (action, payload) => commands.execute(action, payload);
  const route = (action, trigger) => {
    if (!canRunEditorAction(getLayoutMode(), action)) return;
    if (selectionView?.handle(action)) return;
    if (action === 'toggle-heading-menu') {
      const willOpen = !headingMenu?.classList.contains('show');
      closeMenus(Boolean(moreMenu?.contains(headingMenu)));
      if (willOpen) headingMenu?.classList.add('show');
      return;
    }
    if (action === 'heading') {
      execute('heading', Number(trigger.dataset.level) || 1);
      closeMenus();
      return;
    }
    if (action === 'toggle-view-menu') {
      const willOpen = !viewMenu?.classList.contains('show');
      closeMenus();
      if (willOpen) viewMenu?.classList.add('show');
      return;
    }
    if (action === 'layout') {
      const mode = trigger.dataset.mode || trigger.value;
      execute('layout', mode);
      refreshLayoutLabel(mode);
      closeMenus();
      return;
    }
    if (action === 'page-fullscreen' || action === 'system-fullscreen') { execute(action); closeMenus(); return; }
    if (action === 'open-link') return dialogs.link?.open?.();
    if (action === 'open-image') return dialogs.image?.open?.();
    if (action === 'open-find') return dialogs.find?.open?.(false);
    if (action === 'open-replace') return dialogs.find?.open?.(true);
    if (action === 'open-mermaid') return dialogs.mermaid?.open?.();
    if (action === 'toggle-table') return tableView?.toggle?.();
    if (action === 'insert-table') return tableView?.insert?.(Number(trigger.dataset.rows) || 3, Number(trigger.dataset.cols) || 3);
    if (action === 'inline-math') return dialogs.math?.insertInline?.();
    if (action === 'block-math') return dialogs.math?.insertBlock?.();
    execute(action);
  };

  for (const commandRoot of roots) {
    events.listen(commandRoot, 'click', event => {
      const trigger = event.target?.closest?.('[data-editor-action]');
      if (!trigger || trigger.disabled || !commandRoot.contains(trigger)) return;
      const action = trigger.dataset.editorAction;
      if (!action) return;
      event.preventDefault?.();
      route(action, trigger);
      if (commandRoot !== root) execute('close-app-menus');
    });
    events.listen(commandRoot, 'change', event => {
      const trigger = event.target?.closest?.('[data-editor-change-action]');
      if (!trigger || !commandRoot.contains(trigger)) return;
      if (trigger.dataset.editorChangeAction === 'layout') route('layout', trigger);
    });
  }
  events.listen(root.ownerDocument, 'mousedown', event => {
    if (event.target?.closest?.('#heading-dropdown, #view-dropdown, #format-more-dropdown')) return;
    closeMenus();
  });

  const refreshSelection = () => selectionView?.refresh();
  events.listen(root.ownerDocument, 'keydown', event => {
    if (event.key === 'Escape') closeMenus();
  });
  events.listen(root, 'mousedown', event => {
    if (event.target?.closest?.('.format-group button')) event.preventDefault();
  });

  refreshLayoutLabel();
  return Object.freeze({
    closeMenus,
    refreshLayoutLabel,
    refreshSelection,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      closeMenus();
      selectionView?.destroy();
      events.destroy();
    }
  });
}

/** Compose the writing header and a reusable selection-format surface over existing editor actions. */
export function createEditorToolbarContentView(slots) {
  const content = mountStaticContent([
    [slots.toolbar,[
      "\n      ",
      ["div",{"class":"format-group"},[
        "\n        ",
        ["button",{"data-editor-action":"undo","data-i18n-title":"undoTitle","title":"撤销 Ctrl+Z"},[
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-undo"},[]]]]
        ]],
        "\n        ",
        ["button",{"data-editor-action":"redo","data-i18n-title":"redoTitle","title":"重做 Ctrl+Y / Ctrl+Shift+Z"},[
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-redo"},[]]]]
        ]],
        "\n        ",
        ["span",{"class":"divider"},[]],
        "\n        ",
        ["button",{"data-editor-action":"bold","data-toolbar-item":"bold","data-i18n-title":"boldTitle","title":"加粗 Ctrl+B"},[["b",{},["B"]]]],
        "\n        ",
        ["button",{"data-editor-action":"italic","data-toolbar-item":"italic","data-i18n-title":"italicTitle","title":"斜体 Ctrl+I"},[["i",{},["I"]]]],
        "\n        ",
        ["button",{"data-editor-action":"underline","data-toolbar-item":"underline","data-i18n-title":"underlineTitle","title":"下划线 Ctrl+U"},[["u",{},["U"]]]],
        "\n        ",
        ["button",{"data-editor-action":"strikethrough","data-toolbar-item":"strikethrough","data-i18n-title":"strikethroughTitle","title":"删除线"},[["s",{},["S"]]]],
        "\n        ",
        ["button",{"data-editor-action":"subscript","data-toolbar-item":"script","data-i18n-title":"subscriptTitle","title":"下标"},["x₂"]],
        "\n        ",
        ["button",{"data-editor-action":"superscript","data-toolbar-item":"script","data-i18n-title":"superscriptTitle","title":"上标"},["x²"]],
        "\n        ",
        ["div",{"class":"dropdown color-dropdown","id":"text-color-dropdown","data-toolbar-item":"textColor"},[
          "\n          ",
          ["button",{"type":"button","id":"text-color-button","class":"color-tool-button text-color-button","data-color-menu-kind":"text","title":"文字颜色（请先选择文字）","aria-haspopup":"true","aria-expanded":"false","disabled":true},[
            "\n            ",
            ["span",{"class":"color-tool-glyph"},["A"]],
            ["span",{"class":"color-tool-indicator","id":"text-color-indicator"},[]],
            ["svg",{"class":"icon icon-sm"},[["use",{"href":"/assets/icons.svg#icon-chevron-down"},[]]]],
            "\n          "
          ]],
          "\n          ",
          ["div",{"class":"dropdown-menu color-menu","id":"text-color-menu"},[
            "\n            ",
            ["strong",{},["文字颜色"]],
            "\n            ",
            ["div",{"class":"color-swatches","aria-label":"文字颜色预设"},[
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--text-ink","title":"黑色","data-inline-color-kind":"text","data-inline-color":"#1a1d23"},[]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--text-gray","title":"灰色","data-inline-color-kind":"text","data-inline-color":"#6b7280"},[]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--text-red","title":"红色","data-inline-color-kind":"text","data-inline-color":"#dc2626"},[]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--text-orange","title":"橙色","data-inline-color-kind":"text","data-inline-color":"#ea580c"},[]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--text-yellow","title":"黄色","data-inline-color-kind":"text","data-inline-color":"#ca8a04"},[]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--text-green","title":"绿色","data-inline-color-kind":"text","data-inline-color":"#16a34a"},[]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--text-cyan","title":"青色","data-inline-color-kind":"text","data-inline-color":"#0891b2"},[]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--text-blue","title":"蓝色","data-inline-color-kind":"text","data-inline-color":"#2563eb"},[]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--text-purple","title":"紫色","data-inline-color-kind":"text","data-inline-color":"#7c3aed"},[]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--text-pink","title":"粉色","data-inline-color-kind":"text","data-inline-color":"#db2777"},[]],
              "\n            "
            ]],
            "\n            ",
            ["div",{"class":"color-menu-actions"},[
              "\n              ",
              ["label",{"class":"custom-color-action"},["自定义",["input",{"type":"color","id":"custom-text-color","value":"#2563eb","data-inline-color-custom":"text"},[]]]],
              "\n              ",
              ["button",{"type":"button","data-inline-color-clear":"text"},["清除颜色"]],
              "\n            "
            ]],
            "\n          "
          ]],
          "\n        "
        ]],
        "\n        ",
        ["div",{"class":"dropdown color-dropdown","id":"highlight-color-dropdown","data-toolbar-item":"highlight"},[
          "\n          ",
          ["button",{"type":"button","id":"highlight-color-button","class":"color-tool-button highlight-color-button","data-color-menu-kind":"highlight","title":"文字高亮（请先选择文字）","aria-haspopup":"true","aria-expanded":"false","disabled":true},[
            "\n            ",
            ["span",{"class":"color-tool-glyph color-tool-highlight"},["A"]],
            ["span",{"class":"color-tool-indicator","id":"highlight-color-indicator"},[]],
            ["svg",{"class":"icon icon-sm"},[["use",{"href":"/assets/icons.svg#icon-chevron-down"},[]]]],
            "\n          "
          ]],
          "\n          ",
          ["div",{"class":"dropdown-menu color-menu","id":"highlight-color-menu"},[
            "\n            ",
            ["strong",{},["文字高亮"]],
            "\n            ",
            ["div",{"class":"color-swatches","aria-label":"文字高亮预设"},[
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--highlight-yellow","title":"黄色","data-inline-color-kind":"highlight","data-inline-color":"#fff3a3"},[

              ]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--highlight-orange","title":"橙色","data-inline-color-kind":"highlight","data-inline-color":"#fed7aa"},[

              ]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--highlight-red","title":"红色","data-inline-color-kind":"highlight","data-inline-color":"#fecaca"},[

              ]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--highlight-green","title":"绿色","data-inline-color-kind":"highlight","data-inline-color":"#bbf7d0"},[

              ]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--highlight-blue","title":"蓝色","data-inline-color-kind":"highlight","data-inline-color":"#bae6fd"},[

              ]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--highlight-purple","title":"紫色","data-inline-color-kind":"highlight","data-inline-color":"#ddd6fe"},[

              ]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--highlight-pink","title":"粉色","data-inline-color-kind":"highlight","data-inline-color":"#fbcfe8"},[

              ]],
              "\n              ",
              ["button",{"type":"button","class":"color-swatch c-color-swatch--highlight-gray","title":"灰色","data-inline-color-kind":"highlight","data-inline-color":"#e5e7eb"},[

              ]],
              "\n            "
            ]],
            "\n            ",
            ["div",{"class":"color-menu-actions"},[
              "\n              ",
              ["label",{"class":"custom-color-action"},[
                "自定义",
                ["input",{"type":"color","id":"custom-highlight-color","value":"#fff3a3","data-inline-color-custom":"highlight"},[]]
              ]],
              "\n              ",
              ["button",{"type":"button","data-inline-color-clear":"highlight"},["清除高亮"]],
              "\n            "
            ]],
            "\n          "
          ]],
          "\n        "
        ]],
        "\n        ",
        ["span",{"class":"divider"},[]],
        "\n        ",
        ["div",{"class":"dropdown heading-dropdown","id":"heading-dropdown","data-toolbar-item":"heading"},[
          "\n          ",
          ["button",{"data-editor-action":"toggle-heading-menu","data-i18n-title":"heading","title":"标题"},[
            "H ",
            ["svg",{"class":"icon icon-sm"},[["use",{"href":"/assets/icons.svg#icon-chevron-down"},[]]]]
          ]],
          "\n          ",
          ["div",{"class":"dropdown-menu","id":"heading-menu"},[
            "\n            ",
            ["div",{"class":"dropdown-item","data-editor-action":"heading","data-level":"1","data-i18n":"headingH1"},["H1 一级标题"]],
            "\n            ",
            ["div",{"class":"dropdown-item","data-editor-action":"heading","data-level":"2","data-i18n":"headingH2"},["H2 二级标题"]],
            "\n            ",
            ["div",{"class":"dropdown-item","data-editor-action":"heading","data-level":"3","data-i18n":"headingH3"},["H3 三级标题"]],
            "\n            ",
            ["div",{"class":"dropdown-item","data-editor-action":"heading","data-level":"4","data-i18n":"headingH4"},["H4 四级标题"]],
            "\n            ",
            ["div",{"class":"dropdown-item","data-editor-action":"heading","data-level":"5","data-i18n":"headingH5"},["H5 五级标题"]],
            "\n            ",
            ["div",{"class":"dropdown-item","data-editor-action":"heading","data-level":"6","data-i18n":"headingH6"},["H6 六级标题"]],
            "\n          "
          ]],
          "\n        "
        ]],
        "\n        ",
        ["span",{"class":"divider"},[]],
        "\n        ",
        ["button",{"data-editor-action":"quote","data-toolbar-item":"quote","data-i18n-title":"quote","title":"引用"},[
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-quote"},[]]]],
          " ",
          ["span",{"data-i18n":"quote"},["引用"]]
        ]],
        "\n        ",
        ["button",{"data-editor-action":"unordered","data-toolbar-item":"lists","data-i18n-title":"unordered","title":"无序列表"},[
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-list"},[]]]],
          " ",
          ["span",{"data-i18n":"unordered"},["无序"]]
        ]],
        "\n        ",
        ["button",{"data-editor-action":"ordered","data-toolbar-item":"lists","data-i18n-title":"ordered","title":"有序列表"},[
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-list-numbered"},[]]]],
          " ",
          ["span",{"data-i18n":"ordered"},["有序"]]
        ]],
        "\n        ",
        ["button",{"data-editor-action":"task","data-toolbar-item":"lists","data-i18n-title":"task","title":"任务列表"},[
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-task"},[]]]],
          " ",
          ["span",{"data-i18n":"task"},["任务"]]
        ]],
        "\n        ",
        ["span",{"class":"divider"},[]],
        "\n        ",
        ["button",{"data-editor-action":"inline-code","data-toolbar-item":"code","data-i18n-title":"inlineCode","title":"行内代码"},[
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-code"},[]]]],
          " ",
          ["span",{"data-i18n":"inlineCode"},["行内代码"]]
        ]],
        "\n        ",
        ["button",{"data-editor-action":"code","data-toolbar-item":"code","data-i18n-title":"codeBlock","title":"代码块"},[
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-braces"},[]]]]
        ]],
        "\n        ",
        ["button",{"data-editor-action":"open-link","data-toolbar-item":"link","data-i18n-title":"link","title":"插入链接 Ctrl+K"},[
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-link"},[]]]],
          " ",
          ["span",{"data-i18n":"link"},["链接"]]
        ]],
        "\n        ",
        ["button",{"data-editor-action":"open-image","data-toolbar-item":"image","data-i18n-title":"image","title":"插入图片 Ctrl+Shift+K"},[
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-image"},[]]]],
          " ",
          ["span",{"data-i18n":"image"},["图片"]]
        ]],
        "\n        ",
        ["div",{"class":"dropdown","id":"table-dropdown","data-toolbar-item":"table"},[
          "\n          ",
          ["button",{"data-editor-action":"toggle-table","data-i18n-title":"table","title":"插入表格"},[
            ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-table"},[]]]],
            " ",
            ["span",{"data-i18n":"table"},["表格"]]
          ]],
          "\n          ",
          ["div",{"class":"dropdown-menu table-selector-menu","id":"table-menu"},[
            "\n            ",
            ["div",{"class":"table-grid","id":"table-grid"},[]],
            "\n            ",
            ["div",{"class":"table-size-label","id":"table-size-label"},["0 行 × 0 列"]],
            "\n          "
          ]],
          "\n        "
        ]],
        "\n        ",
        ["button",{"data-editor-action":"open-find","data-toolbar-item":"find","data-i18n-title":"find","title":"查找替换 Ctrl+F"},[
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-search"},[]]]],
          " ",
          ["span",{"data-i18n":"find"},["查找"]]
        ]],
        "\n        ",
        ["button",{"data-editor-action":"open-mermaid","data-toolbar-item":"mermaid","data-i18n-title":"mermaid","title":"插入 Mermaid 图表"},[
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-mermaid"},[]]]],
          " ",
          ["span",{"data-i18n":"mermaid"},["Mermaid"]]
        ]],
        "\n      "
      ]],
      "\n      ",
      ["div",{"class":"editor-actions"},[
        "\n        ",
        ["div",{"class":"dropdown","id":"view-dropdown"},[
          "\n          ",
          ["button",{"data-editor-action":"toggle-view-menu","data-i18n-title":"view","title":"视图布局"},[
            ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-layout"},[]]]],
            " ",
            ["span",{"data-i18n":"view"},["视图"]],
            " ",
            ["svg",{"class":"icon icon-sm"},[["use",{"href":"/assets/icons.svg#icon-chevron-down"},[]]]]
          ]],
          "\n          ",
          ["div",{"class":"dropdown-menu","id":"view-menu"},[
            "\n            ",
            ["div",{"class":"dropdown-item","data-editor-action":"layout","data-mode":"both","data-i18n":"viewBoth"},["编辑 + 预览"]],
            "\n            ",
            ["div",{"class":"dropdown-item","data-editor-action":"layout","data-mode":"hybrid","data-i18n":"viewHybrid"},["单视图混合编辑"]],
            "\n            ",
            ["div",{"class":"dropdown-item","data-editor-action":"layout","data-mode":"edit","data-i18n":"viewEdit"},["仅编辑"]],
            "\n            ",
            ["div",{"class":"dropdown-item","data-editor-action":"layout","data-mode":"preview","data-i18n":"viewPreview"},["仅预览"]],
            "\n            ",
            ["div",{"class":"dropdown-item","data-editor-action":"page-fullscreen","data-i18n":"pageFullscreen"},["页面全屏"]],
            "\n            ",
            ["div",{"class":"dropdown-item","data-editor-action":"system-fullscreen","data-i18n":"systemFullscreen"},["系统全屏"]],
            "\n          "
          ]],
          "\n        "
        ]],
        "\n        ",
        ["button",{"data-theme-toggle":true,"data-i18n-title":"theme","title":"切换主题"},[
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-sun"},[]]]],
          " ",
          ["span",{"data-i18n":"theme"},["主题"]]
        ]],
        "\n      "
      ]],
      "\n"
    ]],
  ]);
  const additions = composeWritingToolbar(slots.toolbar);
  return Object.freeze({ destroy() { content.destroy(); for (const node of additions) node.remove(); } });
}

function composeWritingToolbar(root) {
  const doc = root.ownerDocument;
  const node = (tag, options = {}) => createSafeElement(doc, tag, options);
  const button = (label, action, attributes = {}) => node('button', { text: label, attributes: { type: 'button', 'data-editor-action': action, ...attributes } });
  const format = root.querySelector('.format-group');
  const oldActions = root.querySelector('.editor-actions');
  oldActions.querySelector('#view-dropdown')?.classList.add('writing-mode-menu');
  oldActions.querySelector('[data-theme-toggle]')?.classList.add('writing-theme-toggle');
  // Live compatibility projection for existing document commands; Session owns the title.
  const title = node('input', { id: 'filename', attributes: { type: 'hidden', value: '未命名文档.md' } });
  const modes = node('div', { className: 'writing-modes', attributes: { role: 'group', 'aria-label': '文档视图' } });
  const modeSlot = node('div', { className: 'writing-mode-slot' });
  for (const [mode, label, key] of [['hybrid', '写作', 'writingMode'], ['both', '分栏', 'splitMode'], ['preview', '纯阅读', 'readingMode']]) modes.append(button(label, 'layout', { 'data-mode': mode, 'aria-pressed': 'false', 'data-i18n': key }));
  modeSlot.append(modes);
  const more = node('div', { id: 'format-more-dropdown', className: 'dropdown' });
  const moreMenu = node('div', { id: 'format-more-menu', className: 'dropdown-menu writing-more-menu' });
  more.append(button('更多', 'toggle-more'), moreMenu);
  moreMenu.append(button('固定工具条', 'pin-toolbar', { 'aria-pressed': 'false' }), button('自定义工具条…', 'customize-toolbar'));
  const primary = new Set(['bold', 'italic', 'underline', 'strikethrough', 'open-link']);
  for (const child of [...format.children]) {
    if (child.nodeType !== 1) continue;
    if (child.classList.contains('divider')) { child.remove(); continue; }
    if (child.matches('.color-dropdown, #heading-dropdown')) continue;
    if (!primary.has(child.dataset.editorAction)) moreMenu.append(child);
  }
  const heading = format.querySelector('#heading-dropdown');
  if (heading) { format.prepend(heading); const trigger = heading.querySelector('button'); trigger.firstChild.textContent = '正文 '; }
  for (const child of [...oldActions.children]) moreMenu.append(child);
  oldActions.remove();

  const link = format.querySelector('[data-editor-action="open-link"]');
  if (link) { format.append(link); link.querySelector('svg')?.remove(); }
  const highlight = format.querySelector('#highlight-color-button .color-tool-glyph');
  if (highlight) highlight.textContent = '高亮';
  format.append(more);
  format.setAttribute('role', 'toolbar'); format.setAttribute('aria-label', '选区格式');
  root.append(title, modeSlot);
  return [title, modeSlot];
}

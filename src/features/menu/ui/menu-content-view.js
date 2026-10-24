import { mountStaticContent } from '../../../ui/dom/index.js';

/** Own the menu feature markup; event policy and domain state stay in its existing controllers. */
export function createMenuContentView(slots) {
  return mountStaticContent([
    [slots.menu,[
      "\n      ",
      ["div",{"class":"app-brand window-drag-region","aria-label":"Markdown Editor"},[
        "\n        ",
        ["span",{"class":"app-brand-mark","aria-hidden":"true"},["M"]],
        "\n        ",
        ["span",{"class":"app-brand-name"},["Markdown Editor"]],
        "\n      "
      ]],
      "\n      ",
      ["span",{"class":"menu-bar-divider","aria-hidden":"true"},[]],
      "\n      ",
      ["div",{"class":"menu-dropdown","id":"file-menu-dropdown"},[
        "\n        ",
        ["button",{"class":"menu-trigger","data-menu-toggle":"file-menu","title":"文件","aria-label":"文件菜单"},[
          ["svg",{"class":"icon menu-button-icon","aria-hidden":"true"},[["use",{"href":"/assets/icons.svg#icon-menu-file"},[]]]],
          ["span",{"class":"menu-button-label"},["文件"]]
        ]],
        "\n        ",
        ["div",{"class":"menu-dropdown-list","id":"file-menu"},[
          "\n          ",
          ["div",{"class":"menu-item"},[["span",{},["新建文档"]],["kbd",{},["Ctrl+N"]]]],
          "\n          ",
          ["div",{"class":"menu-item"},[["span",{},["打开文件..."]],["kbd",{},["Ctrl+O"]]]],
          "\n          ",
          ["div",{"class":"menu-item","data-editor-action":"save-current-file"},[["span",{},["保存"]],["kbd",{},["Ctrl+S"]]]],
          "\n          ",
          ["div",{"class":"menu-item","data-editor-action":"save-as-markdown"},[["span",{},["另存为..."]],["kbd",{},["Ctrl+Shift+S"]]]],
          "\n          ",
          ["div",{"class":"menu-item"},[["span",{},["重命名当前文档..."]],["kbd",{},["F2"]]]],
          "\n          ",
          ["div",{"class":"menu-item","data-settings-open":true},[["span",{},["设置..."]],["kbd",{},["Ctrl+,"]]]],
          "\n          ",
          ["div",{"class":"menu-item menu-submenu","id":"recent-files-menu-item"},[
            ["span",{},["最近打开"]],
            ["span",{"class":"menu-arrow"},["›"]],
            "\n            ",
            ["div",{"class":"menu-dropdown-list menu-submenu-list recent-files-menu","id":"recent-files-menu"},[]],
            "\n          "
          ]],
          "\n          ",
          ["div",{"class":"menu-separator"},[]],
          "\n          ",
          ["div",{"class":"menu-item"},[["span",{},["从网页导入 Markdown..."]]]],
          "\n          ",
          ["div",{"class":"menu-separator"},[]],
          "\n          ",
          ["div",{"class":"menu-item menu-submenu"},[
            ["span",{},["导出"]],
            ["span",{"class":"menu-arrow"},["›"]],
            "\n            ",
            ["div",{"class":"menu-dropdown-list menu-submenu-list"},[
              "\n              ",
              ["div",{"class":"menu-item"},[["span",{},["Markdown"]]]],
              "\n              ",
              ["div",{"class":"menu-item"},[["span",{},["Word"]]]],
              "\n              ",
              ["div",{"class":"menu-item"},[["span",{},["PDF"]]]],
              "\n              ",
              ["div",{"class":"menu-item"},[["span",{},["HTML"]]]],
              "\n              ",
              ["div",{"class":"menu-item"},[["span",{},["图片..."]]]],
              "\n            "
            ]],
            "\n          "
          ]],
          "\n        "
        ]],
        "\n      "
      ]],
      "\n      ",
      ["div",{"class":"menu-dropdown","id":"edit-menu-dropdown"},[
        "\n        ",
        ["button",{"class":"menu-trigger","data-menu-toggle":"edit-menu","title":"编辑","aria-label":"编辑菜单"},[
          ["svg",{"class":"icon menu-button-icon","aria-hidden":"true"},[["use",{"href":"/assets/icons.svg#icon-menu-edit"},[]]]],
          ["span",{"class":"menu-button-label"},["编辑"]]
        ]],
        "\n        ",
        ["div",{"class":"menu-dropdown-list","id":"edit-menu"},[
          "\n          ",
          ["div",{"class":"menu-item","data-editor-action":"undo"},[["span",{},["撤销"]],["kbd",{},["Ctrl+Z"]]]],
          "\n          ",
          ["div",{"class":"menu-item","data-editor-action":"redo"},[["span",{},["重做"]],["kbd",{},["Ctrl+Y"]]]],
          "\n          ",
          ["div",{"class":"menu-separator"},[]],
          "\n          ",
          ["div",{"class":"menu-item","data-editor-action":"bold"},[["span",{},["加粗"]],["kbd",{},["Ctrl+B"]]]],
          "\n          ",
          ["div",{"class":"menu-item","data-editor-action":"italic"},[["span",{},["斜体"]],["kbd",{},["Ctrl+I"]]]],
          "\n          ",
          ["div",{"class":"menu-item","data-editor-action":"underline"},[["span",{},["下划线"]],["kbd",{},["Ctrl+U"]]]],
          "\n          ",
          ["div",{"class":"menu-item","data-editor-action":"open-find"},[["span",{},["查找 / 替换..."]],["kbd",{},["Ctrl+F"]]]],
          "\n          ",
          ["div",{"class":"menu-separator"},[]],
          "\n          ",
          ["div",{"class":"menu-item","data-editor-action":"clear"},[["span",{},["清空当前文档"]]]],
          "\n        "
        ]],
        "\n      "
      ]],
      "\n      ",
      ["div",{"class":"menu-dropdown","id":"view-menu-dropdown"},[
        "\n        ",
        ["button",{"class":"menu-trigger","data-menu-toggle":"app-view-menu","title":"视图","aria-label":"视图菜单"},[
          ["svg",{"class":"icon menu-button-icon","aria-hidden":"true"},[["use",{"href":"/assets/icons.svg#icon-menu-view"},[]]]],
          ["span",{"class":"menu-button-label"},["视图"]]
        ]],
        "\n        ",
        ["div",{"class":"menu-dropdown-list","id":"app-view-menu"},[
          "\n          ",
          ["div",{"class":"menu-item"},[["span",{},["显示 / 隐藏侧边栏"]],["kbd",{},["Ctrl+Shift+B"]]]],
          "\n          ",
          ["div",{"class":"menu-separator"},[]],
          "\n          ",
          ["div",{"class":"menu-item"},[["span",{},["编辑 + 预览"]]]],
          "\n          ",
          ["div",{"class":"menu-item"},[["span",{},["仅编辑"]]]],
          "\n          ",
          ["div",{"class":"menu-item"},[["span",{},["仅预览"]]]],
          "\n          ",
          ["div",{"class":"menu-separator"},[]],
          "\n          ",
          ["div",{"class":"menu-item"},[["span",{},["专注模式"]],["kbd",{},["F11"]]]],
          "\n          ",
          ["div",{"class":"menu-item"},[["span",{},["系统全屏"]]]],
          "\n        "
        ]],
        "\n      "
      ]],
      "\n      ",
      ["div",{"class":"menu-dropdown","id":"insert-menu-dropdown"},[
        "\n        ",
        ["button",{"class":"menu-trigger","data-menu-toggle":"insert-menu","title":"插入","aria-label":"插入菜单"},[
          ["svg",{"class":"icon menu-button-icon","aria-hidden":"true"},[["use",{"href":"/assets/icons.svg#icon-menu-insert"},[]]]],
          ["span",{"class":"menu-button-label"},["插入"]]
        ]],
        "\n        ",
        ["div",{"class":"menu-dropdown-list","id":"insert-menu"},[
          "\n          ",
          ["div",{"class":"menu-item menu-submenu"},[
            ["span",{},["标题"]],
            ["span",{"class":"menu-arrow"},["›"]],
            "\n            ",
            ["div",{"class":"menu-dropdown-list menu-submenu-list"},[
              "\n              ",
              ["div",{"class":"menu-item","data-editor-action":"heading","data-level":"1"},[["span",{},["H1 一级标题"]]]],
              "\n              ",
              ["div",{"class":"menu-item","data-editor-action":"heading","data-level":"2"},[["span",{},["H2 二级标题"]]]],
              "\n              ",
              ["div",{"class":"menu-item","data-editor-action":"heading","data-level":"3"},[["span",{},["H3 三级标题"]]]],
              "\n              ",
              ["div",{"class":"menu-item","data-editor-action":"heading","data-level":"4"},[["span",{},["H4 四级标题"]]]],
              "\n              ",
              ["div",{"class":"menu-item","data-editor-action":"heading","data-level":"5"},[["span",{},["H5 五级标题"]]]],
              "\n              ",
              ["div",{"class":"menu-item","data-editor-action":"heading","data-level":"6"},[["span",{},["H6 六级标题"]]]],
              "\n            "
            ]],
            "\n          "
          ]],
          "\n          ",
          ["div",{"class":"menu-item","data-editor-action":"open-link"},[["span",{},["链接"]],["kbd",{},["Ctrl+K"]]]],
          "\n          ",
          ["div",{"class":"menu-item","data-editor-action":"open-image"},[["span",{},["图片..."]],["kbd",{},["Ctrl+Shift+K"]]]],
          "\n          ",
          ["div",{"class":"menu-item","data-editor-action":"insert-table","data-rows":"3","data-cols":"3"},[["span",{},["表格 3 × 3"]]]],
          "\n          ",
          ["div",{"class":"menu-item menu-switch-item","id":"table-visual-editing-toggle","role":"menuitemcheckbox","aria-checked":"false"},[
            "\n            ",
            ["span",{},["表格深度可视化编辑"]],
            "\n            ",
            ["span",{"class":"menu-inline-switch","aria-hidden":"true"},[
              ["span",{"class":"menu-inline-switch-track"},[["span",{"class":"menu-inline-switch-thumb"},[]]]],
              ["span",{"class":"menu-inline-switch-state"},["关"]]
            ]],
            "\n          "
          ]],
          "\n          ",
          ["div",{"class":"menu-item menu-switch-item","id":"code-visual-editing-toggle","role":"menuitemcheckbox","aria-checked":"false"},[
            "\n            ",
            ["span",{},["代码块深度可视化编辑"]],
            "\n            ",
            ["span",{"class":"menu-inline-switch","aria-hidden":"true"},[
              ["span",{"class":"menu-inline-switch-track"},[["span",{"class":"menu-inline-switch-thumb"},[]]]],
              ["span",{"class":"menu-inline-switch-state"},["关"]]
            ]],
            "\n          "
          ]],
          "\n          ",
          ["div",{"class":"menu-item menu-submenu"},[
            ["span",{},["数学公式"]],
            ["span",{"class":"menu-arrow"},["›"]],
            "\n            ",
            ["div",{"class":"menu-dropdown-list menu-submenu-list"},[
              "\n              ",
              ["div",{"class":"menu-item","data-editor-action":"inline-math"},[["span",{},["行内公式 $…$"]]]],
              "\n              ",
              ["div",{"class":"menu-item","data-editor-action":"block-math"},[["span",{},["块级公式 $$…$$"]]]],
              "\n            "
            ]],
            "\n          "
          ]],
          "\n          ",
          ["div",{"class":"menu-item","data-editor-action":"open-mermaid"},[["span",{},["Mermaid 图表..."]]]],
          "\n        "
        ]],
        "\n      "
      ]],
      "\n      ",
      ["div",{"class":"menu-dropdown","id":"help-menu-dropdown"},[
        "\n        ",
        ["button",{"class":"menu-trigger","data-menu-toggle":"help-menu","title":"帮助","aria-label":"帮助菜单"},[
          ["svg",{"class":"icon menu-button-icon","aria-hidden":"true"},[["use",{"href":"/assets/icons.svg#icon-help"},[]]]],
          ["span",{"class":"menu-button-label"},["帮助"]]
        ]],
        "\n        ",
        ["div",{"class":"menu-dropdown-list","id":"help-menu"},[
          "\n          ",
          ["div",{"class":"menu-item","data-help-open":true},[["span",{},["使用帮助"]]]],
          "\n        "
        ]],
        "\n      "
      ]],
      "\n      ",
      ["div",{"class":"menu-bar-spacer window-drag-region"},[]],
      "\n      ",
      ["div",{"class":"window-controls","id":"window-controls","hidden":true,"aria-label":"窗口控制"},[
        "\n        ",
        ["button",{"type":"button","class":"window-control-btn","id":"window-minimize-btn","title":"最小化","aria-label":"最小化"},[
          "\n          ",
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-minimize"},[]]]],
          "\n        "
        ]],
        "\n        ",
        ["button",{"type":"button","class":"window-control-btn","id":"window-maximize-btn","title":"最大化","aria-label":"最大化","data-maximized":"false"},[
          "\n          ",
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-maximize"},[]]]],
          "\n        "
        ]],
        "\n        ",
        ["button",{"type":"button","class":"window-control-btn close","id":"window-close-btn","title":"关闭","aria-label":"关闭"},[
          "\n          ",
          ["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-close"},[]]]],
          "\n        "
        ]],
        "\n      "
      ]],
      "\n"
    ]],
  ]);
}

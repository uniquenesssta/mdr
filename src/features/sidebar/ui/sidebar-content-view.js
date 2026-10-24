import { mountStaticContent } from '../../../ui/dom/index.js';

/** Own the sidebar feature markup; event policy and domain state stay in its existing controllers. */
export function createSidebarContentView(slots) {
  return mountStaticContent([
    [slots.sidebar,[
      "\n        ",
      ["div",{"class":"sidebar-header"},[
        "\n          ",
        ["div",{"class":"sidebar-heading"},["\n            ",["span",{"class":"sidebar-kicker"},["WORKSPACE"]],"\n            ",["strong",{},["内容导航"]],"\n          "]],
        "\n          ",
        ["button",{"data-sidebar-hide":true,"title":"隐藏侧边栏"},[["svg",{"class":"icon icon-sm"},[["use",{"href":"/assets/icons.svg#icon-chevron-left"},[]]]]]],
        "\n        "
      ]],
      "\n        ",
      ["div",{"class":"sidebar-tabs"},[
        "\n          ",
        ["button",{"class":"active","id":"sidebar-docs-tab"},[["svg",{"class":"icon icon-sm"},[["use",{"href":"/assets/icons.svg#icon-book"},[]]]],["span",{},["文档"]]]],
        "\n          ",
        ["button",{"id":"sidebar-files-tab","title":"文件树：当前文件所在文件夹"},[
          ["svg",{"class":"icon icon-sm"},[["use",{"href":"/assets/icons.svg#icon-folder"},[]]]],
          ["span",{},["文件"]]
        ]],
        "\n          ",
        ["button",{"id":"sidebar-outline-tab"},[["svg",{"class":"icon icon-sm"},[["use",{"href":"/assets/icons.svg#icon-list"},[]]]],["span",{},["大纲"]]]],
        "\n        "
      ]],
      "\n        ",
      ["section",{"class":"sidebar-panel active","id":"sidebar-docs-panel"},["\n          ",["div",{"class":"document-list","id":"document-list"},[]],"\n        "]],
      "\n        ",
      ["section",{"class":"sidebar-panel sidebar-files-panel","id":"sidebar-files-panel"},[
        "\n          ",
        ["div",{"class":"folder-tree-header"},[
          "\n            ",
          ["div",{"class":"folder-tree-root-summary"},[
            "\n              ",
            ["strong",{"id":"folder-file-tree-root"},["未关联文件夹"]],
            "\n              ",
            ["small",{"id":"folder-file-tree-summary"},[]],
            "\n            "
          ]],
          "\n            ",
          ["button",{"type":"button","id":"folder-file-tree-refresh","class":"folder-tree-refresh","title":"刷新文件树","aria-label":"刷新文件树"},[
            ["svg",{"class":"icon icon-sm"},[["use",{"href":"/assets/icons.svg#icon-redo"},[]]]]
          ]],
          "\n          "
        ]],
        "\n          ",
        ["div",{"class":"folder-file-tree","id":"folder-file-tree"},[]],
        "\n        "
      ]],
      "\n        ",
      ["section",{"class":"sidebar-panel","id":"sidebar-outline-panel"},["\n          ",["div",{"class":"outline-list","id":"outline-list"},[]],"\n        "]],
      "\n"
    ]],
    [slots.overlay,[
      ["div",{"class":"context-menu","id":"sidebar-context-menu","role":"menu"},[
        "\n    ",
        ["button",{"data-sidebar-action":"newDocument"},["新建文档"]],
        "\n    ",
        ["button",{"data-sidebar-action":"duplicateActiveDocument"},["复制当前文档"]],
        "\n    ",
        ["button",{"data-sidebar-action":"importFile"},["打开文件..."]],
        "\n    ",
        ["button",{"data-sidebar-action":"openWebClipper"},["从网页导入 Markdown..."]],
        "\n  "
      ]],
      ["div",{"class":"context-menu","id":"outline-context-menu","role":"menu"},[
        "\n    ",
        ["button",{"data-outline-context-action":"expand-all"},["展开全部大纲"]],
        "\n    ",
        ["button",{"data-outline-context-action":"collapse-all"},["折叠全部大纲"]],
        "\n    ",
        ["div",{"class":"context-separator","id":"outline-context-node-separator","hidden":true},[]],
        "\n    ",
        ["button",{"id":"outline-context-collapse-node","data-outline-context-action":"collapse-node","hidden":true},["折叠此大纲的所有子集"]],
        "\n  "
      ]]
    ]],
  ]);
}

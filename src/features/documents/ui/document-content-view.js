import { mountStaticContent } from '../../../ui/dom/index.js';

/** Own the documents feature markup; event policy and domain state stay in its existing controllers. */
export function createDocumentContentView(slots) {
  return mountStaticContent([
    [slots.overlay,[
      ["div",{"class":"context-menu","id":"document-context-menu","role":"menu"},[
        "\n    ",
        ["button",{"data-document-action":"openDocument"},["打开"]],
        "\n    ",
        ["button",{"data-document-action":"renameDocument"},["重命名..."]],
        "\n    ",
        ["button",{"data-document-action":"duplicateDocument"},["复制副本"]],
        "\n    ",
        ["button",{"data-document-action":"saveAsDocument"},["另存为..."]],
        "\n    ",
        ["button",{"data-document-action":"exportDocument"},["导出 Markdown"]],
        "\n    ",
        ["button",{"data-document-action":"copyDocumentTitle"},["复制文件名"]],
        "\n    ",
        ["div",{"class":"context-separator"},[]],
        "\n    ",
        ["button",{"data-document-action":"closeDocument"},["关闭文档"]],
        "\n  "
      ]],
      ["input",{"type":"text","id":"filename","value":"未命名文档.md","hidden":true,"class":"c-file-input"},[]]
    ]],
  ]);
}

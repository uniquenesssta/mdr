import { mountStaticContent } from '../../../ui/dom/index.js';

/** Own the documents feature markup; event policy and domain state stay in its existing controllers. */
export function createDocumentContentView(slots) {
  return mountStaticContent([
    [slots.overlay,[
      ["div",{"class":"context-menu document-context-menu","id":"document-context-menu","role":"menu"},[
        "\n    ",
        ["button",{"data-document-action":"openDocument"},[["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-menu-file"},[]]]],"打开"]],
        "\n    ",
        ["button",{"data-document-action":"renameDocument"},[["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-menu-edit"},[]]]],"重命名..."]],
        "\n    ",
        ["button",{"data-document-action":"duplicateDocument"},[["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-copy"},[]]]],"复制副本"]],
        "\n    ",
        ["div",{"class":"context-separator"},[]],
        ["button",{"data-document-action":"saveAsDocument"},[["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-save"},[]]]],"另存为..."]],
        "\n    ",
        ["button",{"data-document-action":"exportDocument"},[["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-download"},[]]]],"导出 Markdown"]],
        "\n    ",
        ["button",{"data-document-action":"copyDocumentTitle"},[["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-copy"},[]]]],"复制文件名"]],
        "\n    ",
        ["div",{"class":"context-separator"},[]],
        "\n    ",
        ["button",{"data-document-action":"closeDocument"},[["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-close"},[]]]],"关闭文档"]],
        "\n  "
      ]]
    ]],
  ]);
}

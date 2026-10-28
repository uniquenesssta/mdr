import { mountStaticContent } from '../../../ui/dom/index.js';

/** Own the import feature markup; event policy and domain state stay in its existing controllers. */
export function createImportContentView(slots) {
  return mountStaticContent([
    [slots.overlay,[
      ["div",{"class":"drop-overlay","id":"drop-overlay"},[
        "\n      ",
        ["div",{"class":"drop-message"},[
          ["svg",{"class":"icon icon-lg"},[["use",{"href":"/assets/icons.svg#icon-menu-file"},[]]]],
          " ",
          ["span",{"data-i18n":"dropMessage"},["释放以打开文件或插入图片"]]
        ]],
        "\n    "
      ]],
      ["input",{"type":"file","id":"importFile","accept":".md,.markdown,.txt","hidden":true,"class":"c-file-input"},[]]
    ]],
  ]);
}

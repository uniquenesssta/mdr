import { mountStaticContent } from '../../../ui/dom/index.js';

/** Own the preview feature markup; event policy and domain state stay in its existing controllers. */
export function createPreviewContentView(slots) {
  return mountStaticContent([
    [slots.preview,[
      "\n          ",
      ["div",{"class":"pane-header"},[
        "\n            ",
        ["button",{"class":"collapse-btn","id":"preview-collapse-btn","title":"收起预览区"},[
          ["svg",{"class":"icon icon-sm"},[["use",{"href":"/assets/icons.svg#icon-chevron-right"},[]]]]
        ]],
        "\n            ",
        ["span",{"class":"pane-title","data-i18n":"previewPaneTitle"},["实时预览"]],
        "\n            ",
        ["span",{"class":"preview-strategy-badge","id":"preview-strategy-badge","hidden":true},[]],
        "\n            ",
        ["span",{"class":"word-count","id":"word-count"},["0 字"]],
        "\n          "
      ]],
      "\n          ",
      ["div",{"class":"preview-content f-preview-surface","id":"preview"},[]],
      "\n"
    ]],
  ]);
}

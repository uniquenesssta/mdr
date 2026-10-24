import { mountStaticContent } from '../../../ui/dom/index.js';

/** Own the persistence feature markup; event policy and domain state stay in its existing controllers. */
export function createStatusContentView(slots) {
  return mountStaticContent([
    [slots.status,[
      "\n      ",
      ["div",{"class":"statusbar-left"},[
        "\n        ",
        ["div",{"class":"app-mode-badge statusbar-mode-badge","title":"本地优先，无需联网"},[
          "\n          ",
          ["span",{"class":"app-mode-dot","aria-hidden":"true"},[]],
          "\n          ",
          ["span",{},["本地编辑"]],
          "\n        "
        ]],
        "\n        ",
        ["span",{"id":"status-left","hidden":true,"aria-hidden":"true","class":"f-status-message"},[]],
        "\n      "
      ]],
      "\n      ",
      ["span",{"class":"save-hint","id":"save-hint"},["✓ 已保存"]],
      "\n      ",
      ["span",{"class":"statusbar-spacer"},[]],
      "\n      ",
      ["span",{"class":"statusbar-format"},["Markdown"]],
      "\n"
    ]],
    [slots.overlay,[
      ["div",{"class":"toast","id":"toast"},[]]
    ]],
  ]);
}

import { mountStaticContent } from '../../../ui/dom/index.js';

/** Own the editor feature markup; event policy and domain state stay in its existing controllers. */
export function createEditorContentView(slots) {
  return mountStaticContent([
    [slots.editor,[
      "\n          ",
      ["div",{"class":"pane-header"},[
        "\n            ",
        ["span",{"class":"pane-title","data-i18n":"editorPaneTitle"},["编辑"]],
        "\n            ",
        ["span",{"class":"editor-presentation-badge","id":"editor-presentation-badge","hidden":true,"data-i18n":"viewHybrid"},["单视图混合编辑"]],
        "\n            ",
        ["span",{"data-i18n":"editorPaneHint"},["支持 Markdown 语法"]],
        "\n            ",
        ["button",{"class":"collapse-btn","id":"editor-collapse-btn","data-editor-pane-action":"collapse","title":"收起编辑区"},[
          ["svg",{"class":"icon icon-sm"},[["use",{"href":"/assets/icons.svg#icon-chevron-left"},[]]]]
        ]],
        "\n          "
      ]],
      "\n          ",
      ["div",{"id":"editor","class":"virtual-editor-host f-editor-surface","data-i18n-placeholder":"editorPlaceholder","data-placeholder":"开始输入 Markdown..."},[]],
      "\n"
    ]],
    [slots.overlay,[
      ["div",{"class":"modal-overlay link-modal","id":"link-modal"},[
        "\n    ",
        ["div",{"class":"modal c-modal c-modal--narrow","role":"dialog","aria-modal":"true","aria-labelledby":"link-modal-title"},[
          "\n      ",
          ["div",{"class":"modal-header"},[
            "\n        ",
            ["h3",{"id":"link-modal-title"},[
              ["svg",{"class":"icon icon-lg"},[["use",{"href":"/assets/icons.svg#icon-link"},[]]]],
              " ",
              ["span",{"data-i18n":"link"},["链接"]]
            ]],
            "\n        ",
            ["button",{"data-link-action":"close","aria-label":"关闭"},[["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-close"},[]]]]]],
            "\n      "
          ]],
          "\n      ",
          ["div",{"class":"modal-body"},[
            "\n        ",
            ["label",{"for":"link-url-input","data-i18n":"promptLinkUrl"},["请输入链接地址"]],
            "\n        ",
            ["input",{"type":"url","id":"link-url-input","autocomplete":"url","spellcheck":"false","placeholder":"https://"},[]],
            "\n      "
          ]],
          "\n      ",
          ["div",{"class":"modal-footer"},[
            "\n        ",
            ["button",{"data-link-action":"close","data-i18n":"cancel"},["取消"]],
            "\n        ",
            ["button",{"data-link-action":"confirm","class":"primary","data-i18n":"insert"},["插入"]],
            "\n      "
          ]],
          "\n    "
        ]],
        "\n  "
      ]],
      ["div",{"class":"modal-overlay","id":"find-modal"},[
        "\n    ",
        ["div",{"class":"modal c-modal c-modal--narrow"},[
          "\n      ",
          ["div",{"class":"modal-header"},[
            "\n        ",
            ["h3",{},[["svg",{"class":"icon icon-lg"},[["use",{"href":"/assets/icons.svg#icon-search"},[]]]]," ",["span",{"data-i18n":"findTitle"},["查找与替换"]]]],
            "\n        ",
            ["button",{"data-find-action":"close"},[["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-close"},[]]]]]],
            "\n      "
          ]],
          "\n      ",
          ["div",{"class":"modal-body"},[
            "\n        ",
            ["label",{"for":"find-input","data-i18n":"findLabel"},["查找"]],
            "\n        ",
            ["input",{"type":"text","id":"find-input","data-i18n-placeholder":"findPlaceholder","placeholder":"要查找的内容"},[]],
            "\n        ",
            ["label",{"for":"replace-input","data-i18n":"replaceLabel"},["替换为"]],
            "\n        ",
            ["input",{"type":"text","id":"replace-input","data-i18n-placeholder":"replacePlaceholder","placeholder":"替换后的内容"},[]],
            "\n        ",
            ["div",{"id":"find-status","class":"c-form-status"},[]],
            "\n      "
          ]],
          "\n      ",
          ["div",{"class":"modal-footer"},[
            "\n        ",
            ["button",{"data-find-action":"close","data-i18n":"cancel"},["关闭"]],
            "\n        ",
            ["button",{"data-find-action":"replace-all","data-i18n":"replaceAll"},["全部替换"]],
            "\n        ",
            ["button",{"data-find-action":"replace-one","data-i18n":"replaceOne"},["替换"]],
            "\n        ",
            ["button",{"data-find-action":"next","class":"primary","data-i18n":"findNext"},["查找下一个"]],
            "\n      "
          ]],
          "\n    "
        ]],
        "\n  "
      ]],
      ["div",{"class":"modal-overlay image-modal","id":"image-modal"},[
        "\n    ",
        ["div",{"class":"modal c-modal c-modal--medium"},[
          "\n      ",
          ["div",{"class":"modal-header"},[
            "\n        ",
            ["h3",{},[["svg",{"class":"icon icon-lg"},[["use",{"href":"/assets/icons.svg#icon-image"},[]]]]," ",["span",{"data-i18n":"imageTitle"},["插入图片"]]]],
            "\n        ",
            ["button",{"data-image-action":"close"},[["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-close"},[]]]]]],
            "\n      "
          ]],
          "\n      ",
          ["div",{"class":"modal-body"},[
            "\n        ",
            ["div",{"class":"image-modal-tabs"},[
              "\n          ",
              ["button",{"type":"button","class":"image-tab active","data-tab":"url","data-image-tab":"url","data-i18n":"imageTabUrl"},["链接"]],
              "\n          ",
              ["button",{"type":"button","class":"image-tab","data-tab":"upload","data-image-tab":"upload","data-i18n":"imageTabUpload"},["本地上传"]],
              "\n        "
            ]],
            "\n        ",
            ["div",{"class":"image-tab-panel active","id":"image-tab-url"},[
              "\n          ",
              ["label",{"for":"image-url-input","data-i18n":"imageUrlLabel"},["图片链接"]],
              "\n          ",
              ["input",{"type":"url","id":"image-url-input","data-i18n-placeholder":"imageUrlPlaceholder","placeholder":"https://example.com/image.png"},[]],
              "\n          ",
              ["label",{"for":"image-url-alt","data-i18n":"imageAltLabel"},["描述文字"]],
              "\n          ",
              ["input",{"type":"text","id":"image-url-alt","data-i18n-placeholder":"imageAltPlaceholder","placeholder":"图片描述"},[]],
              "\n        "
            ]],
            "\n        ",
            ["div",{"class":"image-tab-panel","id":"image-tab-upload"},[
              "\n          ",
              ["div",{"class":"upload-area","id":"image-upload-area"},[
                "\n            ",
                ["p",{"data-i18n":"uploadArea"},["点击选择或拖拽图片到此处"]],
                "\n            ",
                ["input",{"type":"file","id":"image-file-input","accept":"image/*"},[]],
                "\n          "
              ]],
              "\n          ",
              ["div",{"id":"image-upload-preview","class":"upload-preview"},[]],
              "\n          ",
              ["label",{"for":"image-upload-alt","data-i18n":"imageAltLabel"},["描述文字"]],
              "\n          ",
              ["input",{"type":"text","id":"image-upload-alt","data-i18n-placeholder":"imageAltPlaceholder","placeholder":"图片描述"},[]],
              "\n        "
            ]],
            "\n        ",
            ["p",{"class":"hint","data-i18n":"imageHint"},["本地图片将以 Base64 嵌入文档，文件过大可能影响性能和保存。"]],
            "\n      "
          ]],
          "\n      ",
          ["div",{"class":"modal-footer"},[
            "\n        ",
            ["button",{"data-image-action":"close","data-i18n":"cancel"},["取消"]],
            "\n        ",
            ["button",{"data-image-action":"confirm","class":"primary","data-i18n":"insert"},["插入"]],
            "\n      "
          ]],
          "\n    "
        ]],
        "\n  "
      ]],
      ["div",{"class":"modal-overlay mermaid-modal","id":"mermaid-modal"},[
        "\n    ",
        ["div",{"class":"modal c-modal c-modal--wide"},[
          "\n      ",
          ["div",{"class":"modal-header"},[
            "\n        ",
            ["h3",{},[["svg",{"class":"icon icon-lg"},[["use",{"href":"/assets/icons.svg#icon-mermaid"},[]]]]," ",["span",{"data-i18n":"mermaidTitle"},["插入 Mermaid 图表"]]]],
            "\n        ",
            ["button",{"data-mermaid-action":"close"},[["svg",{"class":"icon"},[["use",{"href":"/assets/icons.svg#icon-close"},[]]]]]],
            "\n      "
          ]],
          "\n      ",
          ["div",{"class":"modal-body"},[
            "\n        ",
            ["label",{"for":"mermaid-type","data-i18n":"mermaidTypeLabel"},["图表类型"]],
            "\n        ",
            ["select",{"id":"mermaid-type"},[
              "\n          ",
              ["option",{"value":"mindmap","data-i18n":"mermaidTypeMindmap"},["思维导图"]],
              "\n          ",
              ["option",{"value":"flowchart","data-i18n":"mermaidTypeFlowchart"},["流程图"]],
              "\n        "
            ]],
            "\n        ",
            ["label",{"for":"mermaid-code","data-i18n":"mermaidCodeLabel"},["Mermaid 源码"]],
            "\n        ",
            ["textarea",{"class":"mermaid-code","id":"mermaid-code","rows":"10","data-i18n-placeholder":"mermaidCodePlaceholder","placeholder":"mindmap\\n  root((主题))\\n    子主题 A\\n    子主题 B"},[

            ]],
            "\n        ",
            ["p",{"class":"hint","data-i18n":"mermaidHint"},["支持 Mermaid 语法，插入后将在预览区自动渲染。"]],
            "\n      "
          ]],
          "\n      ",
          ["div",{"class":"modal-footer"},[
            "\n        ",
            ["button",{"data-mermaid-action":"close","data-i18n":"cancel"},["取消"]],
            "\n        ",
            ["button",{"data-mermaid-action":"confirm","class":"primary","data-i18n":"insert"},["插入"]],
            "\n      "
          ]],
          "\n    "
        ]],
        "\n  "
      ]]
    ]],
  ]);
}

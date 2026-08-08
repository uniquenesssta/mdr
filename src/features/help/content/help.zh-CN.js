/**
 * Responsibility: Immutable long-form Help content and Help-specific labels for zh-CN.
 * Imports: None; short-text i18n dictionaries and runtime services are forbidden here.
 * Exports: One frozen locale content record.
 * State/side effects: None. Lifecycle: import-only data module.
 */
const titles = Object.freeze({
  "start": "快速开始",
  "views": "视图与导航",
  "files": "文件与导出",
  "shortcuts": "快捷键",
  "markdown": "Markdown 功能",
  "about": "关于"
});
const summaries = Object.freeze({
  "start": "写作与基本操作",
  "views": "布局、侧栏和定位",
  "files": "打开、保存和导出",
  "shortcuts": "应用级常用操作",
  "markdown": "图片、公式与图表",
  "about": "应用信息"
});

const content = Object.freeze({
  "locale": "zh-CN",
  "sourceHtml": "<p>这是一个即开即用的本地 Markdown 编辑器：左侧写作，右侧实时预览。侧栏文档只保留在当前运行会话中；重新打开应用时会从新的空白文档开始，外部文件可从“最近打开”再次访问。</p>\n<p><b>开始写作</b></p>\n<ul>\n  <li>在左侧输入 Markdown，右侧会同步渲染。</li>\n  <li>使用工具栏按钮快速插入标题、加粗、列表、引用、代码、链接、图片、表格等。</li>\n  <li>选中文字再点格式按钮，可自动包裹或替换选区。</li>\n</ul>\n<p><b>调整视图</b></p>\n<ul>\n  <li>拖动中间分隔线调整左右宽度；点击标题栏的折叠按钮收起或展开区域。</li>\n  <li>工具栏「视图」可切换“编辑 + 预览 / 仅编辑 / 仅预览”。</li>\n  </ul>\n<p><b>保存、导入与导出</b></p>\n<ul>\n  <li>按 <code>Ctrl+S</code> 或点「保存」按钮；编辑器会按设置的间隔自动保存。</li>\n  <li>点「导入」导入本地 .md / .txt，或直接把文件拖进窗口。</li>\n  <li>点「导出」导出 Markdown、HTML、Word、PDF（打印另存为）或图片。</li>\n</ul>\n<p><b>图片与公式</b></p>\n<ul>\n  <li>工具栏「图片」支持链接插入或本地上传；本地图片会转为 Base64 嵌入文档，方便离线使用。</li>\n  <li>支持 <code>$...$</code> 行内公式和 <code>$$...$$</code> 块级公式。</li>\n</ul>\n<p><b>网页转 Markdown</b></p>\n<ul>\n  <li>在「导入」菜单中选择「从网页导入 Markdown」，输入网页链接后可自动提取正文。</li>\n</ul>\n<p><b>常用快捷键</b>：<code>Ctrl+S</code> 保存，<code>Ctrl+Z</code> 撤销，<code>Ctrl+Y / Ctrl+Shift+Z</code> 重做，<code>Ctrl+B</code> 加粗，<code>Ctrl+I</code> 斜体，<code>Ctrl+U</code> 下划线，<code>Ctrl+K</code> 链接，<code>Ctrl+Shift+K</code> 图片，<code>Ctrl+F</code> 查找，<code>Ctrl+H</code> 替换，<code>Tab</code> 插入 4 空格缩进。</p>",
  "dialogSummary": "按主题查看操作说明与常用快捷键",
  "closeLabel": "关闭帮助",
  "navigationLabel": "帮助分类",
  "aboutHtml": "<div class=\"about-app-card\"><span class=\"about-app-mark\" aria-hidden=\"true\">M</span><div><b>Markdown Editor</b><small>1.0.0</small></div></div><p>本地轻量 Markdown 编辑器，采用 Tauri、Rust 和原生前端技术构建，支持离线编辑、实时预览与超大文档虚拟化。</p>",
  "titles": titles,
  "summaries": summaries
});

export default content;

/**
 * Responsibility: Immutable long-form Help content and Help-specific labels for zh-TW.
 * Imports: None; short-text i18n dictionaries and runtime services are forbidden here.
 * Exports: One frozen locale content record.
 * State/side effects: None. Lifecycle: import-only data module.
 */
const titles = Object.freeze({
  "start": "快速開始",
  "views": "檢視與導覽",
  "files": "檔案與匯出",
  "shortcuts": "快捷鍵",
  "markdown": "Markdown 功能",
  "about": "關於"
});
const summaries = Object.freeze({
  "start": "寫作與基本操作",
  "views": "版面、側欄與定位",
  "files": "開啟、儲存與匯出",
  "shortcuts": "常用應用操作",
  "markdown": "圖片、公式與圖表",
  "about": "應用程式資訊"
});

const content = Object.freeze({
  "locale": "zh-TW",
  "sourceHtml": "<p>這是一款即開即用的瀏覽器 Markdown 編輯器：左側寫作，右側即時預覽。內容會自動儲存在瀏覽器本地，下次開啟自動恢復。</p>\n<p><b>開始寫作</b></p>\n<ul>\n  <li>在左側輸入 Markdown，右側同步渲染。</li>\n  <li>使用工具列按鈕快速插入標題、粗體、清單、引用、程式碼、連結、圖片、表格等。</li>\n  <li>選取文字後再點格式按鈕，可自動包裹或取代選區。</li>\n</ul>\n<p><b>調整檢視</b></p>\n<ul>\n  <li>拖曳中間分隔線調整左右寬度；點擊標題列的折疊按鈕收起或展開區域。</li>\n  <li>工具列「檢視」可切換「編輯 + 預覽 / 僅編輯 / 僅預覽」。</li>\n  <li>右側頂部的「原始碼」標籤可直接修改原始碼，切回「預覽」看效果。</li>\n</ul>\n<p><b>儲存、匯入與匯出</b></p>\n<ul>\n  <li>按 <code>Ctrl+S</code> 或點「儲存」按鈕；編輯器會依設定的間隔自動儲存。</li>\n  <li>點「匯入」匯入本地 .md / .txt，或直接把檔案拖進視窗。</li>\n  <li>點「匯出」匯出 Markdown、HTML、Word、PDF（列印另存為 PDF）或圖片。</li>\n</ul>\n<p><b>圖片與公式</b></p>\n<ul>\n  <li>工具列「圖片」支援連結插入或本機上傳；本機圖片會轉為 Base64 嵌入文件，方便離線使用。</li>\n  <li>支援 <code>$...$</code> 行內公式和 <code>$$...$$</code> 區塊公式。</li>\n</ul>\n<p><b>網頁轉 Markdown</b></p>\n<ul>\n  <li>點「網頁轉 MD」輸入網頁連結，可自動提取正文。</li>\n</ul>\n<p><b>常用快捷鍵</b>：<code>Ctrl+S</code> 儲存，<code>Ctrl+Z</code> 復原，<code>Ctrl+Y / Ctrl+Shift+Z</code> 重做，<code>Ctrl+B</code> 粗體，<code>Ctrl+I</code> 斜體，<code>Ctrl+U</code> 底線，<code>Ctrl+K</code> 連結，<code>Ctrl+Shift+K</code> 圖片，<code>Ctrl+F</code> 尋找，<code>Ctrl+H</code> 取代，<code>Tab</code> 插入 4 空格縮排。</p>",
  "dialogSummary": "依主題查看操作說明與常用快捷鍵",
  "closeLabel": "關閉說明",
  "navigationLabel": "說明分類",
  "aboutHtml": "<div class=\"about-app-card\"><span class=\"about-app-mark\" aria-hidden=\"true\">M</span><div><b>Markdown Editor</b><small>1.0.0</small></div></div><p>本機輕量 Markdown 編輯器，以 Tauri、Rust 與原生前端技術建構，支援離線編輯、即時預覽與大型文件虛擬化。</p>",
  "titles": titles,
  "summaries": summaries
});

export default content;

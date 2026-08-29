/**
 * Responsibility: Immutable long-form Help content and Help-specific labels for en.
 * Imports: None; short-text i18n dictionaries and runtime services are forbidden here.
 * Exports: One frozen locale content record.
 * State/side effects: None. Lifecycle: import-only data module.
 */
const titles = Object.freeze({
  "start": "Quick start",
  "views": "Views & navigation",
  "files": "Files & export",
  "shortcuts": "Shortcuts",
  "markdown": "Markdown features",
  "about": "About"
});
const summaries = Object.freeze({
  "start": "Writing and basic actions",
  "views": "Layout, panes and navigation",
  "files": "Open, save and export",
  "shortcuts": "Common application actions",
  "markdown": "Images, math and diagrams",
  "about": "Application information"
});

const content = Object.freeze({
  "locale": "en",
  "sourceHtml": "<p>This is a ready-to-use browser Markdown editor: write on the left, preview live on the right. Your content is auto-saved in the browser and restored next time.</p>\n<p><b>Start writing</b></p>\n<ul>\n  <li>Type Markdown on the left; it renders on the right in real time.</li>\n  <li>Use the toolbar to quickly insert headings, bold, lists, quotes, code, links, images, tables, etc.</li>\n  <li>Select text before clicking a format button to wrap or replace the selection.</li>\n</ul>\n<p><b>Adjust the view</b></p>\n<ul>\n  <li>Drag the divider to resize panes; click the collapse buttons on the headers to collapse or expand a pane.</li>\n  <li>The toolbar “View” menu switches between Edit + Preview / Edit only / Preview only.</li>\n  <li>The “Source” tab on the right lets you edit Markdown source directly; switch back to “Preview” to see the result.</li>\n</ul>\n<p><b>Save, import & export</b></p>\n<ul>\n  <li>Press <code>Ctrl+S</code> or click the Save button; auto-save uses the interval configured in Settings.</li>\n  <li>Click Import to open a local .md / .txt file, or drag a file into the window.</li>\n  <li>Click Export to Markdown, HTML, Word, PDF (print to PDF), or image.</li>\n</ul>\n<p><b>Images & math</b></p>\n<ul>\n  <li>The toolbar “Image” button supports URL insertion or local upload; local images are embedded as Base64 for offline use.</li>\n  <li>Supports inline <code>$...$</code> and block <code>$$...$$</code> LaTeX math.</li>\n</ul>\n<p><b>Web to Markdown</b></p>\n<ul>\n  <li>Click “Web → MD” and enter a URL to extract the article body.</li>\n</ul>\n<p><b>Common shortcuts</b>: <code>Ctrl+S</code> Save, <code>Ctrl+Z</code> Undo, <code>Ctrl+Y / Ctrl+Shift+Z</code> Redo, <code>Ctrl+B</code> Bold, <code>Ctrl+I</code> Italic, <code>Ctrl+U</code> Underline, <code>Ctrl+K</code> Link, <code>Ctrl+Shift+K</code> Image, <code>Ctrl+F</code> Find, <code>Ctrl+H</code> Replace, <code>Tab</code> insert 4-space indent.</p>",
  "dialogSummary": "Browse help topics and common shortcuts",
  "closeLabel": "Close help",
  "navigationLabel": "Help categories",
  "aboutHtml": "<div class=\"about-app-card\"><span class=\"about-app-mark\" aria-hidden=\"true\">M</span><div><b>Markdown Editor</b><small>1.0.0</small></div></div><p>A lightweight local Markdown editor built with Tauri, Rust, and native front-end technologies, with offline editing, live preview, and large-document virtualization.</p>",
  "titles": titles,
  "summaries": summaries
});

export default content;

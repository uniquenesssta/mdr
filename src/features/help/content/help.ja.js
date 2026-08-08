/**
 * Responsibility: Immutable long-form Help content and Help-specific labels for ja.
 * Imports: None; short-text i18n dictionaries and runtime services are forbidden here.
 * Exports: One frozen locale content record.
 * State/side effects: None. Lifecycle: import-only data module.
 */
const titles = Object.freeze({
  "start": "クイックスタート",
  "views": "表示とナビゲーション",
  "files": "ファイルとエクスポート",
  "shortcuts": "ショートカット",
  "markdown": "Markdown 機能",
  "about": "このアプリについて"
});
const summaries = Object.freeze({
  "start": "執筆と基本操作",
  "views": "レイアウト、サイドバー、移動",
  "files": "開く、保存、書き出し",
  "shortcuts": "よく使う操作",
  "markdown": "画像、数式、図表",
  "about": "アプリ情報"
});

const content = Object.freeze({
  "locale": "ja",
  "sourceHtml": "<p>これは、すぐに使えるブラウザ Markdown エディタです。左側で書くと、右側にリアルタイムでプレビューが表示されます。内容はブラウザのローカルに自動保存され、次回開いたときに復元されます。</p>\n<p><b>書き始める</b></p>\n<ul>\n  <li>左側に Markdown を入力すると、右側に即時レンダリングされます。</li>\n  <li>ツールバーのボタンで、見出し、太字、リスト、引用、コード、リンク、画像、表などを素早く挿入できます。</li>\n  <li>文字を選択してから書式ボタンをクリックすると、選択範囲を自動で囲んだり置換したりできます。</li>\n</ul>\n<p><b>表示を調整する</b></p>\n<ul>\n  <li>中央の区切り線をドラッグして左右の幅を調整；ヘッダーの「⟨」/「⟩」でエリアを折りたたみ/展開。</li>\n  <li>ツールバーの「表示」で「編集 + プレビュー / 編集のみ / プレビューのみ」を切り替え。</li>\n  <li>右側上部の「ソース」タブで Markdown ソースを直接編集し、「プレビュー」に戻して確認。</li>\n</ul>\n<p><b>保存、インポート、エクスポート</b></p>\n<ul>\n  <li><code>Ctrl+S</code> または 💾 保存をクリック；自動保存は設定した間隔で実行されます。</li>\n  <li>⬆ インポートでローカルの .md / .txt を開くか、ファイルをウィンドウにドラッグ。</li>\n  <li>⬇ エクスポートで Markdown、HTML、Word、PDF（PDF として保存）、画像を出力。</li>\n</ul>\n<p><b>画像と数式</b></p>\n<ul>\n  <li>ツールバーの「画像」は URL 挿入とローカルアップロードに対応；ローカル画像は Base64 で埋め込まれ、オフラインでも使えます。</li>\n  <li><code>$...$</code> のインライン数式と <code>$$...$$</code> のブロック数式に対応。</li>\n</ul>\n<p><b>Web を Markdown に</b></p>\n<ul>\n  <li>🌐 をクリックして Web ページのリンクを入力すると、本文を自動抽出します。</li>\n</ul>\n<p><b>よく使うショートカット</b>：<code>Ctrl+S</code> 保存、<code>Ctrl+Z</code> 元に戻す、<code>Ctrl+Y / Ctrl+Shift+Z</code> やり直す、<code>Ctrl+B</code> 太字、<code>Ctrl+I</code> 斜体、<code>Ctrl+U</code> 下線、<code>Ctrl+K</code> リンク、<code>Ctrl+Shift+K</code> 画像、<code>Ctrl+F</code> 検索、<code>Ctrl+H</code> 置換、<code>Tab</code> 4 スペース字下げ。</p>",
  "dialogSummary": "トピック別の操作説明と主なショートカット",
  "closeLabel": "ヘルプを閉じる",
  "navigationLabel": "ヘルプカテゴリ",
  "aboutHtml": "<div class=\"about-app-card\"><span class=\"about-app-mark\" aria-hidden=\"true\">M</span><div><b>Markdown Editor</b><small>1.0.0</small></div></div><p>Tauri、Rust、ネイティブなフロントエンド技術で構築された軽量ローカル Markdown エディタです。オフライン編集、リアルタイムプレビュー、大規模文書の仮想化に対応します。</p>",
  "titles": titles,
  "summaries": summaries
});

export default content;

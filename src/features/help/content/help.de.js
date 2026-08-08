/**
 * Responsibility: Immutable long-form Help content and Help-specific labels for de.
 * Imports: None; short-text i18n dictionaries and runtime services are forbidden here.
 * Exports: One frozen locale content record.
 * State/side effects: None. Lifecycle: import-only data module.
 */
const titles = Object.freeze({
  "start": "Schnellstart",
  "views": "Ansicht & Navigation",
  "files": "Dateien & Export",
  "shortcuts": "Tastenkürzel",
  "markdown": "Markdown-Funktionen",
  "about": "Über"
});
const summaries = Object.freeze({
  "start": "Schreiben und Grundfunktionen",
  "views": "Layout, Bereiche und Navigation",
  "files": "Öffnen, Speichern und Exportieren",
  "shortcuts": "Häufige Aktionen",
  "markdown": "Bilder, Formeln und Diagramme",
  "about": "Anwendungsinformationen"
});

const content = Object.freeze({
  "locale": "de",
  "sourceHtml": "<p>Dies ist ein sofort einsatzbereiter Markdown-Editor im Browser: links schreiben, rechts live in der Vorschau ansehen. Der Inhalt wird automatisch im Browser lokal gespeichert und beim nächsten Öffnen wiederhergestellt.</p>\n<p><b>Schreiben beginnen</b></p>\n<ul>\n  <li>Gib links Markdown ein; rechts wird es in Echtzeit gerendert.</li>\n  <li>Verwende die Toolbar-Buttons, um schnell Überschriften, Fett, Listen, Zitate, Code, Links, Bilder, Tabellen usw. einzufügen.</li>\n  <li>Markiere Text vor dem Klick auf einen Format-Button, um die Auswahl einzufassen oder zu ersetzen.</li>\n</ul>\n<p><b>Ansicht anpassen</b></p>\n<ul>\n  <li>Ziehe den Trennbalken, um die Bereiche zu skalieren; klicke auf die „⟨“ / „⟩“ Buttons in den Kopfzeilen, um einen Bereich ein- oder auszuklappen.</li>\n  <li>Das Menü „Ansicht“ in der Toolbar schaltet zwischen Bearbeiten + Vorschau / Nur bearbeiten / Nur Vorschau um.</li>\n  <li>Der Reiter „Quelle“ rechts ermöglicht die direkte Bearbeitung des Markdown; zurück zu „Vorschau“, um das Ergebnis zu sehen.</li>\n</ul>\n<p><b>Speichern, importieren und exportieren</b></p>\n<ul>\n  <li>Drücke <code>Ctrl+S</code> oder klicke auf 💾 Speichern; das automatische Speichern verwendet das konfigurierte Intervall.</li>\n  <li>Klicke auf ⬆ Importieren, um eine lokale .md / .txt Datei zu öffnen, oder ziehe eine Datei ins Fenster.</li>\n  <li>Klicke auf ⬇ Exportieren nach Markdown, HTML, Word, PDF (als PDF speichern) oder Bild.</li>\n</ul>\n<p><b>Bilder und Mathe</b></p>\n<ul>\n  <li>Der „Bild“-Button unterstützt URL-Einfügung oder lokales Hochladen; lokale Bilder werden als Base64 eingebettet, um offline nutzbar zu sein.</li>\n  <li>Unterstützt LaTeX-Mathe inline <code>$...$</code> und als Block <code>$$...$$</code>.</li>\n</ul>\n<p><b>Web zu Markdown</b></p>\n<ul>\n  <li>Klicke auf 🌐 und gib eine URL ein, um den Artikeltext zu extrahieren.</li>\n</ul>\n<p><b>Häufige Tastenkürzel</b>: <code>Ctrl+S</code> Speichern, <code>Ctrl+Z</code> Rückgängig, <code>Ctrl+Y / Ctrl+Shift+Z</code> Wiederherstellen, <code>Ctrl+B</code> Fett, <code>Ctrl+I</code> Kursiv, <code>Ctrl+U</code> Unterstrichen, <code>Ctrl+K</code> Link, <code>Ctrl+Shift+K</code> Bild, <code>Ctrl+F</code> Suchen, <code>Ctrl+H</code> Ersetzen, <code>Tab</code> 4 Leerzeichen Einzug einfügen.</p>",
  "dialogSummary": "Hilfethemen und häufige Tastenkürzel",
  "closeLabel": "Hilfe schließen",
  "navigationLabel": "Hilfekategorien",
  "aboutHtml": "<div class=\"about-app-card\"><span class=\"about-app-mark\" aria-hidden=\"true\">M</span><div><b>Markdown Editor</b><small>1.0.0</small></div></div><p>Leichtgewichtiger lokaler Markdown-Editor auf Basis von Tauri, Rust und nativen Front-End-Technologien mit Offline-Bearbeitung, Live-Vorschau und Virtualisierung großer Dokumente.</p>",
  "titles": titles,
  "summaries": summaries
});

export default content;

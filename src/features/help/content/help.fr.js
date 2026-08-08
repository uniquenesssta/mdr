/**
 * Responsibility: Immutable long-form Help content and Help-specific labels for fr.
 * Imports: None; short-text i18n dictionaries and runtime services are forbidden here.
 * Exports: One frozen locale content record.
 * State/side effects: None. Lifecycle: import-only data module.
 */
const titles = Object.freeze({
  "start": "Démarrage rapide",
  "views": "Affichage et navigation",
  "files": "Fichiers et exportation",
  "shortcuts": "Raccourcis",
  "markdown": "Fonctions Markdown",
  "about": "À propos"
});
const summaries = Object.freeze({
  "start": "Écriture et actions de base",
  "views": "Disposition, panneaux et navigation",
  "files": "Ouvrir, enregistrer et exporter",
  "shortcuts": "Actions courantes",
  "markdown": "Images, formules et diagrammes",
  "about": "Informations sur l’application"
});

const content = Object.freeze({
  "locale": "fr",
  "sourceHtml": "<p>Ceci est un éditeur Markdown prêt à l’emploi dans le navigateur : écrivez à gauche, prévisualisez en direct à droite. Le contenu est automatiquement sauvegardé dans le navigateur et restauré à la prochaine ouverture.</p>\n<p><b>Commencer à écrire</b></p>\n<ul>\n  <li>Saisissez du Markdown à gauche ; il est rendu en temps réel à droite.</li>\n  <li>Utilisez les boutons de la barre d’outils pour insérer rapidement titres, gras, listes, citations, code, liens, images, tableaux, etc.</li>\n  <li>Sélectionnez du texte avant de cliquer sur un bouton de mise en forme pour l’entourer ou le remplacer.</li>\n</ul>\n<p><b>Ajuster l’affichage</b></p>\n<ul>\n  <li>Faites glisser le séparateur pour redimensionner ; cliquez sur les boutons « ⟨ » / « ⟩ » pour réduire ou développer un volet.</li>\n  <li>Le menu « Affichage » de la barre permet de passer entre Édition + Aperçu / Édition seule / Aperçu seul.</li>\n  <li>L’onglet « Source » à droite permet d’éditer directement le Markdown ; revenez à « Aperçu » pour voir le résultat.</li>\n</ul>\n<p><b>Enregistrer, importer et exporter</b></p>\n<ul>\n  <li>Appuyez sur <code>Ctrl+S</code> ou cliquez sur 💾 Enregistrer ; la sauvegarde automatique utilise l’intervalle configuré.</li>\n  <li>Cliquez sur ⬆ Importer pour ouvrir un fichier .md / .txt local, ou glissez-déposez un fichier dans la fenêtre.</li>\n  <li>Cliquez sur ⬇ Exporter vers Markdown, HTML, Word, PDF (enregistrer en PDF) ou image.</li>\n</ul>\n<p><b>Images et mathématiques</b></p>\n<ul>\n  <li>Le bouton « Image » prend en charge l’insertion par URL ou le téléversement local ; les images locales sont intégrées en Base64 pour une utilisation hors ligne.</li>\n  <li>Prend en charge les mathématiques LaTeX en ligne <code>$...$</code> et en bloc <code>$$...$$</code>.</li>\n</ul>\n<p><b>Web vers Markdown</b></p>\n<ul>\n  <li>Cliquez sur 🌐 et saisissez une URL pour extraire le corps de l’article.</li>\n</ul>\n<p><b>Raccourcis courants</b> : <code>Ctrl+S</code> Enregistrer, <code>Ctrl+Z</code> Annuler, <code>Ctrl+Y / Ctrl+Shift+Z</code> Rétablir, <code>Ctrl+B</code> Gras, <code>Ctrl+I</code> Italique, <code>Ctrl+U</code> Souligné, <code>Ctrl+K</code> Lien, <code>Ctrl+Shift+K</code> Image, <code>Ctrl+F</code> Rechercher, <code>Ctrl+H</code> Remplacer, <code>Tab</code> insérer une indentation de 4 espaces.</p>",
  "dialogSummary": "Consultez les rubriques d’aide et les raccourcis courants",
  "closeLabel": "Fermer l’aide",
  "navigationLabel": "Catégories d’aide",
  "aboutHtml": "<div class=\"about-app-card\"><span class=\"about-app-mark\" aria-hidden=\"true\">M</span><div><b>Markdown Editor</b><small>1.0.0</small></div></div><p>Éditeur Markdown local léger construit avec Tauri, Rust et des technologies front-end natives, avec édition hors ligne, aperçu en direct et virtualisation des grands documents.</p>",
  "titles": titles,
  "summaries": summaries
});

export default content;

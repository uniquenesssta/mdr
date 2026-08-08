/**
 * Responsibility: Immutable long-form Help content and Help-specific labels for pt.
 * Imports: None; short-text i18n dictionaries and runtime services are forbidden here.
 * Exports: One frozen locale content record.
 * State/side effects: None. Lifecycle: import-only data module.
 */
const titles = Object.freeze({
  "start": "Início rápido",
  "views": "Visualização e navegação",
  "files": "Arquivos e exportação",
  "shortcuts": "Atalhos",
  "markdown": "Recursos Markdown",
  "about": "Sobre"
});
const summaries = Object.freeze({
  "start": "Escrita e ações básicas",
  "views": "Layout, painéis e navegação",
  "files": "Abrir, salvar e exportar",
  "shortcuts": "Ações frequentes",
  "markdown": "Imagens, matemática e diagramas",
  "about": "Informações do aplicativo"
});

const content = Object.freeze({
  "locale": "pt",
  "sourceHtml": "<p>Este é um editor Markdown pronto para uso no navegador: escreva à esquerda e visualize em tempo real à direita. O conteúdo é salvo automaticamente no navegador e restaurado na próxima vez.</p>\n<p><b>Começar a escrever</b></p>\n<ul>\n  <li>Digite Markdown à esquerda; ele será renderizado à direita em tempo real.</li>\n  <li>Use os botões da barra de ferramentas para inserir rapidamente títulos, negrito, listas, citações, código, links, imagens, tabelas etc.</li>\n  <li>Selecione o texto antes de clicar em um botão de formatação para envolver ou substituir a seleção.</li>\n</ul>\n<p><b>Ajustar a visualização</b></p>\n<ul>\n  <li>Arraste o divisor para redimensionar; clique nos botões “⟨” / “⟩” nos cabeçalhos para recolher ou expandir.</li>\n  <li>O menu “Visualização” da barra alterna entre Editar + Visualizar / Somente editar / Somente visualizar.</li>\n  <li>A aba “Fonte” à direita permite editar o Markdown diretamente; volte para “Pré-visualização” para ver o resultado.</li>\n</ul>\n<p><b>Salvar, importar e exportar</b></p>\n<ul>\n  <li>Pressione <code>Ctrl+S</code> ou clique em 💾 Salvar; o salvamento automático usa o intervalo configurado.</li>\n  <li>Clique em ⬆ Importar para abrir um arquivo .md / .txt local, ou arraste um arquivo para a janela.</li>\n  <li>Clique em ⬇ Exportar para Markdown, HTML, Word, PDF (salvar como PDF) ou imagem.</li>\n</ul>\n<p><b>Imagens e matemática</b></p>\n<ul>\n  <li>O botão “Imagem” suporta inserção por URL ou upload local; imagens locais são incorporadas como Base64 para uso offline.</li>\n  <li>Suporta matemática LaTeX inline <code>$...$</code> e em bloco <code>$$...$$</code>.</li>\n</ul>\n<p><b>Web para Markdown</b></p>\n<ul>\n  <li>Clique em 🌐 e insira uma URL para extrair o corpo do artigo.</li>\n</ul>\n<p><b>Atalhos comuns</b>: <code>Ctrl+S</code> Salvar, <code>Ctrl+Z</code> Desfazer, <code>Ctrl+Y / Ctrl+Shift+Z</code> Refazer, <code>Ctrl+B</code> Negrito, <code>Ctrl+I</code> Itálico, <code>Ctrl+U</code> Sublinhado, <code>Ctrl+K</code> Link, <code>Ctrl+Shift+K</code> Imagem, <code>Ctrl+F</code> Localizar, <code>Ctrl+H</code> Substituir, <code>Tab</code> inserir recuo de 4 espaços.</p>",
  "dialogSummary": "Consulte tópicos de ajuda e atalhos comuns",
  "closeLabel": "Fechar ajuda",
  "navigationLabel": "Categorias de ajuda",
  "aboutHtml": "<div class=\"about-app-card\"><span class=\"about-app-mark\" aria-hidden=\"true\">M</span><div><b>Markdown Editor</b><small>1.0.0</small></div></div><p>Editor Markdown local e leve construído com Tauri, Rust e tecnologias nativas de front-end, com edição offline, visualização em tempo real e virtualização de documentos grandes.</p>",
  "titles": titles,
  "summaries": summaries
});

export default content;

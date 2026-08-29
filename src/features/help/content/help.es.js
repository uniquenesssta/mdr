/**
 * Responsibility: Immutable long-form Help content and Help-specific labels for es.
 * Imports: None; short-text i18n dictionaries and runtime services are forbidden here.
 * Exports: One frozen locale content record.
 * State/side effects: None. Lifecycle: import-only data module.
 */
const titles = Object.freeze({
  "start": "Inicio rápido",
  "views": "Vistas y navegación",
  "files": "Archivos y exportación",
  "shortcuts": "Atajos",
  "markdown": "Funciones Markdown",
  "about": "Acerca de"
});
const summaries = Object.freeze({
  "start": "Escritura y operaciones básicas",
  "views": "Diseño, paneles y navegación",
  "files": "Abrir, guardar y exportar",
  "shortcuts": "Acciones habituales",
  "markdown": "Imágenes, matemáticas y diagramas",
  "about": "Información de la aplicación"
});

const content = Object.freeze({
  "locale": "es",
  "sourceHtml": "<p>Este es un editor Markdown listo para usar en el navegador: escribe a la izquierda y previsualiza en tiempo real a la derecha. El contenido se guarda automáticamente en el navegador y se restaura la próxima vez.</p>\n<p><b>Empezar a escribir</b></p>\n<ul>\n  <li>Escribe Markdown a la izquierda; se renderiza a la derecha en tiempo real.</li>\n  <li>Usa los botones de la barra de herramientas para insertar rápidamente títulos, negrita, listas, citas, código, enlaces, imágenes, tablas, etc.</li>\n  <li>Selecciona texto antes de pulsar un botón de formato para envolver o reemplazar la selección.</li>\n</ul>\n<p><b>Ajustar la vista</b></p>\n<ul>\n  <li>Arrastra la barra divisoria para cambiar el tamaño; pulsa los botones “⟨” / “⟩” en los encabezados para contraer o expandir.</li>\n  <li>El menú “Vista” de la barra cambia entre Editar + Previsualizar / Solo editar / Solo previsualizar.</li>\n  <li>La pestaña “Fuente” de la derecha permite editar el Markdown directamente; vuelve a “Vista previa” para ver el resultado.</li>\n</ul>\n<p><b>Guardar, importar y exportar</b></p>\n<ul>\n  <li>Pulsa <code>Ctrl+S</code> o haz clic en 💾 Guardar; el guardado automático usa el intervalo configurado.</li>\n  <li>Haz clic en ⬆ Importar para abrir un archivo .md / .txt local, o arrastra un archivo a la ventana.</li>\n  <li>Haz clic en ⬇ Exportar a Markdown, HTML, Word, PDF (imprimir como PDF) o imagen.</li>\n</ul>\n<p><b>Imágenes y matemáticas</b></p>\n<ul>\n  <li>El botón “Imagen” admite inserción por URL o subida local; las imágenes locales se incrustan como Base64 para uso sin conexión.</li>\n  <li>Admite matemáticas LaTeX en línea <code>$...$</code> y en bloque <code>$$...$$</code>.</li>\n</ul>\n<p><b>Web a Markdown</b></p>\n<ul>\n  <li>Haz clic en 🌐 e introduce una URL para extraer el cuerpo del artículo.</li>\n</ul>\n<p><b>Atajos comunes</b>: <code>Ctrl+S</code> Guardar, <code>Ctrl+Z</code> Deshacer, <code>Ctrl+Y / Ctrl+Shift+Z</code> Rehacer, <code>Ctrl+B</code> Negrita, <code>Ctrl+I</code> Cursiva, <code>Ctrl+U</code> Subrayado, <code>Ctrl+K</code> Enlace, <code>Ctrl+Shift+K</code> Imagen, <code>Ctrl+F</code> Buscar, <code>Ctrl+H</code> Reemplazar, <code>Tab</code> insertar sangría de 4 espacios.</p>",
  "dialogSummary": "Consulta temas de ayuda y atajos habituales",
  "closeLabel": "Cerrar ayuda",
  "navigationLabel": "Categorías de ayuda",
  "aboutHtml": "<div class=\"about-app-card\"><span class=\"about-app-mark\" aria-hidden=\"true\">M</span><div><b>Markdown Editor</b><small>1.0.0</small></div></div><p>Editor Markdown local y ligero construido con Tauri, Rust y tecnologías web nativas, con edición sin conexión, vista previa en tiempo real y virtualización para documentos grandes.</p>",
  "titles": titles,
  "summaries": summaries
});

export default content;

/**
 * Responsibility: Immutable long-form Help content and Help-specific labels for ru.
 * Imports: None; short-text i18n dictionaries and runtime services are forbidden here.
 * Exports: One frozen locale content record.
 * State/side effects: None. Lifecycle: import-only data module.
 */
const titles = Object.freeze({
  "start": "Быстрый старт",
  "views": "Вид и навигация",
  "files": "Файлы и экспорт",
  "shortcuts": "Горячие клавиши",
  "markdown": "Возможности Markdown",
  "about": "О программе"
});
const summaries = Object.freeze({
  "start": "Набор текста и основные действия",
  "views": "Макет, панели и навигация",
  "files": "Открытие, сохранение и экспорт",
  "shortcuts": "Частые действия",
  "markdown": "Изображения, формулы и диаграммы",
  "about": "Информация о приложении"
});

const content = Object.freeze({
  "locale": "ru",
  "sourceHtml": "<p>Это готовый к использованию редактор Markdown в браузере: пишите слева, а справа видите предпросмотр в реальном времени. Содержимое автоматически сохраняется локально в браузере и восстанавливается при следующем открытии.</p>\n<p><b>Начать писать</b></p>\n<ul>\n  <li>Введите Markdown слева; он отобразится справа в реальном времени.</li>\n  <li>Используйте кнопки панели инструментов для быстрой вставки заголовков, жирного текста, списков, цитат, кода, ссылок, изображений, таблиц и т. д.</li>\n  <li>Выделите текст перед нажатием кнопки форматирования, чтобы обернуть или заменить выделение.</li>\n</ul>\n<p><b>Настройка вида</b></p>\n<ul>\n  <li>Перетаскивайте разделитель для изменения размеров; нажимайте кнопки «⟨» / «⟩» в заголовках, чтобы свернуть или развернуть область.</li>\n  <li>Меню «Вид» на панели переключает между Редактирование + Предпросмотр / Только редактирование / Только предпросмотр.</li>\n  <li>Вкладка «Исходный код» справа позволяет редактировать Markdown напрямую; вернитесь на «Предпросмотр», чтобы увидеть результат.</li>\n</ul>\n<p><b>Сохранение, импорт и экспорт</b></p>\n<ul>\n  <li>Нажмите <code>Ctrl+S</code> или кликните 💾 Сохранить; автосохранение использует интервал из настроек.</li>\n  <li>Кликните ⬆ Импорт, чтобы открыть локальный файл .md / .txt, или перетащите файл в окно.</li>\n  <li>Кликните ⬇ Экспорт в Markdown, HTML, Word, PDF (сохранить как PDF) или изображение.</li>\n</ul>\n<p><b>Изображения и формулы</b></p>\n<ul>\n  <li>Кнопка «Изображение» поддерживает вставку по ссылке или локальную загрузку; локальные изображения встраиваются как Base64 для использования офлайн.</li>\n  <li>Поддерживаются встроенные <code>$...$</code> и блочные <code>$$...$$</code> LaTeX-формулы.</li>\n</ul>\n<p><b>Web в Markdown</b></p>\n<ul>\n  <li>Кликните 🌐 и введите URL, чтобы извлечь тело статьи.</li>\n</ul>\n<p><b>Частые горячие клавиши</b>: <code>Ctrl+S</code> Сохранить, <code>Ctrl+Z</code> Отменить, <code>Ctrl+Y / Ctrl+Shift+Z</code> Повторить, <code>Ctrl+B</code> Жирный, <code>Ctrl+I</code> Курсив, <code>Ctrl+U</code> Подчеркнутый, <code>Ctrl+K</code> Ссылка, <code>Ctrl+Shift+K</code> Изображение, <code>Ctrl+F</code> Найти, <code>Ctrl+H</code> Заменить, <code>Tab</code> вставить отступ в 4 пробела.</p>",
  "dialogSummary": "Справка по темам и основные сочетания клавиш",
  "closeLabel": "Закрыть справку",
  "navigationLabel": "Разделы справки",
  "aboutHtml": "<div class=\"about-app-card\"><span class=\"about-app-mark\" aria-hidden=\"true\">M</span><div><b>Markdown Editor</b><small>1.0.0</small></div></div><p>Лёгкий локальный Markdown-редактор на Tauri, Rust и нативных веб-технологиях с автономным редактированием, живым предпросмотром и виртуализацией больших документов.</p>",
  "titles": titles,
  "summaries": summaries
});

export default content;

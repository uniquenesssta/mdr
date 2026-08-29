/**
 * Responsibility: Validate and expose immutable localized long-form Help documents separately from short-text i18n keys.
 * Imports: Help content data modules and Help page IDs only.
 * Exports: createHelpContentRegistry() and the production helpContentRegistry.
 * State/side effects: Immutable module-local registry only; no DOM/storage/network access. Lifecycle: module-load data authority.
 */
import zhCN from './content/help.zh-CN.js';
import zhTW from './content/help.zh-TW.js';
import en from './content/help.en.js';
import ja from './content/help.ja.js';
import ko from './content/help.ko.js';
import es from './content/help.es.js';
import fr from './content/help.fr.js';
import de from './content/help.de.js';
import ru from './content/help.ru.js';
import pt from './content/help.pt.js';
import { HELP_PAGE_IDS } from './help-state.js';

const DEFAULT_LOCALE = 'zh-CN';
const SECTION_PATTERN = /<p><b>([^<]+)<\/b><\/p>\s*(<ul>[\s\S]*?<\/ul>)/g;
const INTRO_PATTERN = /^\s*(<p>[\s\S]*?<\/p>)/;
const SHORTCUT_PATTERN = /<p><b>([^<]+)<\/b>\s*[:：]\s*([\s\S]*?)<\/p>\s*$/;
const UNSAFE_CONTENT_PATTERN = /<script\b|\son[a-z]+\s*=|\b(?:javascript|vbscript):/i;

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string.`);
  return value;
}

function freezeTopic(title, bodyHtml) {
  return Object.freeze({
    title: String(title || '').trim(),
    bodyHtml: assertString(bodyHtml, 'Help topic body')
  });
}

function freezePage(id, title, summary, options = {}) {
  return Object.freeze({
    id,
    title: assertString(title, `Help page ${id} title`),
    summary: assertString(summary, `Help page ${id} summary`),
    introHtml: options.introHtml ? assertString(options.introHtml, `Help page ${id} intro`) : '',
    bodyHtml: options.bodyHtml ? assertString(options.bodyHtml, `Help page ${id} body`) : '',
    topics: Object.freeze([...(options.topics || [])])
  });
}

function parseContent(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('Help content entry must be an object.');
  const locale = assertString(entry.locale, 'Help locale');
  const sourceHtml = assertString(entry.sourceHtml, `Help ${locale} source HTML`);
  const aboutHtml = assertString(entry.aboutHtml, `Help ${locale} about HTML`);
  if (UNSAFE_CONTENT_PATTERN.test(sourceHtml) || UNSAFE_CONTENT_PATTERN.test(aboutHtml)) {
    throw new Error(`Help content for ${locale} contains executable markup.`);
  }
  const intro = sourceHtml.match(INTRO_PATTERN)?.[1] || '';
  const sections = [...sourceHtml.matchAll(SECTION_PATTERN)].map(match => Object.freeze({
    title: match[1].trim(),
    bodyHtml: match[2]
  }));
  const shortcuts = sourceHtml.match(SHORTCUT_PATTERN);
  if (!intro || sections.length !== 5 || !shortcuts) {
    throw new Error(`Help content for ${locale} does not match the preserved long-form structure.`);
  }

  const titles = entry.titles;
  const summaries = entry.summaries;
  if (!titles || !summaries) throw new TypeError(`Help content for ${locale} requires page labels.`);

  const pages = Object.freeze({
    start: freezePage('start', titles.start, summaries.start, {
      introHtml: intro,
      topics: [freezeTopic('', sections[0].bodyHtml)]
    }),
    views: freezePage('views', titles.views, summaries.views, {
      topics: [freezeTopic('', sections[1].bodyHtml)]
    }),
    files: freezePage('files', titles.files, summaries.files, {
      topics: [freezeTopic('', sections[2].bodyHtml)]
    }),
    shortcuts: freezePage('shortcuts', titles.shortcuts, summaries.shortcuts, {
      bodyHtml: `<p>${shortcuts[2]}</p>`
    }),
    markdown: freezePage('markdown', titles.markdown, summaries.markdown, {
      topics: [freezeTopic(sections[3].title, sections[3].bodyHtml), freezeTopic(sections[4].title, sections[4].bodyHtml)]
    }),
    about: freezePage('about', titles.about, summaries.about, { bodyHtml: aboutHtml })
  });

  for (const id of HELP_PAGE_IDS) {
    if (!pages[id]) throw new Error(`Help content for ${locale} is missing page ${id}.`);
  }

  return Object.freeze({
    locale,
    sourceHtml,
    dialogSummary: assertString(entry.dialogSummary, `Help ${locale} dialog summary`),
    closeLabel: assertString(entry.closeLabel, `Help ${locale} close label`),
    navigationLabel: assertString(entry.navigationLabel, `Help ${locale} navigation label`),
    pages
  });
}

export function createHelpContentRegistry(entries, { defaultLocale = DEFAULT_LOCALE } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError('Help content registry requires entries.');
  const documents = new Map();
  for (const entry of entries) {
    const document = parseContent(entry);
    if (documents.has(document.locale)) throw new Error(`Duplicate help locale: ${document.locale}.`);
    documents.set(document.locale, document);
  }
  if (!documents.has(defaultLocale)) throw new Error(`Default help locale is missing: ${defaultLocale}.`);
  const localeIds = Object.freeze([...documents.keys()]);
  return Object.freeze({
    defaultLocale,
    localeIds,
    has(locale) { return documents.has(String(locale || '')); },
    get(locale) { return documents.get(String(locale || '')) || documents.get(defaultLocale); }
  });
}

export const helpContentRegistry = createHelpContentRegistry([
  zhCN,
  zhTW,
  en,
  ja,
  ko,
  es,
  fr,
  de,
  ru,
  pt
]);

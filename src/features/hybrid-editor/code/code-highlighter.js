/**
 * Atomic 8.8 code syntax presentation model.
 * Allowed imports: none. Forbidden imports: CodeMirror, DOM, model-kernel and application globals.
 * API: highlightCode(), getNormalizedCodeLanguage(). State/side effects: none. Lifecycle: pure.
 */
const LANGUAGE_ALIASES = new Map([
  ['javascript', 'js'], ['jsx', 'js'], ['typescript', 'ts'], ['tsx', 'ts'],
  ['python', 'py'], ['shell', 'sh'], ['bash', 'sh'], ['zsh', 'sh'],
  ['html', 'html'], ['xml', 'html'], ['svg', 'html'], ['css', 'css'],
  ['json', 'json'], ['rust', 'rust'], ['rs', 'rust']
]);

const KEYWORDS = {
  js: new Set('as async await break case catch class const continue debugger default delete do else export extends finally for from function get if implements import in instanceof interface let new of package private protected public return set static super switch throw try typeof var void while with yield true false null undefined'.split(' ')),
  ts: new Set('abstract any as asserts async await bigint boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new null number object of override package private protected public readonly require return satisfies set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield'.split(' ')),
  py: new Set('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield'.split(' ')),
  sh: new Set('case do done elif else esac fi for function if in select then time until while'.split(' ')),
  json: new Set(['true', 'false', 'null']),
  rust: new Set('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'.split(' ')),
  css: new Set(['important']),
  html: new Set()
};

function normalizeLanguage(language) {
  const value = String(language || '').trim().toLowerCase().replace(/^language-/, '');
  return LANGUAGE_ALIASES.get(value) || value || 'text';
}

function isIdentifierStart(character) {
  return /[A-Za-z_$\u00a0-\uffff]/.test(character);
}

function isIdentifierPart(character) {
  return /[\w$\u00a0-\uffff]/.test(character);
}

function pushToken(tokens, className, text) {
  if (!text) return;
  const previous = tokens[tokens.length - 1];
  if (previous?.className === className) previous.text += text;
  else tokens.push({ className, text });
}

function tokenizeMarkup(line) {
  const tokens = [];
  let index = 0;
  const tagPattern = /<!--.*?-->|<\/?[A-Za-z][^>]*>/g;
  let match;
  while ((match = tagPattern.exec(line))) {
    pushToken(tokens, '', line.slice(index, match.index));
    const tag = match[0];
    if (tag.startsWith('<!--')) {
      pushToken(tokens, 'comment', tag);
    } else {
      const parts = tag.split(/(\s+|=|"[^"]*"|'[^']*')/).filter(Boolean);
      for (const part of parts) {
        if (/^<\/?|\/?\>$/.test(part)) pushToken(tokens, 'punctuation', part);
        else if (/^\s+$/.test(part)) pushToken(tokens, '', part);
        else if (part === '=') pushToken(tokens, 'operator', part);
        else if (/^["']/.test(part)) pushToken(tokens, 'string', part);
        else if (/^[A-Za-z][\w:-]*$/.test(part) && tokens.length <= 2) pushToken(tokens, 'keyword', part);
        else pushToken(tokens, 'property', part);
      }
    }
    index = match.index + tag.length;
  }
  pushToken(tokens, '', line.slice(index));
  return tokens;
}

function tokenizeLine(line, language, state) {
  if (language === 'html') return tokenizeMarkup(line);
  const tokens = [];
  const keywords = KEYWORDS[language] || new Set();
  const hashComments = language === 'py' || language === 'sh';
  const slashComments = language === 'js' || language === 'ts' || language === 'rust' || language === 'css';
  let index = 0;

  while (index < line.length) {
    if (state.blockComment) {
      const end = line.indexOf('*/', index);
      if (end < 0) {
        pushToken(tokens, 'comment', line.slice(index));
        return tokens;
      }
      pushToken(tokens, 'comment', line.slice(index, end + 2));
      state.blockComment = false;
      index = end + 2;
      continue;
    }

    if (slashComments && line.startsWith('/*', index)) {
      const end = line.indexOf('*/', index + 2);
      if (end < 0) {
        state.blockComment = true;
        pushToken(tokens, 'comment', line.slice(index));
        return tokens;
      }
      pushToken(tokens, 'comment', line.slice(index, end + 2));
      index = end + 2;
      continue;
    }

    if ((slashComments && line.startsWith('//', index)) || (hashComments && line[index] === '#')) {
      pushToken(tokens, 'comment', line.slice(index));
      break;
    }

    const character = line[index];
    if (character === '"' || character === "'" || (character === '`' && (language === 'js' || language === 'ts'))) {
      const quote = character;
      let end = index + 1;
      while (end < line.length) {
        if (line[end] === '\\') {
          end += 2;
          continue;
        }
        end += 1;
        if (line[end - 1] === quote) break;
      }
      pushToken(tokens, 'string', line.slice(index, end));
      index = end;
      continue;
    }

    if (/\d/.test(character)) {
      const number = line.slice(index).match(/^(?:0[xob][0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i)?.[0] || character;
      pushToken(tokens, 'number', number);
      index += number.length;
      continue;
    }

    if (isIdentifierStart(character)) {
      let end = index + 1;
      while (end < line.length && isIdentifierPart(line[end])) end += 1;
      const word = line.slice(index, end);
      if (keywords.has(word)) pushToken(tokens, 'keyword', word);
      else if (/^[A-Z]/.test(word)) pushToken(tokens, 'type', word);
      else pushToken(tokens, '', word);
      index = end;
      continue;
    }

    if (/[{}()[\].,;:]/.test(character)) pushToken(tokens, 'punctuation', character);
    else if (/[+\-*/%=!<>?&|^~]/.test(character)) pushToken(tokens, 'operator', character);
    else pushToken(tokens, '', character);
    index += 1;
  }

  return tokens;
}

export function highlightCode(code, language) {
  const normalizedLanguage = normalizeLanguage(language);
  const state = { blockComment: false };
  return String(code ?? '').split('\n').map((line, index) => ({
    number: index + 1,
    tokens: tokenizeLine(line, normalizedLanguage, state)
  }));
}

export function getNormalizedCodeLanguage(language) {
  return normalizeLanguage(language);
}

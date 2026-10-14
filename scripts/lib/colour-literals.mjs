// Finds colour literals in a CSS, HTML or TypeScript source (#143, look-and-feel spec L1): hex
// colours, the CSS colour functions, named colours, and in TypeScript a three.js colour number.
// Comments are skipped, so an issue number such as #155 in a comment is not a colour. Pure: no
// file access; scripts/check-colours.mjs is the command. Copied from the table application's
// scripts/lib/colour-literals.mjs (its main at 791425e), with HTML added: its comments are
// blanked, a hex counts as a value (an input's, an attribute's) and a named colour in its CSS (a
// style attribute, a <style> element), so a link's #id or a word in a sentence is not a colour.

/** The CSS named colours (CSS Color 4), without `transparent` and `currentColor`. */
export const NAMED_COLOURS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
    'yellowgreen'
  ).split(' '),
);

/** Text blanked to spaces, its newlines kept. */
const blank = (text) => text.replace(/[^\n]/g, ' ');

/**
 * The source with its comments blanked out (newlines kept, so line numbers hold). CSS has only
 * block comments; TypeScript also has line comments, and quotes and template literals are
 * followed so that a `//` in a URL is not taken for a comment. HTML loses its `<!-- -->`
 * comments, then its block comments as CSS.
 */
export function stripComments(source, kind) {
  if (kind === 'html') return stripComments(source.replace(/<!--[\s\S]*?(?:-->|$)/g, blank), 'css');
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    if (quote !== null) {
      out += ch;
      if (ch === '\\') {
        out += source[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === quote || (ch === '\n' && quote !== '`')) quote = null;
      i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (kind === 'ts' && ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? source.length : end;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || (kind === 'ts' && ch === '`')) quote = ch;
    out += ch;
    i++;
  }
  return out;
}

const HEX = /(?<![\w&#$])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
/**
 * In TypeScript an issue number such as (#129) can sit in a string, in the comments of a script
 * the server inlines, and in HTML in a line of text: a short hex of digits alone (three or four)
 * counts there only after a quote, `:` or `=`; six or eight digits are never an issue number.
 */
const TS_DIGITS_ONLY_CONTEXT = /['"`:=]\s*$/;
/** A hex colour in a URL-encoded SVG of a data: URL: `stroke='%23888'`. */
const ENCODED_HEX = /%23(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z])/gi;
const FUNCTIONS = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;
const CSS_COLOR_FUNCTION = /(?<![\w-])color\(/gi;
const THREE_NUMBER = /(?<![\w.])0x[0-9a-f]{6}(?![\w])/gi;
const WORD = /(?<![\w-])[a-z]+(?![\w-])/gi;
/** A declaration's value, up to the `;` or `}` that ends it (a selector ends at `{`). */
const DECLARATION = /(?<![\w-])(--?[\w-]+|[a-z][\w-]*)\s*:\s*([^;{}]+)(?=[;}])/gi;
const TS_NAMED = /(['"`])([a-z]+)\1/gi;
/** Outside its CSS, a hex in HTML counts only as a value (after a quote, `:` or `=`), never as a link's `#id`. */
const HTML_LINK_CONTEXT = /href\s*=\s*["']?$/i;
/** Where HTML holds CSS: a `style` attribute's value (in either quote), a `<style>` element's content. */
const HTML_CSS = /(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')|(<style[^>]*>)([\s\S]*?)(?=<\/style>)/gi;

/**
 * The CSS an HTML source holds, everything else blanked (newlines kept, so indices hold); a style
 * attribute's closing quote becomes `;`, which ends its last declaration. Named colours are
 * looked for only there: prose with a colon is not a declaration.
 */
function cssOf(html) {
  let out = blank(html);
  for (const m of html.matchAll(HTML_CSS)) {
    const [, attribute, doubleQuoted, singleQuoted, open, content] = m;
    const at = m.index + (attribute !== undefined ? attribute.length + 1 : open.length);
    const css = attribute !== undefined ? `${doubleQuoted ?? singleQuoted};` : content;
    out = out.slice(0, at) + css + out.slice(at + css.length);
  }
  return out;
}

/**
 * Every colour literal in a source: `{ line, text }`, in order. `kind` is 'css', 'html' (its
 * comments gone; in its CSS as CSS, elsewhere a hex only as a value) or 'ts'.
 */
export function findColourLiterals(source, kind) {
  const code = stripComments(source, kind);
  const css = kind === 'html' ? cssOf(code) : code;
  const found = [];
  const add = (index, text) => found.push({ index, text });
  for (const m of code.matchAll(HEX)) {
    const before = code.slice(Math.max(0, m.index - 16), m.index);
    const value = TS_DIGITS_ONLY_CONTEXT.test(before);
    const shortDigits = /^#\d{3,4}$/.test(m[0]);
    if (kind === 'ts' && shortDigits && !value) continue;
    const inCss = css[m.index] === '#';
    if (kind === 'html' && !inCss && (!value || HTML_LINK_CONTEXT.test(before))) continue;
    add(m.index, m[0]);
  }
  for (const m of code.matchAll(ENCODED_HEX)) add(m.index, m[0]);
  for (const m of code.matchAll(FUNCTIONS)) add(m.index, m[0]);
  if (kind === 'css' || kind === 'html') {
    for (const m of code.matchAll(CSS_COLOR_FUNCTION)) add(m.index, m[0]);
    for (const m of css.matchAll(DECLARATION)) {
      // Quoted strings and var() names are not colours: blank them before looking for words.
      const value = m[2].replace(/(['"]).*?\1/g, (s) => ' '.repeat(s.length));
      const start = m.index + m[0].length - m[2].length;
      for (const w of value.matchAll(WORD)) {
        if (NAMED_COLOURS.has(w[0].toLowerCase())) add(start + w.index, w[0]);
      }
    }
  } else {
    for (const m of code.matchAll(THREE_NUMBER)) add(m.index, m[0]);
    for (const m of code.matchAll(TS_NAMED)) {
      if (NAMED_COLOURS.has(m[2].toLowerCase())) add(m.index, m[0]);
    }
  }
  found.sort((a, b) => a.index - b.index);
  return found.map(({ index, text }) => ({
    line: code.slice(0, index).split('\n').length,
    text,
  }));
}

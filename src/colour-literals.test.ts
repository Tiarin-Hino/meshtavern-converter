// The colour-literal finder behind npm run check:colours (#143): the table application's cases
// (its scripts/lib/colour-literals.test.mjs), and the HTML this repo adds for index.html.

import { describe, expect, it } from 'vitest';
import {
  findColourLiterals,
  stripComments,
  type SourceKind,
} from '../scripts/lib/colour-literals.mjs';

const texts = (source: string, kind: SourceKind) =>
  findColourLiterals(source, kind).map((f) => f.text);

describe('findColourLiterals in CSS', () => {
  it('finds hex colours, colour functions and named colours in values', () => {
    const css = `.a {
  color: #fff;
  background: rgb(0 0 0 / 25%);
  border: 1px solid hsl(10 20% 30%);
  outline-color: red;
  fill: color(display-p3 1 0 0);
  box-shadow: 0 0 2px #00000080;
  background-image: url("data:image/svg+xml,%3Csvg stroke='%23888'%3E%3C/svg%3E");
}`;
    expect(texts(css, 'css')).toEqual([
      '#fff',
      'rgb(',
      'hsl(',
      'red',
      'color(',
      '#00000080',
      '%23888',
    ]);
    expect(findColourLiterals(css, 'css')[0]!.line).toBe(2);
  });

  it('passes roles, keywords, property names, selectors and comments', () => {
    const css = `/* Was #1b1d22, see #155; white on black. */
.red .white:hover, .chip:not(.green) {
  white-space: nowrap;
  color: var(--red-text);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  border-color: currentColor;
  font-family: 'Black Ops', serif;
  transition: color 120ms;
}
@media (pointer: coarse) {
  .a { --x: var(--grey-0); }
}`;
    expect(texts(css, 'css')).toEqual([]);
  });
});

describe('findColourLiterals in HTML', () => {
  it('skips the comments, so an issue number in one is not a colour', () => {
    const html = `<!--
  The question view (#119) puts its controls here; was #1b1d22.
-->
<summary>Paint (team tool)</summary>
<!-- #127, #128 --><div id="paint-controls" hidden></div>`;
    expect(texts(html, 'html')).toEqual([]);
  });

  it('finds a colour in an attribute or a style, on its line', () => {
    const html = `<label>Base coat <input id="look-base" type="color" value="#9aa0a8" /></label>
<!-- a comment -->
<p style="color: red; background: rgb(0 0 0)">x</p>`;
    expect(findColourLiterals(html, 'html')).toEqual([
      { line: 1, text: '#9aa0a8' },
      { line: 3, text: 'red' },
      { line: 3, text: 'rgb(' },
    ]);
  });

  it('reads a named colour only where the HTML holds CSS', () => {
    const html = `<p style="color: red">x</p>
<style>
  .a { background: white; }
</style>
<p>Note: a white base&nbsp;here, and a red mini &amp; more.</p>
<a href="https://example.com">a red mini</a> &mdash; done.`;
    expect(findColourLiterals(html, 'html')).toEqual([
      { line: 1, text: 'red' },
      { line: 3, text: 'white' },
    ]);
  });

  it('counts a hex only as a value, never as a link’s fragment or a word', () => {
    expect(texts('<a href="#ace">x</a> <a href=#cafe>y</a> <span>#bad</span>', 'html')).toEqual([]);
    expect(texts('<rect fill="#ace" /><td bgcolor=#cafe>', 'html')).toEqual(['#ace', '#cafe']);
  });

  it('passes ids, links, words and issue numbers in a line of text', () => {
    const html = `<a href="#adjust">Adjust</a> <button id="add-base">Add</button>
<p>A red mini on a white base.</p>
<summary>Paint (team tool, #127, #128)</summary>`;
    expect(texts(html, 'html')).toEqual([]);
    expect(texts('<input value="#123" /><i style="color:#456">', 'html')).toEqual(['#123', '#456']);
  });
});

describe('findColourLiterals in TypeScript', () => {
  it('finds colour strings, three.js colour numbers and named colour strings', () => {
    const ts = `const a = '#ffffff';
el.style.color = 'white';
ctx.fillStyle = \`rgba(0,0,0,\${alpha})\`;
new THREE.Color(0x1b1d22);
const html = '<b style="color:#000">';`;
    expect(texts(ts, 'ts')).toEqual(['#ffffff', "'white'", 'rgba(', '0x1b1d22', '#000']);
  });

  it('passes issue numbers, selectors, entities, other numbers and comments', () => {
    const ts = `// The colour of #155 was #ffc94d.
/* rgb(1 2 3) */
const help = 'Closes the gap of (#129) and #128';
document.querySelector('#app');
const entity = '&#123;';
const magic = 0x46546c67;
const byte = 0xff;
const url = 'https://example.com/#top'; // red
const word = 'whitespace';`;
    expect(texts(ts, 'ts')).toEqual([]);
  });

  it('counts a hex of digits alone after a quote, a colon or an equals sign', () => {
    expect(texts(`const a = '#000';`, 'ts')).toEqual(['#000']);
    expect(texts('const b = `color: #111`;', 'ts')).toEqual(['#111']);
    expect(texts(`const c = 'fill=#222';`, 'ts')).toEqual(['#222']);
  });
});

describe('stripComments', () => {
  it('blanks comments and keeps line numbers and strings', () => {
    const ts = `const a = 'http://x'; // note\n/* b\nc */ const d = 1;`;
    const out = stripComments(ts, 'ts');
    expect(out.split('\n')).toHaveLength(3);
    expect(out).toContain("'http://x'");
    expect(out).not.toContain('note');
    expect(out).toContain('const d = 1;');
  });

  it('blanks an HTML comment over several lines, keeping them', () => {
    const out = stripComments('<a>\n<!-- one\ntwo -->\n<b>', 'html');
    expect(out.split('\n')).toHaveLength(4);
    expect(out).not.toContain('one');
    expect(out).toContain('<b>');
  });
});

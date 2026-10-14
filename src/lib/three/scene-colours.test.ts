import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  compositeOver,
  parseCssColour,
  readSceneColours,
  SCENE_COLOURS_FALLBACK,
  SCENE_ROLES,
  sceneColoursFrom,
} from './scene-colours';

/** tokens.css without its comments. */
const TOKENS = readFileSync(
  new URL('../../../public/theme/tokens.css', import.meta.url),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** A declaration's value in tokens.css, `var(--x)` followed to the base value. */
function token(name: string): string {
  const value = new RegExp(`(?<![\\w-])${name}\\s*:\\s*([^;]+);`).exec(TOKENS)?.[1]?.trim();
  if (value === undefined) throw new Error(`${name} is not in tokens.css`);
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  return reference ? token(reference[1]!) : value;
}

describe('the scenes’ colours', () => {
  it('fall back to the values of tokens.css', () => {
    const fromTokens = sceneColoursFrom(token);
    expect(SCENE_COLOURS_FALLBACK).toEqual(fromTokens);
    expect(token(SCENE_ROLES.backdrop)).toBe('#0f0e0d');
    expect(SCENE_COLOURS_FALLBACK.backdrop).toBe(0x0f0e0d);
  });

  it('composite the grid over the backdrop: the centre at the role’s alpha, the lines at half', () => {
    // White at 0.16 and 0.08 over #0f0e0d; the spike's grid was 0x4a4f5a and 0x2c3038 over
    // 0x1b1d22, tuned by eye, so the values move with the backdrop.
    expect(SCENE_COLOURS_FALLBACK.gridCentre).toBe(0x353534);
    expect(SCENE_COLOURS_FALLBACK.gridLine).toBe(0x222120);
    expect(compositeOver(0xffffff, 0, 0x123456)).toBe(0x123456);
    expect(compositeOver(0xffffff, 1, 0x123456)).toBe(0xffffff);
  });

  it('read the roles a root carries, each with its own fallback', () => {
    const roles: Record<string, string> = {
      '--scene-backdrop': ' #000000',
      '--scene-grid': 'rgba(255, 0, 0, 0.5)',
    };
    expect(sceneColoursFrom((role) => roles[role] ?? '')).toEqual({
      backdrop: 0x000000,
      gridCentre: 0x800000,
      gridLine: 0x400000,
    });
    expect(sceneColoursFrom((role) => (role === '--scene-grid' ? '' : '#102030'))).toEqual({
      backdrop: 0x102030,
      gridCentre: compositeOver(0xffffff, 0.16, 0x102030),
      gridLine: compositeOver(0xffffff, 0.08, 0x102030),
    });
    expect(sceneColoursFrom(() => 'light-dark(#fff, #000)')).toEqual(SCENE_COLOURS_FALLBACK);
  });

  it('give the fallback without a DOM', () => {
    expect(readSceneColours()).toEqual(SCENE_COLOURS_FALLBACK);
  });
});

describe('parseCssColour', () => {
  it('reads hex, rgb() and rgba() with their alpha', () => {
    expect(parseCssColour('#fff')).toEqual({ rgb: 0xffffff, alpha: 1 });
    expect(parseCssColour('#0f0e0d')).toEqual({ rgb: 0x0f0e0d, alpha: 1 });
    expect(parseCssColour('#ffffff80')).toEqual({ rgb: 0xffffff, alpha: 128 / 255 });
    expect(parseCssColour('rgb(255 255 255 / 0.16)')).toEqual({ rgb: 0xffffff, alpha: 0.16 });
    expect(parseCssColour('rgb(255 255 255 / 16%)')).toEqual({ rgb: 0xffffff, alpha: 0.16 });
    expect(parseCssColour('rgba(15, 14, 13, 1)')).toEqual({ rgb: 0x0f0e0d, alpha: 1 });
    expect(parseCssColour('rgb(100% 0% 50%)')).toEqual({ rgb: 0xff0080, alpha: 1 });
  });

  it('gives null for what it does not read', () => {
    for (const text of ['', 'white', 'var(--grey-0)', 'rgb(1 2)', 'color(srgb 1 1 1)', '#ggg']) {
      expect(parseCssColour(text), text).toBeNull();
    }
  });
});

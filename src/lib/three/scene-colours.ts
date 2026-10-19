// The scenes' colours (#143, design note look-and-feel.md §3.1): the viewer's, the question view's
// and the painting view's backdrop and grid come from the --scene-* roles of the table
// application's public/theme/tokens.css, read once from the page root when a scene starts, as
// the application's table does (its web/src/table/scene-colors.ts). The scene is dark in both
// themes, so a theme change after that needs nothing. A role the root does not carry, or one in a
// form this does not read, falls back to the tokens' values, which scene-colours.test.ts pins.
// The one file of src/lib/three/ the colour check allows: the pairs' colours, the table's lights
// and the clear colour are data of the scenes, not of the theme.

/** The scenes' colours as three.js colour numbers. */
export interface SceneColours {
  /** `--scene-backdrop`: the scene's background. */
  backdrop: number;
  /** `--scene-grid` composited over the backdrop: the grid's centre lines. */
  gridCentre: number;
  /** `--scene-grid` at `SCENE_GRID_LINE_ALPHA` of its alpha over the backdrop: the other lines. */
  gridLine: number;
}

/** The roles the colours are read from. */
export const SCENE_ROLES = { backdrop: '--scene-backdrop', grid: '--scene-grid' } as const;

/** The grid's other lines take this share of `--scene-grid`'s alpha, the centre lines all of it, which keeps the two-tone grid. _(proposal)_ */
export const SCENE_GRID_LINE_ALPHA = 0.5;

/** A CSS colour read as a three.js colour number and an alpha from 0 to 1. */
export interface RgbaColour {
  rgb: number;
  alpha: number;
}

/** `--scene-backdrop` in tokens.css (`var(--grey-1000)`). */
const BACKDROP_FALLBACK: RgbaColour = { rgb: 0x0f0e0d, alpha: 1 };
/** `--scene-grid` in tokens.css (`rgb(255 255 255 / 0.16)`). */
const GRID_FALLBACK: RgbaColour = { rgb: 0xffffff, alpha: 0.16 };

const channel = (rgb: number, shift: number): number => (rgb >> shift) & 0xff;

/** `top` at `alpha` over the opaque `under`, per channel in sRGB bytes, rounded. */
export function compositeOver(top: number, alpha: number, under: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const mixed = channel(top, shift) * alpha + channel(under, shift) * (1 - alpha);
    out |= Math.round(mixed) << shift;
  }
  return out;
}

/** The scenes' colours from the two roles' values. */
export function sceneColoursOf(backdrop: RgbaColour, grid: RgbaColour): SceneColours {
  return {
    backdrop: backdrop.rgb,
    gridCentre: compositeOver(grid.rgb, grid.alpha, backdrop.rgb),
    gridLine: compositeOver(grid.rgb, grid.alpha * SCENE_GRID_LINE_ALPHA, backdrop.rgb),
  };
}

/** The colours where no root carries the roles: the values of tokens.css. */
export const SCENE_COLOURS_FALLBACK: Readonly<SceneColours> = Object.freeze(
  sceneColoursOf(BACKDROP_FALLBACK, GRID_FALLBACK),
);

/**
 * A CSS colour as a colour number and an alpha: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`,
 * `rgb(r g b)`, `rgb(r g b / a)`, `rgb(r, g, b)` and `rgba(…)`, channels as numbers or
 * percentages, the alpha as a number or a percentage. Null for anything else, such as an empty
 * value, a named colour or `light-dark()`.
 */
export function parseCssColour(text: string): RgbaColour | null {
  const value = text.trim();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (hex) {
    let digits = hex[1]!;
    if (digits.length <= 4) digits = [...digits].map((c) => c + c).join('');
    const alpha = digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1;
    return { rgb: parseInt(digits.slice(0, 6), 16), alpha };
  }
  const fn = /^rgba?\(([^)]*)\)$/i.exec(value);
  if (fn === null) return null;
  const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const number = (part: string, full: number): number => {
    const n = parseFloat(part);
    return part.endsWith('%') ? (n / 100) * full : n;
  };
  const channels = parts.slice(0, 3).map((part) => Math.round(number(part, 255)));
  const alpha = parts.length === 4 ? number(parts[3]!, 1) : 1;
  if (![...channels, alpha].every(Number.isFinite)) return null;
  const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));
  return {
    rgb:
      (clamp(channels[0]!, 255) << 16) | (clamp(channels[1]!, 255) << 8) | clamp(channels[2]!, 255),
    alpha: clamp(alpha, 1),
  };
}

/** The colours from `read`, a role's computed value, each role with its fallback. */
export function sceneColoursFrom(read: (role: string) => string): SceneColours {
  const backdrop = parseCssColour(read(SCENE_ROLES.backdrop));
  const grid = parseCssColour(read(SCENE_ROLES.grid));
  return sceneColoursOf(
    // The backdrop is opaque: a scene's background has no alpha.
    backdrop === null ? BACKDROP_FALLBACK : { rgb: backdrop.rgb, alpha: 1 },
    grid ?? GRID_FALLBACK,
  );
}

/**
 * Reads the two roles from the root's computed style once (the page's `<html>` by default); the
 * fallback where a role is missing, and everywhere when there is no DOM (Node, a worker).
 */
export function readSceneColours(root?: Element): SceneColours {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return { ...SCENE_COLOURS_FALLBACK };
  }
  const style = getComputedStyle(root ?? document.documentElement);
  return sceneColoursFrom((role) => style.getPropertyValue(role));
}

/** The pairs' colours: the patches in the scene, and `--pair-1` … `--pair-4` on the view's hosts for the chips. Data of the question view, not of the theme. _(proposal, #93)_ */
export const PAIR_COLOURS = [0xf0b35e, 0x7ee0c3, 0xd78ae6, 0x8fb8f5] as const;

/** The tint the painting view shows the mask with over the surface (#138): the blue of liquid mask. _(proposal)_ */
export const MASK_TINT = 0x3a78d8;
/** How much of the tint a fully masked texel shows over the mini. _(proposal)_ */
export const MASK_TINT_STRENGTH = 0.45;

/**
 * The groups' colours in the painting view (#139), group k > 0 in colour k modulo their number:
 * the pairs' four first, then four more. _(proposal)_
 */
export const GROUP_COLOURS = [...PAIR_COLOURS, 0xe86f6f, 0xb8d86b, 0x6fd1e8, 0xe8a0c0] as const;
/** How much of its colour a group shows over the mini while the groups are shown. _(proposal)_ */
export const GROUP_TINT_STRENGTH = 0.35;
/** How much of the target group's colour a group stroke's coverage shows before its commit. _(proposal)_ */
export const GROUP_STROKE_TINT_STRENGTH = 0.5;

/** The table's light (`addTableLights`, in the viewer, the question and painting scenes and the thumbnail): the sky and the ground of the fill, and the key light. */
export const TABLE_LIGHT_COLOURS = { sky: 0xffffff, ground: 0x30343c, key: 0xffffff } as const;

/** What a render target or a read-back is cleared to, with an alpha of 0. */
export const BLACK = 0x000000;

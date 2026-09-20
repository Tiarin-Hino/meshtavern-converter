import type { IndexedMesh } from './mesh';

/**
 * The "primed and washed" look: a base coat, darkened where a wash would pool (buried
 * areas and creases) and lightened where a drybrush would catch (edges). Pure maths on the
 * measurements from shade.ts, so the viewer and the GLB export produce the same colours.
 */
export interface Look {
  enabled: boolean;
  /** Base coat as an sRGB hex colour, for example "#9aa0a8". */
  base: string;
  /** 0–1: how much buried areas darken. */
  occlusion: number;
  /** 0–1: how much creases darken. */
  wash: number;
  /** 0–1: how much edges lighten. */
  edges: number;
}

export const DEFAULT_LOOK: Look = {
  enabled: true,
  base: '#9aa0a8',
  occlusion: 0.75,
  wash: 0.6,
  edges: 0.45,
};

/** Raw cavity values are small (a 20° fold is about 0.17); this brings them to a usable range. */
const CAVITY_GAIN = 4;
/** The wash never goes fully black and the drybrush never fully white. */
const DARKEST = 0.12;
const HIGHLIGHT = 0.85;

const srgbToLinear = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

export function parseHexColour(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Not a hex colour: ${hex}`);
  const value = parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) =>
    srgbToLinear(channel / 255),
  ) as [number, number, number];
}

/**
 * Linear RGB per vertex, 0–1, three numbers each. Meshes without shading data, and a
 * disabled look, get the flat base coat.
 */
export function vertexColours(mesh: IndexedMesh, look: Look): Float32Array {
  const vertexCount = mesh.positions.length / 3;
  const colours = new Float32Array(vertexCount * 3);
  const base = parseHexColour(look.base);
  const shaded = look.enabled && mesh.occlusion && mesh.cavity;

  for (let v = 0; v < vertexCount; v++) {
    let shadow = 1;
    let highlight = 0;
    if (shaded) {
      const cavity = Math.max(-1, Math.min(1, mesh.cavity![v]! * CAVITY_GAIN));
      shadow =
        (1 - look.occlusion * (1 - mesh.occlusion![v]!)) * (1 - look.wash * Math.max(0, -cavity));
      shadow = DARKEST + (1 - DARKEST) * shadow;
      highlight = look.edges * Math.max(0, cavity) * HIGHLIGHT;
    }
    for (let channel = 0; channel < 3; channel++) {
      const coat = base[channel]! * shadow;
      colours[v * 3 + channel] = coat + (1 - coat) * highlight;
    }
  }
  return colours;
}

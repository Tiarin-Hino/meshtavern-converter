import { describe, expect, it } from 'vitest';
import { weldVertices } from '../lib/pipeline/mesh';
import { detectUpAxis } from '../lib/pipeline/orient';
import { addRoundBase } from '../lib/pipeline/base';
import {
  addBlob,
  generateFigure,
  generateQuadruped,
  generateSwarm,
  generateTiltedFigure,
  toYUp,
} from './shapes';

/** Every edge of a closed surface is shared by exactly two triangles, once in each direction. */
function openEdges(indices: Uint32Array, vertexCount: number): number {
  const edges = new Map<number, number>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const from = indices[t + k]!;
      const to = indices[t + ((k + 1) % 3)]!;
      edges.set(from * vertexCount + to, (edges.get(from * vertexCount + to) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [edge, count] of edges) {
    const back = (edge % vertexCount) * vertexCount + Math.floor(edge / vertexCount);
    if (count !== 1 || edges.get(back) !== 1) open++;
  }
  return open;
}

function signedVolume(soup: ArrayLike<number>): number {
  let volume = 0;
  for (let i = 0; i < soup.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.prototype.slice.call(soup, i, i + 9);
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

describe('generated shapes', () => {
  it('makes a blob that is closed, faces outward and has the promised triangle count', () => {
    const soup: number[] = [];
    addBlob(soup, [1, 2, 3], [5, 4, 10], 8, 0.1);
    expect(soup.length / 9).toBe(12 * 8 * 8);
    const { mesh, degenerateTriangles } = weldVertices(new Float32Array(soup));
    expect(degenerateTriangles).toBe(0);
    expect(openEdges(mesh.indices, mesh.positions.length / 3)).toBe(0);
    // Close to the ellipsoid's 4/3 π a b c, and positive: the faces point outward.
    expect(signedVolume(soup) / ((4 / 3) * Math.PI * 5 * 4 * 10)).toBeCloseTo(1, 1);
  });

  it('makes a round base that is closed, faces outward and has the asked size', () => {
    const soup: number[] = [];
    addRoundBase(soup, [0, 0], 25, 3, 10);
    expect(soup.length / 9).toBe(4 * 10 * 10 + 8 * 10);
    const { mesh, degenerateTriangles } = weldVertices(new Float32Array(soup));
    expect(degenerateTriangles).toBe(0);
    expect(openEdges(mesh.indices, mesh.positions.length / 3)).toBe(0);
    expect(signedVolume(soup) / (Math.PI * 12.5 ** 2 * 3)).toBeCloseTo(1, 1);
  });

  it('gives the same bits every time', () => {
    // Compared as bytes: a deep comparison of 880,000 numbers takes seconds.
    const bytes = (soup: Float32Array): Buffer => Buffer.from(soup.buffer);
    expect(bytes(generateSwarm()).equals(bytes(generateSwarm()))).toBe(true);
  });

  it('has a base the pipeline finds, in both file conventions', () => {
    const figure = generateFigure(true);
    expect(detectUpAxis(weldVertices(figure).mesh).orientation).toMatchObject({
      up: '+z',
      method: 'base',
    });
    expect(detectUpAxis(weldVertices(toYUp(figure)).mesh).orientation).toMatchObject({
      up: '+y',
      method: 'base',
    });
    expect(detectUpAxis(weldVertices(generateFigure(false)).mesh).orientation.method).toBe(
      'tallest',
    );
  });

  it('makes a quadruped of closed parts that stands on its paws, with no base', () => {
    const soup = generateQuadruped();
    expect(soup.length / 9).toBe(12 * (40 * 40 + 24 * 24 + 4 * 16 * 16));
    expect(signedVolume(soup)).toBeGreaterThan(0);
    let minZ = Infinity;
    for (let i = 2; i < soup.length; i += 3) minZ = Math.min(minZ, soup[i]!);
    expect(Math.abs(minZ)).toBeLessThan(0.01);
    expect(detectUpAxis(weldVertices(soup).mesh).orientation.method).not.toBe('base');
  });

  it('tilts the figure by the 3-4-5 turn, the same bits every time', () => {
    const tilted = generateTiltedFigure();
    const upright = generateFigure(false);
    expect(tilted.length).toBe(upright.length);
    // The turn keeps lengths: the first corner is as far from the x axis as before.
    const r = (s: Float32Array): number => Math.hypot(s[1]!, s[2]!);
    expect(r(tilted)).toBeCloseTo(r(upright), 4);
    const bytes = (soup: Float32Array): Buffer => Buffer.from(soup.buffer);
    expect(bytes(generateTiltedFigure()).equals(bytes(tilted))).toBe(true);
  });
});

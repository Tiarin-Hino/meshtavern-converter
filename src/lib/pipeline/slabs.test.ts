import { describe, expect, it } from 'vitest';
import { generateBumpySheet } from './generate';
import { weldVertices } from './mesh';
import { cutIntoSlabs, splitByGroup } from './slabs';

describe('splitByGroup', () => {
  it('gives every group its own mesh and the way back to the source', () => {
    const source = weldVertices(generateBumpySheet(6)).mesh;
    const groupOfTriangle = Uint32Array.from({ length: 72 }, (_, t) => (t % 3 === 0 ? 1 : 0));
    const parts = splitByGroup(source, groupOfTriangle, 2);
    expect(parts.map((part) => part.mesh.indices.length / 3)).toEqual([48, 24]);
    for (const part of parts) {
      part.sourceTriangle.forEach((from, t) => {
        for (let corner = 0; corner < 3; corner++) {
          const local = part.mesh.indices[t * 3 + corner]!;
          expect(part.sourceVertex[local]).toBe(source.indices[from * 3 + corner]);
          expect(part.mesh.positions[local * 3]).toBe(
            source.positions[part.sourceVertex[local]! * 3],
          );
        }
      });
    }
  });
});

describe('cutIntoSlabs', () => {
  it('cuts one piece into slabs of equal size along its longest side', () => {
    const sheet = weldVertices(generateBumpySheet(8, 40)).mesh;
    // Stretch x, so that the cut has to run across x.
    for (let i = 0; i < sheet.positions.length; i += 3)
      sheet.positions[i] = sheet.positions[i]! * 3;
    const { groupOfTriangle, groupSizes } = cutIntoSlabs(sheet, 4);
    expect(groupSizes).toEqual([32, 32, 32, 32]);
    const highestX = [0, 0, 0, 0];
    const lowestX = [Infinity, Infinity, Infinity, Infinity];
    groupOfTriangle.forEach((group, t) => {
      for (let corner = 0; corner < 3; corner++) {
        const x = sheet.positions[sheet.indices[t * 3 + corner]! * 3]!;
        highestX[group] = Math.max(highestX[group]!, x);
        lowestX[group] = Math.min(lowestX[group]!, x);
      }
    });
    for (let group = 1; group < 4; group++) {
      expect(lowestX[group]).toBeGreaterThanOrEqual(highestX[group - 1]! - 15.01);
      expect(highestX[group]).toBeGreaterThan(highestX[group - 1]!);
    }
  });

  it('never makes more slabs than there are triangles', () => {
    const sheet = weldVertices(generateBumpySheet(1)).mesh;
    expect(cutIntoSlabs(sheet, 8).groupSizes).toEqual([1, 1]);
  });
});

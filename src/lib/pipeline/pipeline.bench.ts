import { bench, describe } from 'vitest';
import { generateBumpySheet } from './generate';
import { weldVertices } from './mesh';
import { orientAndPlace } from './orient';
import { encodeBinaryStl, readStlTriangles } from './stl';

// 1000 quads per side = 2,000,000 triangles, a 100 MB binary STL.
const soup = generateBumpySheet(1000);
const stl = encodeBinaryStl(soup);
const welded = weldVertices(soup).mesh;
const options = { iterations: 5, time: 0, warmupIterations: 1, warmupTime: 0 };

describe('2M-triangle input', () => {
  bench('readStlTriangles', () => void readStlTriangles(stl), options);
  bench('weldVertices', () => void weldVertices(soup), options);
  bench('orientAndPlace', () => void orientAndPlace(welded, '+z', 0), options);
});

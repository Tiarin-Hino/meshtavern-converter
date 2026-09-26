import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as dev from './dev';
import * as lib from './index';
import * as three from './three';

// The library's API as a list (issue #50). Adding or removing an export means changing a
// line here, so the API only grows in a visible diff. Types leave no key at run time; they
// are pinned by the page and the regression net, which import only through the entries.

describe('the library entries', () => {
  it('index.ts exports exactly the public API', () => {
    expect(Object.keys(lib).sort()).toEqual([
      'BAKED_LEVEL',
      'BAKE_STEPS',
      'CREATURE_SIZES',
      'ConversionCancelled',
      'ConversionProblem',
      'Converter',
      'DEFAULT_LOOK',
      'GRID_SQUARE_MM',
      'IDENTITY',
      'LOD_SPECS',
      'PROBLEM_MESSAGES',
      'SIZES',
      'SNIFF_BYTES',
      'STEPS',
      'UNIT_FACTORS',
      'UP_AXES',
      'checkFits',
      'encodeGlb',
      'estimateConversionBytes',
      'footprintMm',
      'fromAxisAngle',
      'glbEncoderReady',
      'memoryBudgetBytes',
      'multiply',
      'readKtx2Header',
      'readStlFile',
      'sizeLabel',
      'sniffStl',
      'toProblem',
      'turnAngleDeg',
      'vertexColours',
    ]);
  });

  it('dev.ts exports exactly what tests and tooling use', () => {
    expect(Object.keys(dev).sort()).toEqual([
      'DETAIL_EFFORT',
      'DETAIL_EFFORTS',
      'addRoundBase',
      'computeVertexNormals',
      'detectUpAxis',
      'encodeAsciiStl',
      'encodeBinaryStl',
      'generateBumpySheet',
      'meshBuffers',
      'pushOutward',
      'runPipeline',
      'weldVertices',
    ]);
  });

  it('three.ts exports exactly the helpers for drawing a baked mini', () => {
    expect(Object.keys(three).sort()).toEqual([
      'bakedTextureBytes',
      'compressedTextureBytes',
      'createBakedGeometry',
      'createBakedMaterial',
      'createDetailTexture',
      'createLookUniforms',
      'disposeBakedMaterial',
      'ownCopy',
      'transcodeDetail',
      'updateLookUniforms',
    ]);
  });

  it('index.ts and everything it re-exports stay free of three.js', () => {
    // A consumer without three.js (a Node script, a server writing GLBs) must be able to
    // load index.ts; three.js is only behind three.ts. Reading the sources is enough: the
    // pipeline and the worker import nothing outside their folders but npm packages.
    const importsThree = /from '(three|three\/[^']*)'|\/three\//;
    const url = new URL('.', import.meta.url);
    expect(readFileSync(new URL('index.ts', url), 'utf8')).not.toMatch(importsThree);
    for (const folder of ['pipeline', 'worker']) {
      for (const file of readdirSync(new URL(`${folder}/`, url))) {
        const source = readFileSync(new URL(`${folder}/${file}`, url), 'utf8');
        expect(source, `${folder}/${file}`).not.toMatch(importsThree);
      }
    }
  });
});

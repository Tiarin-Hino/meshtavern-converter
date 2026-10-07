import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as dev from './dev';
import * as lib from './index';
import * as questions from './questions';
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
      'DISC_HEIGHT_MAX_MM',
      'GRID_SQUARE_MM',
      'IDENTITY',
      'LOD_SPECS',
      'LOOK_PRESETS',
      'MAX_PAIRS',
      'MAX_PARTS',
      'PROBLEM_MESSAGES',
      'SIZES',
      'SNIFF_BYTES',
      'SOURCE_PRESETS',
      'STEPS',
      'TOP_CONE_DEG',
      'TOP_SHARE',
      'UNIT_FACTORS',
      'UP_AXES',
      'checkFits',
      'encodeGlb',
      'estimateConversionBytes',
      'findSourcePreset',
      'footprintMm',
      'fromAxisAngle',
      'glbEncoderReady',
      'memoryBudgetBytes',
      'multiply',
      'pairsAllowed',
      'presetOf',
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
      'placePairOnly',
      'pushOutward',
      'runPipeline',
      'weldVertices',
    ]);
  });

  it('three.ts exports exactly the helpers for drawing a baked mini', () => {
    expect(Object.keys(three).sort()).toEqual([
      'MINI_METALNESS',
      'MINI_ROUGHNESS',
      'THUMBNAIL_AZIMUTH_DEG',
      'THUMBNAIL_ELEVATION_DEG',
      'THUMBNAIL_FOV_DEG',
      'THUMBNAIL_MARGIN',
      'THUMBNAIL_SIZE',
      'addTableLights',
      'bakedTextureBytes',
      'compressedTextureBytes',
      'createBakedGeometry',
      'createBakedMaterial',
      'createDetailTexture',
      'createLookUniforms',
      'disposeBakedMaterial',
      'ownCopy',
      'renderThumbnail',
      'transcodeDetail',
      'updateLookUniforms',
    ]);
  });

  it('questions.ts exports exactly the question view and its words (#119)', () => {
    expect(Object.keys(questions).sort()).toEqual([
      'BRUSH_RADIUS_MM',
      'BRUSH_STEP_PX',
      'FOCUS_HOLD_MS',
      'LIFT_STEP_MM',
      'PAIR_COLOURS',
      'PANEL_WIDTH_PX',
      'QUESTION_COPY',
      'TAP_MAX_MS',
      'TAP_MAX_PX',
      'TURN_STEP_DEG',
      'UPLOAD_BYTES_PER_FRAME',
      'describeAskPending',
      'describeAskedFile',
      'describePairWarning',
      'describePairs',
      'describePart',
      'describeParts',
      'describePlacement',
      'describeUp',
      'mountQuestions',
      'partName',
    ]);
  });

  it('index.ts and everything it re-exports stay free of three.js', () => {
    // A consumer without three.js (a Node script, a server writing GLBs) must be able to
    // load index.ts; three.js is only behind three.ts. Reading the sources is enough: what
    // index.ts re-exports imports nothing outside these files but npm packages.
    const importsThree = /from '(three|three\/[^']*)'|\/three\//;
    const url = new URL('.', import.meta.url);
    const sources = ['index.ts', 'read-file.ts'];
    for (const folder of ['pipeline', 'worker']) {
      for (const file of readdirSync(new URL(`${folder}/`, url))) sources.push(`${folder}/${file}`);
    }
    for (const file of sources) {
      expect(readFileSync(new URL(file, url), 'utf8'), file).not.toMatch(importsThree);
    }
  });
});

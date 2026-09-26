/**
 * What tests, the benchmark, the regression net and scripts need from the library, and the
 * table application would not: generated meshes, STL writers, the pipeline without a worker.
 */
export { generateBumpySheet } from './pipeline/generate';
export { encodeBinaryStl, encodeAsciiStl } from './pipeline/stl';
// The pipeline without a worker: Node and tests.
export { runPipeline, type PipelineOptions } from './pipeline/run';
export { DETAIL_EFFORT, DETAIL_EFFORTS } from './pipeline/compress';
export { meshBuffers, computeVertexNormals, weldVertices } from './pipeline/mesh';
// The regression net's stand-in minis.
export { detectUpAxis } from './pipeline/orient';
export { addRoundBase, pushOutward, type Vec3 } from './pipeline/base';

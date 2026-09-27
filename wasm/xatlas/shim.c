/*
 * The C side of our xatlas interface. JavaScript never writes or reads one of xatlas's structs
 * by offset: every field is filled here, where the compiler knows the layout, and the few
 * offsets the wrapper does need to read results are asked for at run time.
 * Design: docs/design/own-xatlas-build.md, section 4.
 */
#include <emscripten/emscripten.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#include "xatlas_c.h"

/* Implemented by the wrapper (src/pipeline/xatlas.ts). Returns 0 to cancel. */
__attribute__((import_module("env"), import_name("mt_progress"))) int mt_progress(int category, int progress);

static bool forward_progress(xatlasProgressCategory category, int progress, void *user_data) {
  (void)user_data;
  return mt_progress((int)category, progress) != 0;
}

/*
 * xatlas does not check what its allocator returns, and address 0 is ordinary memory in
 * WebAssembly: a failed allocation would be written through silently. So a failed one stops
 * the module with a trap, and the wrapper asks mt_out_of_memory why it stopped.
 */
static int out_of_memory = 0;

static void *checked_realloc(void *pointer, size_t size) {
  void *result = realloc(pointer, size);
  if (result == NULL && size > 0) {
    out_of_memory = 1;
    __builtin_trap();
  }
  return result;
}

EMSCRIPTEN_KEEPALIVE int mt_out_of_memory(void) { return out_of_memory; }

EMSCRIPTEN_KEEPALIVE xatlasAtlas *mt_atlas_create(void) {
  xatlasSetAlloc(checked_realloc, free);
  /* xatlas prints its warnings with printf unless told otherwise; nobody would read them. */
  xatlasSetPrint(NULL, false);
  return xatlasCreate();
}

EMSCRIPTEN_KEEPALIVE void mt_atlas_destroy(xatlasAtlas *a) { xatlasDestroy(a); }

EMSCRIPTEN_KEEPALIVE int mt_add_mesh(xatlasAtlas *a, const float *positions, const float *normals,
                                     const uint32_t *indices, uint32_t vertexCount, uint32_t indexCount,
                                     uint32_t meshCountHint) {
  xatlasMeshDecl decl;
  xatlasMeshDeclInit(&decl);
  decl.vertexPositionData = positions;
  decl.vertexPositionStride = 3 * sizeof(float);
  decl.vertexNormalData = normals;
  decl.vertexNormalStride = normals ? 3 * sizeof(float) : 0;
  decl.indexData = indices;
  decl.indexFormat = XATLAS_INDEX_FORMAT_UINT32;
  decl.vertexCount = vertexCount;
  decl.indexCount = indexCount;
  return (int)xatlasAddMesh(a, &decl, meshCountHint);
}

EMSCRIPTEN_KEEPALIVE const char *mt_add_mesh_error_string(int error) {
  return xatlasAddMeshErrorString((xatlasAddMeshError)error);
}

EMSCRIPTEN_KEEPALIVE void mt_generate(xatlasAtlas *a, float maxCost, uint32_t resolution, uint32_t padding,
                                      int bilinear, int blockAlign) {
  xatlasChartOptions chart;
  xatlasPackOptions pack;
  xatlasChartOptionsInit(&chart);
  xatlasPackOptionsInit(&pack);
  chart.maxCost = maxCost;
  pack.resolution = resolution;
  pack.padding = padding;
  pack.bilinear = bilinear != 0;
  pack.blockAlign = blockAlign != 0;
  xatlasSetProgressCallback(a, forward_progress, NULL);
  xatlasGenerate(a, &chart, &pack);
}

EMSCRIPTEN_KEEPALIVE uint32_t mt_atlas_width(const xatlasAtlas *a) { return a->width; }
EMSCRIPTEN_KEEPALIVE uint32_t mt_atlas_height(const xatlasAtlas *a) { return a->height; }
EMSCRIPTEN_KEEPALIVE uint32_t mt_atlas_chart_count(const xatlasAtlas *a) { return a->chartCount; }

EMSCRIPTEN_KEEPALIVE float mt_atlas_utilization(const xatlasAtlas *a, uint32_t atlasIndex) {
  return atlasIndex < a->atlasCount ? a->utilization[atlasIndex] : 0.0f;
}

EMSCRIPTEN_KEEPALIVE uint32_t mt_mesh_vertex_count(const xatlasAtlas *a, uint32_t mesh) {
  return a->meshes[mesh].vertexCount;
}
EMSCRIPTEN_KEEPALIVE uint32_t mt_mesh_index_count(const xatlasAtlas *a, uint32_t mesh) {
  return a->meshes[mesh].indexCount;
}
EMSCRIPTEN_KEEPALIVE const xatlasVertex *mt_mesh_vertices(const xatlasAtlas *a, uint32_t mesh) {
  return a->meshes[mesh].vertexArray;
}
EMSCRIPTEN_KEEPALIVE const uint32_t *mt_mesh_indices(const xatlasAtlas *a, uint32_t mesh) {
  return a->meshes[mesh].indexArray;
}

/* The wrapper reads vertices straight out of the heap with these, so a layout change cannot misread silently. */
EMSCRIPTEN_KEEPALIVE uint32_t mt_vertex_stride(void) { return sizeof(xatlasVertex); }
EMSCRIPTEN_KEEPALIVE uint32_t mt_vertex_uv_offset(void) { return offsetof(xatlasVertex, uv); }
EMSCRIPTEN_KEEPALIVE uint32_t mt_vertex_xref_offset(void) { return offsetof(xatlasVertex, xref); }

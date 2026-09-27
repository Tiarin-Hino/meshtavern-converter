/*
 * The C side of our Basis Universal encoder interface. Plain C functions with integers and
 * pointers in and out: no struct crosses the boundary and no generated JavaScript is needed.
 * The parameters are filled the way upstream's webgl/transcoder/basis_wrappers.cpp fills them
 * for the options the pipeline used through ktx2-encoder, so the switch changes no setting.
 * Design: docs/design/own-basis-encoder-build.md, section 5.
 */
#include <emscripten/emscripten.h>
#include <stdint.h>
#include <string.h>

#include "encoder/basisu_comp.h"

using namespace basisu;

static bool initialised = false;
static uint8_vec output;

extern "C" {

/* Calls basisu_encoder_init() and basisu_transcoder_init() once; returns 1 when done. */
EMSCRIPTEN_KEEPALIVE int mt_init(void) {
  if (!initialised) {
    basisu_encoder_init();
    basist::basisu_transcoder_init();
    /* The encoder's own debug printing; status output is switched off per encode below. */
    g_debug_printf = false;
    initialised = true;
  }
  return 1;
}

/*
 * Encodes one RGBA image (width * height * 4 bytes, rows top down) to a KTX2 file.
 * effort: UASTC pack level 0..4 (cPackUASTCLevelFastest..VerySlow), the only quality knob the
 * pipeline turns. Returns the file's size in bytes, or a negative code: -1 init failed,
 * -2 no image, -(100 + basis_compressor::error_code) from init() or process().
 */
EMSCRIPTEN_KEEPALIVE int32_t mt_encode(const uint8_t *rgba, uint32_t width, uint32_t height,
                                       uint32_t effort, int zstd, int mipmaps, int perceptual,
                                       int srgb_transfer, int srgb_mips) {
  output.clear();
  if (!initialised) return -1;
  if (!rgba || !width || !height) return -2;

  basis_compressor_params params;
  params.set_format_mode(basist::basis_tex_format::cUASTC_LDR_4x4);
  params.m_pack_uastc_ldr_4x4_flags = effort;
  params.m_ktx2_uastc_supercompression = zstd ? basist::KTX2_SS_ZSTANDARD : basist::KTX2_SS_NONE;
  params.m_create_ktx2_file = true;
  params.m_mip_gen = mipmaps != 0;
  params.m_perceptual = perceptual != 0;
  params.m_ktx2_and_basis_srgb_transfer_function = srgb_transfer != 0;
  params.m_mip_srgb = srgb_mips != 0;
  params.m_read_source_images = false;
  params.m_write_output_basis_or_ktx2_files = false;
  params.m_status_output = false;
  params.m_debug = false;
  params.m_multithreading = false;

  /* A job pool of one thread spawns none: the encoder runs on the calling thread. */
  job_pool pool(1);
  params.m_pJob_pool = &pool;

  params.m_source_images.resize(1);
  image &source = params.m_source_images[0];
  source.resize(width, height);
  memcpy(source.get_ptr(), rgba, (size_t)width * height * 4);

  basis_compressor compressor;
  if (!compressor.init(params)) return -(100 + (int32_t)basis_compressor::cECFailedInitializing);
  basis_compressor::error_code code = compressor.process();
  if (code != basis_compressor::cECSuccess) return -(100 + (int32_t)code);

  output = compressor.get_output_ktx2_file();
  return (int32_t)output.size();
}

/* The last encode's file, valid until the next mt_encode or mt_release. */
EMSCRIPTEN_KEEPALIVE const uint8_t *mt_output(void) { return output.data(); }

/* basisu's clear() frees the block, so the worker holds no second copy of the file. */
EMSCRIPTEN_KEEPALIVE void mt_release(void) { output.clear(); }

} /* extern "C" */

/*
 * Stands in for upstream's JPEG decoder (encoder/jpgd.cpp), which this build leaves out. The
 * shim hands the encoder raw pixels and never loads an image file, so the decoder is never
 * called; but it is the only code in Basis Universal that uses setjmp, and Emscripten's setjmp
 * support imports trampolines that need its generated JavaScript. A JPEG now fails to load, as a
 * corrupt one would. Design: docs/design/own-basis-encoder-build.md, section 4.
 */
#include "encoder/jpgd.h"

namespace jpgd {

unsigned char *decompress_jpeg_image_from_memory(const unsigned char *, int, int *, int *, int *,
                                                 int, uint32_t) {
  return nullptr;
}

unsigned char *decompress_jpeg_image_from_file(const char *, int *, int *, int *, int, uint32_t) {
  return nullptr;
}

} // namespace jpgd

#!/usr/bin/env bash
# Builds wasm/basis-encoder/basis_encoder.wasm from a pinned Basis Universal commit in a pinned
# Emscripten image. How to rebuild and how to bump: wasm/basis-encoder/README.md.
# Design: docs/design/own-basis-encoder-build.md.
#
#   npm run basis:build                          build and replace wasm/basis-encoder/basis_encoder.wasm
#   npm run basis:build -- --check               build to out/basis-encoder/ and fail on any byte that differs
#   npm run basis:build -- --variant <name>      build an experiment to out/basis-encoder/<name>.wasm
#
# Without --inside it starts the image with Docker and runs itself inside it with --inside.
set -euo pipefail

# Upstream sources: one commit, fetched with git; the commit id is the hash of every file in it.
# The commit ktx2-encoder 0.6.0 was built from (2026-07-06), so #38 changed only who compiles it.
BASIS_COMMIT=1b33fd5098c6e7b58324146b8f5518cbb4cdfb72
BASIS_REPO=https://github.com/BinomialLLC/basis_universal.git

# The toolchain: the same image as wasm/xatlas/build.sh, one toolchain for both modules.
EMSDK_IMAGE=emscripten/emsdk:6.0.10@sha256:e077d54e2b8970575ebc4f185ac1de0b95c05f2b266134d4ba27449af7aebf65

COMMITTED=wasm/basis-encoder/basis_encoder.wasm
OUT=out/basis-encoder
SRC=$OUT/src

inside=0
check=0
variant=plain
while [ $# -gt 0 ]; do
  case "$1" in
    --inside) inside=1 ;;
    --check) check=1 ;;
    --variant) variant=$2; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$inside" = 0 ]; then
  cd "$(dirname "$0")/../.."
  args=(--inside --variant "$variant")
  [ "$check" = 1 ] && args+=(--check)
  # MSYS_NO_PATHCONV keeps Git Bash on Windows from rewriting /src; pwd -W gives Docker a Windows path there.
  here=$(pwd -W 2>/dev/null || pwd)
  MSYS_NO_PATHCONV=1 exec docker run --rm -v "$here:/src" -w /src "$EMSDK_IMAGE" \
    bash wasm/basis-encoder/build.sh "${args[@]}"
fi

# The sources: a shallow, blobless fetch of the pinned commit and a sparse checkout of the
# folders the encoder needs, into the git-ignored out/. Refuses any other commit.
# safe.directory: the image runs as root on a checkout someone else owns. autocrlf off: the same
# bytes on every machine.
src_git() { git -c safe.directory='*' -c core.autocrlf=false -C "$SRC" "$@"; }
if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$SRC"
  src_git init -q
  src_git remote add origin "$BASIS_REPO"
fi
src_git sparse-checkout set --no-cone /encoder/ /transcoder/ /zstd/ /LICENSE /NOTICE /LICENSES/
if [ "$(src_git rev-parse -q --verify HEAD 2>/dev/null || true)" != "$BASIS_COMMIT" ]; then
  src_git fetch -q --depth 1 --filter=blob:none origin "$BASIS_COMMIT"
  src_git -c advice.detachedHead=false checkout -q --force FETCH_HEAD
fi
if [ "$(src_git rev-parse HEAD)" != "$BASIS_COMMIT" ] || [ -n "$(src_git status --porcelain)" ]; then
  echo "$SRC is not a clean checkout of $BASIS_COMMIT; refusing to build." >&2
  exit 1
fi

# The flags, one concern per line (design note, section 4), from upstream's
# webgl/encoder/CMakeLists.txt at the pinned commit, Release configuration.
OPT=(-O3 -flto)                                     # upstream's -O3; -flto drops what our shim never reaches
ALIASING=(-fno-strict-aliasing)                     # upstream sets it for every file, C and C++
LANG_CPP=(-std=c++17)
DEFINES=(
  -DNDEBUG                                          # upstream's Release: asserts off
  -DBASISU_SUPPORT_ENCODING=1 -DBASISU_SUPPORT_SSE=0 -DBASISU_SUPPORT_ASTCENC=0
  -DBASISD_SUPPORT_KTX2_ZSTD=1 -DBASISD_SUPPORT_UASTC=1 -DBASISD_SUPPORT_BC7=1 -DBASISD_SUPPORT_XUASTC=1
  -DBASISD_SUPPORT_ATC=0 -DBASISD_SUPPORT_ASTC_HIGHER_OPAQUE_QUALITY=0 -DBASISD_SUPPORT_PVRTC2=0
  -DBASISD_SUPPORT_FXT1=0 -DBASISD_SUPPORT_ETC2_EAC_RG11=0
)
SIMD=()
case "$variant" in
  plain) ;;
  no-lto) OPT=(-O3) ;;
  simd) SIMD=(-msimd128) ;;
  slim)
    LANG_CPP+=(-fno-exceptions -fno-rtti)
    DEFINES=("${DEFINES[@]/-DBASISD_SUPPORT_BC7=1/-DBASISD_SUPPORT_BC7=0}")
    DEFINES=("${DEFINES[@]/-DBASISD_SUPPORT_XUASTC=1/-DBASISD_SUPPORT_XUASTC=0}")
    ;;
  *) echo "unknown variant: $variant" >&2; exit 2 ;;
esac
LINK=(
  -sSTANDALONE_WASM --no-entry                      # one .wasm, no generated JavaScript
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=128MB -sSTACK_SIZE=2MB   # upstream's values
  -sEXPORTED_FUNCTIONS=_malloc,_free                # the mt_* functions are kept by EMSCRIPTEN_KEEPALIVE
)

# Upstream's SRC_LIST minus webgl/transcoder/basis_wrappers.cpp (its embind wrapper, replaced by
# shim.cpp) and encoder/jpgd.cpp (the JPEG loader, the only user of setjmp, replaced by
# no-jpeg.cpp), plus zstd.c for Zstandard.
SOURCES=(
  transcoder/basisu_transcoder.cpp
  encoder/basisu_backend.cpp encoder/basisu_basis_file.cpp encoder/basisu_comp.cpp
  encoder/basisu_enc.cpp encoder/basisu_etc.cpp encoder/basisu_frontend.cpp
  encoder/basisu_gpu_texture.cpp encoder/basisu_pvrtc1_4.cpp encoder/basisu_resampler.cpp
  encoder/basisu_resample_filters.cpp encoder/basisu_ssim.cpp encoder/basisu_uastc_enc.cpp
  encoder/basisu_bc7e_scalar.cpp encoder/basisu_dds_export.cpp encoder/basisu_bc7enc.cpp
  encoder/basisu_kernels_sse.cpp encoder/basisu_opencl.cpp encoder/pvpngreader.cpp
  encoder/3rdparty/android_astc_decomp.cpp encoder/basisu_uastc_hdr_4x4_enc.cpp
  encoder/basisu_astc_hdr_6x6_enc.cpp encoder/basisu_astc_hdr_common.cpp
  encoder/basisu_astc_ldr_common.cpp encoder/basisu_astc_ldr_encode.cpp
  encoder/basisu_astc_ldr_fencode.cpp encoder/basisu_tinyexr.cpp encoder/basisu_xbc7_encode.cpp
)

OBJ=$OUT/obj/$variant
rm -rf "$OBJ"
mkdir -p "$OBJ"
objects=()
for file in "${SOURCES[@]}"; do
  object=$OBJ/$(basename "$file" .cpp).o
  em++ "${OPT[@]}" "${SIMD[@]}" "${ALIASING[@]}" "${LANG_CPP[@]}" "${DEFINES[@]}" -I"$SRC/transcoder" \
    -c "$SRC/$file" -o "$object"
  objects+=("$object")
done
emcc "${OPT[@]}" "${SIMD[@]}" "${ALIASING[@]}" "${DEFINES[@]}" -c "$SRC/zstd/zstd.c" -o "$OBJ/zstd.o"
em++ "${OPT[@]}" "${SIMD[@]}" "${ALIASING[@]}" "${LANG_CPP[@]}" "${DEFINES[@]}" -I"$SRC" -I"$SRC/transcoder" \
  -c wasm/basis-encoder/shim.cpp -o "$OBJ/shim.o"
em++ "${OPT[@]}" "${SIMD[@]}" "${ALIASING[@]}" "${LANG_CPP[@]}" "${DEFINES[@]}" -I"$SRC" -I"$SRC/transcoder" \
  -c wasm/basis-encoder/no-jpeg.cpp -o "$OBJ/no-jpeg.o"
objects+=("$OBJ/zstd.o" "$OBJ/shim.o" "$OBJ/no-jpeg.o")

if [ "$check" = 1 ] || [ "$variant" != plain ]; then
  target=$OUT/$variant.wasm
else
  target=$COMMITTED
fi
# em++ links libc++, which the encoder uses (std::string, operator new).
em++ "${OPT[@]}" "${SIMD[@]}" "${LINK[@]}" "${objects[@]}" -o "$target"
# The image runs as root: give the files back to whoever owns the checkout.
chown -R --reference=. "$OUT" "$target" 2>/dev/null || true
echo "$target: $(wc -c < "$target") bytes, sha256 $(sha256sum "$target" | cut -d' ' -f1)"

if [ "$check" = 1 ]; then
  if cmp "$target" "$COMMITTED"; then
    echo "Identical to $COMMITTED."
  else
    echo "$COMMITTED is not what the pinned build produces." >&2
    exit 1
  fi
fi

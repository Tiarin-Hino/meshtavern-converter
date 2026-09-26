#!/usr/bin/env bash
# Builds wasm/xatlas/xatlas.wasm from a pinned xatlas commit in a pinned Emscripten image.
# How to rebuild and how to bump: wasm/xatlas/README.md. Design: docs/design/own-xatlas-build.md.
#
#   npm run xatlas:build                          build and replace wasm/xatlas/xatlas.wasm
#   npm run xatlas:build -- --check               build to out/xatlas/ and fail on any byte that differs
#   npm run xatlas:build -- --variant <name>      build an experiment to out/xatlas/<name>.wasm
#
# Without --inside it starts the image with Docker and runs itself inside it with --inside.
set -euo pipefail

# Upstream sources: four files of one commit, each checked against its SHA-256 (recorded 2026-09-26).
XATLAS_COMMIT=f700c7790aaa030e794b52ba7791a05c085faf0c
XATLAS_URL=https://raw.githubusercontent.com/jpcy/xatlas/$XATLAS_COMMIT
XATLAS_SHA256_CPP=0ed0283aad005c94738cb0cc4612dba264379d29dea5b3c9b242f2d4752d5df4
XATLAS_SHA256_H=e7675335ad8ab1c1cc9060ad153cf6b8ba2ee914282044eb5f02c49590218fbd
XATLAS_SHA256_C_H=3aef0438ca395a7c4c215de9fe40460a4530d19654bd21a3f849c76775fbc972
XATLAS_SHA256_LICENSE=2c16d5b1c2808277fe975b4f70f0fd9afc9b3bcf04e6c676665a82cb2d5579e3

# The toolchain: Emscripten 6.0.10, pinned by the image's manifest digest (newest tag on 2026-09-21).
EMSDK_IMAGE=emscripten/emsdk:6.0.10@sha256:e077d54e2b8970575ebc4f185ac1de0b95c05f2b266134d4ba27449af7aebf65

# Initial WebAssembly heap in MB: Emscripten's default for the shipped build, a large one to try.
HEAP_INITIAL_MB=16
HEAP_LARGE_MB=256

COMMITTED=wasm/xatlas/xatlas.wasm
OUT=out/xatlas

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
    bash wasm/xatlas/build.sh "${args[@]}"
fi

fetch() { # <path in the repo> <sha256>
  local file=$OUT/src/$(basename "$1")
  if [ ! -f "$file" ] || [ "$(sha256sum "$file" | cut -d' ' -f1)" != "$2" ]; then
    curl -fsSL "$XATLAS_URL/$1" -o "$file"
  fi
  if [ "$(sha256sum "$file" | cut -d' ' -f1)" != "$2" ]; then
    echo "SHA-256 of $1 does not match the pinned one; refusing to build." >&2
    exit 1
  fi
}
mkdir -p "$OUT/src" "$OUT/obj"
fetch source/xatlas/xatlas.cpp "$XATLAS_SHA256_CPP"
fetch source/xatlas/xatlas.h "$XATLAS_SHA256_H"
fetch source/xatlas/xatlas_c.h "$XATLAS_SHA256_C_H"
fetch LICENSE "$XATLAS_SHA256_LICENSE"

# The flags, one concern per line (design note, section 3).
OPT=(-O2 -flto)                                     # as the package we replaced, so results compare
LANG_CPP=(-std=c++17 -fno-exceptions -fno-rtti)     # xatlas has no throw and no dynamic_cast
DEFINES=(-DXATLAS_C_API=1 -DXA_MULTITHREADED=0)     # the C API; no threads (GitHub Pages cannot enable them)
DEFINES+=(-DNDEBUG)                                 # xatlas's debug asserts off, as in the package we replaced
HEAP_MB=$HEAP_INITIAL_MB
SIMD=()
case "$variant" in
  plain) ;;
  simd) SIMD=(-msimd128) ;;
  heap) HEAP_MB=$HEAP_LARGE_MB ;;
  simd-heap) SIMD=(-msimd128); HEAP_MB=$HEAP_LARGE_MB ;;
  o3) OPT=(-O3 -flto) ;;
  *) echo "unknown variant: $variant" >&2; exit 2 ;;
esac
LINK=(
  -sSTANDALONE_WASM --no-entry                      # one .wasm, no generated JavaScript
  -sALLOW_MEMORY_GROWTH=1 "-sINITIAL_MEMORY=${HEAP_MB}MB"
  -sEXPORTED_FUNCTIONS=_malloc,_free                # the mt_* functions are kept by EMSCRIPTEN_KEEPALIVE
)

emcc "${OPT[@]}" "${SIMD[@]}" "${LANG_CPP[@]}" "${DEFINES[@]}" -c "$OUT/src/xatlas.cpp" -o "$OUT/obj/xatlas.o"
emcc "${OPT[@]}" "${SIMD[@]}" "${DEFINES[@]}" -I"$OUT/src" -c wasm/xatlas/shim.c -o "$OUT/obj/shim.o"

if [ "$check" = 1 ] || [ "$variant" != plain ]; then
  target=$OUT/$variant.wasm
else
  target=$COMMITTED
fi
emcc "${OPT[@]}" "${SIMD[@]}" "${LINK[@]}" "$OUT/obj/xatlas.o" "$OUT/obj/shim.o" -o "$target"
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

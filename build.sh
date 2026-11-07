#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (c) 2026 LAN (BI7KGI). GPL-3.0, inherited from SodaGray/apricot-sstv.
#
# Build the wasm module: decoder core + encoder core + the little libc shim.
# Needs clang with the wasm32 target and wasm-ld (brew install lld).
set -eu
cd "$(dirname "$0")"

CC=${CC:-clang}
OUT=www/sstv.wasm
mkdir -p www

# Apple clang ships the wasm backend; wasm-ld comes from `brew install lld`
WASMLD=$(command -v wasm-ld || true)
[ -z "$WASMLD" ] && [ -x tools/bin/wasm-ld ] && WASMLD=$PWD/tools/bin/wasm-ld
if [ -z "$WASMLD" ]; then
    for p in /opt/homebrew/opt/lld/bin/wasm-ld /usr/local/opt/lld/bin/wasm-ld; do
        [ -x "$p" ] && WASMLD=$p && break
    done
fi
if [ -z "$WASMLD" ]; then
    echo "wasm-ld not found -- run: brew install lld" >&2
    exit 1
fi

CFLAGS="-O2 -std=c11 -nostdlib -ffreestanding -fno-builtin -DNDEBUG \
        --target=wasm32 -Isrc -Isrc/wasm-include \
        -Wno-unused-parameter -Wno-unused-function -Wno-unused-variable"

echo "== compiling"
$CC $CFLAGS -c src/sstv_dsp.c  -o build_sstv_dsp.o
$CC $CFLAGS -c src/enc.c       -o build_enc.o
$CC $CFLAGS -c src/shim.c      -o build_shim.o
$CC $CFLAGS -c src/sstv_web.c  -o build_sstv_web.o

echo "== linking"
"$WASMLD" -o "$OUT" --no-entry --export-all --allow-undefined \
    --initial-memory=33554432 --max-memory=268435456 \
    --stack-first -z stack-size=1048576 \
    build_shim.o build_sstv_dsp.o build_enc.o build_sstv_web.o

rm -f build_*.o
ls -l "$OUT"
echo "== ok: $OUT"

# SSTV Tool Web

A slow-scan television (SSTV) tool that runs in the browser: **receive** (decode SSTV from a
recording or the microphone into pictures) and **generate** (turn a picture into SSTV audio, with
crop, rotate and text overlay).

Decoder and encoder are the same C core as the desktop tool, compiled to WebAssembly and run in
the page; picture editing is plain `<canvas>`. Nothing is uploaded — it all happens on your
machine.

[中文](README.md) · English

## Use it without building

Online: https://lan1081210.github.io/sstv-tool-web/

Single file: [`sstv-tool-web.html`](sstv-tool-web.html) (~85 KB). The wasm module is inlined as base64,
and so are the CSS and JS — no external requests, so you can download it, double-click, and go, or drop it
on any static host.

```bash
python3 scripts/bundle_single.py   # rebuild (reads www/, also refreshes docs/index.html)
```

Microphone input needs `https://` or `localhost`. Opened straight from disk (`file://`) the mic is blocked,
but decoding an audio file works fine.

## Copyright

© 2026 LAN (BI7KGI). This project — the WASM port, the JavaScript UI and the build script — is
released under **GPL-3.0**, because it links the decoder core and the encoder from
SodaGray/apricot-sstv (both GPL-3.0). Upstream copyright belongs to its authors; see `LICENSE`
and `NOTICE`.

    Copyright (C) 2026 LAN (BI7KGI)  ·  Licence GPL-3.0

## Building

You need `clang` (Apple's Command Line Tools already ship the wasm32 target) and `wasm-ld`:

```sh
brew install lld
./build.sh          # produces www/sstv.wasm
```

A prebuilt `www/sstv.wasm` is committed, so you only need this after changing the C core.

## Running locally

```sh
cd www && python3 -m http.server 8765
# open http://localhost:8765
```

Microphone input requires `https://` or `localhost` (browser secure-context rule); decoding files
works either way.

## Using it

**Receive**

- *Choose a recording* takes wav / mp3 / m4a / flac; decoded pictures line up on the right and can
  be saved as PNG.
- *Listen on the microphone* decodes live, drawing the picture line by line.
- Lock a single mode (no VIS wait), or tick *continuous* to decode frame after frame.
- *Scan the whole frame before ending* is on by default: dropouts leave white space, the picture
  only closes after the full frame.

**Generate**

- Pick a picture (or drag one in) → drag to reframe, scroll to zoom.
- Rotate 90°, flip horizontally / vertically, letterbox / crop-fill / stretch, text size, zoom,
  brightness, contrast.
- Text overlay with a 3×3 anchor grid.
- 14 modes (Robot 36/72, Martin M1/M2, Scottie S1/S2/DX, PD50–PD290).
- *Generate and play*, or *save as WAV*.

You can also pass material through the URL: `?audio=some-recording.wav`, `?image=some-picture.png`.

## Layout

    src/sstv_dsp.c   decoder core (upstream, unmodified)
    src/enc.c        encoder core (upstream host version, unmodified)
    src/shim.c       the little libc the wasm build needs: bump allocator, mem*,
                     maths forwarded to JavaScript's Math
    src/sstv_web.c   the C API the page calls (feed samples, fetch pictures, encode a WAV)
    www/             page, styles, scripts, and the built sstv.wasm
    test/check.js    headless Node check of the module (decode a WAV, encode a picture)
    build.sh         compile + link

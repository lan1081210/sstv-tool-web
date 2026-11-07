#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-only
 * Headless check of the wasm module: decode a WAV, encode a picture, compare.
 * Copyright (c) 2026 LAN (BI7KGI). GPL-3.0.
 *
 *   node test/check.js www/sstv.wasm www/test/Robot36.wav
 */
'use strict';
const fs = require('fs');
const path = require('path');

const wasmPath = process.argv[2] || 'www/sstv.wasm';
const wavPath = process.argv[3] || 'www/test/Robot36.wav';

const f32 = Math.fround;
const imports = {
  math: {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, atan2: Math.atan2,
    exp: Math.exp, log: Math.log, log10: Math.log10, sqrt: Math.sqrt, fabs: Math.abs,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
    pow: Math.pow, fmod: (a, b) => a % b,
    sinf: (x) => f32(Math.sin(x)), cosf: (x) => f32(Math.cos(x)), tanf: (x) => f32(Math.tan(x)),
    atanf: (x) => f32(Math.atan(x)), atan2f: (y, x) => f32(Math.atan2(y, x)),
    expf: (x) => f32(Math.exp(x)), logf: (x) => f32(Math.log(x)), log10f: (x) => f32(Math.log10(x)),
    sqrtf: (x) => f32(Math.sqrt(x)), fabsf: (x) => f32(Math.abs(x)), floorf: (x) => f32(Math.floor(x)),
    ceilf: (x) => f32(Math.ceil(x)), roundf: (x) => f32(Math.round(x)),
    powf: (a, b) => f32(Math.pow(a, b)), fmodf: (a, b) => f32(a % b),
  },
};

function readWav(p) {
  const b = fs.readFileSync(p);
  let i = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (i + 8 <= b.length) {
    const id = b.toString('ascii', i, i + 4);
    const sz = b.readUInt32LE(i + 4);
    if (id === 'fmt ') {
      fmt = { ch: b.readUInt16LE(i + 10), rate: b.readUInt32LE(i + 12), bits: b.readUInt16LE(i + 22) };
    } else if (id === 'data') { dataOff = i + 8; dataLen = sz; break; }
    i += 8 + sz + (sz & 1);
  }
  if (!fmt || dataOff < 0) throw new Error('bad wav');
  const n = dataLen / 2;
  const out = new Int16Array(n);
  for (let k = 0; k < n; k++) out[k] = b.readInt16LE(dataOff + k * 2);
  return { samples: out, rate: fmt.rate, ch: fmt.ch };
}

(async () => {
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  const M = instance.exports;
  const mem = () => new Uint8Array(M.memory.buffer);

  const modes = [];
  for (let v = 1; v < 128; v++) {
    const p = M.malloc(8);
    if (M.web_mode_size(v, p, p + 4)) modes.push(v);
    M.free(p);
  }
  console.log(`wasm ok · ${(bytes.length / 1024).toFixed(0)} KiB · encoder modes ${modes.length}`);

  /* ---- decode a recording ---- */
  const { samples, rate } = readWav(wavPath);
  const scratch = M.malloc(1 << 16 << 1);
  M.web_new(rate);
  M.web_set_no_timeout(1);
  let chunk = 4096;
  for (let off = 0; off < samples.length; off += chunk) {
    const n = Math.min(chunk, samples.length - off);
    mem().set(new Uint8Array(samples.buffer, samples.byteOffset + off * 2, n * 2), scratch);
    M.web_feed(scratch, n);
  }
  const st = M.malloc(17 * 4);
  M.web_status(st);
  const dvNow = () => new DataView(M.memory.buffer);
  const s = [];
  for (let i = 0; i < 17; i++) s.push(dvNow().getInt32(st + i * 4, true));
  const images = s[16];
  console.log(`decode: vis ${s[6]} · saved ${images} · syncs ${s[12]}/${s[13]} · ppm ${s[10]}`);

  if (images > 0) {
    const p = M.malloc(8);
    const ptr = M.web_saved(0, p, p + 4);
    const w = dvNow().getInt32(p, true), h = dvNow().getInt32(p + 4, true);
    console.log(`first picture: ${w}x${h} @ ${ptr}`);
  }

  /* ---- encode a synthetic picture ---- */
  const vis = 8, p2 = M.malloc(8);
  M.web_mode_size(vis, p2, p2 + 4);
  const w = dvNow().getInt32(p2, true), h = dvNow().getInt32(p2 + 4, true);
  const rgb = M.malloc(w * h * 3);
  const m = mem();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = rgb + (y * w + x) * 3;
      m[o] = (x * 255 / w) | 0; m[o + 1] = (y * 255 / h) | 0; m[o + 2] = 128;
    }
  }
  const frames = M.web_encode(rgb, vis, 44100, 0.7, 0.5, 12000);
  const len = M.web_wav_file(44100);
  const wav = Buffer.from(new Uint8Array(M.memory.buffer, M.web_wav_bytes(), len));
  const out = path.join(path.dirname(wavPath), 'encoded-check.wav');
  fs.writeFileSync(out, wav);
  let peak = 0;
  for (let i = 44; i + 1 < wav.length; i += 2) {
    const v = Math.abs(wav.readInt16LE(i));
    if (v > peak) peak = v;
  }
  console.log(`encode: ${w}x${h} · ${frames} frames (${(frames / 44100).toFixed(1)} s) · peak ${peak} -> ${out}`);

  const ok = images > 0 && frames > 0 && peak > 3000;
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });

/* SPDX-License-Identifier: GPL-3.0-only
 * SSTV Tool Web — app.js
 * Copyright (c) 2026 LAN (BI7KGI). GPL-3.0, inherited from SodaGray/apricot-sstv.
 *
 * The decoder and encoder run in WebAssembly (www/sstv.wasm); this file is the
 * UI glue: audio in, canvas out, and the picture editing for the transmit side.
 */
'use strict';

/* ------------------------------------------------------------------ wasm */

let M = null;            // wasm exports
let scratch = 0;         // s16 buffer inside wasm memory
const SCRATCH_SAMPLES = 1 << 16;

const mem = () => new DataView(M.memory.buffer);
const bytes = () => new Uint8Array(M.memory.buffer);

async function loadWasm() {
  const res = await fetch('sstv.wasm');
  if (!res.ok) throw new Error('sstv.wasm 没找到，先跑 ./build.sh');
  const buf = await res.arrayBuffer();
  const f = (x) => Math.fround(x);
  const math = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan,
    atan2: Math.atan2, exp: Math.exp, log: Math.log, log10: Math.log10,
    sqrt: Math.sqrt, fabs: Math.abs, floor: Math.floor, ceil: Math.ceil,
    round: Math.round, trunc: Math.trunc, pow: Math.pow, fmod: (a, b) => a % b,
    sinf: (x) => f(Math.sin(x)), cosf: (x) => f(Math.cos(x)), tanf: (x) => f(Math.tan(x)),
    atanf: (x) => f(Math.atan(x)), atan2f: (y, x) => f(Math.atan2(y, x)),
    expf: (x) => f(Math.exp(x)), logf: (x) => f(Math.log(x)), log10f: (x) => f(Math.log10(x)),
    sqrtf: (x) => f(Math.sqrt(x)), fabsf: (x) => f(Math.abs(x)), floorf: (x) => f(Math.floor(x)),
    ceilf: (x) => f(Math.ceil(x)), roundf: (x) => f(Math.round(x)), powf: (a, b) => f(Math.pow(a, b)),
    fmodf: (a, b) => f(a % b),
  };
  const { instance } = await WebAssembly.instantiate(buf, { math });
  M = instance.exports;
  scratch = M.malloc(SCRATCH_SAMPLES * 2);
  if (!scratch) throw new Error('wasm 内存不够');
  fillModeSelects();
}

/* mode table comes from the cores themselves, not a hard-coded list */
function modes() {
  const out = [];
  for (let v = 1; v < 128; v++) {
    const w = M.web_mode_size(v, 0, 0);           // 1 if the encoder knows it
    if (!w) continue;
    const namePtr = M.web_enc_name(v);
    out.push({ vis: v, name: cstr(namePtr), enc: true });
  }
  return out;
}

function decodeModes() {                          // VIS codes the receiver decodes
  const out = [];
  for (let v = 1; v < 128; v++) if (M.web_mode_supported(v)) out.push({ vis: v, name: cstr(M.web_mode_name(v)) });
  return out;
}

function cstr(p) {
  const m = bytes();
  let s = '';
  for (let i = 0; m[p + i]; i++) s += String.fromCharCode(m[p + i]);
  return s;
}

function fillModeSelects() {
  const rx = document.getElementById('rx-mode');
  for (const m of decodeModes()) rx.add(new Option(m.name, String(m.vis)));
  const tx = document.getElementById('tx-mode');
  for (const m of modes()) tx.add(new Option(m.name, String(m.vis)));
  tx.value = '8';                                  // Robot 36, like the web encoders
}

/* ----------------------------------------------------------------- tabs */

for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + b.dataset.tab));
  });
}

/* ------------------------------------------------------------- receiving */

const rxCanvas = document.getElementById('rx-canvas');
const rxStatus = document.getElementById('rx-status');
const rxSaved = document.getElementById('rx-saved');
const rxProgress = document.getElementById('rx-progress');

let rxRunning = false;
let rxTotal = 0, rxDone = 0;
let savedShown = 0;

function startReceiver(rate) {
  if (!M.web_new(rate)) { rxHint('解码器起不来'); return false; }
  M.web_set_mode_lock(parseInt(document.getElementById('rx-mode').value, 10) || 0);
  M.web_set_no_timeout(document.getElementById('rx-notimeout').checked ? 1 : 0);
  M.web_set_lost(parseFloat(document.getElementById('rx-lost').value) || 20);
  savedShown = 0;
  rxSaved.innerHTML = '';
  rxRunning = true;
  return true;
}

function feedSamples(i16) {
  // raw bytes, not values: Uint8Array.set(Int16Array) would truncate each sample
  let off = 0;
  while (off < i16.length) {
    const n = Math.min(SCRATCH_SAMPLES, i16.length - off);
    const src = new Uint8Array(i16.buffer, i16.byteOffset + off * 2, n * 2);
    bytes().set(src, scratch);                          // bytes() re-reads after growth
    M.web_feed(scratch, n);
    off += n;
  }
}

const STATUS_NAMES = ['state', 'w', 'h', 'line', 'startKind', 'endKind', 'vis', 'visOk',
  'tone', 'offset', 'ppm', 'ppmValid', 'syncGood', 'syncSeen', 'images', 'relocks', 'saved'];

function readStatus() {
  const p = M.malloc(17 * 4);
  M.web_status(p);
  const dv = new DataView(M.memory.buffer);
  const o = {};
  STATUS_NAMES.forEach((n, i) => { o[n] = dv.getInt32(p + i * 4, true); });
  return o;
}

/* web_image needs the size out-params too, so wrap it */
function liveImage() {
  const p = M.malloc(8);
  const ptr = M.web_image(p, p + 4);
  const dv = new DataView(M.memory.buffer);
  const w = dv.getInt32(p, true), h = dv.getInt32(p + 4, true);
  M.free(p);
  return { ptr, w, h };
}

function paint565(canvas, ptr, w, h) {
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const img = canvas.getContext('2d').createImageData(w, h);
  const src = new Uint16Array(M.memory.buffer, ptr, w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const v = src[i];
    const r = ((v >> 11) & 0x1f), g = ((v >> 5) & 0x3f), b = (v & 0x1f);
    img.data[j] = (r << 3) | (r >> 2);
    img.data[j + 1] = (g << 2) | (g >> 4);
    img.data[j + 2] = (b << 3) | (b >> 2);
    img.data[j + 3] = 255;
  }
  canvas.getContext('2d').putImageData(img, 0, 0);
}

function showSaved() {
  const st = readStatus();
  while (savedShown < st.saved) {
    const p = M.malloc(8);
    const ptr = M.web_saved(savedShown, p, p + 4);
    const dv = new DataView(M.memory.buffer);
    const w = dv.getInt32(p, true), h = dv.getInt32(p + 4, true);
    M.free(p);
    if (ptr && w && h) {
      const c = document.createElement('canvas');
      paint565(c, ptr, w, h);
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png');
      a.download = `sstv-${savedShown + 1}.png`;
      a.appendChild(c);
      a.className = 'shot';
      rxSaved.appendChild(a);
    }
    savedShown++;
  }
}

function statusLine(st) {
  const mode = st.vis >= 0 ? (cstr(M.web_mode_name(st.vis)) || ('VIS ' + st.vis)) : '—';
  const state = st.state ? `接收中 ${st.line}/${st.h || '?'} 行` : '待机';
  return `${mode} · ${state} · 音调 ${st.tone} Hz · 偏移 ${st.offset >= 0 ? '+' : ''}${st.offset} Hz · ` +
    `${st.ppmValid ? '时钟 ' + st.ppm + ' ppm' : '时钟 (先验)'} · 同步 ${st.syncGood}/${st.syncSeen}`;
}

document.getElementById('rx-file').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  rxHint('解码 ' + f.name + ' …');
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await ctx.decodeAudioData(await f.arrayBuffer());
  await ctx.close();

  const rate = buf.sampleRate;
  const ch = buf.getChannelData(0);
  const i16 = new Int16Array(ch.length);
  for (let i = 0; i < ch.length; i++) {
    const v = Math.max(-1, Math.min(1, ch[i]));
    i16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  if (!startReceiver(rate)) return;
  rxTotal = i16.length;
  rxDone = 0;
  const CH = 4096;
  for (let off = 0; off < i16.length; off += CH * 64) {
    const part = i16.subarray(off, Math.min(i16.length, off + CH * 64));
    feedSamples(part);
    rxDone = Math.min(i16.length, off + CH * 64);
    const st = readStatus();
    const li = liveImage();
    if (li.ptr) paint565(rxCanvas, li.ptr, li.w, li.h);
    rxStatus.textContent = statusLine(st);
    rxProgress.style.width = (100 * rxDone / rxTotal).toFixed(1) + '%';
    showSaved();
    await new Promise((r) => setTimeout(r, 0));    // keep the page alive
  }
  rxRunning = false;
  rxHint(`解完 ${f.name}：${savedShown} 张图`);
});

/* ------------------------------------------------------------ microphone */

let micCtx = null, micNode = null, micStream = null;

document.getElementById('rx-mic').addEventListener('click', async () => {
  if (micCtx) return;
  const btn = document.getElementById('rx-mic');
  btn.disabled = true;
  document.getElementById('rx-stop').disabled = false;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    micCtx = new (window.AudioContext || window.webkitAudioContext)();
    let rate = micCtx.sampleRate;
    if (!startReceiver(rate)) return;
    rxHint('正在听 ' + rate + ' Hz …');
    const src = micCtx.createMediaStreamSource(micStream);
    micNode = micCtx.createScriptProcessor(4096, 1, 1);
    micNode.onaudioprocess = (ev) => {
      const ch = ev.inputBuffer.getChannelData(0);
      const i16 = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        const v = Math.max(-1, Math.min(1, ch[i]));
        i16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      feedSamples(i16);
      const st = readStatus();
      const li = liveImage();
      if (li.ptr) paint565(rxCanvas, li.ptr, li.w, li.h);
      rxStatus.textContent = statusLine(st);
      showSaved();
    };
    src.connect(micNode);
    micNode.connect(micCtx.destination);          // keeps the node running
  } catch (err) {
    rxHint('麦克风打不开：' + err.message + '（需要 https 或 localhost）');
    btn.disabled = false;
  }
});

document.getElementById('rx-stop').addEventListener('click', () => {
  if (micNode) { micNode.disconnect(); micNode = null; }
  if (micCtx) { micCtx.close(); micCtx = null; }
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  document.getElementById('rx-mic').disabled = false;
  document.getElementById('rx-stop').disabled = true;
  rxHint('已停止收听');
});

function rxHint(t) { document.getElementById('rx-hint').textContent = t; }

/* -------------------------------------------------------------- generate */

const txCanvas = document.getElementById('tx-canvas');
const txCtx = txCanvas.getContext('2d');
const txInfo = document.getElementById('tx-info');
const txAudio = document.getElementById('tx-audio');

const E = { img: null, rot: 0, flipH: false, flipV: false, panX: 0, panY: 0,
            zoom: 1, bright: 0, contrast: 1, text: '', textPos: 5, scale: 1 };

function modeSize() {
  const vis = parseInt(document.getElementById('tx-mode').value, 10) || 8;
  const p = M.malloc(8);
  M.web_mode_size(vis, p, p + 4);
  const dv = new DataView(M.memory.buffer);
  const w = dv.getInt32(p, true), h = dv.getInt32(p + 4, true);
  M.free(p);
  return { vis, w, h };
}

function drawPreview() {
  const { w, h } = modeSize();
  if (txCanvas.width !== w || txCanvas.height !== h) { txCanvas.width = w; txCanvas.height = h; }
  txCtx.fillStyle = '#000';
  txCtx.fillRect(0, 0, w, h);
  if (E.img) {
    const fit = parseInt(document.getElementById('tx-fit').value, 10);
    const swap = E.rot === 90 || E.rot === 270;
    const rw = swap ? E.img.height : E.img.width;
    const rh = swap ? E.img.width : E.img.height;
    let sc = fit === 2 ? 1 : fit === 1 ? Math.max(w / rw, h / rh) : Math.min(w / rw, h / rh);
    sc *= E.zoom;
    const dw = E.img.width * sc, dh = E.img.height * sc;
    const slackX = Math.max(0, (dw - w) / 2), slackY = Math.max(0, (dh - h) / 2);
    txCtx.save();
    txCtx.beginPath(); txCtx.rect(0, 0, w, h); txCtx.clip();
    txCtx.translate(w / 2 + E.panX * slackX, h / 2 + E.panY * slackY);
    txCtx.rotate(E.rot * Math.PI / 180);
    txCtx.scale(E.flipH ? -1 : 1, E.flipV ? -1 : 1);
    if (fit === 2) {
      const fw = swap ? h : w, fh = swap ? w : h;
      txCtx.drawImage(E.img, -fw / 2, -fh / 2, fw, fh);
    } else {
      txCtx.drawImage(E.img, -dw / 2, -dh / 2, dw, dh);
    }
    txCtx.restore();

    if (E.bright !== 0 || E.contrast !== 1) {
      const d = txCtx.getImageData(0, 0, w, h);
      const lut = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        let v = (i / 255 - 0.5) * E.contrast + 0.5 + E.bright;
        lut[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
      for (let i = 0; i < d.data.length; i += 4) {
        d.data[i] = lut[d.data[i]]; d.data[i + 1] = lut[d.data[i + 1]]; d.data[i + 2] = lut[d.data[i + 2]];
      }
      txCtx.putImageData(d, 0, 0);
    }

    if (E.text.trim()) {
      const size = Math.max(7, (h / 12) * E.scale);
      txCtx.font = `bold ${Math.round(size)}px "PingFang SC", "Helvetica Neue", sans-serif`;
      txCtx.textBaseline = 'alphabetic';
      const tw = txCtx.measureText(E.text).width;
      const m = h / 40;
      const col = (E.textPos - 1) % 3, row = Math.floor((E.textPos - 1) / 3);
      const x = col === 0 ? m : col === 1 ? (w - tw) / 2 : w - m - tw;
      const y = row === 0 ? h - m : row === 1 ? (h + size) / 2 : m + size;
      txCtx.fillStyle = 'rgba(0,0,0,0.85)';
      txCtx.fillText(E.text, x + Math.max(1, size / 16), y + Math.max(1, size / 16));
      txCtx.fillStyle = 'rgba(255,255,255,0.95)';
      txCtx.fillText(E.text, x, y);
    }
  }
  const m = M.web_enc_name(modeSize().vis);
  txInfo.textContent = E.img
    ? `${cstr(m)} · ${w}×${h} · 缩放 ${Math.round(E.zoom * 100)}% · ${E.img.width}×${E.img.height} 原图`
    : '选一张图开始（也可以把图拖进来）';
}

document.getElementById('tx-file').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => { E.img = img; E.panX = E.panY = 0; drawPreview(); };
  img.src = URL.createObjectURL(f);
});

for (const id of ['tx-mode', 'tx-fit', 'tx-scale', 'tx-zoom', 'tx-bright', 'tx-contrast', 'tx-text', 'tx-pos']) {
  document.getElementById(id).addEventListener('input', () => {
    E.zoom = parseFloat(document.getElementById('tx-zoom').value);
    E.bright = parseFloat(document.getElementById('tx-bright').value);
    E.contrast = parseFloat(document.getElementById('tx-contrast').value);
    E.scale = parseFloat(document.getElementById('tx-scale').value);
    E.text = document.getElementById('tx-text').value;
    E.textPos = parseInt(document.getElementById('tx-pos').value, 10);
    drawPreview();
  });
}

document.getElementById('tx-rot').addEventListener('click', () => { E.rot = (E.rot + 90) % 360; drawPreview(); });
document.getElementById('tx-fliph').addEventListener('click', () => { E.flipH = !E.flipH; drawPreview(); });
document.getElementById('tx-flipv').addEventListener('click', () => { E.flipV = !E.flipV; drawPreview(); });
document.getElementById('tx-reset').addEventListener('click', () => {
  Object.assign(E, { rot: 0, flipH: false, flipV: false, panX: 0, panY: 0, zoom: 1, bright: 0, contrast: 1, scale: 1 });
  document.getElementById('tx-zoom').value = 1;
  document.getElementById('tx-bright').value = 0;
  document.getElementById('tx-contrast').value = 1;
  document.getElementById('tx-scale').value = 1;
  drawPreview();
});

/* drag to pan, wheel to zoom */
let drag = null;
txCanvas.addEventListener('mousedown', (e) => {
  if (!E.img) return;
  drag = { x: e.offsetX, y: e.offsetY, px: E.panX, py: E.panY };
  txCanvas.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const r = txCanvas.getBoundingClientRect();
  const { w, h } = modeSize();
  const sc = r.width / w;
  E.panX = drag.px - (e.clientX - r.left - drag.x) / (w * sc);
  E.panY = drag.py - (e.clientY - r.top - drag.y) / (h * sc);
  E.panX = Math.max(-1, Math.min(1, E.panX));
  E.panY = Math.max(-1, Math.min(1, E.panY));
  drawPreview();
});
window.addEventListener('mouseup', () => { drag = null; txCanvas.style.cursor = 'grab'; });
txCanvas.addEventListener('wheel', (e) => {
  if (!E.img) return;
  e.preventDefault();
  E.zoom = Math.max(1, Math.min(3, E.zoom - e.deltaY * 0.002));
  document.getElementById('tx-zoom').value = E.zoom;
  drawPreview();
}, { passive: false });

/* drag & drop a picture */
for (const el of [document.getElementById('panel-tx'), txCanvas]) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => { E.img = img; E.panX = E.panY = 0; drawPreview(); };
    img.src = URL.createObjectURL(f);
  });
}

function encodeNow() {
  const { vis, w, h } = modeSize();
  const d = txCtx.getImageData(0, 0, w, h).data;
  const rgb = M.malloc(w * h * 3);
  const m = bytes();
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    m[rgb + i * 3] = d[j];
    m[rgb + i * 3 + 1] = d[j + 1];
    m[rgb + i * 3 + 2] = d[j + 2];
  }
  const frames = M.web_encode(rgb, vis, 44100, 0.7, 0.5, 12000);
  M.free(rgb);
  if (!frames) throw new Error('编码失败');
  const len = M.web_wav_file(44100);
  const ptr = M.web_wav_bytes();
  const blob = new Blob([new Uint8Array(M.memory.buffer, ptr, len)], { type: 'audio/wav' });
  return { blob, seconds: frames / 44100, vis };
}

function makeWav(play) {
  if (!E.img) { txInfo.textContent = '先选一张图片'; return; }
  try {
    const { blob, seconds, vis } = encodeNow();
    const url = URL.createObjectURL(blob);
    const name = `sstv-${cstr(M.web_enc_name(vis))}-${Date.now()}.wav`;
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    txAudio.src = url;
    txAudio.style.display = 'block';
    if (play) txAudio.play();
    txInfo.textContent = `${cstr(M.web_enc_name(vis))} · ${seconds.toFixed(1)} 秒 · 已生成 ${name}`;
    document.getElementById('tx-stop').disabled = false;
  } catch (err) {
    txInfo.textContent = '出错了：' + err.message;
  }
}

document.getElementById('tx-make').addEventListener('click', () => makeWav(true));
document.getElementById('tx-save').addEventListener('click', () => makeWav(false));
document.getElementById('tx-stop').addEventListener('click', () => {
  txAudio.pause();
  txAudio.currentTime = 0;
  document.getElementById('tx-stop').disabled = true;
});

/* ---------------------------------------------------------------- start */

async function loadFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ': ' + res.status);
  return res.blob();
}

loadWasm().then(async () => {
  drawPreview();
  rxStatus.textContent = '待机 · 选一段录音，或者点「从麦克风听」';

  const q = new URLSearchParams(location.search);
  if (q.has('audio')) {
    try {
      const blob = await loadFromUrl(q.get('audio'));
      const file = new File([blob], q.get('audio').split('/').pop(), { type: blob.type || 'audio/wav' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById('rx-file');
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    } catch (e) { rxHint('音频载入失败：' + e.message); }
  }
  if (q.has('image')) {
    document.querySelector('.tabs button[data-tab=tx]').click();
    const img = new Image();
    img.onload = () => { E.img = img; drawPreview(); };
    img.src = q.get('image');
  }
}).catch((e) => {
  document.body.insertAdjacentHTML('afterbegin',
    `<div class="error">WebAssembly 加载失败：${e.message}</div>`);
});

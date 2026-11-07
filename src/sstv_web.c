/* SPDX-License-Identifier: GPL-3.0-only */
/* sstv_web.c -- the C surface the web page talks to. Both cores (decoder and
 * encoder) run here; the picture editing (crop, rotate, caption) happens on a
 * <canvas> in JS, which hands over raw RGB just before encoding.
 *
 * Copyright (c) 2026 LAN (BI7KGI). GPL-3.0, inherited from SodaGray/apricot-sstv.
 */
#include "sstv_dsp.h"
#include "enc.h"

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define MAX_SAVED 32

static SstvRx *g_rx = 0;
static int g_prev_state = SSTV_IDLE;
static int g_prev_vis = -1;
static int g_prev_relocks = 0;

static uint16_t *g_saved[MAX_SAVED];
static int g_sw[MAX_SAVED], g_sh[MAX_SAVED];
static int g_saved_n = 0;

int web_version(void) { return 1; }

/* ------------------------------------------------------------------ decode */

int web_new(int rate)
{
    if (g_rx) { sstv_free(g_rx); g_rx = 0; }
    while (g_saved_n > 0) { g_saved_n--; }
    g_rx = sstv_new(rate);
    if (!g_rx) return 0;
    {
        SstvStatus st;
        sstv_status(g_rx, &st);
        g_prev_state = st.state;
        g_prev_vis = st.last_vis;
        g_prev_relocks = st.relocks;
    }
    return 1;
}

void web_set_lost(double vis_s)   { sstv_set_lost_seconds(vis_s, vis_s / 2.0); }
void web_set_no_timeout(int on)   { sstv_set_no_timeout(on); }
void web_set_mode_lock(int vis)   { sstv_set_mode_lock(vis); }
void web_set_autosync(int on)     { if (g_rx) sstv_set_autosync(g_rx, on); }

static void save_current(void)
{
    int w = 0, h = 0;
    const uint16_t *px = sstv_image(g_rx, &w, &h);
    if (!px || w <= 0 || h <= 0 || g_saved_n >= MAX_SAVED) return;
    uint16_t *copy = malloc((size_t)w * (size_t)h * sizeof(uint16_t));
    if (!copy) return;
    memcpy(copy, px, (size_t)w * (size_t)h * sizeof(uint16_t));
    g_saved[g_saved_n] = copy;
    g_sw[g_saved_n] = w;
    g_sh[g_saved_n] = h;
    g_saved_n++;
}

/* Feed mono s16 samples. Returns a bitmask of what just happened:
 *   1 = a VIS was read, 2 = a picture started, 4 = a picture ended. */
int web_feed(const int16_t *x, int n)
{
    if (!g_rx || n <= 0) return 0;
    sstv_feed(g_rx, x, n, 1);
    SstvStatus st;
    sstv_status(g_rx, &st);
    int events = 0;
    if (st.last_vis != g_prev_vis) events |= 1;
    if (st.state == SSTV_RX && g_prev_state != SSTV_RX) events |= 2;
    if (st.state != SSTV_RX && g_prev_state == SSTV_RX) { save_current(); events |= 4; }
    if (st.relocks > g_prev_relocks) events |= 8;
    g_prev_state = st.state;
    g_prev_vis = st.last_vis;
    g_prev_relocks = st.relocks;
    return events;
}

/* Status as a flat int array, so JS needs one call per frame:
 *   0 state, 1 width, 2 height, 3 line, 4 start_kind, 5 end_kind, 6 last_vis,
 *   7 last_vis_ok, 8 tone_hz, 9 offset_hz, 10 ppm, 11 ppm_valid,
 *   12 sync_good, 13 sync_seen, 14 images, 15 relocks, 16 saved */
void web_status(int *out)
{
    if (!g_rx) { for (int i = 0; i < 17; i++) out[i] = 0; return; }
    SstvStatus st;
    sstv_status(g_rx, &st);
    out[0] = st.state; out[1] = st.width; out[2] = st.height; out[3] = st.line;
    out[4] = st.start_kind; out[5] = st.end_kind; out[6] = st.last_vis;
    out[7] = st.last_vis_ok; out[8] = st.tone_hz; out[9] = st.offset_hz;
    out[10] = st.ppm; out[11] = st.ppm_valid; out[12] = st.sync_good;
    out[13] = st.sync_seen; out[14] = (int)st.images; out[15] = st.relocks;
    out[16] = g_saved_n;
}

const uint16_t *web_image(int *w, int *h)
{
    if (!g_rx) { *w = *h = 0; return 0; }
    return sstv_image(g_rx, w, h);
}

const uint16_t *web_saved(int idx, int *w, int *h)
{
    if (idx < 0 || idx >= g_saved_n) { *w = *h = 0; return 0; }
    *w = g_sw[idx]; *h = g_sh[idx];
    return g_saved[idx];
}

const char *web_mode_name(int vis) { return sstv_vis_name(vis); }
int web_mode_supported(int vis) { return sstv_vis_supported(vis); }

/* ------------------------------------------------------------------ encode */

static int16_t *g_wav = 0;
static long g_wav_n = 0;

int web_mode_size(int vis, int *w, int *h) { return enc_mode_size(vis, w, h); }
const char *web_enc_name(int vis) { return enc_mode_name(vis); }

/* rgb: the mode's picture, w*h*3 bytes, top row first. */
int web_encode(const uint8_t *rgb, int vis, int rate, double lead, double tail, double amplitude)
{
    if (g_wav) { g_wav = 0; }
    EncOpts o;
    enc_default_opts(&o);
    o.mode = vis;
    o.vis_code = vis;
    o.rate = rate;
    o.amplitude = amplitude > 0 ? amplitude : 12000.0;
    o.lead_s = lead >= 0 ? lead : 0.7;
    o.tail_s = tail >= 0 ? tail : 0.5;
    o.lines = 0;
    long n = 0;
    g_wav = enc_encode(rgb, &o, &n);
    g_wav_n = g_wav ? n : 0;
    return (int)g_wav_n;
}

const int16_t *web_wav(void) { return g_wav; }

/* s16 mono -> 16-bit PCM WAV in a buffer JS can copy out */
static uint8_t *g_wavfile = 0;
static int g_wavfile_n = 0;

static void put32(uint8_t *p, uint32_t v) { p[0] = v & 0xff; p[1] = (v >> 8) & 0xff; p[2] = (v >> 16) & 0xff; p[3] = (v >> 24) & 0xff; }
static void put16(uint8_t *p, uint16_t v) { p[0] = v & 0xff; p[1] = (v >> 8) & 0xff; }

int web_wav_file(int rate)
{
    if (!g_wav || g_wav_n <= 0) return 0;
    int bytes = (int)g_wav_n * 2;
    g_wavfile = malloc((size_t)bytes + 48u);
    if (!g_wavfile) return 0;
    uint8_t *p = g_wavfile;
    memcpy(p, "RIFF", 4); put32(p + 4, (uint32_t)(36 + bytes));
    memcpy(p + 8, "WAVEfmt ", 8); put32(p + 16, 16); put16(p + 20, 1); put16(p + 22, 1);
    put32(p + 24, (uint32_t)rate); put32(p + 28, (uint32_t)rate * 2u);
    put16(p + 32, 2); put16(p + 34, 16);
    memcpy(p + 36, "data", 4); put32(p + 40, (uint32_t)bytes);
    memcpy(p + 44, g_wav, (size_t)bytes);
    g_wavfile_n = bytes + 44;
    return g_wavfile_n;
}

const uint8_t *web_wav_bytes(void) { return g_wavfile; }

/* SPDX-License-Identifier: GPL-3.0-only */
/* shim.c -- the little bit of libc the SSTV cores need, for a freestanding
 * wasm32 build: a bump allocator over the module's memory, mem* primitives,
 * and maths routed to the browser's Math object (imports from JS).
 *
 * Copyright (c) 2026 LAN (BI7KGI). GPL-3.0, inherited from SodaGray/apricot-sstv. */
#include <stddef.h>
#include <stdint.h>

extern unsigned char __heap_base;

static uintptr_t g_top = 0;
static uintptr_t g_end = 0;

void *memcpy(void *d, const void *s, size_t n);
void *memset(void *d, int c, size_t n);

#define WASM_PAGE 65536u

static inline int wasm_grow(int pages) { return __builtin_wasm_memory_grow(0, pages); }
static inline int wasm_size(void) { return __builtin_wasm_memory_size(0); }

static void heap_init(void)
{
    if (g_top) return;
    g_top = ((uintptr_t)&__heap_base + 15u) & ~(uintptr_t)15u;
    g_end = (uintptr_t)wasm_size() * WASM_PAGE;
}

typedef struct { size_t size; size_t spare; } hdr_t;

void *malloc(size_t n)
{
    heap_init();
    size_t total = (n + sizeof(hdr_t) + 15u) & ~(size_t)15u;
    while (g_top + total > g_end) {
        if (wasm_grow(16) < 0) return 0;
        g_end = (uintptr_t)wasm_size() * WASM_PAGE;
    }
    hdr_t *h = (hdr_t *)g_top;
    h->size = n;
    h->spare = 0;
    g_top += total;
    return (void *)(h + 1);
}

void free(void *p) { (void)p; }

void *realloc(void *p, size_t n)
{
    if (!p) return malloc(n);
    hdr_t *h = ((hdr_t *)p) - 1;
    if (h->size >= n) return p;
    void *q = malloc(n);
    if (!q) return 0;
    memcpy(q, p, h->size);
    return q;
}

void *calloc(size_t nm, size_t sz)
{
    size_t n = nm * sz;
    void *p = malloc(n);
    if (p) memset(p, 0, n);
    return p;
}
void *memset(void *d, int c, size_t n);
void *memcpy(void *d, const void *s, size_t n)
{
    unsigned char *a = d;
    const unsigned char *b = s;
    while (n--) *a++ = *b++;
    return d;
}
void *memmove(void *d, const void *s, size_t n)
{
    unsigned char *a = d;
    const unsigned char *b = s;
    if (a < b) { while (n--) *a++ = *b++; }
    else { a += n; b += n; while (n--) *--a = *--b; }
    return d;
}
void *memset(void *d, int c, size_t n)
{
    unsigned char *a = d;
    while (n--) *a++ = (unsigned char)c;
    return d;
}
int memcmp(const void *a, const void *b, size_t n)
{
    const unsigned char *x = a, *y = b;
    while (n--) { if (*x != *y) return *x - *y; x++; y++; }
    return 0;
}
size_t strlen(const char *s) { size_t n = 0; while (s[n]) n++; return n; }

/* ---- maths: the browser has all of this, no point shipping a libm ---- */
#define M1(name, T) __attribute__((import_module("math"), import_name(#name))) T js_##name(T);
#define M2(name, T) __attribute__((import_module("math"), import_name(#name))) T js_##name##2(T, T);

M1(sin, double) M1(cos, double) M1(tan, double) M1(atan, double) M1(exp, double)
M1(log, double) M1(log10, double) M1(sqrt, double) M1(fabs, double)
M1(floor, double) M1(ceil, double) M1(round, double) M1(trunc, double)
M1(sinf, float) M1(cosf, float) M1(fabsf, float) M1(sqrtf, float)
M1(atanf, float) M1(expf, float) M1(logf, float) M1(floorf, float) M1(ceilf, float)
M1(roundf, float) M1(tanf, float) M1(log10f, float)
M2(atan2, double) M2(pow, double) M2(fmod, double) M2(atan2f, float) M2(powf, float) M2(fmodf, float)
M1(round, double)

double sin(double x) { return js_sin(x); }
double cos(double x) { return js_cos(x); }
double tan(double x) { return js_tan(x); }
double atan(double x) { return js_atan(x); }
double atan2(double y, double x) { return js_atan22(y, x); }
double exp(double x) { return js_exp(x); }
double log(double x) { return js_log(x); }
double log10(double x) { return js_log10(x); }
double sqrt(double x) { return js_sqrt(x); }
double fabs(double x) { return js_fabs(x); }
double floor(double x) { return js_floor(x); }
double ceil(double x) { return js_ceil(x); }
double round(double x) { return js_round(x); }
double trunc(double x) { return js_trunc(x); }
double pow(double a, double b) { return js_pow2(a, b); }
double fmod(double a, double b) { return js_fmod2(a, b); }

float sinf(float x) { return js_sinf(x); }
float cosf(float x) { return js_cosf(x); }
float tanf(float x) { return js_tanf(x); }
float atanf(float x) { return js_atanf(x); }
float atan2f(float y, float x) { return js_atan2f2(y, x); }
float expf(float x) { return js_expf(x); }
float logf(float x) { return js_logf(x); }
float log10f(float x) { return js_log10f(x); }
float sqrtf(float x) { return js_sqrtf(x); }
float fabsf(float x) { return js_fabsf(x); }
float floorf(float x) { return js_floorf(x); }
float ceilf(float x) { return js_ceilf(x); }
float roundf(float x) { return js_roundf(x); }
float powf(float a, float b) { return js_powf2(a, b); }
float fmodf(float a, float b) { return js_fmodf2(a, b); }

long lrint(double x) { return (long)js_round(x); }
long lround(double x) { return (long)js_round(x); }

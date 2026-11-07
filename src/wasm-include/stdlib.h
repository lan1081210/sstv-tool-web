/* minimal freestanding stdlib for the wasm build */
#ifndef WASM_STDLIB_H
#define WASM_STDLIB_H
#include <stddef.h>
void *malloc(size_t);
void free(void *);
void *calloc(size_t, size_t);
void *realloc(void *, size_t);
int atoi(const char *);
double atof(const char *);
int abs(int);
#ifndef NULL
#define NULL ((void *)0)
#endif
#endif

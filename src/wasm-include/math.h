/* minimal freestanding math.h: implemented in shim.c on top of JS Math */
#ifndef WASM_MATH_H
#define WASM_MATH_H
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
double sin(double); double cos(double); double tan(double); double atan(double);
double atan2(double, double); double exp(double); double log(double); double log10(double);
double sqrt(double); double fabs(double); double floor(double); double ceil(double);
double round(double); double trunc(double); double pow(double, double); double fmod(double, double);
float sinf(float); float cosf(float); float tanf(float); float atanf(float);
float atan2f(float, float); float expf(float); float logf(float); float log10f(float);
float sqrtf(float); float fabsf(float); float floorf(float); float ceilf(float);
float roundf(float); float powf(float, float); float fmodf(float, float);
long lrint(double); long lround(double);
#endif

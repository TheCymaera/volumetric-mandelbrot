#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

// ----- 6D helpers -----
struct Vec6 { float x; float y; float z; float w; float v; float u; };
Vec6 add6(Vec6 a, Vec6 b) { return Vec6(a.x+b.x, a.y+b.y, a.z+b.z, a.w+b.w, a.v+b.v, a.u+b.u); }
Vec6 mul6(Vec6 a, float s) { return Vec6(a.x*s, a.y*s, a.z*s, a.w*s, a.v*s, a.u*s); }

uniform Vec6 u_pos;
uniform Vec6 u_right;
uniform Vec6 u_up;
uniform Vec6 u_fwd;

uniform vec2 u_screenSize;
uniform float u_zoom;

uniform float u_bailoutRadiusSquared;
uniform int u_maxIterations;

uniform vec3 u_lightDir;      // world-space (screen-space) light direction
uniform float u_stepFactor;   // raymarch step multiplier
uniform int u_maxSteps;
uniform float u_sliceExtent;  // half-depth of marching volume along forward axis

struct ColorStop {
	float position;
	vec4 color;
};

ColorStop gradient[5] = ColorStop[5](
	ColorStop(0.0, vec4(0.0 / 255.0, 7.0 / 255.0, 100.0 / 255.0, 1.0)),
	ColorStop(0.16, vec4(32.0 / 255.0, 107.0 / 255.0, 203.0 / 255.0, 1.0)),
	ColorStop(0.42, vec4(237.0 / 255.0, 255.0 / 255.0, 255.0 / 255.0, 1.0)),
	ColorStop(0.6425, vec4(255.0 / 255.0, 170.0 / 255.0, 0.0 / 255.0, 1.0)),
	ColorStop(0.8575, vec4(0.0 / 255.0, 0.0 / 255.0, 0.0 / 255.0, 1.0))
);

vec4 sampleGradient(float position) {
	int maxIndex = gradient.length() - 1;
	for (int i = 0; i < maxIndex; i++) {
		if (position >= gradient[i].position && position <= gradient[i + 1].position) {
			float t = (position - gradient[i].position) / (gradient[i + 1].position - gradient[i].position);
			return mix(gradient[i].color, gradient[i + 1].color, t);
		}
	}
	return gradient[maxIndex].color;
}

vec2 complexPow(vec2 num, vec2 exponent) {
	float r = length(num);
	if (r == 0.0) return vec2(0.0, 0.0);
	float theta = atan(num.y, num.x);
	float logR = log(r);
	float newR = pow(r, exponent.x) * exp(-exponent.y * theta);
	float newTheta = exponent.x * theta + exponent.y * logR;
	return vec2(newR * cos(newTheta), newR * sin(newTheta));
}

// Iteration count at a 6D point. Returns iterations; >= maxIterations means "inside".
float mandel(Vec6 p) {
	vec2 z = vec2(p.z, p.w);
	vec2 c = vec2(p.x, p.y);
	vec2 e = vec2(p.v, p.u);

	int iterations = 0;
	float zz = dot(z, z);

	for (; zz < u_bailoutRadiusSquared && iterations < u_maxIterations; iterations++) {
		z = complexPow(z, e) + c;
		zz = dot(z, z);
	}

	return float(iterations);
}

// "Inside" test: the 3D solid is the set of points that never escape.
bool isInside(Vec6 p) {
	return mandel(p) >= float(u_maxIterations);
}

// Normal via central differences on an "exterior distance" field in screen space.
vec3 calcNormal(Vec6 p, float eps, Vec6 right, Vec6 up, Vec6 fwd) {
	float dx = (isInside(add6(p, mul6(right,  eps))) ? 1.0 : 0.0) - (isInside(add6(p, mul6(right, -eps))) ? 1.0 : 0.0);
	float dy = (isInside(add6(p, mul6(up,     eps))) ? 1.0 : 0.0) - (isInside(add6(p, mul6(up,     -eps))) ? 1.0 : 0.0);
	float dz = (isInside(add6(p, mul6(fwd,    eps))) ? 1.0 : 0.0) - (isInside(add6(p, mul6(fwd,    -eps))) ? 1.0 : 0.0);
	vec3 n = vec3(dx, dy, dz);
	if (dot(n, n) < 1e-8) return vec3(0.0, 0.0, 1.0);
	return normalize(n);
}

// Fractional iteration value used for coloring the surface: sample slightly outside along the ray.
float surfaceIter(Vec6 p) {
	return clamp(mandel(p) / float(u_maxIterations), 0.0, 1.0);
}

void main() {
	float aspectRatio = u_screenSize.x / u_screenSize.y;
	vec2 pixelOffset = (v_texCoord - vec2(0.5)) / u_zoom;
	pixelOffset.y /= aspectRatio;

	Vec6 rightV = u_right;
	Vec6 upV = u_up;
	Vec6 fwdV = u_fwd;

	// Ray setup in 6D: origin on the slice plane, direction = forward vector.
	Vec6 rayOrigin = add6(u_pos, add6(mul6(rightV, pixelOffset.x), mul6(upV, pixelOffset.y)));

	// March through the slice volume [-u_sliceExtent, +u_sliceExtent].
	// Fixed absolute step size; u_maxSteps is sized by JS so the ray always
	// covers the whole volume regardless of the adaptive slowdown near the set.
	float t = -u_sliceExtent;
	float baseStep = 0.01 * u_stepFactor;
	bool hit = false;
	Vec6 hitPos = rayOrigin;

	for (int i = 0; i < u_maxSteps; i++) {
		Vec6 p = add6(rayOrigin, mul6(fwdV, t));
		float it = mandel(p);
		if (it >= float(u_maxIterations)) { hit = true; hitPos = p; break; }
		float f = clamp(it / float(u_maxIterations), 0.0, 1.0);
		t += baseStep * mix(0.35, 1.0, f);
		if (t > u_sliceExtent) break;
	}

	if (!hit) {
		fragColor = vec4(0.0, 0.0, 0.0, 1.0);
		return;
	}

	// Shade: gradient color from iteration field near surface + simple diffuse lighting.
	vec3 normal = calcNormal(hitPos, baseStep * 0.75, rightV, upV, fwdV);
	float diff = clamp(dot(normal, normalize(-u_lightDir)), 0.0, 1.0);
	float ambient = 0.25;

	// Sample iteration count a bit in front of the hit (exterior side) for color.
	Vec6 extPos = add6(hitPos, mul6(fwdV, -baseStep * 1.5));
	float colorValue = surfaceIter(extPos);
	vec4 baseColor = sampleGradient(colorValue);

	vec3 col = baseColor.rgb * (ambient + diff * 0.85);
	fragColor = vec4(col, 1.0);
}

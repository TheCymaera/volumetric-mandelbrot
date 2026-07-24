#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

// ----- Vec6 -----
struct Vec6 { float x; float y; float z; float w; float v; float u; };
Vec6 add6(Vec6 a, Vec6 b) { return Vec6(a.x+b.x, a.y+b.y, a.z+b.z, a.w+b.w, a.v+b.v, a.u+b.u); }
Vec6 mul6(Vec6 a, float s) { return Vec6(a.x*s, a.y*s, a.z*s, a.w*s, a.v*s, a.u*s); }
Vec6 subtract6(Vec6 a, Vec6 b) { return Vec6(a.x-b.x, a.y-b.y, a.z-b.z, a.w-b.w, a.v-b.v, a.u-b.u); }
float dot6(Vec6 a, Vec6 b) { return a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w + a.v*b.v + a.u*b.u; }
Vec6 normalize6(Vec6 v) {
	float len = sqrt(max(dot6(v, v), 1e-12));
	return mul6(v, 1.0 / len);
}

uniform Vec6 u_pos;
uniform Vec6 u_right;
uniform Vec6 u_up;
uniform Vec6 u_forward;

uniform vec2 u_screenSize;
uniform float u_zoom;

uniform float u_bailoutRadiusSquared;
uniform int u_maxIterations;

uniform vec3 u_lightDir;
uniform float u_stepSize;
uniform int u_maxSteps;
uniform float u_maxDistance;
uniform float u_focalLength;

uniform float u_fogDensity;
uniform vec4 u_fogColor;
uniform float u_glowIntensity;

uniform float u_glowThreshold;
uniform float u_glowWeightFactor;
uniform float u_stepSizeMinFactor;
uniform int u_binarySearchIterations;
uniform float u_normalStepFactor;
uniform float u_exteriorStepFactor;
uniform float u_ambientLight;
uniform float u_diffuseFactor;

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

float mandelbrot(Vec6 p) {
	vec2 z = vec2(p.z, p.w);
	vec2 c = vec2(p.x, p.y);
	vec2 e = vec2(p.v, p.u);

	int iterations = 0;
	float zz = dot(z, z);

	for (; zz < u_bailoutRadiusSquared && iterations < u_maxIterations; iterations++) {
		z = complexPow(z, e) + c;
		zz = dot(z, z);
	}

	if (iterations >= u_maxIterations) return float(u_maxIterations);

	// Smooth (fractional) iteration count for continuous coloring/normals.
	float logPower = log(max(length(e), 1.0001));
	float smoothIter = float(iterations) + 1.0
		- log(max(log(sqrt(zz)) / log(sqrt(u_bailoutRadiusSquared)), 1e-6)) / logPower;
	return clamp(smoothIter, 0.0, float(u_maxIterations));
}

bool isInside(Vec6 p) {
	return mandelbrot(p) >= float(u_maxIterations);
}

vec3 calcNormal(Vec6 p, float eps, Vec6 right, Vec6 up, Vec6 forward) {
	float dx = mandelbrot(add6(p, mul6(right,   eps))) - mandelbrot(add6(p, mul6(right,   -eps)));
	float dy = mandelbrot(add6(p, mul6(up,      eps))) - mandelbrot(add6(p, mul6(up,      -eps)));
	float dz = mandelbrot(add6(p, mul6(forward, eps))) - mandelbrot(add6(p, mul6(forward, -eps)));
	vec3 n = vec3(dx, dy, dz);
	if (dot(n, n) < 1e-8) return vec3(0.0, 0.0, 1.0);
	return normalize(n);
}

void main() {
	float aspectRatio = u_screenSize.x / u_screenSize.y;
	vec2 pixelOffset = (v_texCoord - vec2(0.5)) / u_zoom;
	pixelOffset.y /= aspectRatio;

	Vec6 rightV = u_right;
	Vec6 upV = u_up;
	Vec6 forwardV = u_forward;

	Vec6 pinhole = add6(u_pos, mul6(forwardV, -u_focalLength));

	Vec6 retina = add6(
		u_pos,
		add6(mul6(rightV, pixelOffset.x), mul6(upV, pixelOffset.y))
	);

	Vec6 rayDir = normalize6(subtract6(retina, pinhole));
	Vec6 rayOrigin = retina;

	float t = 0.0;
	float tPrev = 0.0;
	bool hit = false;
	Vec6 hitPos = rayOrigin;

	// Glow accumulation during ray march
	vec4 glowAcc = vec4(0.0);

	for (int i = 0; i < u_maxSteps; i++) {
		Vec6 p = add6(rayOrigin, mul6(rayDir, t));
		float it = mandelbrot(p);

		// Accumulate glow from points near the set (high iteration count)
		float f = clamp(it / float(u_maxIterations), 0.0, 1.0);
		if (f > u_glowThreshold) {
			vec4 glowColor = sampleGradient(f);
			float glowWeight = smoothstep(u_glowThreshold, 1.0, f) * u_glowIntensity * u_stepSize * u_glowWeightFactor;
			// Fog-attenuate the glow contribution
			float distFog = exp(-u_fogDensity * t);
			glowAcc += glowColor * glowWeight * distFog;
		}

		if (it >= float(u_maxIterations)) {
			hit = true;

			// Binary search: surface lies between tPrev (outside) and t (inside).
			float lo = tPrev, hi = t;
			for (int j = 0; j < u_binarySearchIterations; j++) {
				float mid = 0.5 * (lo + hi);
				if (isInside(add6(rayOrigin, mul6(rayDir, mid)))) hi = mid; else lo = mid;
			}
			t = hi;
			hitPos = add6(rayOrigin, mul6(rayDir, t));
			break;
		}
		tPrev = t;
		t += u_stepSize * mix(u_stepSizeMinFactor, 1.0, f);
		if (t > u_maxDistance) break;
	}

	// Fog factor for the surface hit
	float fogFactor = exp(-u_fogDensity * t);

	if (!hit) {
		// No hit: show accumulated glow against fog color
		vec4 result = glowAcc + u_fogColor * (1.0 - fogFactor);
		fragColor = vec4(result.rgb, 1.0);
		return;
	}

	// Shade: gradient color from iteration field near surface + simple diffuse lighting.
	vec3 normal = calcNormal(hitPos, u_stepSize * u_normalStepFactor, rightV, upV, forwardV);
	float diff = clamp(dot(normal, normalize(-u_lightDir)), 0.0, 1.0);
	float ambient = u_ambientLight;

	// Sample iteration count a bit in front of the hit (exterior side) for color.
	Vec6 extPos = add6(hitPos, mul6(rayDir, -u_stepSize * u_exteriorStepFactor));
	float colorValue = mandelbrot(extPos) / float(u_maxIterations);
	vec4 baseColor = sampleGradient(colorValue);

	vec3 litColor = baseColor.rgb * (ambient + diff * u_diffuseFactor);

	// Apply fog to the surface
	vec4 surfaceResult = vec4(mix(u_fogColor.rgb, litColor, fogFactor), 1.0);

	// Add accumulated glow on top
	vec4 result = surfaceResult + glowAcc * fogFactor;
	fragColor = vec4(result.rgb, 1.0);
}

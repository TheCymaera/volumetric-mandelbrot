#version 300 es
precision highp float;

// Bake pass: writes the iteration field for ONE z-slice of the volume.
// Each fragment = one voxel. Attach texture layer `u_layer` to the FBO.

in vec2 v_texCoord;
out vec4 fragColor;

struct Vec6 { float x; float y; float z; float w; float v; float u; };
Vec6 add6(Vec6 a, Vec6 b) { return Vec6(a.x+b.x, a.y+b.y, a.z+b.z, a.w+b.w, a.v+b.v, a.u+b.u); }
Vec6 mul6(Vec6 a, float s) { return Vec6(a.x*s, a.y*s, a.z*s, a.w*s, a.v*s, a.u*s); }

uniform Vec6 u_pos;
uniform Vec6 u_right;
uniform Vec6 u_up;
uniform Vec6 u_fwd;

uniform int u_layer;        // which z-slice of the volume this pass renders
uniform float u_volSize;    // voxel count per axis
uniform float u_extent;     // half-extent of the volume in 6D units (per axis)

uniform float u_bailoutRadiusSquared;
uniform int u_maxIterations;

vec2 complexPow(vec2 num, vec2 exponent) {
	float r = length(num);
	if (r == 0.0) return vec2(0.0, 0.0);
	float theta = atan(num.y, num.x);
	float logR = log(r);
	float newR = pow(r, exponent.x) * exp(-exponent.y * theta);
	float newTheta = exponent.x * theta + exponent.y * logR;
	return vec2(newR * cos(newTheta), newR * sin(newTheta));
}

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

void main() {
	// voxel coords in [0,1)^3; slice index from uniform
	vec2 xy = v_texCoord;
	float zl = (float(u_layer) + 0.5) / u_volSize;
	vec3 uvw = vec3(xy, zl);
	// map to centered local coords in [-extent, extent]
	vec3 local = (uvw - 0.5) * 2.0 * u_extent;

	Vec6 p = u_pos;
	p = add6(p, mul6(u_right, local.x));
	p = add6(p, mul6(u_up,    local.y));
	p = add6(p, mul6(u_fwd,   local.z));

	float it = mandel(p);
	// normalized field: 1.0 = inside, 0.0 = escaped immediately
	fragColor = vec4(clamp(it / float(u_maxIterations), 0.0, 1.0), 0.0, 0.0, 1.0);
}

#version 300 es
precision highp float;
precision highp sampler3D;

// Render pass: volume ray casting over the prebaked iteration field.
// Field value f in [0,1]: 1.0 = inside the set. Surface at f >= u_iso.

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler3D u_volume;
uniform float u_volSize;
uniform float u_extent;      // half-extent of volume box in world units
uniform vec3 u_eye;          // camera position in volume-local space
uniform mat3 u_camBasis;     // columns: right, up, forward (volume-local)
uniform float u_fovScale;    // tan(fov/2)
uniform vec2 u_screenSize;
uniform vec3 u_lightDir;     // volume-local
uniform float u_iso;         // isovalue treated as solid (typically ~1.0)
uniform int u_maxSteps;

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

float field(vec3 uvw) {
	return texture(u_volume, uvw).r;
}

// normal via central differences on the baked field (cheap texture reads)
vec3 calcNormal(vec3 uvw) {
	float h = 1.0 / u_volSize;
	float dx = field(uvw + vec3(h, 0, 0)) - field(uvw - vec3(h, 0, 0));
	float dy = field(uvw + vec3(0, h, 0)) - field(uvw - vec3(0, h, 0));
	float dz = field(uvw + vec3(0, 0, h)) - field(uvw - vec3(0, 0, h));
	vec3 n = vec3(dx, dy, dz);
	if (dot(n, n) < 1e-10) return vec3(0.0, 0.0, 1.0);
	return normalize(n);
}

// ray vs unit box [0,1]^3
vec2 boxIntersect(vec3 ro, vec3 rd) {
	vec3 inv = 1.0 / rd;
	vec3 t0 = (vec3(0.0) - ro) * inv;
	vec3 t1 = (vec3(1.0) - ro) * inv;
	vec3 tmin = min(t0, t1), tmax = max(t0, t1);
	return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

void main() {
	vec2 ndc = v_texCoord * 2.0 - 1.0;
	float aspect = u_screenSize.x / u_screenSize.y;
	vec3 rd = normalize(u_camBasis * vec3(ndc.x * aspect * u_fovScale, ndc.y * u_fovScale, 1.0));
	vec3 ro = u_eye;

	vec2 t = boxIntersect(ro, rd);
	if (t.x > t.y || t.y < 0.0) { fragColor = vec4(0.0); return; }
	t.x = max(t.x, 0.0);

	float stepLen = (t.y - t.x) / float(u_maxSteps);
	vec3 col = vec3(0.0);
	bool hit = false;
	float hitVal = 0.0;
	vec3 hitPos = vec3(0.0);

	for (int i = 0; i < 1024; i++) {
		if (i >= u_maxSteps) break;
		float ti = t.x + (float(i) + 0.5) * stepLen;
		if (ti > t.y) break;
		vec3 uvw = ro + rd * ti;
		float f = field(uvw);
		if (f >= u_iso) {
			// refine with a few bisection steps
			float lo = ti - stepLen, hi = ti;
			for (int j = 0; j < 6; j++) {
				float mid = 0.5 * (lo + hi);
				if (field(ro + rd * mid) >= u_iso) hi = mid; else lo = mid;
			}
			hitPos = ro + rd * hi;
			hitVal = field(hitPos - rd * (2.0 / u_volSize)); // color slightly outside
			hit = true;
			break;
		}
	}

	if (!hit) { fragColor = vec4(0.0); return; }

	vec3 n = calcNormal(hitPos);
	// flip normal toward viewer if needed
	if (dot(n, -rd) < 0.0) n = -n;
	float diff = max(dot(n, normalize(u_lightDir)), 0.0);
	float amb = 0.25;
	float spec = pow(max(dot(reflect(-normalize(u_lightDir), n), -rd), 0.0), 32.0) * 0.4;

	vec4 base = sampleGradient(1.0 - hitVal); // invert: low iter near surface -> bright band
	vec3 shaded = base.rgb * (amb + diff * 0.85) + vec3(spec);
	fragColor = vec4(shaded, 1.0);
}

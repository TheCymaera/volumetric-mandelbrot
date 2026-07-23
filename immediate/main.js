// 6D Mandelbrot — 3D slice renderer (WebGL2)
//
// The 6D point is (x, y, z, w, v, u):
//   c = (x, y)  — classic Mandelbrot constant
//   z0 = (z, w) — initial value
//   e = (v, u)  — complex exponent
//
// We pick 3 orthonormal 6D axes (right/up/forward) and raymarch the volume
// they span, treating "never escapes" as solid.

const canvas = document.getElementById('gl');
const hud = document.getElementById('hud');
const gl = canvas.getContext('webgl2');
if (!gl) { alert('WebGL2 not supported'); throw new Error('no webgl2'); }

async function loadShader(url) {
	const r = await fetch(url);
	return await r.text();
}

function compile(type, src) {
	// strip the #version line of included duplicates if any
	const s = gl.createShader(type);
	gl.shaderSource(s, src);
	gl.compileShader(s);
	if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
		console.error(gl.getShaderInfoLog(s));
		console.error(src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
		throw new Error('shader compile failed');
	}
	return s;
}

function createProgram(vsSrc, fsSrc) {
	const p = gl.createProgram();
	gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
	gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
	gl.linkProgram(p);
	if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
		console.error(gl.getProgramInfoLog(p));
		throw new Error('link failed');
	}
	return p;
}

const [vsSrc, fsSrc] = await Promise.all([
	loadShader('shaders/fullscreen.vert.glsl'),
	loadShader('shaders/mandelbrot3d.frag.glsl'),
]);

const prog = createProgram(vsSrc, fsSrc);
gl.useProgram(prog);

// fullscreen triangle
const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

function requireUniform(name) {
	const loc = gl.getUniformLocation(prog, name);
	//if (loc === null) throw new Error(`uniform ${name} not found`);
	return loc;
}

const U = {
	u_pos: requireUniform('u_pos'),
	u_right: requireUniform('u_right'),
	u_up: requireUniform('u_up'),
	u_fwd: requireUniform('u_fwd'),
	u_screenSize: requireUniform('u_screenSize'),
	u_zoom: requireUniform('u_zoom'),
	u_bailoutRadiusSquared: requireUniform('u_bailoutRadiusSquared'),
	u_maxIterations: requireUniform('u_maxIterations'),
	u_lightDir: requireUniform('u_lightDir'),
	u_stepFactor: requireUniform('u_stepFactor'),
	u_maxSteps: requireUniform('u_maxSteps'),
	u_sliceExtent: requireUniform('u_sliceExtent'),
}

// Pre-resolve Vec6 struct member uniform locations
function requireVec6(base) {
	return {
		x: requireUniform(`${base}.x`),
		y: requireUniform(`${base}.y`),
		z: requireUniform(`${base}.z`),
		w: requireUniform(`${base}.w`),
		v: requireUniform(`${base}.v`),
		u: requireUniform(`${base}.u`),
	};
}
const UL = {
	u_pos: requireVec6('u_pos'),
	u_right: requireVec6('u_right'),
	u_up: requireVec6('u_up'),
	u_fwd: requireVec6('u_fwd'),
};
function setVec6(locs, v) {
	gl.uniform1f(locs.x, v.x);
	gl.uniform1f(locs.y, v.y);
	gl.uniform1f(locs.z, v.z);
	gl.uniform1f(locs.w, v.w);
	gl.uniform1f(locs.v, v.v);
	gl.uniform1f(locs.u, v.u);
}

// ---- 6D vector class ----
class Vec6 {
	constructor(x, y, z, w, v, u) {
		this.x = x; this.y = y; this.z = z; this.w = w; this.v = v; this.u = u;
	}
	add(b) { return new Vec6(this.x + b.x, this.y + b.y, this.z + b.z, this.w + b.w, this.v + b.v, this.u + b.u); }
	sub(b) { return new Vec6(this.x - b.x, this.y - b.y, this.z - b.z, this.w - b.w, this.v - b.v, this.u - b.u); }
	scale(s) { return new Vec6(this.x * s, this.y * s, this.z * s, this.w * s, this.v * s, this.u * s); }
	dot(b) { return this.x * b.x + this.y * b.y + this.z * b.z + this.w * b.w + this.v * b.v + this.u * b.u; }
	norm() { return Math.sqrt(this.dot(this)); }
	normalize() { const n = this.norm() || 1; return this.scale(1 / n); }
	toArray() { return [this.x, this.y, this.z, this.w, this.v, this.u]; }

	static x() { return new Vec6(1, 0, 0, 0, 0, 0); }
	static y() { return new Vec6(0, 1, 0, 0, 0, 0); }
	static z() { return new Vec6(0, 0, 1, 0, 0, 0); }
	static w() { return new Vec6(0, 0, 0, 1, 0, 0); }
	static v() { return new Vec6(0, 0, 0, 0, 1, 0); }
	static u() { return new Vec6(0, 0, 0, 0, 0, 1); }
}

// Basis axes in 6D
//const AX = { x: 0, y: 1, z: 2, w: 3, v: 4, u: 5 };
//function axisVec(i) {
//	const a = [0, 0, 0, 0, 0, 0]; a[i] = 1;
//	return new Vec6(...a);
//}

// ---- State ----
const state = {
	// Which 3 of the 6 axes form the slice: [rightAxis, upAxis, forwardAxis]
	sliceAxes: [Vec6.x(), Vec6.y(), Vec6.z()],
	position: new Vec6(-0.5, 0, 0, 0, 2, 0), // 6D center (classic c-plane, z0=0, e=2)
	zoom: 0.2,
	renderScale: 0.6, // render at reduced resolution for speed
	// rotation angles (radians) applied to the slice frame within 6D
	rot: { xy: 0, xz: 0, yz: 0 },
	maxIterations: 40,
	// maxSteps is derived from sliceExtent in frame(): the shader uses a fixed
	// 0.01 step (worst case 0.35x near the set), so steps must cover the range.
	stepSize: 0.02,
	sliceExtent: 1.5 * 1.2 * 1,
	bailout: 1e10,
	lightDir: [-0.5, -0.7, -1.0],
};

// Build orthonormal-ish 6D frame from slice axes plus rotations in axis planes.
// Rotations: rotate in (right,up), (right,forward), (up,forward) planes of the slice.
function buildFrame() {
	let r = state.sliceAxes[0];
	let u = state.sliceAxes[1];
	let f = state.sliceAxes[2];

	const rotPlane = (a, b, ang) => {
		const c = Math.cos(ang), s = Math.sin(ang);
		const na = a.scale(c).add(b.scale(s));
		const nb = b.scale(c).add(a.scale(-s));
		return [na, nb];
	};

	[r, u] = rotPlane(r, u, state.rot.xy);
	[r, f] = rotPlane(r, f, state.rot.xz);
	[u, f] = rotPlane(u, f, state.rot.yz);

	return { right: r, up: u, fwd: f };
}

// ---- Input ----
const keys = {};
let dragging = false, lastX = 0, lastY = 0;

canvas.addEventListener('mousedown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', () => dragging = false);
window.addEventListener('mousemove', e => {
	if (!dragging) return;
	const dx = (e.clientX - lastX) / canvas.clientHeight;
	const dy = (e.clientY - lastY) / canvas.clientHeight;
	lastX = e.clientX; lastY = e.clientY;
	const f = buildFrame();
	// pan within slice
	state.position = state.position.add(f.right.scale(-dx / state.zoom)).add(f.up.scale(dy / state.zoom));
});
canvas.addEventListener('wheel', e => {
	e.preventDefault();
	state.zoom *= Math.exp(-e.deltaY * 0.001);
}, { passive: false });

window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

// Cycle slice axis triplets with Tab
const axisNames = ['x(c.re)', 'y(c.im)', 'z(z0.re)', 'w(z0.im)', 'v(e.re)', 'u(e.im)'];
window.addEventListener('keydown', e => {
	if (e.key === 'Tab') {
		e.preventDefault();
		// rotate the triplet forward
		//state.sliceAxes = state.sliceAxes.map(a => (a + 1) % 6);
	}
});

function update(dt) {
	const rs = 1.2 * dt; // rad/s
	const ps = 1.0 / state.zoom * dt; // pan speed
	const f = buildFrame();
	if (keys['q']) state.rot.xy += rs;
	if (keys['e']) state.rot.xy -= rs;
	if (keys['r']) state.rot.xz += rs;
	if (keys['f']) state.rot.xz -= rs;
	if (keys['t']) state.rot.yz += rs;
	if (keys['g']) state.rot.yz -= rs;

	// WASD pans, arrow keys move along forward axis / zoom
	if (keys['a']) state.position = state.position.add(f.right.scale(-ps));
	if (keys['d']) state.position = state.position.add(f.right.scale(ps));
	if (keys['w']) state.position = state.position.add(f.up.scale(ps));
	if (keys['s']) state.position = state.position.add(f.up.scale(-ps));
	if (keys['arrowup']) state.position = state.position.add(f.fwd.scale(ps));
	if (keys['arrowdown']) state.position = state.position.add(f.fwd.scale(-ps));
	if (keys['+'] || keys['=']) state.zoom *= 1 + dt;
	if (keys['-']) state.zoom /= 1 + dt;
}

function resize() {
	const dpr = Math.min(window.devicePixelRatio, 1) * state.renderScale;
	const w = Math.max(2, Math.floor(canvas.clientWidth * dpr));
	const h = Math.max(2, Math.floor(canvas.clientHeight * dpr));
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w; canvas.height = h;
		gl.viewport(0, 0, w, h);
	}
}

let lastT = performance.now();
function frame() {
	const now = performance.now();
	const dt = Math.min((now - lastT) / 1000, 0.1);
	lastT = now;
	update(dt);
	resize();

	const f = buildFrame();
	gl.useProgram(prog);
	setVec6(UL.u_pos, state.position);
	setVec6(UL.u_right, f.right);
	setVec6(UL.u_up, f.up);
	setVec6(UL.u_fwd, f.fwd);
	gl.uniform2f(U.u_screenSize, canvas.width, canvas.height);
	gl.uniform1f(U.u_zoom, state.zoom);
	gl.uniform1f(U.u_bailoutRadiusSquared, state.bailout);
	gl.uniform1i(U.u_maxIterations, state.maxIterations);
	gl.uniform3fv(U.u_lightDir, state.lightDir);
	gl.uniform1f(U.u_stepFactor, state.stepSize / 0.01); // shader: baseStep = 0.01 * u_stepFactor
	// worst-case step is 0.35 * stepSize, so budget steps for the full range
	const maxSteps = Math.ceil(2 * state.sliceExtent / (state.stepSize * 0.35));
	gl.uniform1i(U.u_maxSteps, maxSteps);
	gl.uniform1f(U.u_sliceExtent, state.sliceExtent);

	gl.drawArrays(gl.TRIANGLES, 0, 3);

	hud.textContent =
		`6D Mandelbrot — 3D slice\n` +
		`slice axes (R,U,F): ${state.sliceAxes.map(a => axisNames[a]).join(' / ')}\n` +
		`pos: ${state.position.toArray().map(v => v.toFixed(3)).join(', ')}\n` +
		`zoom: ${state.zoom.toFixed(3)}  rot: xy ${state.rot.xy.toFixed(2)} xz ${state.rot.xz.toFixed(2)} yz ${state.rot.yz.toFixed(2)}\n` +
		`drag=pan  wheel=zoom  WASD=pan  Q/E R/F T/G=rotate slice  arrows=depth  Tab=cycle axes`;

	requestAnimationFrame(frame);
}
frame();

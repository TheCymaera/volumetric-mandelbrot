// 6D Mandelbrot — prebaked 3D volume renderer (WebGL2)
//
// Two-pass approach:
//   1. BAKE: evaluate the iteration field into a 3D texture,
//      one z-slice per draw (framebufferTextureLayer). Baked only when
//      the 6D slice parameters change; spread over multiple frames.
//   2. RENDER: raycast the 3D texture — hardware trilinear filtering,
//      texture-based normals. Cheap enough for smooth camera orbiting.

const canvas = document.getElementById('gl');
const hud = document.getElementById('hud');
const gl = canvas.getContext('webgl2');
if (!gl) { alert('WebGL2 not supported'); throw new Error('no webgl2'); }
if (!gl.getExtension('EXT_color_buffer_float')) {
	alert('EXT_color_buffer_float not supported'); throw new Error('no float render targets');
}

async function loadShader(url) {
	const r = await fetch(url);
	return await r.text();
}

function compile(type, src) {
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

const [vsSrc, bakeSrc, raySrc] = await Promise.all([
	loadShader('shaders/fullscreen.vert.glsl'),
	loadShader('shaders/bake.frag.glsl'),
	loadShader('shaders/raycast.frag.glsl'),
]);

const bakeProg = createProgram(vsSrc, bakeSrc);
const rayProg = createProgram(vsSrc, raySrc);

// fullscreen triangle
const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

function uniforms(prog, names) {
	const u = {};
	for (const n of names) u[n] = gl.getUniformLocation(prog, n);
	return u;
}

const frameNames = ['u_pos', 'u_right', 'u_up', 'u_fwd'];

function requireVec6(prog, base) {
	return {
		x: gl.getUniformLocation(prog, `${base}.x`),
		y: gl.getUniformLocation(prog, `${base}.y`),
		z: gl.getUniformLocation(prog, `${base}.z`),
		w: gl.getUniformLocation(prog, `${base}.w`),
		v: gl.getUniformLocation(prog, `${base}.v`),
		u: gl.getUniformLocation(prog, `${base}.u`),
	};
}

const UB_vec6 = {};
for (const name of frameNames) UB_vec6[name] = requireVec6(bakeProg, name);

const UB = uniforms(bakeProg, [
	...frameNames.flatMap(b => [b + '.x', b + '.y', b + '.z', b + '.w', b + '.v', b + '.u']),
	'u_layer', 'u_volSize', 'u_extent',
	'u_bailoutRadiusSquared', 'u_maxIterations',
]);
const UR = uniforms(rayProg, [
	'u_volume', 'u_volSize', 'u_extent', 'u_eye', 'u_camBasis', 'u_fovScale',
	'u_screenSize', 'u_lightDir', 'u_iso', 'u_maxSteps',
]);

function setVec6(locs, v) {
	gl.uniform1f(locs.x, v[0]);
	gl.uniform1f(locs.y, v[1]);
	gl.uniform1f(locs.z, v[2]);
	gl.uniform1f(locs.w, v[3]);
	gl.uniform1f(locs.v, v[4]);
	gl.uniform1f(locs.u, v[5]);
}

// ---- volume texture + FBO ----
const VOL = 160; // voxels per axis (160^3 = 4.1M voxels, ~8MB as R16F)
const volTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_3D, volTex);
gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R16F, VOL, VOL, VOL);
gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

const fbo = gl.createFramebuffer();

// ---- 6D vector math ----
const v6 = {
	add: (a, b) => a.map((x, i) => x + b[i]),
	scale: (a, s) => a.map(x => x * s),
};

const AX = { x: 0, y: 1, z: 2, w: 3, v: 4, u: 5 };
const axisVec = i => { const a = [0, 0, 0, 0, 0, 0]; a[i] = 1; return a; };

const state = {
	sliceAxes: [AX.x, AX.y, AX.z],
	position: [-0.5, 0, 0, 0, 2, 0],
	extent: 1.6,        // half-extent of the baked volume in 6D units
	rot: { xy: 0, xz: 0, yz: 0 },
	maxIterations: 40,
	bailout: 1e10,
	lightDir: [-0.5, -0.7, -1.0],
	// camera (orbits the baked volume)
	camYaw: 0.6, camPitch: 0.35, camDist: 4.0,
	renderScale: 1.0,
	bakeDirty: true,
	bakeCursor: 0,
	slicesPerFrame: 8,  // bake throughput per frame while dirty
};

function buildFrame() {
	let r = axisVec(state.sliceAxes[0]);
	let u = axisVec(state.sliceAxes[1]);
	let f = axisVec(state.sliceAxes[2]);
	const rotPlane = (a, b, ang) => {
		const c = Math.cos(ang), s = Math.sin(ang);
		return [
			v6.add(v6.scale(a, c), v6.scale(b, s)),
			v6.add(v6.scale(b, c), v6.scale(a, -s)),
		];
	};
	[r, u] = rotPlane(r, u, state.rot.xy);
	[r, f] = rotPlane(r, f, state.rot.xz);
	[u, f] = rotPlane(u, f, state.rot.yz);
	return { right: r, up: u, fwd: f };
}

function markBakeDirty() {
	state.bakeDirty = true;
	state.bakeCursor = 0;
}

// ---- bake pass ----
function bakeSome() {
	if (!state.bakeDirty) return;
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.viewport(0, 0, VOL, VOL);
	gl.useProgram(bakeProg);

	const f = buildFrame();
	setVec6(UB_vec6['u_pos'], state.position);
	setVec6(UB_vec6['u_right'], f.right);
	setVec6(UB_vec6['u_up'], f.up);
	setVec6(UB_vec6['u_fwd'], f.fwd);
	gl.uniform1f(UB.u_volSize, VOL);
	gl.uniform1f(UB.u_extent, state.extent);
	gl.uniform1f(UB.u_bailoutRadiusSquared, state.bailout);
	gl.uniform1i(UB.u_maxIterations, state.maxIterations);

	const end = Math.min(state.bakeCursor + state.slicesPerFrame, VOL);
	for (let layer = state.bakeCursor; layer < end; layer++) {
		gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, volTex, 0, layer);
		gl.uniform1i(UB.u_layer, layer);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}
	state.bakeCursor = end;
	if (state.bakeCursor >= VOL) state.bakeDirty = false;

	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ---- render pass ----
function render() {
	gl.viewport(0, 0, canvas.width, canvas.height);
	gl.useProgram(rayProg);

	// camera in volume-uv space: box is [0,1]^3, center (0.5,0.5,0.5)
	const cy = Math.cos(state.camYaw), sy = Math.sin(state.camYaw);
	const cp = Math.cos(state.camPitch), sp = Math.sin(state.camPitch);
	const dist = state.camDist * state.extent; // world units; uv space = world / (2*extent) + 0.5
	// work directly in uv units
	const d = state.camDist; // in "extents": eye at distance d*2*0.5 uv units... simpler: uv units
	const eye = [
		0.5 + 0.5 * d * cp * sy,
		0.5 + 0.5 * d * sp,
		0.5 + 0.5 * d * cp * cy,
	];
	const center = [0.5, 0.5, 0.5];
	const fwd = norm3(sub3(center, eye));
	const right = norm3(cross3(fwd, [0, 1, 0]));
	const up = cross3(right, fwd);

	gl.uniformMatrix3fv(UR.u_camBasis, false, [
		right[0], right[1], right[2],
		up[0], up[1], up[2],
		fwd[0], fwd[1], fwd[2],
	]);
	gl.uniform3fv(UR.u_eye, eye);
	gl.uniform1f(UR.u_fovScale, 0.7);
	gl.uniform2f(UR.u_screenSize, canvas.width, canvas.height);
	gl.uniform3fv(UR.u_lightDir, norm3(state.lightDir));
	gl.uniform1f(UR.u_iso, 1.0 - 1e-4); // "inside" voxels bake to 1.0
	gl.uniform1f(UR.u_volSize, VOL);
	gl.uniform1f(UR.u_extent, state.extent);
	gl.uniform1i(UR.u_maxSteps, 512);

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_3D, volTex);
	gl.uniform1i(UR.u_volume, 0);

	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm3(a) { const n = Math.hypot(...a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; }

// ---- input ----
const keys = {};
let dragging = false, lastX = 0, lastY = 0;
let panMode = false; // shift = pan the 6D slice instead of orbiting

canvas.addEventListener('mousedown', e => { dragging = true; panMode = e.shiftKey; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', () => dragging = false);
window.addEventListener('mousemove', e => {
	if (!dragging) return;
	const dx = (e.clientX - lastX) / canvas.clientHeight;
	const dy = (e.clientY - lastY) / canvas.clientHeight;
	lastX = e.clientX; lastY = e.clientY;
	if (panMode) {
		const f = buildFrame();
		state.position = v6.add(state.position, v6.add(v6.scale(f.right, -dx * state.extent), v6.scale(f.up, dy * state.extent)));
		markBakeDirty();
	} else {
		state.camYaw += dx * 3;
		state.camPitch = Math.max(-1.5, Math.min(1.5, state.camPitch + dy * 3));
	}
});
canvas.addEventListener('wheel', e => {
	e.preventDefault();
	state.camDist = Math.max(1.1, Math.min(12, state.camDist * Math.exp(e.deltaY * 0.001)));
}, { passive: false });

window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

const axisNames = ['x(c.re)', 'y(c.im)', 'z(z0.re)', 'w(z0.im)', 'v(e.re)', 'u(e.im)'];
window.addEventListener('keydown', e => {
	if (e.key === 'Tab') {
		e.preventDefault();
		state.sliceAxes = state.sliceAxes.map(a => (a + 1) % 6);
		markBakeDirty();
	}
});

function update(dt) {
	const rs = 1.2 * dt;
	const ps = state.extent * dt;
	const f = buildFrame();
	let dirty = false;
	if (keys['q']) { state.rot.xy += rs; dirty = true; }
	if (keys['e']) { state.rot.xy -= rs; dirty = true; }
	if (keys['r']) { state.rot.xz += rs; dirty = true; }
	if (keys['f']) { state.rot.xz -= rs; dirty = true; }
	if (keys['t']) { state.rot.yz += rs; dirty = true; }
	if (keys['g']) { state.rot.yz -= rs; dirty = true; }
	if (keys['a']) { state.position = v6.add(state.position, v6.scale(f.right, -ps)); dirty = true; }
	if (keys['d']) { state.position = v6.add(state.position, v6.scale(f.right, ps)); dirty = true; }
	if (keys['w']) { state.position = v6.add(state.position, v6.scale(f.up, ps)); dirty = true; }
	if (keys['s']) { state.position = v6.add(state.position, v6.scale(f.up, -ps)); dirty = true; }
	if (keys['arrowup']) { state.position = v6.add(state.position, v6.scale(f.fwd, ps)); dirty = true; }
	if (keys['arrowdown']) { state.position = v6.add(state.position, v6.scale(f.fwd, -ps)); dirty = true; }
	if (keys['+'] || keys['=']) { state.extent = Math.max(0.05, state.extent * (1 - dt)); dirty = true; }
	if (keys['-']) { state.extent = Math.min(4, state.extent * (1 + dt)); dirty = true; }
	if (dirty) markBakeDirty();
}

function resize() {
	const dpr = Math.min(window.devicePixelRatio, 1.5) * state.renderScale;
	const w = Math.max(2, Math.floor(canvas.clientWidth * dpr));
	const h = Math.max(2, Math.floor(canvas.clientHeight * dpr));
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w; canvas.height = h;
	}
}

let lastT = performance.now();
function frame() {
	const now = performance.now();
	const dt = Math.min((now - lastT) / 1000, 0.1);
	lastT = now;
	update(dt);
	resize();
	bakeSome();
	render();

	const pct = state.bakeDirty ? `baking ${state.bakeCursor}/${VOL}` : 'baked ✓';
	hud.textContent =
		`6D Mandelbrot — prebaked volume (${VOL}³)\n` +
		`slice axes (R,U,F): ${state.sliceAxes.map(a => axisNames[a]).join(' / ')}  [${pct}]\n` +
		`pos: ${state.position.map(v => v.toFixed(3)).join(', ')}  extent: ${state.extent.toFixed(3)}\n` +
		`cam: yaw ${state.camYaw.toFixed(2)} pitch ${state.camPitch.toFixed(2)} dist ${state.camDist.toFixed(2)}\n` +
		`drag=orbit  shift-drag=pan slice  wheel=zoom cam  WASD/QE/RF/TG=move slice  +/-=extent  Tab=cycle axes`;

	requestAnimationFrame(frame);
}
frame();

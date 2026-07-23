import vsSrc from './shaders/fullscreen.vert.glsl?raw';
import fsSrc from './shaders/mandelbrot3d.frag.glsl?raw';
import { Vec6 } from './maths/Vec6.js';
import { Mat6 } from './maths/Mat6.js';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLPreElement;
const gl = canvas.getContext('webgl2')!;

function compile(type: number, src: string) {
	const s = gl.createShader(type)!;
	gl.shaderSource(s, src);
	gl.compileShader(s);
	if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
		console.error(gl.getShaderInfoLog(s));
		console.error(src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
		throw new Error('shader compile failed');
	}
	return s;
}

function createProgram(vsSrc: string, fsSrc: string) {
	const p = gl.createProgram()!;
	gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
	gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
	gl.linkProgram(p);
	if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
		console.error(gl.getProgramInfoLog(p));
		throw new Error('link failed');
	}
	return p;
}

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

function requireUniform(name: string) {
	const loc = gl.getUniformLocation(prog, name);
	if (!loc) throw new Error(`uniform ${name} not found`);
	return loc;
}

function requireVec6(base: string) {
	return {
		x: requireUniform(`${base}.x`),
		y: requireUniform(`${base}.y`),
		z: requireUniform(`${base}.z`),
		w: requireUniform(`${base}.w`),
		v: requireUniform(`${base}.v`),
		u: requireUniform(`${base}.u`),
	};
}

function setVec6(locs: ReturnType<typeof requireVec6>, v: Vec6) {
	gl.uniform1f(locs.x, v.x);
	gl.uniform1f(locs.y, v.y);
	gl.uniform1f(locs.z, v.z);
	gl.uniform1f(locs.w, v.w);
	gl.uniform1f(locs.v, v.v);
	gl.uniform1f(locs.u, v.u);
}

const uniforms = {
	u_pos: requireVec6('u_pos'),
	u_right: requireVec6('u_right'),
	u_up: requireVec6('u_up'),
	u_forward: requireVec6('u_forward'),
	u_screenSize: requireUniform('u_screenSize'),
	u_zoom: requireUniform('u_zoom'),
	u_bailoutRadiusSquared: requireUniform('u_bailoutRadiusSquared'),
	u_maxIterations: requireUniform('u_maxIterations'),
	u_lightDir: requireUniform('u_lightDir'),
	u_stepFactor: requireUniform('u_stepFactor'),
	u_maxSteps: requireUniform('u_maxSteps'),
	u_sliceExtent: requireUniform('u_sliceExtent'),
};

const AXIS_NAMES = ['x(c.re)', 'y(c.im)', 'z(z0.re)', 'w(z0.im)', 'v(e.re)', 'u(e.im)'] as const;
const ALL_AXES: Vec6[] = [Vec6.X(), Vec6.Y(), Vec6.Z(), Vec6.W(), Vec6.V(), Vec6.U()];

// ---- State ----
const state = {
	sliceAxes: [Vec6.X(), Vec6.Y(), Vec6.Z()] as [Vec6, Vec6, Vec6],
	position: new Vec6(-0.5, 0, -2, 0, 2, 0),
	zoom: 0.2,
	renderScale: 0.6,
	rotMatrix: Mat6.identity(),
	maxIterations: 40,
	stepSize: 0.02,
	sliceExtent: 1.5 * 1.2 * 2,
	bailout: 1e10,
	lightDir: [-0.5, -0.7, -1.0] as [number, number, number],
};

interface Frame {
	right: Vec6;
	up: Vec6;
	forward: Vec6;
}

function buildFrame(): Frame {
	const r = state.rotMatrix.multiplyVec6(state.sliceAxes[0]);
	const u = state.rotMatrix.multiplyVec6(state.sliceAxes[1]);
	const f = state.rotMatrix.multiplyVec6(state.sliceAxes[2]);
	return { right: r, up: u, forward: f };
}

// ---- Input ----
const keys: Record<string, boolean> = {};
let dragging = false, lastX = 0, lastY = 0;

canvas.addEventListener('mousedown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', e => {
	if (!dragging) return;
	const dx = (e.clientX - lastX) / canvas.clientHeight;
	const dy = (e.clientY - lastY) / canvas.clientHeight;
	lastX = e.clientX; lastY = e.clientY;
	const frame = buildFrame();
	state.position = state.position.add(frame.right.scale(-dx / state.zoom)).add(frame.up.scale(dy / state.zoom));
});
canvas.addEventListener('wheel', e => {
	e.preventDefault();
	state.zoom *= Math.exp(-e.deltaY * 0.001);
}, { passive: false });

window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

// Cycle slice axis triplets with Tab
window.addEventListener('keydown', e => {
	if (e.key === 'Tab') {
		e.preventDefault();
		const idx = ALL_AXES.indexOf(state.sliceAxes[0]);
		const next = (idx + 1) % 6;
		state.sliceAxes = [ALL_AXES[next]!, ALL_AXES[(next + 1) % 6]!, ALL_AXES[(next + 2) % 6]!];
		state.rotMatrix = Mat6.identity();
	}
});

function update(dt: number): void {
	const rs = 1.2 * dt;
	const ps = 1.0 / state.zoom * dt;
	const frame = buildFrame();

	// T/G: rotate around right axis (tilt up/down)
	if (keys['t']) state.rotMatrix = Mat6.rotationFromAxes(frame.up, frame.forward, rs).multiply(state.rotMatrix);
	if (keys['g']) state.rotMatrix = Mat6.rotationFromAxes(frame.up, frame.forward, -rs).multiply(state.rotMatrix);
	// F/H: rotate around up axis (pan left/right)
	if (keys['f']) state.rotMatrix = Mat6.rotationFromAxes(frame.right, frame.forward, rs).multiply(state.rotMatrix);
	if (keys['h']) state.rotMatrix = Mat6.rotationFromAxes(frame.right, frame.forward, -rs).multiply(state.rotMatrix);

	if (keys['a']) state.position = state.position.add(frame.right.scale(-ps));
	if (keys['d']) state.position = state.position.add(frame.right.scale(ps));
	if (keys['w']) state.position = state.position.add(frame.up.scale(ps));
	if (keys['s']) state.position = state.position.add(frame.up.scale(-ps));
	if (keys['arrowup']) state.position = state.position.add(frame.forward.scale(ps));
	if (keys['arrowdown']) state.position = state.position.add(frame.forward.scale(-ps));
	if (keys['+'] || keys['=']) state.zoom *= 1 + dt;
	if (keys['-']) state.zoom /= 1 + dt;
}

function resize(): void {
	const dpr = Math.min(window.devicePixelRatio, 1) * state.renderScale;
	const w = Math.max(2, Math.floor(canvas.clientWidth * dpr));
	const h = Math.max(2, Math.floor(canvas.clientHeight * dpr));
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w; canvas.height = h;
		gl.viewport(0, 0, w, h);
	}
}

let lastT = performance.now();
function renderFrame(): void {
	const now = performance.now();
	const dt = Math.min((now - lastT) / 1000, 0.1);
	lastT = now;
	update(dt);
	resize();

	const frame = buildFrame();
	gl.useProgram(prog);
	setVec6(uniforms.u_pos, state.position);
	setVec6(uniforms.u_right, frame.right);
	setVec6(uniforms.u_up, frame.up);
	setVec6(uniforms.u_forward, frame.forward);
	gl.uniform2f(uniforms.u_screenSize, canvas.width, canvas.height);
	gl.uniform1f(uniforms.u_zoom, state.zoom);
	gl.uniform1f(uniforms.u_bailoutRadiusSquared, state.bailout);
	gl.uniform1i(uniforms.u_maxIterations, state.maxIterations);
	gl.uniform3fv(uniforms.u_lightDir, state.lightDir);
	gl.uniform1f(uniforms.u_stepFactor, state.stepSize / 0.01);
	const maxSteps = Math.ceil(2 * state.sliceExtent / (state.stepSize * 0.35));
	gl.uniform1i(uniforms.u_maxSteps, maxSteps);
	gl.uniform1f(uniforms.u_sliceExtent, state.sliceExtent);

	gl.drawArrays(gl.TRIANGLES, 0, 3);

	hud.textContent =
		`6D Mandelbrot — 3D slice\n` +
		`slice axes (R,U,F): ${state.sliceAxes.map(a => AXIS_NAMES[ALL_AXES.indexOf(a)]).join(' / ')}\n` +
		`pos: ${state.position.toArray().map(v => v.toFixed(3)).join(', ')}\n` +
		`zoom: ${state.zoom.toFixed(3)}\n` +
		`drag=pan  wheel=zoom  WASD=pan  T/G=rotate up/down  F/H=rotate left/right  arrows=depth  Tab=cycle axes`;

	requestAnimationFrame(renderFrame);
}
renderFrame();
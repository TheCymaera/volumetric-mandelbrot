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
	u_stepSize: requireUniform('u_stepSize'),
	u_maxSteps: requireUniform('u_maxSteps'),
	u_maxDistance: requireUniform('u_maxDistance'),
	u_focalLength: requireUniform('u_focalLength'),
	u_fogDensity: requireUniform('u_fogDensity'),
	u_fogColor: requireUniform('u_fogColor'),
	u_glowIntensity: requireUniform('u_glowIntensity'),
};

// ---- State ----
interface InputMode {
	name: string;
	horizontal: Vec6;
	vertical: Vec6;
	depth: Vec6;
	planeMappings: { from: number, to: number }[];
}

const inputModes = [
	{
		name: "Mandelbrot",
		horizontal: Vec6.X(),
		vertical: Vec6.Y(),
		depth: Vec6.Z(),
		planeMappings: []
	} as InputMode,
	{
		name: "Julia",
		horizontal: Vec6.Z(),
		vertical: Vec6.W(),
		depth: Vec6.ZERO(),
		planeMappings: [
			{ from: Vec6.X_INDEX, to: Vec6.Z_INDEX },
			{ from: Vec6.Y_INDEX, to: Vec6.W_INDEX },
		]
	} as InputMode,
	{
		name: "X",
		horizontal: Vec6.V(),
		vertical: Vec6.U(),
		depth: Vec6.ZERO(),
		planeMappings: [
			{ from: Vec6.X_INDEX, to: Vec6.V_INDEX },
			{ from: Vec6.Y_INDEX, to: Vec6.U_INDEX },
		]
	} as InputMode,
] as const;

//const rotMatrix = Mat6.createPlaneMapping(Vec6.X_INDEX, Vec6.Y_INDEX, Vec6.Z_INDEX, Vec6.W_INDEX);

const state = {
	axes: { right: Vec6.X(), up: Vec6.Y(), forward: Vec6.Z() },
	inputMode: inputModes[0]!,
	position: new Vec6(0, 0, 0, 0, 2, 0),
	zoom: 0.2,
	focalLength: 3.0,
	dolly: 3.0,
	resolution: 0.6,
	rotMatrix: Mat6.identity(),
	maxIterations: 80,
	stepSize: 0.03,
	maxDistance: 1.5 * 1.2 * 2 * 3,
	bailout: 1e10,
	lightDir: [-0.5, -0.7, -1.0] as [number, number, number],
	fogDensity: 0.1,
	fogColor: [0.1, 0.15, 0.3, 1.0] as [number, number, number, number],
	glowIntensity: 12,
};

interface Frame {
	right: Vec6;
	up: Vec6;
	forward: Vec6;
}

function buildFrame(): Frame {
	const r = state.rotMatrix.multiplyVec6(state.axes.right);
	const u = state.rotMatrix.multiplyVec6(state.axes.up);
	const f = state.rotMatrix.multiplyVec6(state.axes.forward);
	return { right: r, up: u, forward: f };
}

// ---- Input ----
const keys: Record<string, boolean> = {};
let dragging = false, lastX = 0, lastY = 0;

canvas.addEventListener('mousedown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', e => {
	if (!dragging) return;
	const dx = (e.clientX - lastX) / canvas.clientHeight * 3;
	const dy = (e.clientY - lastY) / canvas.clientHeight * 3;
	lastX = e.clientX; lastY = e.clientY;
	const frame = buildFrame();
	// horizontal drag → rotate around up axis (like F/H)
	state.rotMatrix = Mat6.rotationFromAxes(frame.right, frame.forward, -dx).multiply(state.rotMatrix);
	// vertical drag → rotate around right axis (like T/G)
	state.rotMatrix = Mat6.rotationFromAxes(frame.up, frame.forward, dy).multiply(state.rotMatrix);
});
canvas.addEventListener('wheel', e => {
	e.preventDefault();
	state.dolly += e.deltaY * 0.001;
}, { passive: false });

window.addEventListener('keydown', e => {
	const k = e.key.toLowerCase();
	keys[k] = true;
	if (k === '1') state.inputMode = inputModes[0];
	if (k === '2') state.inputMode = inputModes[1];
	if (k === '3') state.inputMode = inputModes[2];
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

function update(deltaTime: number): void {
	const rotSpeed = 1.2 * deltaTime;
	const moveSpeed = .5 / state.zoom * deltaTime;
	const frame = buildFrame();

	// T/G: rotate around right axis (tilt up/down)
	if (keys['t']) state.rotMatrix = Mat6.rotationFromAxes(frame.up, frame.forward, rotSpeed).multiply(state.rotMatrix);
	if (keys['g']) state.rotMatrix = Mat6.rotationFromAxes(frame.up, frame.forward, -rotSpeed).multiply(state.rotMatrix);
	// F/H: rotate around up axis (pan left/right)
	if (keys['f']) state.rotMatrix = Mat6.rotationFromAxes(frame.right, frame.forward, rotSpeed).multiply(state.rotMatrix);
	if (keys['h']) state.rotMatrix = Mat6.rotationFromAxes(frame.right, frame.forward, -rotSpeed).multiply(state.rotMatrix);

	// Movement uses the active input mode axes, rotated by the view
	const hAxis = state.rotMatrix.multiplyVec6(state.inputMode.horizontal);
	const vAxis = state.rotMatrix.multiplyVec6(state.inputMode.vertical);
	const dAxis = state.rotMatrix.multiplyVec6(state.inputMode.depth);

	if (keys['a']) state.position = state.position.add(hAxis.scale(-moveSpeed));
	if (keys['d']) state.position = state.position.add(hAxis.scale(moveSpeed));
	if (keys['w']) state.position = state.position.add(vAxis.scale(moveSpeed));
	if (keys['s']) state.position = state.position.add(vAxis.scale(-moveSpeed));
	if (keys['shift']) {
		state.position = state.position.add(dAxis.scale(moveSpeed));
		for (const mapping of state.inputMode.planeMappings) {
			state.rotMatrix = Mat6.rotationFromAxes(
				Vec6.fromIndex(mapping.from),
				Vec6.fromIndex(mapping.to),
				rotSpeed
			).multiply(state.rotMatrix);
		}
	}
	if (keys[' ']) {
		state.position = state.position.add(dAxis.scale(-moveSpeed));
		for (const mapping of state.inputMode.planeMappings) {
			state.rotMatrix = Mat6.rotationFromAxes(
				Vec6.fromIndex(mapping.from),
				Vec6.fromIndex(mapping.to),
				-rotSpeed
			).multiply(state.rotMatrix);
		}
	}
}

function resize(): void {
	const dpr = Math.min(window.devicePixelRatio, 1) * state.resolution;
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
	const deltaTime = Math.min((now - lastT) / 1000, 0.1);
	lastT = now;
	update(deltaTime);
	resize();

	const frame = buildFrame();
	const effectivePos = state.position.add(frame.forward.scale(-state.dolly));
	gl.useProgram(prog);
	setVec6(uniforms.u_pos, effectivePos);
	setVec6(uniforms.u_right, frame.right);
	setVec6(uniforms.u_up, frame.up);
	setVec6(uniforms.u_forward, frame.forward);
	gl.uniform2f(uniforms.u_screenSize, canvas.width, canvas.height);
	gl.uniform1f(uniforms.u_zoom, state.zoom);
	gl.uniform1f(uniforms.u_bailoutRadiusSquared, state.bailout);
	gl.uniform1i(uniforms.u_maxIterations, state.maxIterations);
	gl.uniform3fv(uniforms.u_lightDir, state.lightDir);
	gl.uniform1f(uniforms.u_stepSize, state.stepSize);
	gl.uniform1i(uniforms.u_maxSteps, Math.ceil(state.maxDistance / state.stepSize));
	gl.uniform1f(uniforms.u_maxDistance, state.maxDistance);
	gl.uniform1f(uniforms.u_focalLength, state.focalLength);
	gl.uniform1f(uniforms.u_fogDensity, state.fogDensity);
	gl.uniform4f(uniforms.u_fogColor, ...state.fogColor);
	gl.uniform1f(uniforms.u_glowIntensity, state.glowIntensity);

	gl.drawArrays(gl.TRIANGLES, 0, 3);

	hud.textContent =
		`mode: ${state.inputMode.name} (1/2/3 to switch)\n` +
		`right: ${state.axes.right.toArray().map(v => v.toFixed(3)).join(', ')}\n` +
		`up: ${state.axes.up.toArray().map(v => v.toFixed(3)).join(', ')}\n` +
		`forward: ${state.axes.forward.toArray().map(v => v.toFixed(3)).join(', ')}\n` +
		`pos: ${state.position.toArray().map(v => v.toFixed(3)).join(', ')}\n` +
		`zoom: ${state.zoom.toFixed(3)}  dolly: ${state.dolly.toFixed(2)}`;

	requestAnimationFrame(renderFrame);
}
renderFrame();
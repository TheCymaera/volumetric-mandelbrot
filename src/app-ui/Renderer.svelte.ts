import vsSrc from '../shaders/fullscreen.vert.glsl?raw';
import fsSrc from '../shaders/mandelbrot3d.frag.glsl?raw';
import { Vec6 } from '../utilities/maths/Vec6.js';
import { deepEquals } from '../utilities/deepEquals.js';
import { frame, mandelbrot, toSerializable } from '../mandelbrot.svelte.js';

const AXIS_COLORS: [number, number, number, number][] = [
	[1.0, 0.0, 0.0, 1.0], // X: red
	[0.0, 1.0, 0.0, 1.0], // Y: green
	[0.0, 0.4, 1.0, 1.0], // Z: blue
	[1.0, 0.8, 0.0, 1.0], // W: gold
	[0.9, 0.3, 1.0, 1.0], // V: magenta
	[0.0, 1.0, 1.0, 1.0], // U: cyan
];
const AXIS_LABELS = ['X', 'Y', 'Z', 'W', 'V', 'U'];
const basisVectors = [Vec6.X(), Vec6.Y(), Vec6.Z(), Vec6.W(), Vec6.V(), Vec6.U()];

const AXIS_LINE_WIDTH = 3;
const AXIS_DOT_RADIUS = 4;
const AXIS_FONT_SIZE = 11;
const AXIS_ORIGIN_RADIUS = 3;
const AXIS_SCALE_FACTOR = 0.12;
const AXIS_LABEL_OFFSET_FACTOR = 0.12;
const AXIS_STROKE_ALPHA_FACTOR = 0.7;
const AXIS_MIN_ALPHA = 1;
const AXIS_DEPTH_FADE_RANGE = .6;

export class Renderer {
	#canvas: HTMLCanvasElement;
	#ctx: CanvasRenderingContext2D;
	#glCanvas: HTMLCanvasElement;
	#gl: WebGL2RenderingContext;
	#program: WebGLProgram;
	#vao: WebGLVertexArrayObject;
	#uniforms: ReturnType<Renderer['_requireUniforms']>;
	#lastState: ReturnType<typeof toSerializable> | null = null;

	render() {
		const didResize = this.resize();

		const serialized = toSerializable(true);
		if (!didResize && deepEquals(this.#lastState, serialized)) return;
		this.#lastState = serialized;

		console.log('Rendering frame', serialized);
		this.#renderGL();
		this.#composite();
	}

	constructor(canvas: HTMLCanvasElement) {
		this.#canvas = canvas;
		this.#ctx = canvas.getContext('2d')!;

		this.#glCanvas = document.createElement('canvas');
		const gl = this.#glCanvas.getContext('webgl2');
		if (!gl) throw new Error('WebGL2 not supported');
		this.#gl = gl;

		this.#program = this.#createProgram(gl, vsSrc, fsSrc);
		gl.useProgram(this.#program);

		this.#vao = gl.createVertexArray()!;
		gl.bindVertexArray(this.#vao);
		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

		this.#uniforms = this._requireUniforms(gl);
	}

	#compile(gl: WebGL2RenderingContext, type: number, src: string) {
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

	#createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string) {
		const p = gl.createProgram()!;
		gl.attachShader(p, this.#compile(gl, gl.VERTEX_SHADER, vsSrc));
		gl.attachShader(p, this.#compile(gl, gl.FRAGMENT_SHADER, fsSrc));
		gl.linkProgram(p);
		if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
			console.error(gl.getProgramInfoLog(p));
			throw new Error('link failed');
		}
		return p;
	}

	#requireUniform(gl: WebGL2RenderingContext, name: string) {
		const out = gl.getUniformLocation(this.#program, name);
		if (!out) throw new Error(`Uniform ${name} not found`);
		return out;
	}

	private _requireVec6(gl: WebGL2RenderingContext, base: string) {
		return {
			x: this.#requireUniform(gl, `${base}.x`),
			y: this.#requireUniform(gl, `${base}.y`),
			z: this.#requireUniform(gl, `${base}.z`),
			w: this.#requireUniform(gl, `${base}.w`),
			v: this.#requireUniform(gl, `${base}.v`),
			u: this.#requireUniform(gl, `${base}.u`),
		};
	}

	private _requireUniforms(gl: WebGL2RenderingContext) {
		return {
			u_pos: this._requireVec6(gl, 'u_pos'),
			u_right: this._requireVec6(gl, 'u_right'),
			u_up: this._requireVec6(gl, 'u_up'),
			u_forward: this._requireVec6(gl, 'u_forward'),
			u_screenSize: this.#requireUniform(gl, 'u_screenSize'),
			u_retinaWidth: this.#requireUniform(gl, 'u_retinaWidth'),
			u_bailoutRadiusSquared: this.#requireUniform(gl, 'u_bailoutRadiusSquared'),
			u_maxIterations: this.#requireUniform(gl, 'u_maxIterations'),
			u_lightDir: this.#requireUniform(gl, 'u_lightDir'),
			u_stepSize: this.#requireUniform(gl, 'u_stepSize'),
			u_maxSteps: this.#requireUniform(gl, 'u_maxSteps'),
			u_maxDistance: this.#requireUniform(gl, 'u_maxDistance'),
			u_focalLength: this.#requireUniform(gl, 'u_focalLength'),
			u_fogDensity: this.#requireUniform(gl, 'u_fogDensity'),
			u_fogColor: this.#requireUniform(gl, 'u_fogColor'),
			u_glowIntensity: this.#requireUniform(gl, 'u_glowIntensity'),
			u_glowThreshold: this.#requireUniform(gl, 'u_glowThreshold'),
			u_stepSizeMinFactor: this.#requireUniform(gl, 'u_stepSizeMinFactor'),
			u_binarySearchIterations: this.#requireUniform(gl, 'u_binarySearchIterations'),
			u_normalStepFactor: this.#requireUniform(gl, 'u_normalStepFactor'),
			u_exteriorStepFactor: this.#requireUniform(gl, 'u_exteriorStepFactor'),
			u_ambientLight: this.#requireUniform(gl, 'u_ambientLight'),
			u_diffuseFactor: this.#requireUniform(gl, 'u_diffuseFactor'),
			u_logSmoothingRadius: this.#requireUniform(gl, 'u_logSmoothingRadius'),
		};
	}

	#setVec6(locs: ReturnType<typeof this._requireVec6>, v: Vec6) {
		const gl = this.#gl!;
		gl.uniform1f(locs.x, v.x);
		gl.uniform1f(locs.y, v.y);
		gl.uniform1f(locs.z, v.z);
		gl.uniform1f(locs.w, v.w);
		gl.uniform1f(locs.v, v.v);
		gl.uniform1f(locs.u, v.u);
	}

	#calculateResolution() {
		const aspectRatio = (this.#canvas.clientWidth / Math.max(this.#canvas.clientHeight, 1)) || 1;
		const dpr = window.devicePixelRatio || 1;

		const widthSetting = parseInt(mandelbrot.resolution.width) || undefined;
		const heightSetting = parseInt(mandelbrot.resolution.height) || undefined;

		if (!widthSetting && !heightSetting) return {
			width: Math.floor(this.#canvas.clientWidth * dpr),
			height: Math.floor(this.#canvas.clientHeight * dpr),
		};

		if (heightSetting && !widthSetting) {
			const height = heightSetting;
			const width = Math.round(height * aspectRatio) || 1;
			return { height, width };
		}

		if (widthSetting && !heightSetting) {
			const width = widthSetting;
			const height = Math.round(width / aspectRatio) || 1;
			return { width, height };
		}

		return {
			width: widthSetting!,
			height: heightSetting!,
			useContainFit: true,
		};
	}

	resize() {
		const gl = this.#gl!;
		const { width, height, useContainFit } = this.#calculateResolution();
		
		const w = Math.max(2, width);
		const h = Math.max(2, height);
		if (this.#glCanvas.width === w && this.#glCanvas.height === h) return false;
		this.#glCanvas.width = w;
		this.#glCanvas.height = h;
		this.#canvas.width = w;
		this.#canvas.height = h;
		gl.viewport(0, 0, w, h);
		this.#canvas.style.objectFit = useContainFit ? 'contain' : '';
		return true;
	}

	#renderGL() {
		const gl = this.#gl!;
		const u = this.#uniforms!;
		const effectivePos = mandelbrot.position.add(frame.forward.scale(-mandelbrot.dolly));

		gl.useProgram(this.#program);
		this.#setVec6(u.u_pos, effectivePos);
		this.#setVec6(u.u_right, frame.right);
		this.#setVec6(u.u_up, frame.up);
		this.#setVec6(u.u_forward, frame.forward);
		gl.uniform2f(u.u_screenSize, this.#glCanvas.width, this.#glCanvas.height);
		gl.uniform1f(u.u_retinaWidth, mandelbrot.retinaWidth);
		gl.uniform1f(u.u_bailoutRadiusSquared, mandelbrot.bailout ** 2);
		gl.uniform1i(u.u_maxIterations, mandelbrot.maxIterations);
		gl.uniform3fv(u.u_lightDir, mandelbrot.lightDir);
		gl.uniform1f(u.u_stepSize, mandelbrot.stepSize);
		gl.uniform1f(u.u_stepSizeMinFactor, mandelbrot.stepSizeMinFactor);
		gl.uniform1i(u.u_maxSteps, Math.ceil(mandelbrot.maxDistance / mandelbrot.stepSize));
		gl.uniform1f(u.u_maxDistance, mandelbrot.maxDistance);
		gl.uniform1f(u.u_focalLength, mandelbrot.focalLength);
		gl.uniform1f(u.u_fogDensity, mandelbrot.fogDensity);
		gl.uniform4f(u.u_fogColor, ...mandelbrot.fogColor);
		gl.uniform1f(u.u_glowIntensity, mandelbrot.glowIntensity);
		gl.uniform1f(u.u_glowThreshold, mandelbrot.glowThreshold);
		gl.uniform1i(u.u_binarySearchIterations, mandelbrot.binarySearchIterations);
		gl.uniform1f(u.u_normalStepFactor, mandelbrot.normalStepFactor);
		gl.uniform1f(u.u_exteriorStepFactor, mandelbrot.exteriorStepFactor);
		gl.uniform1f(u.u_ambientLight, mandelbrot.ambientLight);
		gl.uniform1f(u.u_diffuseFactor, mandelbrot.diffuseFactor);
		gl.uniform1f(u.u_logSmoothingRadius, Math.log(mandelbrot.smoothingRadius));
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	#composite() {
		const ctx = this.#ctx;

		// Draw WebGL output
		ctx.drawImage(this.#glCanvas, 0, 0);

		// Draw axes overlay directly
		if (mandelbrot.showAxes) {
			this.#drawAxes();
		}
	}

	#drawAxes() {
		const ctx = this.#ctx;
		const w = this.#canvas.width;
		const h = this.#canvas.height;

		const canvasScale = w / Math.max(this.#canvas.clientWidth, 1);
		const pixelScale = Math.min(w, h) * AXIS_SCALE_FACTOR;
		const centerX = w / 2;
		const centerY = h / 2;
		const originPos = mandelbrot.position.scale(-1);

		const projections = basisVectors.map(bv => {
			const camX = bv.dot(frame.right);
			const camY = bv.dot(frame.up);
			const camZ = bv.dot(frame.forward);
			const effectiveZ = mandelbrot.focalLength + camZ;
			const scale = mandelbrot.focalLength / Math.max(effectiveZ, 0.01);
			return { x: camX * scale, y: camY * scale, depth: camZ };
		});

		const depthSorted = projections.map((p, i) => ({ index: i, depth: p.depth })).sort((a, b) => b.depth - a.depth);

		const originProj = (() => {
			const camX = originPos.dot(frame.right);
			const camY = originPos.dot(frame.up);
			const camZ = originPos.dot(frame.forward);
			const effectiveZ = mandelbrot.focalLength + camZ;
			const scale = mandelbrot.focalLength / Math.max(effectiveZ, 0.01);
			return { x: camX * scale, y: camY * scale };
		})();

		const ax = centerX + originProj.x * pixelScale;
		const ay = centerY - originProj.y * pixelScale;

		for (const { index } of depthSorted) {
			const proj = projections[index]!;
			const sx = ax + proj.x * pixelScale;
			const sy = ay - proj.y * pixelScale;
			const alpha = Math.max(AXIS_MIN_ALPHA, Math.min(1.0, AXIS_DEPTH_FADE_RANGE - proj.depth * AXIS_DEPTH_FADE_RANGE));
			const [cr, cg, cb] = AXIS_COLORS[index]!;

			ctx.beginPath();
			ctx.moveTo(ax, ay);
			ctx.lineTo(sx, sy);
			ctx.strokeStyle = `rgba(${Math.round(cr * 255)}, ${Math.round(cg * 255)}, ${Math.round(cb * 255)}, ${(alpha * AXIS_STROKE_ALPHA_FACTOR).toFixed(3)})`;
			ctx.lineWidth = AXIS_LINE_WIDTH * canvasScale;
			ctx.stroke();

			ctx.beginPath();
			ctx.arc(sx, sy, AXIS_DOT_RADIUS * canvasScale, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(${Math.round(cr * 255)}, ${Math.round(cg * 255)}, ${Math.round(cb * 255)}, ${alpha.toFixed(3)})`;
			ctx.fill();

			ctx.font = `bold ${AXIS_FONT_SIZE * canvasScale}px monospace`;
			ctx.fillStyle = `rgba(${Math.round(cr * 255)}, ${Math.round(cg * 255)}, ${Math.round(cb * 255)}, ${alpha.toFixed(3)})`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'bottom';
			const labelOffX = (sx - ax) * AXIS_LABEL_OFFSET_FACTOR;
			const labelOffY = (sy - ay) * AXIS_LABEL_OFFSET_FACTOR;
			ctx.fillText(AXIS_LABELS[index]!, sx + labelOffX, sy - 6 * canvasScale + labelOffY);
		}

		const distToOrigin = mandelbrot.position.length();
		const originInFront = originPos.dot(frame.forward) + mandelbrot.focalLength > 0.01;
		if (originInFront && distToOrigin < 50) {
			ctx.beginPath();
			ctx.arc(ax, ay, AXIS_ORIGIN_RADIUS * canvasScale, 0, Math.PI * 2);
			ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
			ctx.fill();
		}
	}
}
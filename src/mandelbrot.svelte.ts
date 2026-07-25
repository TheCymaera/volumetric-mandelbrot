import { deepEquals } from "./utilities/deepEquals";
import { Mat6 } from "./utilities/maths/Mat6";
import { lerp } from "./utilities/maths/numbers";
import { Vec6 } from "./utilities/maths/Vec6";


export const axes = { right: Vec6.X(), up: Vec6.Y(), forward: Vec6.Z() };
export const mandelbrot = $state({
	position: new Vec6(0, 0, 0, 0, 2, 0),
	orientation: Mat6.identity(),
	dolly: 3.0,

	retinaWidth: 4,
	focalLength: 3.0,
	moveSpeed: 2,
	rotateSpeed: 90,
	maxIterations: 60,
	stepSize: 0.03,
	stepSizeMinFactor: .35,
	maxDistance: 10,
	bailout: Infinity,
	lightDir: [-0.5, -0.7, -1.0] as [number, number, number],
	fogDensity: 0.1,
	fogColor: [0.1, 0.15, 0.3, 1.0] as [number, number, number, number],
	glowIntensity: 3,
	glowThreshold: 0.05,
	binarySearchIterations: 4,
	normalStepFactor: 0.5,
	exteriorStepFactor: 1.5,
	ambientLight: 0.25,
	diffuseFactor: 0.85,
	smoothingRadius: 2,

	showAxes: true,
	resolution: {
		width: '800',
		height: 'Auto',
	},
});

export const frame = {
	get right() { return mandelbrot.orientation.multiplyVec6(axes.right); },
	get up() { return mandelbrot.orientation.multiplyVec6(axes.up); },
	get forward() { return mandelbrot.orientation.multiplyVec6(axes.forward); },
}

console.log(`
For scripting, use:
- mandelbrot
- Mat6
- Vec6
`.trim())
Object.assign(globalThis, { mandelbrot, Mat6, Vec6 });

export type Mandelbrot = typeof mandelbrot;

export type Preset = Partial<Mandelbrot>;

export function presetFromJson(data: any): Preset {
	const out = { ...data }
	if (data.position) out.position = Vec6.fromMaybeArray(data.position);
	if (data.orientation) out.orientation = Mat6.fromMaybeArray(data.orientation);
	if (data.bailout === "Infinity") out.bailout = Infinity;
	return out;
}

export function presetIsApplied(preset: Preset): boolean {

	let isApplied = true;
	for (const k in preset) {
		const key = k as keyof Preset;
		isApplied &&= deepEquals(mandelbrot[key], preset[key]);
	}
	if (deepEquals(currentLerpPreset, preset)) return true;
	return isApplied;
}

function lerpPreset(a: Preset, b: Preset, t: number): Preset {
	if (t <= 0) return a;
	if (t >= 1) return b;

	const out = {} as Preset;
	for (const k in b) {
		const key = k as keyof Preset;
		const aValue = a[key] as unknown;
		const bValue = b[key] as unknown;

		let value: unknown;
		if (aValue instanceof Vec6 && bValue instanceof Vec6) {
			value = aValue.lerp(bValue, t);
		} else if (aValue instanceof Mat6 && bValue instanceof Mat6) {
			value = aValue.perElementLerp(bValue, t);
		} else if (typeof aValue === 'number' && typeof bValue === 'number') {
			value = lerp(aValue, bValue, t);
		} else {
			value = bValue;
		}

		// @ts-expect-error
		out[key] = value;
	}
	return out;
}

export function applyPreset(preset: Preset) {
	Object.assign(mandelbrot, preset);
}

let currentLerpPreset: Preset | null = null;
export function applyPresetWithLerp(preset: Preset, duration: number, ease: (t: number) => number) {
	const start = { ...mandelbrot };
	const startTime = performance.now();

	currentLerpPreset = preset;

	function step() {
		const now = performance.now();
		const elapsed = now - startTime;
		const t = Math.min(elapsed / (duration * 1000), 1);
		const easedT = ease(t);

		applyPreset(lerpPreset(start, preset, easedT));

		if (t < 1) {
			requestAnimationFrame(step);
		} else {
			currentLerpPreset = null;
		}
	}

	requestAnimationFrame(step);
}

export function toSerializable(includeRenderOptions: boolean) {
	const position = {
		position: mandelbrot.position.toArray(),
		orientation: mandelbrot.orientation.toArray(),
		dolly: mandelbrot.dolly,
	}

	return {
		...includeRenderOptions ? $state.snapshot(mandelbrot) : {},
		...position,
	};
}
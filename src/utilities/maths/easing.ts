export function linear(t: number): number {
	return t;
}

export function easeInOutBezier(t: number): number {
	return t * t * (3 - 2 * t)
}

export function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Calculates a frame-rate independent lerp
 */
export function expLerpFactor(lerpAmount: number, deltaTime: number): number {
	return 1 - Math.exp(-lerpAmount * deltaTime);
}

/**
 * Lerp two numbers
 */
export function lerp(a: number, b: number, lerp: number): number {
	return a + (b - a) * lerp;
}

/**
 * Move a value towards a target by a maximum delta
 */
export function moveTowards(current: number, target: number, maxDelta: number): number {
	if (Math.abs(target - current) <= maxDelta) {
		return target;
	}
	return current + Math.sign(target - current) * maxDelta;
}
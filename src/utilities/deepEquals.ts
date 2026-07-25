export function deepEquals(a: unknown, b: unknown) {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;

	if (Array.isArray(a)) {
		if (a.length !== (b as any[]).length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!deepEquals(a[i], (b as any[])[i])) return false;
		}
		return true;
	} else {
		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b as object);
		if (aKeys.length !== bKeys.length) return false;
		for (const key of aKeys) {
			if (!deepEquals((a as any)[key], (b as any)[key])) return false;
		}
		return true;
	}
}
import { lerp } from "./numbers.js";

export class Vec2 {
	constructor(public x: number = 0, public y: number = 0) {}
	
	static from(x: number, y: number): Vec2 {
		return new Vec2(x, y);
	}

	static fromMaybeArray(array: unknown): Vec2 {
		if (!Array.isArray(array) || array.length !== 2 || !array.every(Number.isFinite)) {
			throw new Error('Invalid Vec2 array');
		}
		const a = array as number[];
		return new Vec2(a[0]!, a[1]!);
	}
	
	static zero(): Vec2 {
		return new Vec2(0, 0);
	}
	
	clone(): Vec2 {
		return new Vec2(this.x, this.y);
	}
	
	add(other: Vec2): Vec2 {
		return new Vec2(this.x + other.x, this.y + other.y);
	}
	
	subtract(other: Vec2): Vec2 {
		return new Vec2(this.x - other.x, this.y - other.y);
	}
	
	multiply(scalar: number): Vec2 {
		return new Vec2(this.x * scalar, this.y * scalar);
	}
	
	length(): number {
		return Math.sqrt(this.x * this.x + this.y * this.y);
	}
	
	normalize(): Vec2 {
		const len = this.length();
		return len > 0 ? new Vec2(this.x / len, this.y / len) : new Vec2(0, 0);
	}
	
	lerp(other: Vec2, t: number): Vec2 {
		return new Vec2(
			lerp(this.x, other.x, t),
			lerp(this.y, other.y, t)
		);
	}

	distanceTo(other: Vec2): number {
		return this.subtract(other).length();
	}

	angleTo(other: Vec2): number {
		return Math.atan2(other.y - this.y, other.x - this.x);
	}
	
	toArray(): [number, number] {
		return [this.x, this.y];
	}
}

import { lerp } from "./numbers.js";

export class Vec3 {
	constructor(public x: number = 0, public y: number = 0, public z: number = 0) {}
	
	static from(x: number, y: number, z: number): Vec3 {
		return new Vec3(x, y, z);
	}
	
	static zero(): Vec3 {
		return new Vec3(0, 0, 0);
	}
	
	clone(): Vec3 {
		return new Vec3(this.x, this.y, this.z);
	}
	
	add(other: Vec3): Vec3 {
		return new Vec3(this.x + other.x, this.y + other.y, this.z + other.z);
	}
	
	subtract(other: Vec3): Vec3 {
		return new Vec3(this.x - other.x, this.y - other.y, this.z - other.z);
	}
	
	multiply(scalar: number): Vec3 {
		return new Vec3(this.x * scalar, this.y * scalar, this.z * scalar);
	}
	
	length(): number {
		return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
	}
	
	normalize(): Vec3 {
		const len = this.length();
		return len > 0 ? new Vec3(this.x / len, this.y / len, this.z / len) : new Vec3(0, 0, 0);
	}

	distanceTo(other: Vec3): number {
		return Math.sqrt(
			(this.x - other.x) ** 2 +
			(this.y - other.y) ** 2 +
			(this.z - other.z) ** 2
		);
	}

	lerp(other: Vec3, t: number): Vec3 {
		return new Vec3(
			lerp(this.x, other.x, t),
			lerp(this.y, other.y, t),
			lerp(this.z, other.z, t)
		);
	}

	moveTowards(target: Vec3, maxDistance: number): Vec3 {
		const diff = target.subtract(this);
		if (diff.length() === 0) return this;

		const distance = Math.min(maxDistance, this.distanceTo(target));
		return this.add(diff.normalize().multiply(distance));
	}
	
	toArray(): [number, number, number] {
		return [this.x, this.y, this.z];
	}
}

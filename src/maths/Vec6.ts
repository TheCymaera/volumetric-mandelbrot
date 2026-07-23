import { lerp } from "./numbers.js";

export class Vec6 {
	x: number;
	y: number;
	z: number;
	w: number;
	v: number;
	u: number;

	constructor(x: number, y: number, z: number, w: number, v: number, u: number) {
		this.x = x;
		this.y = y;
		this.z = z;
		this.w = w;
		this.v = v;
		this.u = u;
	}

	static fromMaybeArray(array: unknown): Vec6 {
		if (!Array.isArray(array) || array.length !== 6 || !array.every(Number.isFinite)) {
			throw new Error('Invalid Vec6 array');
		}
		const a = array as number[];
		return new Vec6(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!);
	}

	toArray(): number[] {
		return [this.x, this.y, this.z, this.w, this.v, this.u];
	}

	equals(other: Vec6): boolean {
		return this.x === other.x && this.y === other.y && this.z === other.z &&
				this.w === other.w && this.v === other.v && this.u === other.u;
	}

	add(other: Vec6): Vec6 {
		return new Vec6(
			this.x + other.x,
			this.y + other.y,
			this.z + other.z,
			this.w + other.w,
			this.v + other.v,
			this.u + other.u
		);
	}

	lerp(other: Vec6, t: number): Vec6 {
		return new Vec6(
			lerp(this.x, other.x, t),
			lerp(this.y, other.y, t),
			lerp(this.z, other.z, t),
			lerp(this.w, other.w, t),
			lerp(this.v, other.v, t),
			lerp(this.u, other.u, t),
		);
	}

	dot(other: Vec6): number {
		return this.x * other.x + this.y * other.y + this.z * other.z + 
				this.w * other.w + this.v * other.v + this.u * other.u;
	}

	length(): number {
		return Math.sqrt(this.dot(this));
	}

	normalize(): Vec6 {
		const mag = this.length();
		if (mag === 0) return new Vec6(0, 0, 0, 0, 0, 0);
		return this.scale(1 / mag);
	}

	isZero(): boolean {
		return this.x === 0 && this.y === 0 && this.z === 0 && this.w === 0 && this.v === 0 && this.u === 0;
	}

	scale(scalar: number): Vec6 {
		return new Vec6(
			this.x * scalar,
			this.y * scalar,
			this.z * scalar,
			this.w * scalar,
			this.v * scalar,
			this.u * scalar
		);
	}

	subtract(other: Vec6): Vec6 {
		return new Vec6(
			this.x - other.x,
			this.y - other.y,
			this.z - other.z,
			this.w - other.w,
			this.v - other.v,
			this.u - other.u
		);
	}

	moveTowards(target: Vec6, maxDistance: number): Vec6 {
		const diff = target.subtract(this);
		if (diff.length() === 0) return this;

		const distance = Math.min(maxDistance, this.distanceTo(target));
		return this.add(diff.normalize().scale(distance));
	}

	distanceTo(other: Vec6): number {
		return Math.sqrt(
			(this.x - other.x) ** 2 +
			(this.y - other.y) ** 2 +
			(this.z - other.z) ** 2 +
			(this.w - other.w) ** 2 +
			(this.v - other.v) ** 2 +
			(this.u - other.u) ** 2
		);
	}

	static readonly X_INDEX = 0;
	static readonly Y_INDEX = 1;
	static readonly Z_INDEX = 2;
	static readonly W_INDEX = 3;
	static readonly V_INDEX = 4;
	static readonly U_INDEX = 5;

	static fromIndex(index: number): Vec6 {
		switch (index) {
			case Vec6.X_INDEX: return new Vec6(1, 0, 0, 0, 0, 0);
			case Vec6.Y_INDEX: return new Vec6(0, 1, 0, 0, 0, 0);
			case Vec6.Z_INDEX: return new Vec6(0, 0, 1, 0, 0, 0);
			case Vec6.W_INDEX: return new Vec6(0, 0, 0, 1, 0, 0);
			case Vec6.V_INDEX: return new Vec6(0, 0, 0, 0, 1, 0);
			case Vec6.U_INDEX: return new Vec6(0, 0, 0, 0, 0, 1);
			default: throw new Error('Invalid index');
		}
	}

	static ZERO(): Vec6 { return new Vec6(0, 0, 0, 0, 0, 0); }
	static X(): Vec6 { return new Vec6(1, 0, 0, 0, 0, 0); }
	static Y(): Vec6 { return new Vec6(0, 1, 0, 0, 0, 0); }
	static Z(): Vec6 { return new Vec6(0, 0, 1, 0, 0, 0); }
	static W(): Vec6 { return new Vec6(0, 0, 0, 1, 0, 0); }
	static V(): Vec6 { return new Vec6(0, 0, 0, 0, 1, 0); }
	static U(): Vec6 { return new Vec6(0, 0, 0, 0, 0, 1); }

	static NEG_X(): Vec6 { return new Vec6(-1, 0, 0, 0, 0, 0); }
	static NEG_Y(): Vec6 { return new Vec6(0, -1, 0, 0, 0, 0); }
	static NEG_Z(): Vec6 { return new Vec6(0, 0, -1, 0, 0, 0); }
	static NEG_W(): Vec6 { return new Vec6(0, 0, 0, -1, 0, 0); }
	static NEG_V(): Vec6 { return new Vec6(0, 0, 0, 0, -1, 0); }
	static NEG_U(): Vec6 { return new Vec6(0, 0, 0, 0, 0, -1); }
}

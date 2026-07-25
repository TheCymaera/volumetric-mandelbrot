import { lerp } from './numbers.js';
import { Vec6 } from './Vec6.js';

export class Mat6 {
	// Store as column-major order (like OpenGL)
	private m: Float64Array;

	private constructor(array?: number[]) {
		this.m = new Float64Array(36);
		if (array) {
			this.m.set(array);
		} else {
			this.identity();
		}
	}

	static fromMaybeArray(arr: unknown): Mat6 {
		if (!Array.isArray(arr) || !arr.every(Number.isFinite)) {
			throw new Error('Invalid Mat6 array');
		}
		return Mat6.fromArray(arr as number[]);
	}

	static fromArray(array: number[]): Mat6 {
		if (array.length !== 36) throw new Error('Mat6 must have 36 elements');
		return new Mat6(array);
	}

	static identity() {
		return new Mat6;
	}

	toArray(): number[] {
		return Array.from(this.m);
	}

	equals(other: Mat6): boolean {
		for (let i = 0; i < 36; i++) {
			if (this.m[i] !== other.m[i]) return false;
		}
		return true;
	}

	identity(): Mat6 {
		this.m.fill(0);
		for (let i = 0; i < 6; i++) {
			this.m[i * 6 + i] = 1;
		}
		return this;
	}

	getElement(row: number, col: number): number | undefined {
		return this.m[col * 6 + row];
	}

	setElement(row: number, col: number, value: number): void {
		this.m[col * 6 + row] = value;
	}

	clone(): Mat6 {
		return new Mat6().set(this)
	}

	set(other: Mat6): Mat6 {
		this.m.set(other.m);
		return this;
	}

	multiplyVec6(v: Vec6): Vec6 {
		const components = [v.x, v.y, v.z, v.w, v.v, v.u];
		const resultComponents = [0, 0, 0, 0, 0, 0];

		for (let i = 0; i < 6; i++) {
			for (let j = 0; j < 6; j++) {
				resultComponents[i]! += this.getElement(i, j)! * components[j]!;
			}
		}

		return new Vec6(
			resultComponents[0]!,
			resultComponents[1]!,
			resultComponents[2]!,
			resultComponents[3]!,
			resultComponents[4]!,
			resultComponents[5]!,
		);
	}

	multiply(other: Mat6): Mat6 {
		const result = new Mat6();
		for (let i = 0; i < 6; i++) {
			for (let j = 0; j < 6; j++) {
				let sum = 0;
				for (let k = 0; k < 6; k++) {
					sum += this.getElement(i, k)! * other.getElement(k, j)!;
				}
				result.setElement(i, j, sum);
			}
		}
		return result;
	}

	/**
	 * Efficiently multiply by the transpose of this matrix: result = (this^T) * v
	 * For pure rotation matrices, transpose equals inverse, so this avoids an O(n^3) inverse.
	 */
	multiplyTransposeVec6(v: Vec6): Vec6 {
		const components = [v.x, v.y, v.z, v.w, v.v, v.u];
		const resultComponents = [0, 0, 0, 0, 0, 0];

		for (let j = 0; j < 6; j++) {
			let sum = 0;
			for (let i = 0; i < 6; i++) {
				sum += this.getElement(i, j)! * components[i]!; // dot(column j, v)
			}
			resultComponents[j] = sum;
		}

		return new Vec6(
			resultComponents[0]!,
			resultComponents[1]!,
			resultComponents[2]!,
			resultComponents[3]!,
			resultComponents[4]!,
			resultComponents[5]!,
		);
	}

	perElementLerp(other: Mat6, t: number): Mat6 {
		const out = new Mat6();
		for (let r = 0; r < 6; r++) {
			for (let c = 0; c < 6; c++) {
				const v0 = this.getElement(r, c)!;
				const v1 = other.getElement(r, c)!;
				out.setElement(r, c, lerp(v0, v1, t));
			}
		}
		return out;
	}

	static rotationFromAxisIndices(axis1: number, axis2: number, angle: number): Mat6 {
		const matrix = new Mat6();
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);

		// Set rotation in the specified plane
		matrix.setElement(axis1, axis1, cos);
		matrix.setElement(axis1, axis2, -sin);
		matrix.setElement(axis2, axis1, sin);
		matrix.setElement(axis2, axis2, cos);

		return matrix;
	}

	static createPlaneMapping(fromAxis1: number, fromAxis2: number, toAxis1: number, toAxis2: number, rotation = Math.PI / 2): Mat6 {
		return (
			Mat6.rotationFromAxisIndices(fromAxis1, toAxis1, rotation)
			.multiply(Mat6.rotationFromAxisIndices(fromAxis2, toAxis2, rotation))
		)
	}

	static rotationFromAxes(axis1: Vec6, axis2: Vec6, angle: number): Mat6 {
		// Normalize the first axis
		const u1 = axis1.normalize();
		
		// Orthogonalize the second axis using Gram-Schmidt
		const proj = u1.scale(u1.dot(axis2));
		const u2 = axis2.subtract(proj).normalize();
		
		// If vectors are parallel, return identity
		if (u2.length() < 1e-10) {
			return Mat6.identity();
		}
		
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		
		// Create rotation matrix: I + sin(θ)(u1⊗u2 - u2⊗u1) + (cos(θ)-1)(u1⊗u1 + u2⊗u2)
		const matrix = Mat6.identity();
		
		// Convert Vec6 to arrays for easier component access
		const u1Array = u1.toArray();
		const u2Array = u2.toArray();
		
		// For each matrix element
		for (let i = 0; i < 6; i++) {
			for (let j = 0; j < 6; j++) {
				const u1i = u1Array[i] ?? 0;
				const u1j = u1Array[j] ?? 0;
				const u2i = u2Array[i] ?? 0;
				const u2j = u2Array[j] ?? 0;
				
				// Apply Rodrigues' rotation formula in the plane
				// Flipped sign to match standard rotation convention (from u1 towards u2)
				const delta = sin * (u2i * u1j - u1i * u2j) + 
							 (cos - 1) * (u1i * u1j + u2i * u2j);
				
				const currentValue = matrix.getElement(i, j);
				if (currentValue !== undefined) {
					matrix.setElement(i, j, currentValue + delta);
				}
			}
		}
		
		return matrix;
	}
}

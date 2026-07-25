//import { infoWindowOpened } from "../app-ui/AppInfo.svelte";

import { infoWindowOpened } from "./app-ui/AppInfo.svelte";

export const keyMap = new class KeyMap {
	onHalfSpeed: ()=>void = ()=>{};
	onDoubleSpeed: ()=>void = ()=>{};
	onChooseInputMode: (id: number)=>void = ()=>{};

	get isMovingLeft(): boolean {
		return this.#pressed.has('KeyA') || this.#pressed.has('ArrowLeft');
	}
	
	get isMovingRight(): boolean {
		return this.#pressed.has('KeyD') || this.#pressed.has('ArrowRight');
	}
	
	get isMovingUp(): boolean {
		return this.#pressed.has('KeyW') || this.#pressed.has('ArrowUp');
	}
	
	get isMovingDown(): boolean {
		return this.#pressed.has('KeyS') || this.#pressed.has('ArrowDown');
	}
	
	get isMovingForward(): boolean {
		return this.#pressed.has('ShiftLeft') || this.#pressed.has('ShiftRight');
	}
	
	get isMovingBackward(): boolean {
		return this.#pressed.has('Space');
	}

	readonly #pressed = new Set<string>();
	constructor() {
		window.addEventListener('keyup', (e) => {
			this.#pressed.delete(e.code);
		});

		window.addEventListener('keydown', (e) => {
			// ignore if input is focused
			if (document.activeElement instanceof HTMLInputElement ||
				document.activeElement instanceof HTMLTextAreaElement) {
				return;
			}

			// ignore if info page is open
			if (infoWindowOpened()) {
				return;
			}

			this.#pressed.add(e.code);

			const movementModes: Record<string, number> = {
				'Digit1': 0,
				'Digit2': 1,
				'Digit3': 2,
				'Digit4': 3,
			};

			const id = movementModes[e.code];
			if (id !== undefined) this.onChooseInputMode(id);

			if (e.code === 'BracketLeft') {
				this.onHalfSpeed();
			}
			
			if (e.code === 'BracketRight') {
				this.onDoubleSpeed();
			}
		});
	}
}
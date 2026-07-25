<script lang="ts">
	import { onMount } from 'svelte';
	import { Vec6 } from '../utilities/maths/Vec6.js';
	import { Mat6 } from '../utilities/maths/Mat6.js';
	import NumberField from '../ui-components/NumberField.svelte';
	import TextField from '../ui-components/TextField.svelte';
	import Button from '../ui-components/Button.svelte';
	import CircleButton from '../ui-components/CircleButton.svelte';
	import SelectField from '../ui-components/SelectField.svelte';
	import CheckboxField from '../ui-components/CheckboxField.svelte';
	import NavRailButton from '../ui-components/NavRailButton.svelte';
	import NavRail from '../ui-components/NavRail.svelte';
	import NavRailSpacer from '../ui-components/NavRailSpacer.svelte';
	import { fa5_brands_github, fa5_solid_bars, fa5_solid_book, fa5_solid_code, fa5_solid_info, fa5_solid_paintBrush, fa5_solid_times, fa6_solid_upDownLeftRight } from 'fontawesome-svgs';
	import { deepEquals } from '../utilities/deepEquals';
	import { keyMap } from '../keyMap';
	import { presets } from '../presets.js';
	import { linear, easeInOutBezier } from '../utilities/maths/easing.js';
	import { mandelbrot, presetIsApplied, type Preset, applyPresetWithLerp, presetFromJson, applyPreset, toSerializable, axes, frame } from '../mandelbrot.svelte';
	import { githubRepositoryLink } from './links';
	import { Renderer } from './Renderer.svelte.js';
    import { MediaQuery } from 'svelte/reactivity';

	// ---- Canvas refs ----
	let canvas: HTMLCanvasElement;
	let renderer: Renderer;

	// ---- State ----
	interface InputMode {
		name: string;
		horizontal: Vec6;
		vertical: Vec6;
		dolly: boolean;
		planeMappings: { from: number; to: number }[];
	}

	const inputModeDefs: InputMode[] = [
		{
			name: 'Mandelbrot',
			horizontal: Vec6.X(),
			vertical: Vec6.Y(),
			dolly: true,
			planeMappings: [],
		},
		{
			name: 'Julia',
			horizontal: Vec6.Z(),
			vertical: Vec6.W(),
			dolly: false,
			planeMappings: [
				{ from: Vec6.X_INDEX, to: Vec6.Z_INDEX },
				{ from: Vec6.Y_INDEX, to: Vec6.W_INDEX },
			],
		},
		{
			name: 'X',
			horizontal: Vec6.V(),
			vertical: Vec6.U(),
			dolly: false,
			planeMappings: [
				{ from: Vec6.X_INDEX, to: Vec6.V_INDEX },
				{ from: Vec6.Y_INDEX, to: Vec6.U_INDEX },
			],
		},
	];

	let inputMode = $state(structuredClone(inputModeDefs[0]!));
	let moveMode: "global" | "local" = $state("local");
	let rotateMode: "global" | "local" = $state("global");

	let rotateBy = $state(90);
	let loadPresetLerpDuration = $state(1);
	let loadPresetLerpEase = $state(easeInOutBezier);

	// ---- Animation & input ----
	let dragging = false;
	let lastX = 0;
	let lastY = 0;

	keyMap.onDoubleSpeed = ()=>mandelbrot.moveSpeed *= 2;
	keyMap.onHalfSpeed = ()=>mandelbrot.moveSpeed /= 2;
	keyMap.onChooseInputMode = (id)=>{
		const mode = inputModeDefs[id];
		if (mode) inputMode = structuredClone(mode);
	};

	function update(deltaTime: number) {
		const rotSpeed = 1.2 * deltaTime;
		const moveSpeed = mandelbrot.moveSpeed * deltaTime;

		let dir = Vec6.ZERO();
		if (keyMap.isMovingRight) dir = dir.add(inputMode.horizontal);
		if (keyMap.isMovingLeft) dir = dir.subtract(inputMode.horizontal);
		if (keyMap.isMovingUp) dir = dir.add(inputMode.vertical);
		if (keyMap.isMovingDown) dir = dir.subtract(inputMode.vertical);
		dir.normalize();

		if (moveMode === 'local') {
			dir = mandelbrot.orientation.multiplyVec6(dir);
		}

		mandelbrot.position = mandelbrot.position.add(dir.scale(moveSpeed));

		let rotAmount = 0;
		let dollyAmount = 0;
		if (keyMap.isMovingForward) {
			rotAmount += rotSpeed;
			if (inputMode.dolly) dollyAmount += moveSpeed;
		}
		if (keyMap.isMovingBackward) {
			rotAmount -= rotSpeed;
			if (inputMode.dolly) dollyAmount -= moveSpeed;
		}
		rotate(rotAmount, rotateMode);
		mandelbrot.dolly += dollyAmount;
	}

	onMount(() => {
		renderer = new Renderer(canvas);

		// Mouse drag to rotate
		canvas.addEventListener('pointerdown', e => {
			if (e.button !== 0) return;

			dragging = true;
			lastX = e.clientX;
			lastY = e.clientY;
		});
		window.addEventListener('pointerup', () => {
			dragging = false;
		});
		window.addEventListener('pointermove', e => {
			if (!dragging) return;
			const dx = ((e.clientX - lastX) / canvas.clientHeight) * 3;
			const dy = ((e.clientY - lastY) / canvas.clientHeight) * 3;
			lastX = e.clientX;
			lastY = e.clientY;
			const { right, up, forward } = frame;
			mandelbrot.orientation = Mat6.rotationFromAxes(right, forward, -dx).multiply(mandelbrot.orientation);
			mandelbrot.orientation = Mat6.rotationFromAxes(up, forward, dy).multiply(mandelbrot.orientation);
		});

		// Scroll to dolly
		canvas.addEventListener('wheel', e => {
			e.preventDefault();
			mandelbrot.dolly += e.deltaY * 0.001;
		}, { passive: false });

		// Resize observer
		const resizeObserver = new ResizeObserver(() => {
			renderer.render();
		});
		resizeObserver.observe(canvas.parentElement!);

		// Animation loop
		let lastT = performance.now();
		function animate() {
			const now = performance.now();
			const deltaTime = Math.min((now - lastT) / 1000, 0.1);
			lastT = now;

			update(deltaTime);
			renderer.render();

			requestAnimationFrame(animate);
		}
		requestAnimationFrame(animate);

		return () => {
			resizeObserver.disconnect();
		};
	});

	let jsonError = $state('');
	let jsonIncludeRenderOptions = $state(false);

	function prettyPrintJson(data: unknown) {
		return JSON.stringify(data, function (k, v) {
			if (v instanceof Array) return JSON.stringify(v);
			return v;
		}, '\t')
		.replace(/\\/g, '')
		.replace(/\"\[/g, '[')
		.replace(/\]\"/g, ']')
		.replace(/\"\{/g, '{')
		.replace(/\}\"/g, '}');
	}

	function loadJson(text: string) {
		try {
			const data = JSON.parse(text);
			applyPreset(presetFromJson(data));
			jsonError = '';
		} catch (err) {
			jsonError = err instanceof Error ? err.message : 'Invalid JSON';
		}
	}


	// ---- Helpers ----
	function getAxisIndex(axis: Vec6) {
		if (axis.x > 0) return Vec6.X_INDEX;
		if (axis.y > 0) return Vec6.Y_INDEX;
		if (axis.z > 0) return Vec6.Z_INDEX;
		if (axis.w > 0) return Vec6.W_INDEX;
		if (axis.v > 0) return Vec6.V_INDEX;
		return Vec6.U_INDEX;
	}

	function getAxisNameFromIndex(index: number) {
		return ['X', 'Y', 'Z', 'W', 'V', 'U'][index] ?? 'U';
	}

	function getAxisName(vec: Vec6) {
		return getAxisNameFromIndex(getAxisIndex(vec));
	}

	function rotate(amount: number, mode: "global" | "local") {
		for (const mapping of inputMode.planeMappings) {
			let from = Vec6.fromIndex(mapping.from);
			let to = Vec6.fromIndex(mapping.to);
			
			if (mode === "local") {
				from = mandelbrot.orientation.multiplyVec6(from);
				to = mandelbrot.orientation.multiplyVec6(to);
			}

			mandelbrot.orientation = Mat6.rotationFromAxes(Vec6.fromIndex(mapping.from), Vec6.fromIndex(mapping.to), amount).multiply(mandelbrot.orientation);
		}
	}

	// Plane mappings for rotation select
	const rotations: { name: string; mapping: { from: number; to: number }[] }[] = [
		{ name: 'None', mapping: [] },
		{ name: 'Mandelbrot XYZ to Mandelbrot XYW', mapping: [
			{ from: Vec6.Z_INDEX, to: Vec6.W_INDEX },
		] },
		{ name: 'Mandelbrot XYZ to Julia ZWX', mapping: [
			{ from: Vec6.X_INDEX, to: Vec6.Z_INDEX },
			{ from: Vec6.Y_INDEX, to: Vec6.W_INDEX },
		] },
		{ name: 'Mandelbrot XYZ to Julia ZWY', mapping: [
			{ from: Vec6.X_INDEX, to: Vec6.Z_INDEX },
			{ from: Vec6.Y_INDEX, to: Vec6.W_INDEX },
			{ from: Vec6.X_INDEX, to: Vec6.Y_INDEX },
		] },
		{ name: 'Mandelbrot XYZ to X VUX', mapping: [
			{ from: Vec6.X_INDEX, to: Vec6.V_INDEX },
			{ from: Vec6.Y_INDEX, to: Vec6.U_INDEX },
		] },
		{ name: 'Mandelbrot XYZ to X VUY', mapping: [
			{ from: Vec6.X_INDEX, to: Vec6.V_INDEX },
			{ from: Vec6.Y_INDEX, to: Vec6.U_INDEX },
			{ from: Vec6.X_INDEX, to: Vec6.Y_INDEX },
		] },
		{ name: 'Mandelbrot XYZ to X VUZ', mapping: [
			{ from: Vec6.X_INDEX, to: Vec6.V_INDEX },
			{ from: Vec6.Y_INDEX, to: Vec6.U_INDEX },
			{ from: Vec6.X_INDEX, to: Vec6.Z_INDEX },
		] },
		{ name: 'Mandelbrot XYZ to X VUW', mapping: [
			{ from: Vec6.X_INDEX, to: Vec6.V_INDEX },
			{ from: Vec6.Y_INDEX, to: Vec6.U_INDEX },
			{ from: Vec6.X_INDEX, to: Vec6.W_INDEX },
		] },
	];
	for (let i = 0; i < 6; i++) {
		for (let j = i + 1; j < 6; j++) {
			rotations.push({
				name: `${getAxisNameFromIndex(i)}${getAxisNameFromIndex(j)} Plane`,
				mapping: [{ from: i, to: j }],
			});
		}
	}

	// ---- Sidebar state ----
	let sidebarOpen = $state(true);
	let sidebarSection: 'controls' | 'rendering' | 'preset' | 'json' = $state('controls');
	const deviceSupportsHover = new MediaQuery("(hover: hover)");
</script>

<main
	style:--sidebar-width="450px"
	style:--sidebar-height="50%"
	class="inset-0 bg-background overflow-hidden relative"
>
	<div class="
		absolute transition-all duration-300
		inset-0
		{sidebarOpen ? `
			bottom-(--sidebar-height) md:bottom-0
			md:left-(--sidebar-width)
		` : ''}
	">
		<div class="
			absolute top-0 left-0 flex flex-col gap-4 p-4
			w-min h-full
			hover:opacity-100 transition-opacity delay-50 duration-500
			{deviceSupportsHover.current ? "opacity-0" : ""}
		">
			<CircleButton 
				onPress={()=>(sidebarOpen = !sidebarOpen)}
				label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
			>
				{@html sidebarOpen ? fa5_solid_times : fa5_solid_bars}
			</CircleButton>
		</div>
		<canvas 
			bind:this={canvas}
			class="w-full h-full block outline-none"
			tabindex="0"
		></canvas>
	</div>

	<!-- Collapsible sidebar -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="
			absolute bottom-0 left-0 bg-surface transition-transform duration-300
			w-full h-(--sidebar-height)
			md:w-(--sidebar-width) md:h-full
			grid grid-cols-[min-content_1fr]
			{sidebarOpen ?
				`translate-x-0 translate-y-0` :
				'translate-y-full md:translate-y-0 md:-translate-x-full'
			}
		"
		onkeydown={(e) => {
			if (e.code === 'Space' || e.code === 'Shift') {
				e.preventDefault();
			}
		}}
	>
		<NavRail placement="left">
			<NavRailButton
				selected={sidebarSection === 'controls'}
				onPress={() => (sidebarSection = 'controls')}
				label="Position"
				displayLabel={true}
			>
				{@html fa6_solid_upDownLeftRight}
			</NavRailButton>

			<NavRailButton
				selected={sidebarSection === 'rendering'}
				onPress={() => (sidebarSection = 'rendering')}
				label="Display"
				displayLabel={true}
			>
				{@html fa5_solid_paintBrush}
			</NavRailButton>

			<NavRailButton
				selected={sidebarSection === 'preset'}
				onPress={() => (sidebarSection = 'preset')}
				label="Presets"
				displayLabel={true}
			>
				{@html fa5_solid_book}
			</NavRailButton>

			<NavRailButton
				selected={sidebarSection === 'json'}
				onPress={() => (sidebarSection = 'json')}
				label="JSON"
				displayLabel={true}
			>
				{@html fa5_solid_code}
			</NavRailButton>

			<NavRailSpacer />

			<a tabindex="-1" href="#info">
				<NavRailButton label="Info" onPress={() => {}}>
					{@html fa5_solid_info}
				</NavRailButton>
			</a>

			<a tabindex="-1" href={githubRepositoryLink} target="_blank">
				<NavRailButton label="GitHub" onPress={() => {}}>
					{@html fa5_brands_github}
				</NavRailButton>
			</a>
		</NavRail>

		<div class="p-4 overflow-y-auto">
			{#if sidebarSection === 'controls'}
				{@render controlSettings()}
			{:else if sidebarSection === 'rendering'}
				{@render renderSettings()}
			{:else if sidebarSection === 'preset'}
				{@render presetSettings()}
			{:else if sidebarSection === 'json'}
				{@render jsonSettings()}
			{/if}
		</div>
	</div>
</main>

{#snippet controlSettings()}
	<!-- Input Mode -->
	<div class="mb-6">
		<h3 class="text-lg font-semibold mb-2">Input Mode</h3>
		<div class="grid grid-cols-3 gap-2 text-sm mb-4">
			{#each inputModeDefs.slice(0,3) as mode, i}
				<Button
					onPress={() => (inputMode = mode)}
					className="w-full p-2! rounded!"
					variant={deepEquals(inputMode, mode) ? 'filled' : 'outlined'}
				>
					{mode.name}
				</Button>
			{/each}
		</div>

		{#snippet kbd(text: string)}
			<kbd class="bg-surfaceContainer text-onSurfaceContainer rounded px-3 ml-1 font-mono">{text}</kbd>
		{/snippet}

		<div class="text-sm mb-3">
			<div class="flex items-center mb-1">
				Press {@render kbd('1')}, {@render kbd('2')}, or {@render kbd('3')} to switch modes
			</div>
			<div class="flex items-center mb-1">
				<div>Move {moveMode === 'local' ? "Local " : ""}{getAxisName(inputMode.horizontal)}</div>
				{@render kbd('W')}{@render kbd('D')}
			</div>
			<div class="flex items-center mb-1">
				<div>Move {moveMode === 'local' ? "Local " : ""} {getAxisName(inputMode.vertical)}</div>
				{@render kbd('A')}{@render kbd('S')}
			</div>
			<div class="flex items-center mb-1">
				{inputMode.planeMappings.length > 0 ? 'Rotate' : `Dolly`}
				{@render kbd('Shift')}{@render kbd('Space')}
			</div>
		</div>

		<div class="text-sm mb-3 font-mono bg-surfaceContainer p-2 rounded">
			z = p.z + p.w * i <span class="opacity-30">// Julia</span><br />
			c = p.x + p.y * i <span class="opacity-30">// Mandelbrot</span><br />
			e = p.v + p.u * i <span class="opacity-30">// X</span>
		</div>
		<div class="text-sm mb-3 font-mono bg-surfaceContainer p-2 rounded">
			z = z ^ e + c
		</div>
	</div>

	<!-- Controls -->
	<div class="mb-6">
		<h3 class="text-lg font-semibold mb-2">Controls</h3>
		<div class="grid grid-cols-2 gap-2 mb-2">
			<NumberField label="Move Speed" bind:value={mandelbrot.moveSpeed} />
			<NumberField label="Rotate Speed" bind:value={mandelbrot.rotateSpeed} />
		</div>

		<CheckboxField
			label="Move on Local Axes"
			bind:checked={
				()=>moveMode === 'local',
				(v) => (moveMode = v ? 'local' : 'global')
			}
		/>

		<SelectField
			label="Rotational Plane"
			className="mt-3"
			value={rotations.find(r => deepEquals(r.mapping, inputMode.planeMappings)) ?? rotations[0]!}
			options={rotations.map(r => ({ value: r, label: r.name }))}
			onChange={(e) => (inputMode.planeMappings = e.value.mapping)}
		/>

		<CheckboxField
			label="Rotate on Local Axes"
			bind:checked={
				()=>rotateMode === 'local',
				(v) => (rotateMode = v ? 'local' : 'global')
			}
		/>

		<div class="grid grid-cols-[1fr_min-content] gap-2 items-end mb-3">
			<NumberField label="Rotate By" bind:value={rotateBy} />
			<Button className="w-20 p-2! rounded!" disabled={inputMode.planeMappings.length === 0} onPress={() => {
				const inRadians = rotateBy * (Math.PI / 180);
				for (const mapping of inputMode.planeMappings) {
					mandelbrot.orientation = Mat6.rotationFromAxes(Vec6.fromIndex(mapping.from), Vec6.fromIndex(mapping.to), inRadians).multiply(mandelbrot.orientation);
				}
			}}>
				Rotate
			</Button>
		</div>
	</div>

	<!-- Position -->
	<div class="mb-6">
		<h3 class="text-lg font-semibold mb-2">Position</h3>
		{@render vec6Editor({ vec: mandelbrot.position, readonly: false })}
	</div>

	<div class="mb-6">
		<h3 class="text-lg font-semibold mb-2">Dolly</h3>
		<NumberField label="Dolly" bind:value={mandelbrot.dolly} hideLabel={true} className="w-full mt-2" />
	</div>

	<!-- Rotation -->
	<div class="mb-6">
		<h3 class="text-lg font-semibold mb-2">Rotation</h3>

		<Button className="px-5! p-2! rounded! mt-2" onPress={() => (mandelbrot.orientation = Mat6.identity())}>
			Reset Rotation
		</Button>

		<h4 class="font-semibold mt-4 mb-2">
			Right Vector
		</h4>
		{@render vec6Editor({ vec: frame.right, readonly: true })}

		<h4 class="font-semibold mt-3 mb-2">
			Up Vector
		</h4>
		{@render vec6Editor({ vec: frame.up, readonly: true })}

		<h4 class="font-semibold mt-3 mb-2">
			Forward Vector
		</h4>
		{@render vec6Editor({ vec: frame.forward, readonly: true })}
	</div>
{/snippet}

{#snippet renderSettings()}
	<div class="mb-6">
		<h3 class="text-lg font-semibold mb-2">Resolution</h3>
		<div class="grid grid-cols-2 gap-2 mb-2">
			<TextField
				label="Width"
				bind:value={mandelbrot.resolution.width}
			/>

			<TextField
				label="Height"
				bind:value={mandelbrot.resolution.height}
			/>
		</div>
	</div>

	<div class="mb-6">
		<h3 class="text-lg font-semibold mb-2">Indicators</h3>
		<div class="grid gap-2 mb-2">
			<CheckboxField
				label="Show Axes"
				bind:checked={mandelbrot.showAxes}
			/>
		</div>
	</div>

	<div class="mb-6">
		<h3 class="text-lg font-semibold mb-2">Iteration Settings</h3>
		<div class="grid gap-2 mb-2">
			<NumberField label="Max Iterations" bind:value={mandelbrot.maxIterations} />
			<NumberField label="Bailout Radius" bind:value={mandelbrot.bailout} />
		</div>
	</div>

	<div class="mb-6">
		<h3 class="text-lg font-semibold mb-2">Ray Marching</h3>
		<div class="grid gap-2 mb-2">
			<div class="grid grid-cols-2 gap-2">
				<NumberField label="Step Size" bind:value={mandelbrot.stepSize} />
				<NumberField label="Step Size Min Factor" bind:value={mandelbrot.stepSizeMinFactor} />
			</div>

			<NumberField label="Max Distance" bind:value={mandelbrot.maxDistance} />
			<NumberField label="Focal Length" bind:value={mandelbrot.focalLength} />
			<NumberField label="Retina Width" bind:value={mandelbrot.retinaWidth} />
			<NumberField label="Binary Search Iterations" bind:value={mandelbrot.binarySearchIterations} />
			<NumberField label="Normal Step Factor" bind:value={mandelbrot.normalStepFactor} />
			<NumberField label="Exterior Step Factor" bind:value={mandelbrot.exteriorStepFactor} />
		</div>
	</div>

	<div class="mb-6">
		<h3 class="text-lg font-semibold mb-2">Lighting</h3>
		<div class="grid gap-2 mb-2">
			<NumberField label="Ambient Light" bind:value={mandelbrot.ambientLight} />
			<NumberField label="Diffuse Factor" bind:value={mandelbrot.diffuseFactor} />
		</div>
		<h4 class="font-semibold mb-1">Light Direction</h4>
		<div class="grid grid-cols-3 gap-2 mb-2">
			<NumberField label="X" hideLabel={true} bind:value={mandelbrot.lightDir[0]} />
			<NumberField label="Y" hideLabel={true} bind:value={mandelbrot.lightDir[1]} />
			<NumberField label="Z" hideLabel={true} bind:value={mandelbrot.lightDir[2]} />
		</div>
	</div>

	<div class="mb-6">
		<h3 class="text-lg font-semibold mb-2">Fog</h3>
		<div class="grid gap-2 mb-2">
			<NumberField label="Fog Density" bind:value={mandelbrot.fogDensity} />
		</div>
		<h4 class="font-semibold mb-1">Fog Color</h4>
		<div class="grid grid-cols-4 gap-2 mb-2">
			<NumberField label="R" hideLabel={true} bind:value={mandelbrot.fogColor[0]} />
			<NumberField label="G" hideLabel={true} bind:value={mandelbrot.fogColor[1]} />
			<NumberField label="B" hideLabel={true} bind:value={mandelbrot.fogColor[2]} />
			<NumberField label="A" hideLabel={true} bind:value={mandelbrot.fogColor[3]} />
		</div>
	</div>

	<div class="mb-6">
		<h3 class="text-lg font-semibold mb-2">Glow</h3>
		<div class="grid gap-2 mb-2">
			<NumberField label="Glow Intensity" bind:value={mandelbrot.glowIntensity} />
			<NumberField label="Glow Threshold" bind:value={mandelbrot.glowThreshold} />
		</div>
	</div>

	<div class="mb-6">
		<h3 class="text-lg font-semibold mb-2">Smoothing</h3>
		<div class="grid gap-2 mb-2">
			<NumberField label="Smoothing Radius" bind:value={mandelbrot.smoothingRadius} />
		</div>
	</div>
{/snippet}

{#snippet presetSettings()}
	{#snippet presetButton(opts: { name: string, state: Preset } )}
		{@const applied = presetIsApplied(opts.state)}
		<Button
			className="w-full p-2! rounded! mb-2"
			variant={applied ? 'filled' : 'outlined'}
			onPress={() => applyPresetWithLerp(opts.state, loadPresetLerpDuration, loadPresetLerpEase)}
		>
			{opts.name}
		</Button>
	{/snippet}

	<div class="grid grid-cols-2 gap-2 mb-6">
		<NumberField
			label="Transition Seconds"
			bind:value={loadPresetLerpDuration}
			className="w-full"
		/>

		<SelectField
			label="Easing Function"
			bind:value={loadPresetLerpEase}
			options={[
				{ value: linear, label: 'Linear' },
				{ value: easeInOutBezier, label: 'Ease In Out' },
			]}
		/>
	</div>

	{#each [
		{ name: 'Mandelbrot', presets: presets.mandelbrot },
		{ name: 'Julia', presets: presets.julia },
		{ name: 'Hyperbolic Julia', presets: presets.hyperbolicJulia },
	] as presetSection}
		<h3 class="text-lg font-semibold mb-2">{presetSection.name}</h3>
		{#each presetSection.presets as preset}
			{@render presetButton(preset)}
		{/each}
		{#if presetSection.presets.length === 0}
			<p class="text-sm opacity-50 mb-4">No presets yet</p>
		{/if}
		<div class="mb-6"></div>
	{/each}
{/snippet}

{#snippet jsonSettings()}
	{@const jsonString = prettyPrintJson(toSerializable(jsonIncludeRenderOptions))}

	<div class="mb-6">
		<h3 class="text-lg font-semibold mb-2">JSON State</h3>
		<small class="text-xs opacity-80 text-balance">
			Copy this JSON to save the current state, or paste it to load a state.
		</small>
		<div class="mb-2"></div>
		<textarea
			value={jsonString}
			oninput={(e) => loadJson((e.target as HTMLTextAreaElement).value)}
			placeholder="Paste JSON parameters here..."
			class="w-full p-3 font-mono whitespace-pre resize-none border-[.08rem] border-containerBorder rounded-md bg-transparent outline-offset-[calc(var(--outline-width)*-1)] transition-colors"
			rows={jsonString.split('\n').length + 1}
		></textarea>
		{#if jsonError}
			<div class="text-red-500 text-sm mt-2">Error: {jsonError}</div>
		{/if}

		<CheckboxField
			label="Include Render Options"
			className="mt-2"
			bind:checked={jsonIncludeRenderOptions}
		/>
	</div>
{/snippet}

{#snippet vec6Editor(opts: { vec: Vec6; readonly: boolean })}
	<div class="grid grid-cols-2 gap-2">
		<NumberField label="X" hideLabel={true} readonly={opts.readonly} bind:value={opts.vec.x} />
		<NumberField label="Y" hideLabel={true} readonly={opts.readonly} bind:value={opts.vec.y} />
		<NumberField label="Z" hideLabel={true} readonly={opts.readonly} bind:value={opts.vec.z} />
		<NumberField label="W" hideLabel={true} readonly={opts.readonly} bind:value={opts.vec.w} />
		<NumberField label="V" hideLabel={true} readonly={opts.readonly} bind:value={opts.vec.v} />
		<NumberField label="U" hideLabel={true} readonly={opts.readonly} bind:value={opts.vec.u} />
	</div>
{/snippet}

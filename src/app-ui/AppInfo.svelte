<script lang="ts" module>
	import { fa5_solid_times } from 'fontawesome-svgs';
	import { githubRepositoryLink, homeLink, mandelbrot2DExplorerLink, minecraftYouTubeCode } from './links.js';

	export function infoWindowOpened() {
		return window.location.hash === "#info";
	}
</script>

<div class="bg-surface text-onSurface/80 p-6 rounded-lg text-pretty">
	<h1 class="text-2xl text-onSurface font-bold mb-4 pr-7">Volumetric 6D Mandelbrot Set Explorer</h1>


	<a 
		class="helion-icon-button absolute! top-6 right-6 text-xl"
		title="Close"
		href="#/"
	>
		{@html fa5_solid_times}
	</a>


	<div class="mb-4">
		This tool is a volumetric variant of the <a 
			href="{mandelbrot2DExplorerLink}"
			target="_blank" 
			class="text-primary-500 hover:underline"
		>6D Mandelbrot Explorer</a> that uses ray-marching to render a 3D slice of the 6D Mandelbrot set.
	</div>

	<div class="mb-4">
		The 6D Mandelbrot is a generalization by <a 
			href="https://www.youtube.com/watch?v=Ed1gsyxxwM0" 
			target="_blank" 
			class="text-primary-500 hover:underline"
		>2swap</a>, defined by the iteration:
		<div class="p-3 block font-mono bg-codeContainer my-2">
			zₙ₊₁ = zₙ ^ e + c
		</div>
	</div>

	<h2 class="text-xl text-onSurface font-bold mb-2">Source Code</h2>
	
	<div class="mb-6">
		<a 
			href="{githubRepositoryLink}" 
			target="_blank" 
			class="text-primary-500 hover:underline"
		>
			{githubRepositoryLink}
		</a>
	</div>

	
	<div class="mb-6">
		<h2 class="text-xl text-onSurface font-bold mb-2">Other Tools</h2>
		<a 
			href="{homeLink}" 
			target="_blank" 
			class="text-primary-500 hover:underline"
		>
			{homeLink}
		</a>
	</div>
	
	<div class="mt-6 text-right">
		<a 
			class="helion-filled-button" 
			href="#/"
		>
			Close
		</a>
	</div>
</div>

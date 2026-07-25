import App from './app-ui/Router.svelte';
import "./main.css";
import { mount } from 'svelte';

mount(App, {
	target: document.querySelector('.SvelteOutlet')!,
});
/**
 * The user's own colour (0.22.0): the picker at the end of the user menu
 * (AdminThemeBridge::renderColorPicker()). A preset, a custom colour or "Site default" applies at
 * once, the same way the server prints it (`data-pw-variant` and, for a custom colour,
 * `--pw-primary` on <html>; `pw-variant-<name>` on <body>), and is saved for the user with a POST
 * to the admin (hookUserColorsSave()). A custom colour previews while the native picker moves and
 * saves when it is set. Listeners hear `pw-variant-change` on document (detail: variant, color).
 * The theme script hands the clicks here through Bridge.colors().
 */

import { pwConfig } from './pw';
import { fetchOk, failed } from './fail';

type Site = { variant?: string; primary?: string };

const VARIANTS = ['blue', 'vibrant', 'black', 'pink', 'green', 'custom'];
const HEX = /^#[0-9a-f]{6}$/;

let timer = 0;

function apply(variant: string, color: string): void {
	const root = document.documentElement;
	if (root.getAttribute('data-pw-variant') === variant && (variant !== 'custom' || root.style.getPropertyValue('--pw-primary') === color)) return;
	root.setAttribute('data-pw-variant', variant);
	if (variant === 'custom') root.style.setProperty('--pw-primary', color);
	else root.style.removeProperty('--pw-primary');
	VARIANTS.forEach(v => document.body.classList.toggle('pw-variant-' + v, v === variant));
	document.dispatchEvent(new CustomEvent('pw-variant-change', { detail: { variant, color } }));
}

/**
 * A pick in the colour picker
 *
 * @param el the swatch or the custom colour input (data-pw-variant-pick: a preset, custom, or '')
 * @param save false while the custom colour is still moving: preview only
 */
export function pick(el: HTMLElement, save: boolean): void {
	const box = el.closest<HTMLElement>('.pw-color-pick');
	if (!box) return;
	const variant = el.getAttribute('data-pw-variant-pick') || '';
	const color = variant === 'custom' ? (el as HTMLInputElement).value.toLowerCase() : '';
	if ((variant && VARIANTS.indexOf(variant) < 0) || (variant === 'custom' && !HEX.test(color))) return;
	const site = pwConfig<{ site?: Site }>('AdminThemeBridge').site || {};
	if (variant) apply(variant, color);
	else apply(site.variant || 'blue', site.primary || '');
	box.querySelectorAll<HTMLElement>('button[data-pw-variant-pick]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-pw-variant-pick') === variant)));
	box.classList.toggle('pw-color-pick-custom', variant === 'custom');
	if (!save) return;
	// one request for a quick run of picks
	window.clearTimeout(timer);
	timer = window.setTimeout(() => {
		const body = new URLSearchParams({ bridgeColors: '1', variant, color });
		const token = box.getAttribute('data-token-name');
		if (token) body.set(token, box.getAttribute('data-token-value') || '');
		fetchOk(box.getAttribute('data-url') || '', { method: 'POST', body }).catch(err => failed('colour', err));
	}, 250);
}

/**
 * The user's own colour (0.22.0): the picker at the end of the user menu
 * (AdminThemeBridge::renderColorPicker()). A preset, a custom colour or "Site default" applies at
 * once, the same way the server prints it (`data-pw-variant` and, for a custom colour,
 * `--pw-primary` and its text colour `--primary-foreground` on <html>, 1.3.0; `pw-variant-<name>`
 * on <body>), and is saved for the user with a POST
 * to the admin (hookUserColorsSave()). A custom colour previews while the native picker moves and
 * saves when it is set. Listeners hear `pw-variant-change` on document (detail: variant, color).
 * The theme script hands the clicks here through Bridge.colors().
 */

import { pwConfig } from './pw';
import { fetchOk, failed } from './fail';

type Site = { variant?: string; primary?: string };

const VARIANTS = ['red', 'blue', 'vibrant', 'black', 'pink', 'green', 'custom'];
const HEX = /^#[0-9a-f]{6}$/;

let timer = 0;

/**
 * The text colour on a custom primary, as AdminThemeBridge::onPrimary() (1.3.0): white or the
 * theme's near-black, whichever has the higher WCAG 2 contrast ratio; white on a tie
 */
function onPrimary(color: string): string {
	if (!HEX.test(color)) return '#ffffff';
	let lum = 0;
	[0.2126, 0.7152, 0.0722].forEach((weight, i) => {
		let c = parseInt(color.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
		c = c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
		lum += weight * c;
	});
	const dark = (10 / 255) / 12.92;
	return 1.05 / (lum + 0.05) >= (lum + 0.05) / (dark + 0.05) ? '#ffffff' : '#0a0a0a';
}

function apply(variant: string, color: string): void {
	const root = document.documentElement;
	if (root.getAttribute('data-pw-variant') === variant && (variant !== 'custom' || root.style.getPropertyValue('--pw-primary') === color)) return;
	root.setAttribute('data-pw-variant', variant);
	if (variant === 'custom') {
		root.style.setProperty('--pw-primary', color);
		root.style.setProperty('--primary-foreground', onPrimary(color));
	} else {
		root.style.removeProperty('--pw-primary');
		root.style.removeProperty('--primary-foreground');
	}
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
	else apply(site.variant || 'red', site.primary || '');
	box.querySelectorAll<HTMLElement>('button[data-pw-variant-pick]').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-pw-variant-pick') === variant)));
	// the colour in use is ringed: the pick, or the site's after "Site default"
	const inUse = variant || site.variant || 'red';
	box.querySelectorAll<HTMLElement>('.pw-color-swatch').forEach(s => s.classList.toggle('pw-color-current', (s.getAttribute('data-pw-variant') || 'custom') === inUse));
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

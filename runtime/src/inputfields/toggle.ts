/**
 * InputfieldToggle without jQuery (milestone 2.4, ADR 0015). Same contract as upstream
 * InputfieldToggle.js: the checked radio carries .InputfieldToggleChecked and its label
 * .InputfieldToggleCurrent; inside .InputfieldToggleUseDeselect a click on the current option
 * clears the selection (no option checked) and dispatches `change`. Labels are the radio's next
 * sibling (toggle buttons), its parent (radios) or label[for]. Colours are the theme's CSS
 * (fields.css), not upstream's computed-colour <style>.
 */

import { legacyLoaded } from '../legacy';

const CHECKED = 'InputfieldToggleChecked';
const CURRENT = 'InputfieldToggleCurrent';

function labelOf(input: HTMLInputElement): HTMLElement | null {
	const next = input.nextElementSibling;
	if (next && next.tagName === 'LABEL') return next as HTMLElement;
	const parent = input.closest('label');
	if (parent) return parent as HTMLElement;
	return input.id ? document.querySelector<HTMLElement>('label[for="' + CSS.escape(input.id) + '"]') : null;
}

function inputOf(label: HTMLElement): HTMLInputElement | null {
	const prev = label.previousElementSibling;
	if (prev && prev.tagName === 'INPUT') return prev as HTMLInputElement;
	const inner = label.querySelector<HTMLInputElement>('input');
	if (inner) return inner;
	const id = label.getAttribute('for');
	return id ? document.getElementById(id) as HTMLInputElement | null : null;
}

/** Bring the classes of every option in this toggle in line with the checked state */
function sync(field: HTMLElement): void {
	field.querySelectorAll<HTMLInputElement>('.InputfieldContent input[type=radio]').forEach(input => {
		input.classList.toggle(CHECKED, input.checked);
		const label = labelOf(input);
		if (label) label.classList.toggle(CURRENT, input.checked);
	});
}

export function initToggles(root: ParentNode): void {
	if (legacyLoaded()) return;
	root.querySelectorAll<HTMLElement>('.InputfieldToggle').forEach(sync);
	if (root instanceof HTMLElement && root.matches('.InputfieldToggle')) sync(root);
}

let ready = false;

export function setupToggleEvents(): void {
	if (ready) return;
	ready = true;
	// deselect: a click on the current option's label (capture, before the browser re-checks it)
	document.addEventListener('click', e => {
		if (legacyLoaded()) return;
		const target = e.target as HTMLElement;
		if (!target || !target.closest) return;
		const label = target.closest<HTMLElement>('.InputfieldToggle label:not(.InputfieldHeader)');
		const direct = !label && target.matches('.InputfieldToggle input[type=radio]') ? target as HTMLInputElement : null;
		const input = direct || (label ? inputOf(label) : null);
		if (!input) return;
		const field = input.closest<HTMLElement>('.InputfieldToggle');
		if (!field || !field.closest('.InputfieldToggleUseDeselect') || !input.classList.contains(CHECKED)) return;
		e.preventDefault();
		input.checked = false;
		sync(field);
		input.dispatchEvent(new Event('change', { bubbles: true }));
	}, true);
	document.addEventListener('change', e => {
		if (legacyLoaded()) return;
		const input = e.target as HTMLElement;
		const field = input && input.closest ? input.closest<HTMLElement>('.InputfieldToggle') : null;
		if (field && input.matches('input[type=radio]')) sync(field);
	});
}

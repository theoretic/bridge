/**
 * InputfieldCheckboxes without jQuery (milestone 2.4, ADR 0015). Same behaviour as upstream
 * InputfieldCheckboxes.js:
 * - shift-click selects or clears the range between the last clicked checkbox and this one
 *   (each changed checkbox dispatches `change`, so change tracking and showIf see it);
 * - columns are abandoned when they would wrap labels: a ul.InputfieldCheckboxesColumns whose
 *   items differ in height by more than 5px loses the class and its items go full width.
 * Applies inside .InputfieldCheckboxes and .InputfieldPage (page fields rendered as checkboxes).
 */

import { legacyLoaded } from '../legacy';

let lastClicked: HTMLInputElement | null = null;

function abandonWrappedColumns(root: ParentNode): void {
	root.querySelectorAll<HTMLElement>(':is(.InputfieldCheckboxes, .InputfieldPage) ul.InputfieldCheckboxesColumns').forEach(ul => {
		const items = Array.from(ul.children).filter(el => el.tagName === 'LI') as HTMLElement[];
		if (items.length < 2 || !ul.offsetParent) return;
		const first = items[0].offsetHeight;
		if (!items.some(li => Math.abs(li.offsetHeight - first) > 5)) return;
		ul.classList.remove('InputfieldCheckboxesColumns');
		items.forEach(li => { li.style.width = '100%'; });
	});
}

export function initCheckboxes(root: ParentNode): void {
	if (legacyLoaded()) return;
	abandonWrappedColumns(root);
}

let ready = false;

export function setupCheckboxEvents(): void {
	if (ready) return;
	ready = true;
	document.addEventListener('click', e => {
		if (legacyLoaded()) return;
		const box = e.target as HTMLInputElement;
		if (!box || !box.matches || !box.matches('.InputfieldCheckboxes ul input[type=checkbox]')) return;
		const ul = box.closest('ul');
		const prev = lastClicked;
		lastClicked = box;
		if (!e.shiftKey || !prev || !ul || prev.closest('ul') !== ul) return;
		const all = Array.from(ul.querySelectorAll<HTMLInputElement>('input[type=checkbox]'));
		const a = all.indexOf(box);
		const b = all.indexOf(prev);
		all.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(cb => {
			if (cb === box || cb.checked === prev.checked) return;
			cb.checked = prev.checked;
			cb.dispatchEvent(new Event('change', { bubbles: true }));
		});
		if (box.checked !== prev.checked) {
			box.checked = prev.checked;
			box.dispatchEvent(new Event('change', { bubbles: true }));
		}
	});
	// open or reloaded fields and window resizes can change label wrapping
	for (const type of ['opened', 'reloaded']) document.addEventListener(type, e => initCheckboxes(e.target as ParentNode));
	let timer = 0;
	window.addEventListener('resize', () => {
		window.clearTimeout(timer);
		timer = window.setTimeout(() => initCheckboxes(document), 150);
	});
}

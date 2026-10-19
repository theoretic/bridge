/**
 * Native field widgets, loaded on demand (milestone 2.4, ADR 0015). Each widget is its own chunk
 * (Vite code-splits the dynamic imports into assets/dist/chunks/), imported only when its markup
 * is on the page, so the shared runtime stays small. A widget is found by the same markup its
 * upstream script looks for, and initialises each element once (it marks what it did).
 */

import { legacyLoaded } from '../legacy';

export type FieldWidget = { init(el: HTMLElement): void };

type Entry = { selector: string; load: () => Promise<FieldWidget> };

const WIDGETS: Entry[] = [
	{ selector: '.InputfieldAsmSelect select[multiple]', load: () => import('./asmselect') },
	{ selector: '.InputfieldPage', load: () => import('./page') },
	{ selector: '.InputfieldPageAutocompleteData', load: () => import('./pageautocomplete') },
	{ selector: '.InputfieldPageListSelectData, .InputfieldPageListSelectMultipleData', load: () => import('./pagelistselect') },
	{ selector: 'input.InputfieldDatetimeDatepicker, .InputfieldDatetimeSelect', load: () => import('./datetime') },
	{ selector: '.InputfieldTextTagsInput, .InputfieldTextTagsSelect', load: () => import('./texttags') },
	{ selector: 'li.InputfieldSelector', load: () => import('./selector') },
	{ selector: '.InputfieldPageName, .InputfieldPageTitle', load: () => import('./pagename') },
	// by the theme's mark: a subclass of these (third-party) stays legacy and keeps its own script
	{ selector: '.Inputfield[data-bridge-component="InputfieldFile"]', load: () => import('./file') },
	{ selector: '.Inputfield[data-bridge-component="InputfieldImage"]', load: () => import('./image') },
	{ selector: '.Inputfield[data-bridge-component="InputfieldRepeater"]', load: () => import('./repeater') },
	{ selector: '.Inputfield[data-bridge-component="InputfieldPageTable"]', load: () => import('./pagetable') },
	// the page tree (ProcessPageList, milestone 3.4): its screen and the page editor's Children tab
	{ selector: 'div#PageListContainer', load: () => import('./pagelist') },
	// MarkupAdminDataTable (milestone 3.5): sortable columns, mobile labels, shift-click
	{ selector: 'table.AdminDataTable', load: () => import('./datatable') },
	// the setup screens (milestone 3.6): icon picker, password with strength and confirm
	{ selector: '.Inputfield[data-bridge-component="InputfieldIcon"]', load: () => import('./icon') },
	{ selector: '.Inputfield[data-bridge-component="InputfieldPassword"]', load: () => import('./password') },
];

const loading = new Map<Entry, Promise<FieldWidget>>();

function matches(root: ParentNode, selector: string): HTMLElement[] {
	const found = Array.from(root.querySelectorAll<HTMLElement>(selector));
	if (root instanceof HTMLElement && root.matches(selector)) found.unshift(root);
	return found;
}

export function initWidgets(root: ParentNode): void {
	if (legacyLoaded()) return;
	for (const entry of WIDGETS) {
		const els = matches(root, entry.selector);
		if (!els.length) continue;
		let promise = loading.get(entry);
		if (!promise) {
			promise = entry.load();
			loading.set(entry, promise);
		}
		promise.then(widget => {
			if (legacyLoaded()) return;
			els.forEach(el => widget.init(el));
		}).catch(err => console.error('Bridge: field widget failed', entry.selector, err));
	}
}

/**
 * Bridge runtime entry. Imported by modules/AdminThemeBridge/scripts/main.js via import().
 *
 * Exposes window.Bridge and dispatches 'pw-runtime-ready' on document. On a page where the
 * legacy stack is present (or arrives later), Inputfield behaviours are left to upstream; the
 * custom elements and component loading work either way.
 */

import { Inputfields } from './inputfields/index';
import { defineTabs } from './elements/pw-tabs';
import { defineDialog, setupModalLinks, sharedDialog, DialogOptions } from './elements/pw-dialog';
import type { LightboxItem } from './util/lightbox';
import { legacyLoaded, legacyPending, loadLegacy, onLegacyLoaded } from './legacy';
import { replay } from './util/stubs';
import { load as loadComponent, loadFrom as loadComponentsFrom, loadProcess, loaded as loadedComponents } from './components';

export const version = '1.0.0';

export const Bridge = {
	version,
	contract: '1',
	Inputfields,
	components: { load: loadComponent, loadFrom: loadComponentsFrom, loaded: loadedComponents },
	dialog: {
		open: (url: string, size?: 'small' | 'medium' | 'large' | 'full', options?: DialogOptions) => sharedDialog().open(url, size, options),
		close: (abort = false) => sharedDialog().close(abort),
	},
	legacy: { loaded: legacyLoaded, load: loadLegacy },
	// on demand: the image field and the Lister load it with their own chunks
	lightbox: (items: LightboxItem[], index?: number): Promise<void> => import('./util/lightbox').then(m => m.openLightbox(items, index)),
	// sort a data table by a column (0-based), as a header click does; the table chunk loads on demand
	tables: {
		sort: (table: HTMLTableElement, column: number, dir: 'asc' | 'desc' = 'asc'): Promise<void> => import('./fields/datatable').then(m => m.sort(table, column, dir)),
	},
	init(): void {
		defineTabs();
		defineDialog();
		setupModalLinks();
		Inputfields.init(document);
		void loadProcess();
		void loadComponentsFrom(document);
		observeContent();
		onLegacyLoaded(() => document.body.classList.add('pw-runtime-passive'));
		document.body.classList.add('pw-runtime-ready');
		document.dispatchEvent(new CustomEvent('pw-runtime-ready', { detail: { version } }));
	},
};

/**
 * Content that arrives after load (AJAX, dialogs): import declared component modules, and
 * while the page is still native, initialise Inputfield behaviours. Legacy arrivals are the
 * theme script's business (it loads the stack).
 *
 * One batch of mutations, one pass (audit B17): the added elements, without those inside another
 * added one; Inputfields.init() once per distinct parent, without parents inside another. The
 * records come from the theme script's one body observer (ProcessWireAdminTheme.observe, B18).
 */
// what needs Inputfields.init(): fields, and data tables swapped in on their own (the log viewer's
// pager, Sessions)
const INITIALISE = '.Inputfield, table.AdminDataTable';
const LEAVES = new Set(['OPTION', 'OPTGROUP', 'SCRIPT', 'STYLE', 'BR', 'I', 'SVG', 'IMG']);

export function contentAdded(records: MutationRecord[]): void {
	const added = new Set<HTMLElement>();
	for (const record of records) {
		record.addedNodes.forEach(node => {
			// leaves hold no fields: a widget building a select adds its options one by one (P2)
			if (node.nodeType === 1 && node.isConnected && !LEAVES.has(node.nodeName)) added.add(node as HTMLElement);
		});
	}
	if (!added.size) return;
	// the added elements not inside another added one: a walk up per element, not a pass over all
	// of them per element (audit P2)
	const top: HTMLElement[] = [];
	added.forEach(el => {
		for (let p = el.parentElement; p; p = p.parentElement) if (added.has(p)) return;
		top.push(el);
	});
	const roots: Node[] = [];
	const native = !legacyLoaded();
	for (const el of top) {
		void loadComponentsFrom(el);
		if (!native || legacyPending(el) || !(el.matches(INITIALISE) || el.querySelector(INITIALISE))) continue;
		const root = el.parentNode || el;
		if (roots.indexOf(root) < 0) roots.push(root);
	}
	roots.filter(root => !roots.some(other => other !== root && other.contains(root)))
		.forEach(root => Inputfields.init(root as ParentNode));
}

// the runtime is imported by the theme script only (scripts/main.js), whose observer it shares
function observeContent(): void {
	const theme = (window as unknown as { ProcessWireAdminTheme?: { observe?: (fn: (records: MutationRecord[]) => void) => () => void } }).ProcessWireAdminTheme;
	if (theme && theme.observe) theme.observe(contentAdded);
}

declare global {
	interface Window {
		Bridge: typeof Bridge;
	}
}

// over the theme's stand-in: calls recorded before the runtime arrived run once it is set up
const stub: unknown = window.Bridge;
window.Bridge = Bridge;
const start = (): void => {
	Bridge.init();
	replay(stub, Bridge, 'Bridge');
};
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
	start();
}

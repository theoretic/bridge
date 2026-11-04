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
import type { SortableOptions } from './util/sortable';
import { legacyLoaded, legacyPending, loadLegacy, onLegacyLoaded } from './legacy';
import { replay } from './util/stubs';
import { load as loadComponent, loadFrom as loadComponentsFrom, loadProcess, loaded as loadedComponents } from './components';
import type { AskOptions } from './util/ask';
import { pwConfig } from './util/pw';
import { failed } from './util/fail';
import { importAgain } from './util/retry';
import type * as ExtensionsChunk from './extensions';

export const version = '1.0.0';

// the extensions chunk, once a page lists extensions (it is not loaded on a page without any)
let ext: typeof ExtensionsChunk | null = null;
const extensionList = (): Array<{ name: string }> => pwConfig<{ extensions?: Array<{ name: string }> }>('AdminThemeBridge').extensions || [];

export const Bridge = {
	version,
	contract: '1',
	Inputfields,
	components: { load: loadComponent, loadFrom: loadComponentsFrom, loaded: loadedComponents },
	// extension modules (extension contract, docs/extensions.md 5)
	extensions: {
		list: () => extensionList().slice(),
		loaded: () => (ext ? ext.loaded() : []),
		reload: (name: string): Promise<unknown> => (ext ? ext.reload(name) : Promise.resolve()),
	},
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
	// a page tree in a container of its own (the page tree drawer, 0.25.0: options in data-pw-tree),
	// with or without the legacy stack on the page; the tree chunk on demand
	pageTree: (container: HTMLElement): Promise<void> => import('./fields/pagelist').then(m => m.init(container), err => failed('page tree', err)),
	// the field widgets' sorting for a list a component owns (0.24.0, theoretic/bridge#3): the
	// sortable chunk on demand; a promise of the function that removes it
	sortable: (list: HTMLElement, options: SortableOptions): Promise<() => void> => import('./util/sortable').then(m => m.makeSortable(list, options)),
	// a themed confirm (always asks) and a risky action's warning (asks while the setting is on,
	// ADR 0019); a promise, and callbacks for classic scripts calling through the stand-in
	confirm: (opts: AskOptions | string, onOk?: () => void, onCancel?: () => void): Promise<boolean> => import('./util/danger').then(m => m.callbacks(m.confirm(opts), onOk, onCancel)),
	guard: (opts: AskOptions, onOk?: () => void, onCancel?: () => void): Promise<boolean> => import('./util/danger').then(m => m.callbacks(m.guard(opts), onOk, onCancel)),
	// the user's own colour from the user menu (0.22.0); the theme script hands its picks here
	colors: (el: HTMLElement, save = true): Promise<void> => import('./util/colors').then(m => m.pick(el, save), err => failed('colour', err)),
	init(): void {
		defineTabs();
		defineDialog();
		setupModalLinks();
		// once more after a second: Firefox rejects the import of a page that is being left
		if (pwConfig<{ dangerWarn?: boolean }>('AdminThemeBridge').dangerWarn) importAgain(() => import('./guards')).then(m => m.start()).catch(err => failed('risky-action warnings', err));
		Inputfields.init(document);
		void loadProcess();
		void loadComponentsFrom(document);
		if (extensionList().length) importAgain(() => import('./extensions')).then(m => (ext = m).init()).catch(err => failed('extensions', err));
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
	// a node removed and added in the same batch only moved (each step of a drag, a table sorted
	// in the browser): it was initialised where it came from (audit PF2)
	const moved = new Set<Node>();
	for (const record of records) record.removedNodes.forEach(node => moved.add(node));
	const added = new Set<HTMLElement>();
	for (const record of records) {
		record.addedNodes.forEach(node => {
			// leaves hold no fields: a widget building a select adds its options one by one (P2)
			if (node.nodeType === 1 && node.isConnected && !LEAVES.has(node.nodeName) && !moved.has(node)) added.add(node as HTMLElement);
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

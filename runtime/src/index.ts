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
import { legacyLoaded, loadLegacy, onLegacyLoaded } from './legacy';
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
 */
function observeContent(): void {
	if (!window.MutationObserver) return;
	const observer = new MutationObserver(records => {
		for (const record of records) {
			record.addedNodes.forEach(node => {
				if (node.nodeType !== 1) return;
				const el = node as HTMLElement;
				void loadComponentsFrom(el);
				if (legacyLoaded()) return;
				if (el.matches('.Inputfield') || el.querySelector('.Inputfield')) Inputfields.init(el.parentNode || el);
			});
		}
	});
	observer.observe(document.body, { childList: true, subtree: true });
}

declare global {
	interface Window {
		Bridge: typeof Bridge;
	}
}

window.Bridge = Bridge;
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => Bridge.init(), { once: true });
} else {
	Bridge.init();
}

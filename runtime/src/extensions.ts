/**
 * Extension modules (extension contract 0.1, docs/extensions.md 5). A chunk of its own, imported
 * by the runtime only on a page whose list is not empty (index.ts: Bridge.extensions).
 *
 * The theme lists the extensions the signed-in user may have in
 * ProcessWire.config.AdminThemeBridge.extensions. On init() the runtime imports each one's client
 * module through components.load() (one registry, one retry, the same failure notice), then
 * dispatches 'pw-extension-loaded' per extension and 'pw-extensions-ready' once. An extension
 * whose contract range does not take the theme's (compatible: false) is not imported: its slots
 * are not printed either. The bus is DOM events: no other.
 */

import { load, loaded as componentsLoaded, ComponentModule } from './components';
import { pwConfig } from './util/pw';

export interface ExtensionManifest {
	name: string;
	module: string | null;
	contract: string;
	compatible: boolean;
	priority: number;
}

const current = new Map<string, string>();

export function list(): ExtensionManifest[] {
	return (pwConfig<{ extensions?: ExtensionManifest[] }>('AdminThemeBridge').extensions || []).slice();
}

function find(name: string): ExtensionManifest | undefined {
	return list().filter(e => e.name === name)[0];
}

function fire(name: string, mod: ComponentModule | null): void {
	document.dispatchEvent(new CustomEvent('pw-extension-loaded', { detail: { name, module: mod } }));
}

function one(ext: ExtensionManifest, url?: string): Promise<unknown> {
	if (!ext.compatible) return Promise.resolve();
	const u = url || ext.module;
	if (!u) {
		fire(ext.name, null);
		return Promise.resolve();
	}
	current.set(ext.name, u);
	// a failure is reported by components.load() (pw-component-failed and the notice)
	return load(u).then(mod => { if (mod) fire(ext.name, mod); });
}

/** The extensions this page has: their module's export and the error, if any */
export function loaded(): Array<{ name: string; url: string | null; tag?: string; version?: string; error: string | null }> {
	const parts = componentsLoaded();
	return list().map(ext => {
		const url = current.get(ext.name) || null;
		const part = url ? parts.filter(p => p.url === url.split('#')[0])[0] : undefined;
		return {
			name: ext.name,
			url,
			tag: part?.tag,
			version: part?.version,
			error: !ext.compatible ? 'incompatible contract ' + ext.contract : part ? part.error : null,
		};
	});
}

/** Import an extension's module once more, with a fresh ?v=; 'pw-extension-loaded' again */
export function reload(name: string): Promise<unknown> {
	const ext = find(name);
	if (!ext || !ext.module) return Promise.resolve();
	const url = new URL(ext.module, location.href);
	url.searchParams.set('v', String(Date.now()));
	return one(ext, url.href);
}

export function init(): Promise<unknown> {
	const all = list();
	return Promise.all(all.map(ext => one(ext))).then(() => {
		document.dispatchEvent(new CustomEvent('pw-extensions-ready', { detail: { names: all.map(e => e.name) } }));
	});
}

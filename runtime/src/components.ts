/**
 * Component module loading.
 *
 * A BridgeComponent declares an ES module (`module` key of getBridgeComponent()). The theme
 * writes it, resolved to a URL, as data-bridge-module on the Inputfield wrapper, and for the
 * current Process into ProcessWire.config.AdminThemeBridge.process. The runtime imports every
 * such URL once, whether the markup was in the page at load or arrived later (AJAX, dialogs).
 * A component module registers its custom element on import; an optional default export
 * `{ tag, version }` is recorded for diagnostics.
 */

export interface ComponentModule {
	tag?: string;
	version?: string;
}

interface Entry {
	url: string;
	promise: Promise<ComponentModule | null>;
	module: ComponentModule | null;
	error: Error | null;
}

const registry = new Map<string, Entry>();

export function load(url: string): Promise<ComponentModule | null> {
	const key = url.split('#')[0];
	const existing = registry.get(key);
	if (existing) return existing.promise;
	const entry: Entry = { url: key, promise: Promise.resolve(null), module: null, error: null };
	entry.promise = import(/* @vite-ignore */ key)
		.then(m => {
			const def = (m && typeof m === 'object' && 'default' in m ? (m as { default: ComponentModule }).default : null) || {};
			entry.module = def;
			document.dispatchEvent(new CustomEvent('pw-component-loaded', { detail: { url: key, module: def } }));
			return def;
		})
		.catch((err: Error) => {
			entry.error = err;
			console.error('Bridge: component module failed', key, err);
			return null;
		});
	registry.set(key, entry);
	return entry.promise;
}

export function loaded(): Array<{ url: string; tag?: string; version?: string; error: string | null }> {
	return Array.from(registry.values()).map(e => ({
		url: e.url,
		tag: e.module?.tag,
		version: e.module?.version,
		error: e.error ? e.error.message : null,
	}));
}

/**
 * Import the modules declared by component wrappers under root
 */
export function loadFrom(root: ParentNode): Promise<unknown> {
	const urls = new Set<string>();
	const self = root as HTMLElement;
	if (self.nodeType === 1 && self.matches('[data-bridge-module]')) urls.add(self.getAttribute('data-bridge-module') as string);
	root.querySelectorAll<HTMLElement>('[data-bridge-module]').forEach(el => urls.add(el.getAttribute('data-bridge-module') as string));
	return Promise.all(Array.from(urls).map(load));
}

/**
 * Import the current Process's module, if declared
 */
export function loadProcess(): Promise<unknown> {
	const pw = (window as unknown as { ProcessWire?: { config?: { AdminThemeBridge?: { process?: { module?: string } | null } } } }).ProcessWire;
	const url = pw?.config?.AdminThemeBridge?.process?.module;
	return url ? load(url) : Promise.resolve(null);
}

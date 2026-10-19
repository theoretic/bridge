/**
 * Is the upstream legacy stack (jQuery + inputfields.js) on the page?
 *
 * When it is, upstream owns Inputfield behaviours (collapse, dependencies, widths) and the
 * runtime must not act on the same events. The flag lives on the theme's classic script.
 */
export function legacyLoaded(): boolean {
	const w = window as unknown as { ProcessWireAdminTheme?: { legacy?: { loaded?: boolean } }; jQuery?: unknown };
	if (w.ProcessWireAdminTheme?.legacy?.loaded) return true;
	return typeof w.jQuery !== 'undefined';
}

/**
 * Ask the theme script to load the legacy stack (resolves when done)
 */
export function loadLegacy(): Promise<void> {
	const w = window as unknown as { ProcessWireAdminTheme?: { legacy?: { load?: () => Promise<void> } } };
	const load = w.ProcessWireAdminTheme?.legacy?.load;
	return load ? load.call(w.ProcessWireAdminTheme!.legacy) : Promise.resolve();
}

/**
 * Register a one-time listener for the moment the legacy stack arrives
 */
export function onLegacyLoaded(fn: () => void): void {
	if (legacyLoaded()) {
		fn();
		return;
	}
	document.addEventListener('pw-legacy-loaded', fn, { once: true });
}

/**
 * Is the upstream legacy stack (jQuery + inputfields.js + main.js) on the page?
 *
 * When it is, upstream owns Inputfield behaviours (collapse, dependencies, widths) and the
 * runtime must not act on the same events. The theme script decides (ProcessWireAdminTheme
 * .upstream(): its legacy flag or upstream's ProcessWireAdmin); a jQuery that a site module
 * brought along by itself does not make upstream the owner (audit B11).
 */
export function legacyLoaded(): boolean {
	const w = window as unknown as { ProcessWireAdminTheme?: { upstream?: () => boolean; legacy?: { loaded?: boolean } }; ProcessWireAdmin?: unknown; jQuery?: unknown };
	const theme = w.ProcessWireAdminTheme;
	if (theme && typeof theme.upstream === 'function') return theme.upstream();
	if (theme?.legacy?.loaded || typeof w.ProcessWireAdmin !== 'undefined') return true;
	// no theme script (the runtime on its own): jQuery is the only sign there is
	return !theme && typeof w.jQuery !== 'undefined';
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

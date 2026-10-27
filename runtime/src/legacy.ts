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

let handoverCtl: AbortController | null = null;

/**
 * A signal aborted when the legacy stack takes over ('pw-legacy-handover', scripts/main.js):
 * upstream's scripts then bind the same controls, so a native widget's listeners must end there
 * or every event is handled twice (audit R2)
 */
export function handover(): AbortSignal {
	if (!handoverCtl) {
		const ctl = new AbortController();
		handoverCtl = ctl;
		document.addEventListener('pw-legacy-handover', () => ctl.abort(), { once: true });
	}
	return handoverCtl.signal;
}

/** addEventListener with the handover signal */
export function on<K extends keyof HTMLElementEventMap>(target: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void): void;
export function on(target: EventTarget, type: string, fn: (e: Event) => void): void;
export function on(target: EventTarget, type: string, fn: (e: Event) => void): void {
	target.addEventListener(type, fn, { signal: handover() });
}

/**
 * Is this content legacy markup the theme script loads the stack for (scripts/main.js
 * legacy.legacyTarget())? Until the stack is there legacyLoaded() is still false, so without this
 * the runtime would set such content up natively first and upstream again after it (audit R1).
 */
export function legacyPending(el: Node): boolean {
	const legacy = (window as unknown as { ProcessWireAdminTheme?: { legacy?: { loaded?: boolean; legacyTarget?: (n: Node) => Element | null } } }).ProcessWireAdminTheme?.legacy;
	if (!legacy || legacy.loaded || typeof legacy.legacyTarget !== 'function' || el === document) return false;
	return !!legacy.legacyTarget(el);
}

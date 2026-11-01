/**
 * The globals the classic scripts (src/classic/*.js) share with core, the legacy stack and the
 * runtime, for their type check (tsconfig.classic.json, audit AR3). Kept out of src/ so the
 * TypeScript sources stay under strict types.
 *
 * Event targets and elements are what the scripts treat them as: an event's target is an
 * Element (closest(), matches()), and elements carry the expando markers the scripts set on them
 * (pwWireTab, pwOn, seq, ...). Everything else is checked against the DOM's own types.
 *
 * Original work, MIT.
 */
export {};

declare global {
	interface Window {
		ProcessWire: any;
		ProcessWireAdminTheme: any;
		ProcessWireAdmin: any;
		jQuery: any;
		$: any;
		UIkit: any;
		Bridge: any;
		Inputfields: any;
		AdminDataTable: any;
		InputfieldSubmitDropdown: any;
		CKEDITOR: any;
		tinymce: any;
		trustedTypes: any;
		pwPanels: any;
		Notifications: any;
		[key: string]: any;
	}
	const ProcessWire: any;
	const jQuery: any;
	const Inputfields: any;
	const ProcessWireAdmin: any;
	const Bridge: any;
	const UIkit: any;
	const ProcessLister: any;
	const ProcessLogger: any;
	const Notifications: any;
	const CKEDITOR: any;
	interface EventTarget {
		closest(selectors: string): any;
		matches(selectors: string): boolean;
		[key: string]: any;
	}
	interface Element { [key: string]: any; }
	interface XMLHttpRequest { [key: string]: any; }
	interface Event { detail?: any; }
	// Trusted Types (Chromium): the bridge policy's results (main.js `trusted`)
	type TrustedHTML = any;
	type TrustedScript = any;
	type TrustedScriptURL = any;
}

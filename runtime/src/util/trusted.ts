/**
 * Trusted Types for the runtime (ADR 0020): every HTML, script and script URL it writes goes
 * through the theme's one policy, `bridge` (ProcessWireAdminTheme.trusted, scripts/main.js). A
 * policy name may be created once per page, so the runtime creates its own only when it runs
 * without the theme script. Identity for now; without Trusted Types, or where the page's policy
 * does not list `bridge`, the string itself is used and nothing changes.
 *
 * runtime/scripts/check-sinks.mjs fails the build on an HTML or script sink written without these.
 */

type Kind = 'html' | 'script' | 'scriptURL';
type Rules = Record<'createHTML' | 'createScript' | 'createScriptURL', (s: string) => unknown>;

let own: Rules | null | undefined;

function policy(): Rules | null {
	if (own === undefined) {
		own = null;
		const id = (s: string): string => s;
		try {
			const tt = (window as unknown as { trustedTypes?: { createPolicy(name: string, rules: Rules): Rules } }).trustedTypes;
			if (tt) own = tt.createPolicy('bridge', { createHTML: id, createScript: id, createScriptURL: id });
		} catch (err) {
			console.warn('Bridge: no Trusted Types policy "bridge"', err);
		}
	}
	return own;
}

/** the theme's helper of this kind, else the runtime's own policy, else the string */
const through = (kind: Kind, rule: keyof Rules) => (s: string): string => {
	const theme = (window as unknown as { ProcessWireAdminTheme?: { trusted?: Record<Kind, (s: string) => unknown> } }).ProcessWireAdminTheme;
	if (theme && theme.trusted) return theme.trusted[kind](s) as string;
	const p = policy();
	return (p ? p[rule](s) : s) as string;
};

/** HTML for innerHTML, insertAdjacentHTML and parseHTML (typed as the string the DOM typings want) */
export const toHTML = through('html', 'createHTML');
/** A script's text */
export const toScript = through('script', 'createScript');
/** A script's URL */
export const toScriptURL = through('scriptURL', 'createScriptURL');

/** A document parsed from HTML: inert, its scripts never run and its images never load */
export const parseHTML = (s: string): Document => new DOMParser().parseFromString(toHTML(s), 'text/html');

/** The text of an HTML string, parsed inert (a div in this page would load an <img onerror>) */
export const htmlText = (s: string): string => (parseHTML(s).body.textContent || '').trim();

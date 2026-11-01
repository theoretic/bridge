/**
 * Inline scripts of content inserted from HTML (innerHTML, a template, a parsed document) never
 * run on their own: the theme script's ProcessWireAdminTheme.runScripts() (scripts/main.js, audit
 * B22) replaces each with a live copy, attributes kept, non-JS types and loaded src skipped, and
 * with `legacy` waits for the legacy stack first. The classic scripts call the same function.
 *
 * On a page with a Content-Security-Policy nonce (ADR 0020) a script runs only when its own nonce
 * is the one its response carried: pass `nonce: responseNonce(res)`. Anything else is skipped with
 * one warning (audit SE2). Without a nonce on the page nothing changes.
 */

import { legacyLoaded, loadLegacy } from '../legacy';
import { toScript, toScriptURL } from './trusted';

export interface RunOptions {
	legacy?: boolean;
	/** the nonce of the response the scripts came in (responseNonce()) */
	nonce?: string;
}

type Runner = (rootOrScripts: ParentNode | HTMLScriptElement | HTMLScriptElement[], options?: RunOptions) => Promise<void>;

/** This page's nonce (meta[property=csp-nonce]; the IDL property survives nonce hiding), '' for none */
export function pageNonce(): string {
	const meta = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]');
	return (meta && (meta.nonce || meta.getAttribute('nonce'))) || '';
}

/**
 * The nonce a response vouches for its scripts with: the X-Bridge-Nonce header the theme sends
 * (AJAX fragments have no head), else the meta of the document it holds
 * @param res The response
 * @param doc Its parsed document, when there is one
 */
export function responseNonce(res: Response | null, doc?: Document | null): string {
	const header = res ? res.headers.get('X-Bridge-Nonce') || '' : '';
	if (header) return header;
	const meta = doc ? doc.querySelector('meta[property="csp-nonce"]') : null;
	return (meta && meta.getAttribute('nonce')) || '';
}

export function runScripts(rootOrScripts: ParentNode | HTMLScriptElement[], options: RunOptions = {}): Promise<void> {
	const theme = (window as unknown as { ProcessWireAdminTheme?: { runScripts?: Runner } }).ProcessWireAdminTheme;
	if (theme && theme.runScripts) return theme.runScripts(rootOrScripts, options);
	// the theme script is always there in the admin; this is for a page that loads the runtime alone
	const scripts = Array.isArray(rootOrScripts) ? rootOrScripts : Array.from(rootOrScripts.querySelectorAll('script'));
	const page = pageNonce();
	const run = (): void => {
		let skipped = 0;
		for (const old of scripts) {
			if (!old.isConnected) continue;
			// the same rule as the theme's runner (audit SE2)
			if (page && (!options.nonce || (old.nonce || old.getAttribute('nonce') || '') !== options.nonce)) { skipped++; continue; }
			const live = document.createElement('script');
			// src and text through the Trusted Types policy, never as plain strings (ADR 0020)
			for (const attr of Array.from(old.attributes)) if (attr.name !== 'nonce' && attr.name !== 'src') live.setAttribute(attr.name, attr.value);
			if (page) live.nonce = page;
			const src = old.getAttribute('src');
			if (src) live.src = toScriptURL(src);
			else live.text = toScript(old.text);
			old.replaceWith(live);
		}
		if (skipped) console.warn(`Bridge: ${skipped} script(s) without the response's nonce not run (Content-Security-Policy)`);
	};
	if (options.legacy && !legacyLoaded()) return loadLegacy().then(run);
	run();
	return Promise.resolve();
}

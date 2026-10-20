/**
 * Inline scripts of content inserted from HTML (innerHTML, a template, a parsed document) never
 * run on their own: the theme script's ProcessWireAdminTheme.runScripts() (scripts/main.js, audit
 * B22) replaces each with a live copy, attributes kept, non-JS types and loaded src skipped, and
 * with `legacy` waits for the legacy stack first. The classic scripts call the same function.
 */

import { legacyLoaded, loadLegacy } from '../legacy';

interface RunOptions {
	legacy?: boolean;
}

type Runner = (rootOrScripts: ParentNode | HTMLScriptElement | HTMLScriptElement[], options?: RunOptions) => Promise<void>;

export function runScripts(rootOrScripts: ParentNode | HTMLScriptElement[], options: RunOptions = {}): Promise<void> {
	const theme = (window as unknown as { ProcessWireAdminTheme?: { runScripts?: Runner } }).ProcessWireAdminTheme;
	if (theme && theme.runScripts) return theme.runScripts(rootOrScripts, options);
	// the theme script is always there in the admin; this is for a page that loads the runtime alone
	const scripts = Array.isArray(rootOrScripts) ? rootOrScripts : Array.from(rootOrScripts.querySelectorAll('script'));
	const run = (): void => {
		for (const old of scripts) {
			if (!old.isConnected) continue;
			const live = document.createElement('script');
			for (const attr of Array.from(old.attributes)) live.setAttribute(attr.name, attr.value);
			live.text = old.text;
			old.replaceWith(live);
		}
	};
	if (options.legacy && !legacyLoaded()) return loadLegacy().then(run);
	run();
	return Promise.resolve();
}

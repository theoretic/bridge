/**
 * Run a clean-up after a batch of mutations that removed nodes, through the theme script's one body
 * observer (ProcessWireAdminTheme.observe). Widgets that keep state per element (a Map of fields
 * with their observers and sortables) drop what left the page at once, not at their next init()
 * (audit R6).
 */
export function onRemoval(fn: () => void): void {
	const theme = (window as unknown as { ProcessWireAdminTheme?: { observe?: (cb: (records: MutationRecord[]) => void) => () => void } }).ProcessWireAdminTheme;
	if (!theme || typeof theme.observe !== 'function') return;
	theme.observe(records => {
		for (const r of records) if (r.removedNodes.length) { fn(); return; }
	});
}

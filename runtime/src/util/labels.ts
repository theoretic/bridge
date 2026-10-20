/**
 * The runtime's own button and dialog labels, translated by the theme (_head.php, audit B15)
 */

/** a label the theme printed translated (ProcessWire.config.AdminThemeBridge.labels) */
export function label(key: string, fallback: string): string {
	const pw = (window as unknown as { ProcessWire?: { config?: { AdminThemeBridge?: { labels?: Record<string, string> } } } }).ProcessWire;
	const labels = pw?.config?.AdminThemeBridge?.labels;
	return (labels && labels[key]) || fallback;
}

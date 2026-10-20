/**
 * A dynamic import, once more after a second if it fails: a page that is being left has its
 * pending imports rejected (Firefox: "error loading dynamically imported module"), and a page
 * that is gone never reaches the retry. A failure that stays is the caller's to report.
 */
export function importAgain<T>(load: () => Promise<T>): Promise<T> {
	return load().catch(() => new Promise<T>((resolve, reject) => {
		window.setTimeout(() => { load().then(resolve, reject); }, 1000);
	}));
}

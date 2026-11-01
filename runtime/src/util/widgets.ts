/** Native widgets are reusable by native components without loading either widget eagerly. */
export { makeSortable as sortable } from './sortable';

export async function file(field: HTMLElement, kind: 'file' | 'image'): Promise<void> {
	const widget = kind === 'image' ? await import('../fields/image') : await import('../fields/file');
	widget.init(field);
}

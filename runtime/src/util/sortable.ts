/**
 * Vertical drag sorting without jQuery UI (Phase 2): the items of a list reorder live while the
 * pointer moves (no clone, no placeholder element), so the list always shows the order that a
 * drop would give. Shared by the native field widgets (asmSelect, PageAutocomplete, repeaters,
 * file lists).
 *
 * Classes: the container gets the given listClass (asmListSortable and the like), the dragged
 * item `ui-state-highlight` (as jQuery UI sortable does with asmSelect) and `pw-sorting`,
 * the container `pw-sorting-active` while a drag runs.
 *
 * Keyboard (audit R7): Alt+ArrowUp / Alt+ArrowDown moves the item that holds the focus one place,
 * with the same start, stop and update calls as a drag.
 */

export type SortableOptions = {
	/** selector for the sortable children (direct children of the container) */
	items: string;
	/** optional selector inside an item that starts a drag; else the whole item, minus controls */
	handle?: string;
	/** elements inside an item that never start a drag */
	cancel?: string;
	/** controls that never start a drag when there is no handle (default: links, buttons, inputs, ...) */
	controls?: string;
	/** 'y' (default): a vertical list; 'xy': inline items that wrap (chips), placed by the item under the pointer */
	axis?: 'y' | 'xy';
	/** called after a drop that changed the order */
	update?: (item: HTMLElement) => void;
	/** called when a drag starts and ends */
	start?: (item: HTMLElement) => void;
	/** offset: how far the pointer moved from the press (the repeater sets depth from dx) */
	stop?: (item: HTMLElement, offset: { dx: number; dy: number }) => void;
	/** called while dragging */
	move?: (item: HTMLElement, offset: { dx: number; dy: number }) => void;
	/**
	 * pixels the pointer must move before a drag starts (default 0: at once). With a threshold a
	 * press that does not move stays a click on the item (an image opening its editor); a drag
	 * swallows the click that follows it.
	 */
	threshold?: number;
	/** checked at each press: false skips the drag (the list is sorted by someone else) */
	enabled?: () => boolean;
};

const CONTROLS = 'a, button, input, select, textarea, label, [contenteditable]';

export function makeSortable(list: HTMLElement, options: SortableOptions): () => void {
	let dragging: HTMLElement | null = null;
	let pending: HTMLElement | null = null;
	let startX = 0;
	let startY = 0;
	let startIndex = -1;
	let pointerId = -1;
	const threshold = options.threshold || 0;

	const items = (): HTMLElement[] =>
		Array.from(list.children).filter(el => (el as HTMLElement).matches(options.items)) as HTMLElement[];

	const onDown = (e: PointerEvent): void => {
		if (e.button !== 0) return;
		const target = e.target as HTMLElement;
		const item = target.closest<HTMLElement>(options.items);
		if (!item || item.parentElement !== list) return;
		if (options.handle) {
			if (!target.closest(options.handle)) return;
		} else if (target.closest(options.controls === undefined ? CONTROLS : options.controls || ':not(*)')) {
			return;
		}
		if (options.cancel && target.closest(options.cancel)) return;
		if (options.enabled && !options.enabled()) return;
		pointerId = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		if (threshold > 0) {
			// wait for movement: until then the press may still be a click
			pending = item;
			return;
		}
		e.preventDefault();
		begin(item);
	};

	const begin = (item: HTMLElement): void => {
		dragging = item;
		startIndex = items().indexOf(item);
		item.classList.add('ui-state-highlight', 'pw-sorting');
		list.classList.add('pw-sorting-active');
		try { list.setPointerCapture(pointerId); } catch (err) { /* older engines */ }
		if (options.start) options.start(item);
	};

	// after a real drag the browser still sends a click: it must not open or toggle anything
	const swallowClick = (): void => {
		const stop = (ev: Event): void => { ev.stopPropagation(); ev.preventDefault(); };
		window.addEventListener('click', stop, { capture: true, once: true });
		window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
	};

	const onMove = (e: PointerEvent): void => {
		if (pending && e.pointerId === pointerId) {
			if (Math.abs(e.clientX - startX) < threshold && Math.abs(e.clientY - startY) < threshold) return;
			const item = pending;
			pending = null;
			window.getSelection()?.removeAllRanges();
			begin(item);
		}
		if (!dragging || e.pointerId !== pointerId) return;
		e.preventDefault();
		if (options.move) options.move(dragging, { dx: e.clientX - startX, dy: e.clientY - startY });
		if (options.axis === 'xy') {
			const under = document.elementFromPoint(e.clientX, e.clientY);
			const other = under ? (under as HTMLElement).closest<HTMLElement>(options.items) : null;
			if (!other || other === dragging || other.parentElement !== list) return;
			const r = other.getBoundingClientRect();
			list.insertBefore(dragging, e.clientX < r.left + r.width / 2 ? other : other.nextSibling);
			return;
		}
		const y = e.clientY;
		for (const other of items()) {
			if (other === dragging) continue;
			const r = other.getBoundingClientRect();
			const mid = r.top + r.height / 2;
			const otherIndex = Array.prototype.indexOf.call(list.children, other);
			const dragIndex = Array.prototype.indexOf.call(list.children, dragging);
			if (otherIndex < dragIndex && y < mid) {
				list.insertBefore(dragging, other);
				break;
			}
			if (otherIndex > dragIndex && y > mid) {
				list.insertBefore(dragging, other.nextSibling);
				break;
			}
		}
	};

	const onUp = (e: PointerEvent): void => {
		if (pending && e.pointerId === pointerId) pending = null;
		if (!dragging || e.pointerId !== pointerId) return;
		const item = dragging;
		dragging = null;
		if (threshold > 0) swallowClick();
		item.classList.remove('ui-state-highlight', 'pw-sorting');
		list.classList.remove('pw-sorting-active');
		try { list.releasePointerCapture(pointerId); } catch (err) { /* already released */ }
		if (options.stop) options.stop(item, { dx: e.clientX - startX, dy: e.clientY - startY });
		if (items().indexOf(item) !== startIndex && options.update) options.update(item);
	};

	const onKey = (e: KeyboardEvent): void => {
		if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || dragging) return;
		const target = e.target as HTMLElement;
		if (target.closest('select, textarea, [contenteditable]')) return; // their own Alt+arrow
		const item = target.closest<HTMLElement>(options.items);
		if (!item || item.parentElement !== list || (options.enabled && !options.enabled())) return;
		const all = items();
		const other = all[all.indexOf(item) + (e.key === 'ArrowUp' ? -1 : 1)];
		if (!other) return;
		e.preventDefault();
		if (options.start) options.start(item);
		list.insertBefore(item, e.key === 'ArrowUp' ? other : other.nextSibling);
		target.focus(); // moving the node may drop the focus
		if (options.stop) options.stop(item, { dx: 0, dy: 0 });
		if (options.update) options.update(item);
	};
	list.addEventListener('keydown', onKey);
	// an image or link inside an item would start the browser's own drag and swallow the pointer
	const onNativeDrag = (e: DragEvent): void => { if (pending || dragging) e.preventDefault(); };
	list.addEventListener('dragstart', onNativeDrag);
	list.addEventListener('pointerdown', onDown);
	list.addEventListener('pointermove', onMove);
	list.addEventListener('pointerup', onUp);
	list.addEventListener('pointercancel', onUp);
	return () => {
		list.removeEventListener('keydown', onKey);
		list.removeEventListener('dragstart', onNativeDrag);
		list.removeEventListener('pointerdown', onDown);
		list.removeEventListener('pointermove', onMove);
		list.removeEventListener('pointerup', onUp);
		list.removeEventListener('pointercancel', onUp);
	};
}

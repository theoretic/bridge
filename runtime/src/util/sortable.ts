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
 * Groups (0.14.0, ADR 0018): with `group`, the items it returns travel with the pressed one (the
 * selection of util/selection.ts). They are hidden (`pw-drag-member`) while the pressed item, the
 * lead, moves with a count badge (`data-pw-count`), and land around it at the drop, in their
 * original order.
 *
 * Leaving the list (0.14.0): with `outside`, a handler may take over while the pointer is away from
 * the list (fields/files-move.ts, drags between fields). The list then shows its original order,
 * the travelling items get `pw-drag-away`, and `stop` reports `outside: true`.
 *
 * Esc or a cancelled pointer puts the original order back (`cancelled: true`). The window scrolls
 * when the pointer nears its top or bottom edge (edgeScroll(), also used by the marquee).
 *
 * Keyboard (audit R7): Alt+ArrowUp / Alt+ArrowDown moves the item that holds the focus one place
 * (with its group), with the same start, stop and update calls as a drag.
 */

export type DragEnd = { dx: number; dy: number; outside: boolean; cancelled: boolean };

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
	/** called when a drag starts; group: every travelling item in DOM order, the lead included */
	start?: (item: HTMLElement, group: HTMLElement[]) => void;
	/** end: how far the pointer moved from the press (the repeater sets depth from dx), and how it ended */
	stop?: (item: HTMLElement, end: DragEnd, group: HTMLElement[]) => void;
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
	/** the items that travel with the pressed one (it included); default: the item alone */
	group?: (item: HTMLElement) => HTMLElement[];
	/** called on each move: true when an outside handler owns this move (the list stays still) */
	outside?: (item: HTMLElement, group: HTMLElement[], e: PointerEvent) => boolean;
};

const CONTROLS = 'a, button, input, select, textarea, label, [contenteditable]';

let scrollStep = 0;
let scrollFrame = 0;

/** Scroll the window while clientY is within 40 px of its top or bottom edge; stop: end it */
export function edgeScroll(clientY: number, stop = false): void {
	const edge = 40;
	const h = window.innerHeight;
	scrollStep = stop ? 0 : clientY < edge ? -Math.ceil((edge - clientY) / 3) : clientY > h - edge ? Math.ceil((clientY - h + edge) / 3) : 0;
	if (!scrollStep || scrollFrame) return;
	const tick = (): void => {
		if (!scrollStep) { scrollFrame = 0; return; }
		window.scrollBy(0, scrollStep);
		scrollFrame = window.requestAnimationFrame(tick);
	};
	scrollFrame = window.requestAnimationFrame(tick);
}

/** Document order, for sort() */
export const byDom = (a: Node, b: Node): number => a === b ? 0 : (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

/** after a real drag the browser still sends a click: it must not open or toggle anything */
export function swallowClick(): void {
	const stop = (ev: Event): void => { ev.stopPropagation(); ev.preventDefault(); };
	window.addEventListener('click', stop, { capture: true, once: true });
	window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}

/**
 * Put a group's members around its lead as one block: those that came before it in `order` go
 * right before it, the others right after, each part in its original order
 */
export function gather(lead: HTMLElement, group: HTMLElement[], order: HTMLElement[]): void {
	const at = order.indexOf(lead);
	const before = group.filter(m => m !== lead && order.indexOf(m) < at);
	const after = group.filter(m => m !== lead && order.indexOf(m) > at);
	before.forEach(m => lead.insertAdjacentElement('beforebegin', m));
	let last: HTMLElement = lead;
	after.forEach(m => { last.insertAdjacentElement('afterend', m); last = m; });
}

export function makeSortable(list: HTMLElement, options: SortableOptions): () => void {
	let dragging: HTMLElement | null = null;
	let pending: HTMLElement | null = null;
	let startX = 0;
	let startY = 0;
	let pointerId = -1;
	let group: HTMLElement[] = [];
	let members = new Set<HTMLElement>();
	let snapshot: Element[] = [];
	let startOrder: HTMLElement[] = [];
	let away = false;
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
		// with a group, a modifier press is a selection (util/selection.ts), never a drag
		if (options.group && (e.ctrlKey || e.metaKey || e.shiftKey)) return;
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

	const groupOf = (item: HTMLElement): HTMLElement[] => {
		const found = options.group ? options.group(item).filter(m => m.parentElement === list) : [];
		if (found.indexOf(item) < 0) found.push(item);
		return found.sort(byDom);
	};

	const begin = (item: HTMLElement): void => {
		dragging = item;
		snapshot = Array.from(list.children);
		startOrder = items();
		group = groupOf(item);
		members = new Set(group.filter(m => m !== item));
		members.forEach(m => m.classList.add('pw-drag-member'));
		if (members.size) item.setAttribute('data-pw-count', String(group.length));
		item.classList.add('ui-state-highlight', 'pw-sorting');
		list.classList.add('pw-sorting-active');
		try { list.setPointerCapture(pointerId); } catch (err) { /* older engines */ }
		window.addEventListener('keydown', onEsc, true);
		if (options.start) options.start(item, group);
	};

	// the order at the press; nodes that left the list meanwhile stay out
	const restore = (): void => { snapshot.forEach(el => { if (el.parentElement === list) list.appendChild(el); }); };

	const setAway = (on: boolean): void => {
		if (on === away) return;
		away = on;
		if (on) restore();
		group.forEach(m => m.classList.toggle('pw-drag-away', on));
		members.forEach(m => m.classList.toggle('pw-drag-member', !on));
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
		edgeScroll(e.clientY);
		if (options.outside) {
			setAway(options.outside(dragging, group, e));
			if (away) return;
		}
		if (options.move) options.move(dragging, { dx: e.clientX - startX, dy: e.clientY - startY });
		if (options.axis === 'xy') {
			const under = document.elementFromPoint(e.clientX, e.clientY);
			const other = under ? (under as HTMLElement).closest<HTMLElement>(options.items) : null;
			if (!other || other === dragging || other.parentElement !== list || members.has(other)) return;
			const r = other.getBoundingClientRect();
			list.insertBefore(dragging, e.clientX < r.left + r.width / 2 ? other : other.nextSibling);
			return;
		}
		const y = e.clientY;
		for (const other of items()) {
			if (other === dragging || members.has(other)) continue;
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

	const finish = (e: { clientX: number; clientY: number }, cancelled: boolean): void => {
		const item = dragging as HTMLElement;
		const travelled = group;
		const outside = away && !cancelled;
		dragging = null;
		window.removeEventListener('keydown', onEsc, true);
		edgeScroll(0, true);
		if (threshold > 0) swallowClick();
		if (cancelled) restore();
		else if (!away) gather(item, travelled, startOrder);
		travelled.forEach(m => m.classList.remove('pw-drag-member', 'pw-drag-away'));
		away = false;
		members = new Set();
		group = [];
		item.removeAttribute('data-pw-count');
		item.classList.remove('ui-state-highlight', 'pw-sorting');
		list.classList.remove('pw-sorting-active');
		try { list.releasePointerCapture(pointerId); } catch (err) { /* already released */ }
		if (options.stop) options.stop(item, { dx: e.clientX - startX, dy: e.clientY - startY, outside, cancelled }, travelled);
		const now = items();
		if (!outside && !cancelled && options.update && now.some((el, n) => el !== startOrder[n])) options.update(item);
	};

	const onUp = (e: PointerEvent): void => {
		if (pending && e.pointerId === pointerId) pending = null;
		if (!dragging || e.pointerId !== pointerId) return;
		finish(e, false);
	};

	const onCancel = (e: PointerEvent): void => {
		if (pending && e.pointerId === pointerId) pending = null;
		if (!dragging || e.pointerId !== pointerId) return;
		finish(e, true);
	};

	const onEsc = (e: KeyboardEvent): void => {
		if (e.key !== 'Escape' || !dragging) return;
		e.preventDefault();
		e.stopPropagation();
		finish({ clientX: startX, clientY: startY }, true);
	};

	const onKey = (e: KeyboardEvent): void => {
		if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || dragging) return;
		const target = e.target as HTMLElement;
		if (target.closest('select, textarea, [contenteditable]')) return; // their own Alt+arrow
		const item = target.closest<HTMLElement>(options.items);
		if (!item || item.parentElement !== list || (options.enabled && !options.enabled())) return;
		const block = groupOf(item);
		const all = items();
		const up = e.key === 'ArrowUp';
		// the neighbour past the block's first (up) or last (down) item that is not in the block
		let n = all.indexOf(up ? block[0] : block[block.length - 1]);
		let other: HTMLElement | undefined;
		do { n += up ? -1 : 1; other = all[n]; } while (other && block.indexOf(other) > -1);
		if (!other) return;
		e.preventDefault();
		if (options.start) options.start(item, block);
		const order = items();
		if (up) other.insertAdjacentElement('beforebegin', item);
		else other.insertAdjacentElement('afterend', item);
		gather(item, block, order);
		target.focus(); // moving the node may drop the focus
		if (options.stop) options.stop(item, { dx: 0, dy: 0, outside: false, cancelled: false }, block);
		if (options.update) options.update(item);
	};
	list.addEventListener('keydown', onKey);
	// an image or link inside an item would start the browser's own drag and swallow the pointer
	const onNativeDrag = (e: DragEvent): void => { if (pending || dragging) e.preventDefault(); };
	list.addEventListener('dragstart', onNativeDrag);
	list.addEventListener('pointerdown', onDown);
	list.addEventListener('pointermove', onMove);
	list.addEventListener('pointerup', onUp);
	list.addEventListener('pointercancel', onCancel);
	return () => {
		list.removeEventListener('keydown', onKey);
		list.removeEventListener('dragstart', onNativeDrag);
		list.removeEventListener('pointerdown', onDown);
		list.removeEventListener('pointermove', onMove);
		list.removeEventListener('pointerup', onUp);
		list.removeEventListener('pointercancel', onCancel);
		window.removeEventListener('keydown', onEsc, true);
	};
}

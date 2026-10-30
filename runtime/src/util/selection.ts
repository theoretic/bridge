/**
 * Selecting several items of a list (0.14.0, ADR 0018): file rows, image tiles and page tree rows,
 * so a drag (util/sortable.ts `group`, fields/pagelist-move.ts) or a delete box takes them all.
 *
 * Gestures, as in a file manager, with the mouse or a pen (touch keeps its scroll and drags):
 * - Ctrl+click (Cmd+click on a Mac) adds or removes an item; Shift+click selects the range from
 *   the last item toggled. The click does nothing else: no edit panel, no link, no lightbox.
 * - A press on the list's background (with `marqueeFromItems`, also on an item's own blank box)
 *   draws a rubber band after 4 px: the items it touches are selected, added with Ctrl or Shift.
 *   A press there that does not move clears the selection.
 * - A plain click on an item clears the selection, then does what it did before. A press on an
 *   unselected item clears it too, so a drag that follows moves that item alone; a press on a
 *   selected item keeps the selection for the drag.
 * - A press anywhere outside the container clears it (not inside dialogs, the lightbox, dropdowns).
 * - Esc clears every selection; Ctrl+A (Cmd+A) selects all items of the list last pressed, unless
 *   the focus is in a text control.
 *
 * State: `pw-selected` on the items, `pw-has-selection` and `data-pw-selectable` on the container;
 * the count is announced in a polite live region. Items that left the page drop out.
 */

import { edgeScroll, byDom } from './sortable';
import { label } from './labels';

export type SelectableOptions = {
	/** the items, found with closest() from the pressed element, inside the container */
	items: string;
	/** never a selection gesture: controls, panels, actions */
	ignore?: string;
	canSelect?: (item: HTMLElement) => boolean;
	/** a press on an item's own box (not on its children) may start the rubber band */
	marqueeFromItems?: boolean;
	/** applied to every new selection (the page tree drops rows inside a selected row) */
	normalize?: (items: HTMLElement[]) => HTMLElement[];
	enabled?: () => boolean;
	onChange?: (selected: HTMLElement[]) => void;
};

export type Selectable = {
	/** the selected items still on the page, in document order */
	selected(): HTMLElement[];
	set(items: HTMLElement[]): void;
	toggle(item: HTMLElement): void;
	clear(): void;
	isSelected(item: HTMLElement): boolean;
	destroy(): void;
};

type Instance = { container: HTMLElement; api: Selectable; selectAll(): void };

const instances = new Set<Instance>();
let lastActive: Instance | null = null;
let documentReady = false;
let status: HTMLElement | null = null;

// presses there keep every selection: dialogs, dropdowns, and the menu of several tree rows
const OUTSIDE_KEEP = 'dialog, .pw-lightbox, .selectize-dropdown, .ui-dialog, .pw-drag-ghost, .pw-group-actions';
const TEXT = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function announce(n: number): void {
	if (!document.body) return;
	if (!status) {
		status = document.createElement('span');
		status.className = 'pw-sr-only';
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		document.body.appendChild(status);
	}
	status.textContent = n ? label('selectedCount', '%d selected').replace('%d', String(n)) : '';
}

function setupDocument(): void {
	if (documentReady) return;
	documentReady = true;
	document.addEventListener('pointerdown', e => {
		const t = e.target as HTMLElement;
		if (t.closest && t.closest(OUTSIDE_KEEP)) return;
		lastActive = null;
		instances.forEach(inst => {
			if (!inst.container.isConnected) { instances.delete(inst); return; }
			if (inst.container.contains(t)) lastActive = inst;
			else if (!e.ctrlKey && !e.metaKey && !e.shiftKey) inst.api.clear();
		});
	}, true);
	document.addEventListener('keydown', e => {
		if (e.key === 'Escape') {
			if (document.querySelector('dialog[open]')) return;
			instances.forEach(inst => inst.api.clear());
			return;
		}
		if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey) && !e.altKey && lastActive && lastActive.container.isConnected) {
			const t = e.target as HTMLElement;
			if (t.closest && t.closest(TEXT)) return;
			e.preventDefault();
			lastActive.selectAll();
		}
	});
}

export function makeSelectable(container: HTMLElement, o: SelectableOptions): Selectable {
	setupDocument();
	const sel = new Set<HTMLElement>();
	let anchor: HTMLElement | null = null;
	container.setAttribute('data-pw-selectable', '');

	// an item of this container, not of a selectable nested in it
	const itemOf = (t: HTMLElement): HTMLElement | null => {
		const item = t.closest<HTMLElement>(o.items);
		if (!item || !container.contains(item)) return null;
		const owner = item.parentElement ? item.parentElement.closest('[data-pw-selectable]') : null;
		return owner === container ? item : null;
	};
	const ownTarget = (t: HTMLElement): boolean => t.closest('[data-pw-selectable]') === container;
	const can = (item: HTMLElement): boolean => !o.canSelect || o.canSelect(item);
	const candidates = (): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>(o.items))
		.filter(i => i.offsetParent !== null && can(i) && itemOf(i) === i);

	const selected = (): HTMLElement[] => Array.from(sel).filter(i => i.isConnected).sort(byDom);

	const apply = (next: HTMLElement[]): void => {
		let list = next.filter(i => i.isConnected && can(i));
		if (o.normalize) list = o.normalize(list);
		const keep = new Set(list);
		let changed = keep.size !== sel.size;
		sel.forEach(i => { if (!keep.has(i)) { i.classList.remove('pw-selected'); changed = true; } });
		list.forEach(i => { if (!sel.has(i)) { i.classList.add('pw-selected'); changed = true; } });
		sel.clear();
		list.forEach(i => sel.add(i));
		if (!changed) return;
		container.classList.toggle('pw-has-selection', sel.size > 0);
		announce(sel.size);
		if (o.onChange) o.onChange(selected());
	};

	const api: Selectable = {
		selected,
		set: items => apply(items),
		toggle: item => {
			anchor = item;
			apply(sel.has(item) ? selected().filter(i => i !== item) : selected().concat(item));
		},
		clear: () => { if (sel.size) apply([]); },
		isSelected: item => sel.has(item) && item.isConnected,
		destroy: () => {
			api.clear();
			container.removeEventListener('pointerdown', onDown, true);
			container.removeEventListener('pointermove', onMove);
			container.removeEventListener('pointerup', onUp);
			container.removeEventListener('pointercancel', onUp);
			container.removeEventListener('click', onClick, true);
			container.removeEventListener('dragstart', onNativeDrag);
			container.removeAttribute('data-pw-selectable');
			if (lastActive === inst) lastActive = null;
			instances.delete(inst);
		},
	};

	const range = (item: HTMLElement, add: boolean): void => {
		const all = candidates();
		const from = anchor && anchor.isConnected ? all.indexOf(anchor) : -1;
		const to = all.indexOf(item);
		if (from < 0 || to < 0) { api.toggle(item); return; }
		const part = all.slice(Math.min(from, to), Math.max(from, to) + 1);
		apply(add ? selected().concat(part.filter(i => !sel.has(i))) : part);
	};

	/* rubber band ********************************************************************************/

	type Band = { id: number; x: number; y: number; base: HTMLElement[]; add: boolean; box: HTMLElement | null };
	let band: Band | null = null;
	let swallow = false;

	const startBand = (e: PointerEvent): void => {
		band = { id: e.pointerId, x: e.clientX + window.scrollX, y: e.clientY + window.scrollY, base: selected(), add: e.ctrlKey || e.metaKey || e.shiftKey, box: null };
	};

	const onMove = (e: PointerEvent): void => {
		if (!band || e.pointerId !== band.id) return;
		// released outside the container before the band began
		if (!band.box && !(e.buttons & 1)) { band = null; return; }
		const x = e.clientX + window.scrollX;
		const y = e.clientY + window.scrollY;
		if (!band.box) {
			if (Math.abs(x - band.x) < 4 && Math.abs(y - band.y) < 4) return;
			window.getSelection()?.removeAllRanges();
			band.box = document.createElement('div');
			band.box.className = 'pw-marquee';
			document.body.appendChild(band.box);
			container.classList.add('pw-marquee-active');
			try { container.setPointerCapture(band.id); } catch (err) { /* older engines */ }
		}
		e.preventDefault();
		const left = Math.min(x, band.x);
		const top = Math.min(y, band.y);
		const right = Math.max(x, band.x);
		const bottom = Math.max(y, band.y);
		Object.assign(band.box.style, { left: (left - window.scrollX) + 'px', top: (top - window.scrollY) + 'px', width: (right - left) + 'px', height: (bottom - top) + 'px' });
		const hit = candidates().filter(i => {
			const r = i.getBoundingClientRect();
			return r.right + window.scrollX > left && r.left + window.scrollX < right && r.bottom + window.scrollY > top && r.top + window.scrollY < bottom;
		});
		apply(band.add ? band.base.concat(hit.filter(i => band && band.base.indexOf(i) < 0)) : hit);
		edgeScroll(e.clientY);
	};

	const onUp = (e: PointerEvent): void => {
		if (!band || e.pointerId !== band.id) return;
		const b = band;
		band = null;
		edgeScroll(0, true);
		if (b.box) {
			b.box.remove();
			container.classList.remove('pw-marquee-active');
			try { container.releasePointerCapture(b.id); } catch (err) { /* released */ }
			// the click that follows the band is not a click on what it ends over
			swallow = true;
			window.setTimeout(() => { swallow = false; }, 0);
			return;
		}
		if (!b.add) api.clear();
	};

	/* presses and clicks *************************************************************************/

	const onDown = (e: PointerEvent): void => {
		if (e.button !== 0 || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
		if (o.enabled && !o.enabled()) return;
		const t = e.target as HTMLElement;
		if (!ownTarget(t) && !itemOf(t)) return;
		if (o.ignore && t.closest(o.ignore)) return;
		const item = itemOf(t);
		const modifier = e.ctrlKey || e.metaKey || e.shiftKey;
		if (item) {
			// no text range on Shift+click
			if (e.shiftKey) e.preventDefault();
			if (!modifier && !sel.has(item)) api.clear();
			if (o.marqueeFromItems && t === item) startBand(e);
			return;
		}
		startBand(e);
	};

	const onClick = (e: MouseEvent): void => {
		if (swallow) {
			swallow = false;
			e.preventDefault();
			e.stopPropagation();
			return;
		}
		if (o.enabled && !o.enabled()) return;
		const t = e.target as HTMLElement;
		const item = itemOf(t);
		if (!item || (o.ignore && t.closest(o.ignore))) return;
		if (e.ctrlKey || e.metaKey || e.shiftKey) {
			e.preventDefault();
			e.stopPropagation();
			if (!can(item)) return;
			if (e.shiftKey) range(item, e.ctrlKey || e.metaKey);
			else api.toggle(item);
			return;
		}
		api.clear();
	};

	// the band must not turn into the browser's drag of an image or a link
	const onNativeDrag = (e: DragEvent): void => { if (band) e.preventDefault(); };

	container.addEventListener('pointerdown', onDown, true);
	container.addEventListener('pointermove', onMove);
	container.addEventListener('pointerup', onUp);
	container.addEventListener('pointercancel', onUp);
	container.addEventListener('click', onClick, true);
	container.addEventListener('dragstart', onNativeDrag);
	const inst: Instance = { container, api, selectAll: () => apply(candidates()) };
	instances.add(inst);
	return api;
}

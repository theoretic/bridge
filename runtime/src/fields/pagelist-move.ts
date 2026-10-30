/**
 * The page tree's moves (milestone 3.4, split from fields/pagelist.ts in 0.14.0; 0.16.0: a row is
 * dragged by its title, there is no Move action): upstream ProcessPageList.js's stopMove on the same
 * markup and endpoint.
 *
 * - A row can be dragged when the server gave it Move (ProcessPageListActions: the page is sortable
 *   or moveable); that action is not shown (fields/pagelist.ts). The drag starts on the row's title,
 *   count or note: with the mouse or a pen after 4 px (a press that does not move stays a click that
 *   opens or closes the row; the click after a drag is swallowed), with touch after a 400 ms hold, so
 *   a swipe still scrolls. Ctrl, Cmd or Shift make a press a selection, never a drag; the row's blank
 *   part draws the rubber band and its actions stay links (util/selection.ts).
 * - While dragging: the item `PageListSortItem PageListSortPlaceholder`, the root `PageListSorting`;
 *   open items without visible children get a placeholder list to drop into. The item goes before
 *   or after the item under the pointer (an open item's child list takes it first, never between the
 *   item and its list).
 * - A selected row (util/selection.ts, ADR 0018) drags the selection: the others are hidden
 *   (`pw-drag-member`) while it is dragged with a count (`data-pw-count`), and land after it, in
 *   their order. Each page is posted on its own, as upstream's endpoint takes one (`id`,
 *   `parent_id`, `sort` = the drop list's order, the container's CSRF token); a page the server
 *   refuses goes back where it was, and the messages are shown once at the end. Counts follow;
 *   `pageMoved` on each moved item.
 * - A drop where the rows were posts nothing. Esc or a cancelled pointer puts them back; the window
 *   scrolls near its edges while dragging.
 */

import { gather, edgeScroll, swallowClick } from '../util/sortable';
import type { Selectable } from '../util/selection';
import { label } from '../util/labels';
import { guard, fill } from '../util/danger';

export type TreeCtx = {
	root: HTMLElement;
	container: HTMLElement;
	o: { ajaxMoveURL: string; ajaxUnknownError: string; trashPageID: number };
	el: <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => HTMLElementTagNameMap[K];
	kids: (e: Element | null, sel: string) => HTMLElement[];
	next: (e: Element, sel: string) => HTMLElement | null;
	prev: (e: Element, sel: string) => HTMLElement | null;
	pageId: (item: Element) => number;
	numOf: (item: HTMLElement | null, total?: boolean) => number;
	setNum: (item: HTMLElement, numChildren: number | false, numTotal?: number | false, addNew?: boolean) => void;
	adjustTotal: (item: HTMLElement | null, n: number) => void;
	forceReload: (item: HTMLElement | null, reloadNow?: boolean) => void;
	toggleItem: (li: HTMLElement) => void;
	spinner: () => HTMLElement;
	alertMsg: (m: string) => void;
	ignoreClicks: () => boolean;
	select: Selectable;
	/** the server gave the row Move */
	canMove: (li: HTMLElement) => boolean;
	/** a drag began (the menu of several rows steps aside) */
	onStart: () => void;
};

type Origin = { list: HTMLElement; at: number };

const THRESHOLD = 4;
const HOLD = 400;
// the parts of a row that drag it; the rest of the row draws the rubber band
const GRIP = 'a.PageListPage, .PageListNumChildren, .PageListNote';

export function installMove(c: TreeCtx): void {
	const { root, kids, next, prev, pageId } = c;
	let moving: HTMLElement | null = null;
	let group: HTMLElement[] = [];
	let origins = new Map<HTMLElement, Origin>();
	// each list the rows came from, in its order at the start: a drop that changes none posts nothing
	let orders = new Map<HTMLElement, HTMLElement[]>();
	let dragId = -1;
	// pressed, not dragged yet
	let pending: HTMLElement | null = null;
	let startX = 0;
	let startY = 0;
	let holdTimer = 0;

	const items = (list: Element): HTMLElement[] => kids(list, '.PageListItem').filter(x => !x.classList.contains('PageListPlaceholderItem'));
	const busy = (): boolean => root.classList.contains('PageListSorting') || root.classList.contains('PageListSortSaving');

	/** back where it was: its place among the items of its list that do not move */
	const restore = (li: HTMLElement): void => {
		const o = origins.get(li);
		if (!o || !o.list.isConnected) return;
		const stay = items(o.list).filter(x => group.indexOf(x) < 0);
		const before = stay[o.at] || kids(o.list, 'ul.PageListActions')[0] || null;
		o.list.insertBefore(li, before);
	};

	const unchanged = (): boolean => group.every(m => { const o = origins.get(m); return !!o && o.list === m.parentElement; })
		&& Array.from(orders).every(([list, was]) => { const now = items(list); return now.length === was.length && now.every((x, n) => x === was[n]); });

	const forget = (): void => {
		window.clearTimeout(holdTimer);
		pending = null;
		dragId = -1;
	};

	/** the drag ends where it began */
	const abort = (): void => {
		if (!moving) return;
		try { root.releasePointerCapture(dragId); } catch (err) { /* released */ }
		dragId = -1;
		moving.classList.remove('PageListSortPlaceholder');
		edgeScroll(0, true);
		group.slice().reverse().forEach(restore);
		cancelMove();
	};

	const onEsc = (e: KeyboardEvent): void => {
		if (e.key !== 'Escape' || !moving) return;
		e.preventDefault();
		abort();
	};

	/** the rows that move: open ones closed, where each came from, places to drop into, the mode on */
	const prepare = (rows: HTMLElement[]): void => {
		group = rows;
		group.forEach(m => { if (m.classList.contains('PageListItemOpen')) c.toggleItem(m); });
		origins = new Map();
		orders = new Map();
		group.forEach(m => {
			const list = m.parentElement as HTMLElement;
			origins.set(m, { list, at: items(list).filter(x => group.indexOf(x) < 0 && (x.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING)).length });
			if (!orders.has(list)) orders.set(list, items(list));
		});
		// an open item without visible children gets an empty list to drop into
		root.querySelectorAll<HTMLElement>('.PageListItemOpen').forEach(open => {
			const list = next(open, '.PageList');
			if (c.numOf(open) > 1 && !(list && list.offsetParent !== null)) return;
			if (list && list.offsetParent !== null) return;
			const ph = c.el('div', 'PageListPlaceholder PageList');
			ph.appendChild(c.el('div', 'PageListItem PageListPlaceholderItem', '&nbsp;'));
			open.insertAdjacentElement('afterend', ph);
		});
		root.classList.add('PageListSorting');
		kids(kids(root, '.PageList')[0], '.PageList').forEach(x => x.classList.add('PageListSortingList'));
		window.addEventListener('keydown', onEsc, true);
	};

	/** the pressed row starts moving, with the selection when it is in it */
	const begin = (li: HTMLElement): void => {
		window.clearTimeout(holdTimer);
		pending = null;
		const visible = Array.from(root.querySelectorAll<HTMLElement>('.PageListItem')).filter(x => x.offsetParent !== null);
		if (visible.length < 2 || !li.isConnected) { dragId = -1; return; }
		const rows = c.select.isSelected(li) ? c.select.selected().filter(c.canMove) : [li];
		prepare(rows.indexOf(li) < 0 ? [li] : rows);
		li.classList.add('PageListSortItem', 'PageListSortPlaceholder');
		group.forEach(m => { if (m !== li) m.classList.add('pw-drag-member'); });
		if (group.length > 1) li.setAttribute('data-pw-count', String(group.length));
		moving = li;
		window.getSelection()?.removeAllRanges();
		try { root.setPointerCapture(dragId); } catch (err) { /* older engines */ }
		c.onStart();
	};

	const cancelMove = (): void => {
		root.querySelectorAll('.PageListSortingList').forEach(x => x.classList.remove('PageListSortingList'));
		group.forEach(m => {
			m.classList.remove('pw-drag-member', 'PageListSortItem');
			m.removeAttribute('data-pw-count');
		});
		root.querySelectorAll('.PageListPlaceholder').forEach(x => {
			if (x.querySelector('.PageListItem:not(.PageListPlaceholderItem)')) { x.classList.remove('PageListPlaceholder'); x.querySelectorAll('.PageListPlaceholderItem').forEach(p => p.remove()); }
			else x.remove();
		});
		root.classList.remove('PageListSorting');
		window.removeEventListener('keydown', onEsc, true);
		moving = null;
	};

	const post = async (li: HTMLElement, parentID: number, list: HTMLElement): Promise<{ error?: boolean; message?: string }> => {
		const body = new URLSearchParams();
		body.set('id', String(pageId(li)));
		body.set('parent_id', String(parentID));
		body.set('sort', items(list).map(x => pageId(x)).join(',') + ',');
		body.set(c.container.getAttribute('data-token-name') || '', c.container.getAttribute('data-token-value') || '');
		try {
			const res = await fetch(c.o.ajaxMoveURL, { method: 'POST', body, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
			const text = (await res.text()).trim();
			// nothing to say: the order was already right (an earlier request of the group saved it)
			if (!text && res.ok) return {};
			return JSON.parse(text);
		} catch (err) {
			return { error: true, message: c.o.ajaxUnknownError };
		}
	};

	const stopMove = async (lead: HTMLElement): Promise<void> => {
		const list = lead.parentElement as HTMLElement;
		const travelling = group.slice();
		// the others land after the lead (those before it in the tree before it), in their order
		gather(lead, travelling, travelling);
		if (unchanged()) { cancelMove(); return; }
		if (list.classList.contains('PageListPlaceholder')) {
			list.classList.remove('PageListPlaceholder');
			list.querySelectorAll('.PageListPlaceholderItem').forEach(x => x.remove());
		}
		let before = list.previousElementSibling as HTMLElement | null;
		if (before && !before.classList.contains('PageListItem')) before = before.previousElementSibling as HTMLElement | null;
		const parentID = before ? pageId(before) : 0;
		// a drop on the Trash sends the pages away from the site at once (ADR 0019)
		if (parentID && parentID === c.o.trashPageID) {
			const one = travelling.length === 1;
			const kidsOf = one ? c.numOf(lead) : 0;
			const ok = await guard({
				title: one
					? fill('warnTrashTitle', 'Move %s to the trash?', (lead.querySelector('a.PageListPage') || lead).textContent || '')
					: fill('trashPages', 'Move %d pages to the trash?', travelling.length),
				message: kidsOf
					? fill('warnTrashKids', 'It leaves the site right away, with its %d subpages. You can restore it from the trash.', kidsOf)
					: one
						? label('warnTrash', 'It leaves the site right away. You can restore it from the trash.')
						: label('warnTrashMany', 'They leave the site right away. You can restore them from the trash.'),
				ok: label('warnVerbTrash', 'Move to trash'),
			});
			if (!ok) {
				group.slice().reverse().forEach(restore);
				cancelMove();
				return;
			}
		}
		root.classList.add('PageListSortSaving');
		cancelMove();
		group = travelling;
		const messages: string[] = [];
		const moved: HTMLElement[] = [];
		// in tree order, one request each: upstream's endpoint moves one page
		for (const li of travelling.filter(x => x.parentElement === list)) {
			const spin = c.spinner();
			li.appendChild(spin);
			const data = await post(li, parentID, list);
			spin.remove();
			if (data && data.error) {
				if (data.message && messages.indexOf(data.message) < 0) messages.push(data.message);
				restore(li);
				continue;
			}
			moved.push(li);
			const origin = (origins.get(li) as Origin).list;
			if (origin !== list) {
				const fromItem = prev(origin, '.PageListItem');
				let n = c.numOf(fromItem);
				if (n > 0) { n--; c.adjustTotal(fromItem, -1); } else if (!items(origin).length) origin.remove();
				if (fromItem) { c.setNum(fromItem, n, false); c.forceReload(fromItem); }
				const toItem = prev(list, '.PageListItem');
				if (toItem) { c.adjustTotal(toItem, 1); c.setNum(toItem, c.numOf(toItem) + 1, false); c.forceReload(toItem); }
			}
		}
		group = [];
		root.classList.remove('PageListSortSaving');
		c.select.clear();
		if (messages.length) c.alertMsg(messages.join('\n'));
		moved.forEach(li => li.dispatchEvent(new CustomEvent('pageMoved', { bubbles: true })));
	};

	// a press on a row's title, count or note may become its drag
	root.addEventListener('pointerdown', e => {
		if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || moving || pending || busy() || c.ignoreClicks()) return;
		const grip = (e.target as HTMLElement).closest<HTMLElement>(GRIP);
		const row = grip ? grip.parentElement : null;
		if (!row || !row.classList.contains('PageListItem') || !root.contains(row) || !c.canMove(row)) return;
		pending = row;
		dragId = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		if (e.pointerType === 'touch') {
			holdTimer = window.setTimeout(() => { if (pending === row) begin(row); }, HOLD);
			return;
		}
		// no text selection and no browser drag of the link: the press is a click or this drag
		e.preventDefault();
	});
	// touch: the hold made it a drag, so the finger no longer scrolls or opens the link's menu
	root.addEventListener('touchmove', e => { if (moving) e.preventDefault(); }, { passive: false });
	root.addEventListener('contextmenu', e => { if (pending || moving) e.preventDefault(); });
	root.addEventListener('dragstart', e => { if (pending || moving) e.preventDefault(); });

	// dragging: placed before or after the item under the pointer
	root.addEventListener('pointermove', e => {
		if (e.pointerId !== dragId) return;
		if (pending) {
			const far = Math.max(Math.abs(e.clientX - startX), Math.abs(e.clientY - startY));
			// touch: moving before the hold is a scroll
			if (e.pointerType === 'touch') { if (far > 8) forget(); return; }
			if (!(e.buttons & 1)) { forget(); return; }
			if (far < THRESHOLD) return;
			begin(pending);
		}
		if (!moving) return;
		e.preventDefault();
		edgeScroll(e.clientY);
		const under = document.elementFromPoint(e.clientX, e.clientY);
		const target = under ? (under as HTMLElement).closest<HTMLElement>('.PageListItem') : null;
		if (!target || target === moving || !root.contains(target) || target.closest('.PageListRootHidden > .PageListItem') === target) return;
		if (!target.closest('.PageListSortingList') && !target.classList.contains('PageListPlaceholderItem')) return;
		if (target.classList.contains('PageListPlaceholderItem')) { target.insertAdjacentElement('beforebegin', moving); return; }
		const r = target.getBoundingClientRect();
		const after = e.clientY > r.top + r.height / 2;
		if (!after) { target.insertAdjacentElement('beforebegin', moving); return; }
		// below an open item is its child list: the item goes first in there, never between the two
		const childList = next(target, '.PageList');
		if (target.classList.contains('PageListItemOpen') && childList) {
			const first = kids(childList, '.PageListItem')[0];
			if (first) first.insertAdjacentElement('beforebegin', moving); else childList.appendChild(moving);
		} else {
			target.insertAdjacentElement('afterend', moving);
		}
	});
	root.addEventListener('pointerup', e => {
		if (e.pointerId !== dragId) return;
		if (!moving) { forget(); return; }
		dragId = -1;
		edgeScroll(0, true);
		try { root.releasePointerCapture(e.pointerId); } catch (err) { /* released */ }
		// the click that follows does not open or close the row it ends over
		swallowClick();
		const li = moving;
		li.classList.remove('PageListSortPlaceholder');
		void stopMove(li);
	});
	root.addEventListener('pointercancel', e => {
		if (e.pointerId !== dragId) return;
		if (moving) abort(); else forget();
	});
}

/**
 * The page tree's Move (milestone 3.4, split from fields/pagelist.ts in 0.14.0 and loaded at the
 * first Move click): upstream ProcessPageList.js's clickMove / stopMove on the same markup and
 * endpoint.
 *
 * - Move on an item: it gets the move note with Cancel (`PageListSortItem`, `PageListMoveNote`),
 *   the root `PageListSorting`; open items without visible children get a placeholder list to drop
 *   into. The item is then dragged before or after the item under the pointer (an open item's child
 *   list takes it first, never between the item and its list).
 * - With several rows selected (util/selection.ts, ADR 0018), Move on one of them moves them all:
 *   the others are hidden (`pw-drag-member`) while it is dragged with a count (`data-pw-count`), and
 *   land after it, in their order. Each page is posted on its own, as upstream's endpoint takes one
 *   (`id`, `parent_id`, `sort` = the drop list's order, the container's CSRF token); a page the
 *   server refuses goes back where it was, and the messages are shown once at the end. Counts follow;
 *   `pageMoved` on each moved item.
 * - Esc or Cancel ends the move; the window scrolls near its edges while dragging.
 */

import { gather, edgeScroll } from '../util/sortable';
import type { Selectable } from '../util/selection';
import { label } from '../util/labels';
import { esc } from '../util/html';

export type TreeCtx = {
	root: HTMLElement;
	container: HTMLElement;
	o: { ajaxMoveURL: string; moveInstructionLabel: string; selectCancelLabel: string; ajaxUnknownError: string };
	icons: { sort: string; left: string };
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
};

type Origin = { list: HTMLElement; at: number };

export function installMove(c: TreeCtx): { clickMove(a: HTMLAnchorElement): void } {
	const { root, kids, next, prev, pageId } = c;
	let moving: HTMLElement | null = null;
	let group: HTMLElement[] = [];
	let origins = new Map<HTMLElement, Origin>();
	let dragId = -1;

	const items = (list: Element): HTMLElement[] => kids(list, '.PageListItem').filter(x => !x.classList.contains('PageListPlaceholderItem'));

	/** back where it was: its place among the items of its list that do not move */
	const restore = (li: HTMLElement): void => {
		const o = origins.get(li);
		if (!o || !o.list.isConnected) return;
		const stay = items(o.list).filter(x => group.indexOf(x) < 0);
		const before = stay[o.at] || kids(o.list, 'ul.PageListActions')[0] || null;
		o.list.insertBefore(li, before);
	};

	const onEsc = (e: KeyboardEvent): void => {
		if (e.key !== 'Escape' || !moving) return;
		e.preventDefault();
		if (dragId > -1) {
			try { root.releasePointerCapture(dragId); } catch (err) { /* released */ }
			dragId = -1;
			moving.classList.remove('PageListSortPlaceholder');
			edgeScroll(0, true);
		}
		group.slice().reverse().forEach(restore);
		cancelMove();
	};

	const clickMove = (a: HTMLAnchorElement): void => {
		if (c.ignoreClicks() || moving) return;
		const visible = Array.from(root.querySelectorAll<HTMLElement>('.PageListItem')).filter(x => x.offsetParent !== null);
		if (visible.length === 1) { a.style.textDecoration = 'line-through'; a.classList.add('ui-state-disabled'); return; }
		const li = a.closest<HTMLElement>('.PageListItem') as HTMLElement;
		group = c.select.isSelected(li) ? c.select.selected() : [li];
		if (group.indexOf(li) < 0) group = [li];
		group.forEach(m => { if (m.classList.contains('PageListItemOpen')) c.toggleItem(m); });
		origins = new Map();
		group.forEach(m => {
			const list = m.parentElement as HTMLElement;
			origins.set(m, { list, at: items(list).filter(x => group.indexOf(x) < 0 && (x.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING)).length });
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
		const count = group.length > 1 ? esc(label('movePages', 'Moving %d pages').replace('%d', String(group.length))) + ':&nbsp;' : '';
		const note = c.el('span', 'PageListMoveNote detail', c.icons.sort + '&nbsp;' + count + c.o.moveInstructionLabel + '&nbsp;' + c.icons.left + '&nbsp;');
		const cancel = c.el('a', '', c.o.selectCancelLabel);
		cancel.href = '#';
		cancel.addEventListener('click', e => { e.preventDefault(); cancelMove(); });
		note.appendChild(cancel);
		const actions = kids(li, 'ul.PageListActions')[0];
		li.insertBefore(note, actions || null);
		li.classList.add('PageListSortItem');
		group.forEach(m => { if (m !== li) m.classList.add('pw-drag-member'); });
		if (group.length > 1) li.setAttribute('data-pw-count', String(group.length));
		root.classList.add('PageListSorting');
		kids(kids(root, '.PageList')[0], '.PageList').forEach(x => x.classList.add('PageListSortingList'));
		moving = li;
		window.addEventListener('keydown', onEsc, true);
	};

	const cancelMove = (): void => {
		root.querySelectorAll('.PageListSortingList').forEach(x => x.classList.remove('PageListSortingList'));
		if (moving) {
			moving.classList.remove('PageListSortItem');
			moving.removeAttribute('data-pw-count');
			moving.querySelectorAll('.PageListMoveNote').forEach(x => x.remove());
		}
		group.forEach(m => m.classList.remove('pw-drag-member'));
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
		if (list.classList.contains('PageListPlaceholder')) {
			list.classList.remove('PageListPlaceholder');
			list.querySelectorAll('.PageListPlaceholderItem').forEach(x => x.remove());
		}
		let before = list.previousElementSibling as HTMLElement | null;
		if (before && !before.classList.contains('PageListItem')) before = before.previousElementSibling as HTMLElement | null;
		const parentID = before ? pageId(before) : 0;
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
			li.classList.remove('PageListSortItem');
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

	// dragging the item that is moving: placed before or after the item under the pointer
	root.addEventListener('pointerdown', e => {
		if (!moving || e.button !== 0) return;
		const t = e.target as HTMLElement;
		if (!moving.contains(t) || t.closest('.PageListMoveNote a')) return;
		e.preventDefault();
		dragId = e.pointerId;
		moving.classList.add('PageListSortPlaceholder');
		root.setPointerCapture(dragId);
	});
	root.addEventListener('pointermove', e => {
		if (!moving || e.pointerId !== dragId) return;
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
	const drop = (e: PointerEvent): void => {
		if (!moving || e.pointerId !== dragId) return;
		dragId = -1;
		edgeScroll(0, true);
		try { root.releasePointerCapture(e.pointerId); } catch (err) { /* released */ }
		const li = moving;
		li.classList.remove('PageListSortPlaceholder');
		void stopMove(li);
	};
	root.addEventListener('pointerup', drop);
	root.addEventListener('pointercancel', drop);

	return { clickMove };
}

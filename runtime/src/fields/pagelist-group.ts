/**
 * One menu for several selected rows of the page tree (0.14.1, ADR 0018): a chunk of its own,
 * loaded when a second row is selected (fields/pagelist.ts).
 *
 * With two or more rows selected, their own action menus stay hidden (`pw-multi-selection` on the
 * root). Hovering a selected row shows `ul.PageListActions.pw-group-actions` instead, after the
 * longest title of the run of selected rows under the pointer (adjacent selected rows read as one
 * band) and centred on it vertically. It holds the actions of the selected rows except View: each
 * once, with how many rows it applies to when not all. They act on every selected row that has
 * them:
 * - Move: the selection becomes draggable as one (fields/pagelist-move.ts moveGroup());
 * - AJAX extras (hide, unpublish, lock, trash, ...): posted row by row as a single row's are
 *   (Trash asks first); the rows stay selected afterwards;
 * - the others (Edit, New, extras that open a page): the native dialog, one row after another, with a
 *   Next button in its footer (unsaved changes ask first); closing it ends the round. Edited
 *   rows' lists reload afterwards.
 */

import type { Selectable } from '../util/selection';
import { label } from '../util/labels';
import { esc } from '../util/html';

type Action = { cn: string; name: string; url: string; extras?: Record<string, Action>; ajax?: boolean };
type Entry = { action: Action; rows: HTMLElement[] };

export type GroupCtx = {
	root: HTMLElement;
	select: Selectable;
	pageId: (li: Element) => number;
	isModal: boolean;
	hoverDelay: number;
	actionsOf: (li: HTMLElement) => Action[];
	ajaxAction: (link: HTMLAnchorElement) => Promise<void>;
	moveGroup: (rows: HTMLElement[]) => void;
	refreshList: (id: number) => void;
};

type Dialog = { open(url: string, size: string, options: Record<string, unknown>): void };

const EDIT_BUTTONS = '#ProcessPageEdit > .Inputfields > .InputfieldSubmit .ui-button';
const text = (html: string): string => { const d = document.createElement('div'); d.innerHTML = html; return (d.textContent || '').trim(); };

export function installGroup(c: GroupCtx): { update(rows: HTMLElement[]): void } {
	const root = c.root;
	const menu = document.createElement('ul');
	menu.className = 'PageListActions actions pw-group-actions';
	menu.hidden = true;
	document.body.appendChild(menu);
	let selected: HTMLElement[] = [];
	let primary = new Map<string, Entry>();
	let extras = new Map<string, Entry>();
	let showTimer = 0;
	let hideTimer = 0;
	let shownFor: HTMLElement | null = null;

	const hide = (): void => {
		window.clearTimeout(showTimer);
		window.clearTimeout(hideTimer);
		menu.hidden = true;
		shownFor = null;
	};
	const later = (): void => { window.clearTimeout(hideTimer); hideTimer = window.setTimeout(hide, 300); };

	/** the adjacent selected rows around one: they read as one band */
	const runOf = (li: HTMLElement): HTMLElement[] => {
		const run = [li];
		for (let p = li.previousElementSibling; p && p.matches('.PageListItem.pw-selected'); p = p.previousElementSibling) run.unshift(p as HTMLElement);
		for (let n = li.nextElementSibling; n && n.matches('.PageListItem.pw-selected'); n = n.nextElementSibling) run.push(n as HTMLElement);
		return run;
	};

	const collect = (): void => {
		primary = new Map();
		extras = new Map();
		const add = (map: Map<string, Entry>, action: Action, li: HTMLElement): void => {
			const entry = map.get(action.cn) || { action, rows: [] };
			if (entry.rows.indexOf(li) < 0) entry.rows.push(li);
			map.set(action.cn, entry);
		};
		selected.forEach(li => c.actionsOf(li).forEach(action => {
			if (action.cn === 'View') return; // several pages cannot be viewed at once
			if (action.extras) Object.keys(action.extras).forEach(k => add(extras, (action.extras as Record<string, Action>)[k], li));
			add(primary, action, li);
		}));
		if (!extras.size) primary.delete('Extras');
	};

	const item = (cn: string, entry: Entry, extra: boolean): HTMLElement => {
		const li = document.createElement('li');
		li.className = 'PageListAction' + cn + (extra ? ' PageListActionExtra' : '') + (cn === 'Extras' ? ' ui-priority-secondary' : '');
		const a = document.createElement('a');
		a.href = '#';
		a.setAttribute('data-cn', cn);
		if (extra) a.setAttribute('data-extra', '1');
		const count = cn !== 'Extras' && entry.rows.length < selected.length ? ` <span class="pw-group-count">${entry.rows.length}</span>` : '';
		a.innerHTML = entry.action.name + count;
		li.appendChild(a);
		return li;
	};

	const build = (): void => {
		collect();
		menu.innerHTML = '';
		primary.forEach((entry, cn) => menu.appendChild(item(cn, entry, false)));
		const toggle = menu.querySelector('.PageListActionExtras');
		if (toggle) menu.appendChild(toggle);
	};

	const place = (li: HTMLElement): void => {
		const run = runOf(li);
		const top = run[0].getBoundingClientRect().top;
		const bottom = run[run.length - 1].getBoundingClientRect().bottom;
		let right = 0;
		run.forEach(r => r.querySelectorAll(':scope > a.PageListPage, :scope > .PageListNumChildren, :scope > .PageListNote').forEach(x => {
			right = Math.max(right, x.getBoundingClientRect().right);
		}));
		menu.style.left = Math.round(right + 8) + 'px';
		menu.style.top = Math.round(top + (bottom - top - menu.offsetHeight) / 2) + 'px';
	};

	const show = (li: HTMLElement): void => {
		if (root.classList.contains('PageListSorting') || root.classList.contains('PageListSortSaving') || selected.length < 2) return;
		build();
		menu.hidden = false;
		place(li);
		shownFor = li;
	};

	const toggleExtras = (a: HTMLElement): void => {
		const open = menu.querySelectorAll('li.PageListActionExtra');
		a.querySelector('i.fa, i[class*=fa-]')?.classList.toggle('fa-flip-horizontal');
		if (open.length) { open.forEach(x => x.remove()); return; }
		const toggle = a.parentElement as HTMLElement;
		let trash: HTMLElement | null = null;
		extras.forEach((entry, cn) => {
			const li = item(cn, entry, true);
			if (cn === 'Trash') trash = li; else menu.insertBefore(li, toggle);
		});
		if (trash) menu.insertBefore(trash, toggle);
		if (shownFor) place(shownFor);
	};

	/** an action of one row by its cn, among its actions or their extras */
	const actionOf = (li: HTMLElement, cn: string): Action | null => {
		for (const action of c.actionsOf(li)) {
			if (action.cn === cn) return action;
			// the server keys extras by their own names (hide, trash, ...), not by cn
			const extra = action.extras ? Object.values(action.extras).find(x => x.cn === cn) : null;
			if (extra) return extra;
		}
		return null;
	};

	const reselect = (ids: number[]): void => {
		window.setTimeout(() => {
			const rows = ids.map(id => root.querySelector<HTMLElement>('.PageListID' + id)).filter(Boolean) as HTMLElement[];
			c.select.set(rows);
		}, 1200);
	};

	/** AJAX actions: each row as its own extras link would post it */
	const ajaxAll = async (cn: string, rows: HTMLElement[]): Promise<void> => {
		const ids = selected.map(c.pageId);
		for (const li of rows) {
			const action = actionOf(li, cn);
			const list = li.querySelector(':scope > ul.PageListActions');
			if (!action || !list || !li.isConnected) continue;
			const holder = document.createElement('li');
			holder.className = 'PageListActionExtra PageListAction' + cn;
			holder.hidden = true;
			const link = document.createElement('a');
			link.className = 'PageListActionExtra PageListAction' + cn;
			link.href = action.url;
			link.setAttribute('data-ajax', '1');
			holder.appendChild(link);
			list.appendChild(holder);
			await c.ajaxAction(link);
			holder.remove();
		}
		reselect(ids.filter(id => cn !== 'Trash' || !rows.some(r => c.pageId(r) === id)));
	};

	/** pages that open: one after another in the native dialog */
	const openAll = (cn: string, name: string, rows: HTMLElement[]): void => {
		const items = rows.map(li => ({ li, action: actionOf(li, cn) })).filter(x => x.action) as Array<{ li: HTMLElement; action: Action }>;
		const bridge = (window as unknown as { Bridge?: { dialog?: Dialog } }).Bridge;
		if (!items.length) return;
		if (!bridge || !bridge.dialog || c.isModal) { window.location.href = items[0].action.url; return; }
		const dialog = bridge.dialog;
		let n = 0;
		let switching = false;
		const title = (li: HTMLElement): string => text((li.querySelector(':scope > a.PageListPage') || li).innerHTML);
		const done = (): void => {
			// lists of the rows that were opened: titles and states may have changed
			const lists = new Set<Element>();
			items.slice(0, n + 1).forEach(x => {
				if (!x.li.isConnected || !x.li.parentElement || lists.has(x.li.parentElement)) return;
				lists.add(x.li.parentElement);
				c.refreshList(c.pageId(x.li));
			});
		};
		const openAt = (): void => {
			const it = items[n];
			const last = n === items.length - 1;
			switching = true;
			dialog.open(it.action.url, 'large', {
				title: `${text(name)}: ${title(it.li)} (${n + 1}/${items.length})`,
				buttons: cn === 'Edit' ? EDIT_BUTTONS : undefined,
				moreButtons: last ? undefined : (doc: Document) => [{
					html: esc(label('nextPage', 'Next page')) + " <i class='fa fa-angle-right' aria-hidden='true'></i>",
					secondary: true,
					click: () => {
						const changed = !!doc.querySelector('form.InputfieldFormConfirm .InputfieldStateChanged');
						if (changed && !window.confirm(label('discardChanges', 'This page has unsaved changes. Leave it?'))) return;
						n++;
						openAt();
					},
				}],
				onClose: () => { if (!switching) done(); },
			});
			switching = false;
		};
		openAt();
	};

	menu.addEventListener('click', e => {
		const a = (e.target as HTMLElement).closest<HTMLElement>('a[data-cn]');
		if (!a) return;
		e.preventDefault();
		const cn = a.getAttribute('data-cn') || '';
		if (cn === 'Extras') { toggleExtras(a); return; }
		const entry = (a.hasAttribute('data-extra') ? extras : primary).get(cn);
		if (!entry) return;
		const rows = entry.rows.filter(li => li.isConnected);
		hide();
		if (cn === 'Move') { c.moveGroup(selected.filter(li => li.isConnected)); return; }
		if (entry.action.ajax) {
			if (cn === 'Trash' && !window.confirm(label('trashPages', 'Move %d pages to the trash?').replace('%d', String(rows.length)))) return;
			void ajaxAll(cn, rows);
			return;
		}
		openAll(cn, entry.action.name, rows);
	});
	menu.addEventListener('mouseenter', () => window.clearTimeout(hideTimer));
	menu.addEventListener('mouseleave', later);

	root.addEventListener('mouseover', e => {
		if (selected.length < 2) return;
		const li = (e.target as HTMLElement).closest<HTMLElement>('.PageListItem');
		if (!li || !li.classList.contains('pw-selected') || !root.contains(li)) { later(); return; }
		window.clearTimeout(hideTimer);
		if (!menu.hidden && shownFor && runOf(shownFor).indexOf(li) > -1) return;
		window.clearTimeout(showTimer);
		showTimer = window.setTimeout(() => show(li), c.hoverDelay);
	});
	root.addEventListener('mouseleave', later);
	// the menu is placed for where the rows were: any scroll or resize takes it away
	window.addEventListener('scroll', () => { if (!menu.hidden) hide(); }, true);
	window.addEventListener('resize', () => { if (!menu.hidden) hide(); });
	document.addEventListener('pw-legacy-handover', () => { hide(); menu.remove(); });

	return {
		update: rows => {
			selected = rows;
			if (rows.length < 2) { hide(); return; }
			// the row under the pointer (a Ctrl+click just selected it): its menu, without waiting for a move
			const under = root.querySelector<HTMLElement>('.PageListItem.pw-selected:hover');
			hide();
			if (under) showTimer = window.setTimeout(() => { if (under.matches(':hover')) show(under); }, c.hoverDelay);
		},
	};
}

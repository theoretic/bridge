/**
 * The page tree without jQuery (milestone 3.4, ADR 0016): upstream ProcessPageList.js in
 * "actions" mode (core 3.0.274), on the same markup and JSON endpoint, so ProcessPageList.css, the
 * theme (30-pagelist.css) and setupTreeFit() style and fit it as before. The "select" mode is
 * fields/pagelistselect.ts.
 *
 *   div#PageListContainer(.PageListContainerRoot|Page)[data-token-name, data-token-value]
 *     div.PageListRoot(.PageListUseHoverActions)
 *       div.PageList > div.PageListItem.PageListID<id>(.PageListItemOpen)[data-numChild, data-numTotal]
 *                        > a.PageListPage + span.PageListNumChildren + span.PageListNote
 *                        + ul.PageListActions > li.PageListAction<Edit|View|New|Move|Extras> > a
 *                    + div.PageList (its children; ul.PageListPagination; More as li.PageListActionMore)
 *
 * Options from ProcessWire.config.ProcessPageList (ajaxURL, ajaxMoveURL, rootPageID, showRootPage,
 * openPageIDs and pre-rendered openPageData, qtyType, hover actions, labels, pagination classes).
 * - A title click opens or closes its children (the home page closes every open item first),
 *   remembered in the `pagelist_open` cookie; More and pagination load further children.
 * - Edit and View are .pw-modal-longclick links: a click follows them, a long press opens them in
 *   the native dialog (elements/pw-dialog.ts).
 * - Extras shows the item's extra actions; AJAX ones (unpublish, hide, lock, trash, ...) are posted
 *   with the CSRF token and the item is updated, added or removed as the answer says.
 * - Move: the item is dragged to its new place among the visible items, also into an open item
 *   without visible children (a placeholder list) or the trash; the new parent and order are posted
 *   to ajaxMoveURL; counts follow; `pageMoved` on the item.
 * - `pageListRefresh` on document (detail: page id) reloads the list holding that page.
 * - Events on the container: `pageListChildrenDone` (detail: the JSON data).
 */

import { setCookie } from '../util/cookie';
import { legacyLoaded } from '../legacy';

type Action = { cn: string; name: string; url: string; extras?: Record<string, Action>; ajax?: boolean };
type Child = {
	id: number; label: string; path: string; template?: string; numChildren: number; numTotal?: number;
	status?: number; note?: string; addClass?: string; type?: string; actions?: Action[];
};
type Data = { page: Child; children: Child[]; start: number; limit: number; error?: number; message?: string; list?: HTMLElement; item?: HTMLElement | null };
type Options = Record<string, unknown> & {
	ajaxURL: string; ajaxMoveURL: string; rootPageID: number; showRootPage: boolean; openPageIDs: Array<string | number>;
	openPageData: Record<string, Data>; trashPageID: number; langID: number; labelName: string; ajaxParams: Record<string, string>;
	qtyType: string; useHoverActions: boolean; hoverActionDelay: number; useNarrowActions: boolean;
	moreLabel: string; selectCancelLabel: string; moveInstructionLabel: string; ajaxNetworkError: string; ajaxUnknownError: string;
	paginationClass: string; paginationCurrentClass: string; paginationLinkClass: string; paginationLinkCurrentClass: string;
	paginationHoverClass: string; paginationDisabledClass: string;
};

const icons = {
	left: "<i class='fa fa-angle-left'></i>", right: "<i class='fa fa-angle-right'></i>", sort: "<i class='fa fa-fw fa-sort'></i>",
	spinner: "<i class='ui-priority-secondary fa fa-fw fa-spin fa-spinner'></i>", check: "<i class='fa fa-check-square ui-priority-secondary'></i>",
};

function pw(): { config: Record<string, unknown>; icon?: (name: string, extra?: string) => string; alert?: (m: string) => void } {
	return ((window as unknown as { ProcessWire?: ReturnType<typeof pw> }).ProcessWire) || { config: {} };
}
function alertMsg(m: string): void { const p = pw(); if (p.alert) p.alert(m); else window.alert(m); }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (html) e.innerHTML = html;
	return e;
}
const kids = (e: Element | null, sel: string): HTMLElement[] => e ? Array.from(e.children).filter(c => c.matches(sel)) as HTMLElement[] : [];
const next = (e: Element, sel: string): HTMLElement | null => { const n = e.nextElementSibling; return n && n.matches(sel) ? n as HTMLElement : null; };
const prev = (e: Element, sel: string): HTMLElement | null => { const n = e.previousElementSibling; return n && n.matches(sel) ? n as HTMLElement : null; };
const pageId = (item: Element): number => parseInt(item.getAttribute('data-page-id') || '0', 10);

function setupTree(container: HTMLElement): void {
	if (container.hasAttribute('data-pw-pagelist')) return;
	container.setAttribute('data-pw-pagelist', '');
	const admin = ((pw().config.urls as { admin?: string }) || {}).admin || '/processwire/';
	const o: Options = {
		ajaxURL: admin + 'page/list/', ajaxMoveURL: admin + 'page/sort/', rootPageID: 0, showRootPage: true, openPageIDs: [], openPageData: {},
		trashPageID: 7, langID: 0, labelName: '', ajaxParams: {}, qtyType: '', useHoverActions: false, hoverActionDelay: 250,
		useNarrowActions: document.body.classList.contains('pw-narrow-width'), moreLabel: 'More', selectCancelLabel: 'Cancel',
		moveInstructionLabel: 'Click and drag to move', ajaxNetworkError: 'Network error', ajaxUnknownError: 'Unknown error',
		paginationClass: 'PageListPagination', paginationCurrentClass: 'PageListPaginationCurrent', paginationLinkClass: 'ui-state-default',
		paginationLinkCurrentClass: 'ui-state-active', paginationHoverClass: 'ui-state-hover', paginationDisabledClass: 'ui-priority-secondary',
	};
	Object.assign(o, pw().config.ProcessPageList || {});
	if (!o.openPageData || Array.isArray(o.openPageData)) o.openPageData = {};
	if (!Array.isArray(o.openPageIDs)) o.openPageIDs = [];
	const p = pw();
	if (document.body.classList.contains('icons-fa6') && p.icon) {
		icons.right = p.icon('caret-right');
		icons.left = p.icon('caret-left');
		icons.sort = p.icon('sort', 'fw');
		icons.spinner = p.icon('spinner', 'spin ui-priority-secondary');
		icons.check = p.icon('check-square', 'ui-priority-secondary');
	}
	const isModal = document.body.classList.contains('modal') || document.body.classList.contains('pw-iframe');
	const root = el('div', 'PageListRoot');
	container.appendChild(root);
	const spinner = (): HTMLElement => el('span', 'PageListLoading', icons.spinner);
	let ignoreClicks = false;
	let firstPagination = 0;

	/* items *****************************************************************************************/

	const setNum = (item: HTMLElement, numChildren: number | false, numTotal?: number | false, addNew = false): void => {
		if (numTotal === undefined) numTotal = numChildren;
		let span = addNew ? null : kids(item, '.PageListNumChildren')[0] || null;
		if (!span) { span = el('span', 'PageListNumChildren detail'); addNew = true; }
		const n = numChildren === false ? numTotal : numChildren;
		item.classList.toggle('PageListHasChildren', !!n && n > 0);
		item.classList.toggle('PageListNoChildren', !n || n < 1);
		if (n !== false && n < 1 && numTotal !== false) numTotal = 0;
		if (numTotal === false) numTotal = parseInt(item.getAttribute('data-numTotal') || '0', 10) || 0;
		else item.setAttribute('data-numTotal', String(numTotal));
		if (numChildren === false) numChildren = parseInt(item.getAttribute('data-numChild') || '0', 10) || 0;
		else item.setAttribute('data-numChild', String(Math.max(0, numChildren)));
		const slash = "<span class='ui-priority-secondary'>/</span>";
		let label: string | number = numChildren;
		if (o.qtyType === 'total') label = numTotal;
		else if (o.qtyType === 'total/children') label = numTotal > 0 && numTotal !== numChildren ? numTotal + slash + numChildren : numTotal;
		else if (o.qtyType === 'children/total') label = numTotal > 0 && numTotal !== numChildren ? numChildren + slash + numTotal : numTotal;
		else if (o.qtyType === 'id') label = pageId(item);
		span.innerHTML = label ? String(label) : '';
		if (addNew) item.appendChild(span);
	};
	const numOf = (item: HTMLElement | null, total = false): number => item ? parseInt(item.getAttribute(total ? 'data-numTotal' : 'data-numChild') || '0', 10) || 0 : 0;
	const adjustTotal = (item: HTMLElement | null, n: number): void => {
		if (!item) return;
		setNum(item, false, Math.max(0, numOf(item, true) + n));
		const list = item.closest('.PageList');
		adjustTotal(list ? prev(list, '.PageListItem') : null, n);
	};

	const listChild = (child: Child): HTMLElement => {
		const li = el('div', 'PageListItem PageListTemplate_' + child.template);
		li.setAttribute('data-page-id', String(child.id));
		const a = el('a', 'PageListPage label', child.label);
		a.href = '#';
		a.title = child.path;
		li.classList.add(child.numChildren > 0 ? 'PageListHasChildren' : 'PageListNoChildren', 'PageListID' + child.id);
		const status = child.status || 0;
		if (status === 0) li.classList.add('PageListStatusOff', 'disabled');
		if (status & 2048) li.classList.add('PageListStatusUnpublished', 'secondary');
		if (status & 1024) li.classList.add('PageListStatusHidden', 'secondary');
		if (status & 512) li.classList.add('PageListStatusTemp', 'secondary');
		if (status & (16 | 8)) li.classList.add('PageListStatusSystem');
		if (status & 4) li.classList.add('PageListStatusLocked');
		if (child.addClass) child.addClass.split(/\s+/).filter(Boolean).forEach(c => li.classList.add(c));
		if (child.type === 'System') li.classList.add('PageListStatusSystem');
		if (o.openPageIDs.some(id => parseInt(String(id), 10) === child.id)) li.classList.add('PageListTriggerOpen');
		li.appendChild(a);
		setNum(li, child.numChildren, child.numTotal, true);
		if (child.note) li.appendChild(el('span', 'PageListNote detail', child.note));
		const actions = el('ul', 'PageListActions actions');
		const links = child.actions || [];
		const hasExtras = o.useNarrowActions && links.some(l => l.extras);
		let extras: Record<string, Action> = {};
		let extrasLink: HTMLAnchorElement | null = null;
		let last: HTMLElement | null = null;
		links.forEach(action => {
			const name = action.cn;
			if (hasExtras && name !== 'Edit' && name !== 'View' && name !== 'Extras') { extras[name] = action; return; }
			const link = el('a', '', action.name);
			link.href = action.url;
			if (!isModal && (name === 'Edit' || name === 'View')) {
				link.classList.add('pw-modal', 'pw-modal-large', 'pw-modal-longclick');
				if (name === 'Edit') link.setAttribute('data-buttons', '#ProcessPageEdit > .Inputfields > .InputfieldSubmit .ui-button');
			}
			if (action.extras) { extras = Object.assign(extras, action.extras); extrasLink = link; }
			const item = el('li', 'PageListAction' + name);
			item.appendChild(link);
			if (name === 'Extras') last = item; else actions.appendChild(item);
		});
		if (extrasLink) extrasData.set(extrasLink, extras);
		if (last) { (last as HTMLElement).classList.add('ui-priority-secondary'); actions.appendChild(last); }
		li.appendChild(actions);
		return li;
	};
	const extrasData = new WeakMap<HTMLAnchorElement, Record<string, Action>>();

	const listChildren = (children: Child[]): HTMLElement => {
		const list = el('div', 'PageList');
		children.forEach(c => list.appendChild(listChild(c)));
		return list;
	};

	/** open the items the server asked for (openPageIDs), except the home page */
	const triggerOpen = (scope: HTMLElement): void => {
		scope.querySelectorAll<HTMLElement>('.PageListTriggerOpen:not(.PageListID1)').forEach(li => {
			if (!li.classList.contains('PageListItemOpen')) toggleItem(li);
		});
	};

	/* loading ***************************************************************************************/

	const pagination = (id: number, start: number, limit: number, total: number): HTMLElement => {
		const max = 9;
		const pages = Math.ceil(total / limit);
		const cur = start >= limit ? Math.floor(start / limit) : 0;
		if (cur === 0) firstPagination = 0;
		else if (cur - max + 1 > firstPagination) firstPagination = cur - Math.floor(max / 2);
		else if (firstPagination > 0 && cur === firstPagination) firstPagination = cur - Math.ceil(max / 2);
		if (firstPagination > pages - max) firstPagination = pages - max;
		if (firstPagination < 0) firstPagination = 0;
		const ul = el('ul', o.paginationClass);
		ul.setAttribute('data-pagination', JSON.stringify({ id, start, limit, total }));
		const link = (n: number, html: string, current = false): HTMLElement => {
			const li = el('li', o.paginationClass.split(' ').pop() + String(ul.children.length));
			const a = el('a', current ? o.paginationLinkCurrentClass : o.paginationLinkClass, html);
			a.href = String(n);
			if (current) li.classList.add(o.paginationCurrentClass);
			li.appendChild(a);
			return li;
		};
		const sep = (): HTMLElement => el('li', o.paginationDisabledClass, '&hellip;');
		for (let n = firstPagination, cnt = 0; n < pages; n++, cnt++) {
			if (cnt >= max) { ul.appendChild(sep()); ul.appendChild(link(pages - 1, String(pages))); break; }
			ul.appendChild(link(n, String(n + 1), n === cur));
		}
		if (firstPagination > 0) { ul.insertBefore(sep(), ul.firstChild); ul.insertBefore(link(0, '1'), ul.firstChild); }
		if (cur + 1 < pages) ul.appendChild(link(cur + 1, icons.right));
		if (cur > 0) ul.insertBefore(link(cur - 1, icons.left), ul.firstChild);
		return ul;
	};

	const fetchData = async (id: number, start: number): Promise<Data> => {
		let url = o.ajaxURL + '?id=' + id + '&render=JSON&start=' + start + '&lang=' + o.langID + '&open=' + o.openPageIDs[0] + '&mode=actions';
		if (o.labelName) url += '&labelName=' + o.labelName;
		for (const key in o.ajaxParams) url += '&' + key + '=' + o.ajaxParams[key];
		try {
			const res = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
			return await res.json() as Data;
		} catch (err) {
			return { error: 1, message: o.ajaxUnknownError } as Data;
		}
	};

	async function loadChildren(id: number, target: HTMLElement, start: number, begin: boolean, paginate = true, replace = false): Promise<void> {
		const loading = spinner();
		if (!replace) target.appendChild(loading);
		const key = id + '-' + start;
		const cached = o.openPageData[key] && !target.classList.contains('PageListID' + o.trashPageID) && !target.classList.contains('PageListForceReload');
		const data = cached ? o.openPageData[key] : await fetchData(id, start);
		loading.remove();
		if (!data || data.error) {
			alertMsg((data && data.message) || o.ajaxUnknownError);
			ignoreClicks = false;
			return;
		}
		const list = listChildren(data.children);
		const nextStart = data.start + data.limit;
		if (target.classList.contains('PageListItem')) setNum(target, data.page.numChildren, data.page.numTotal);
		if (data.page.numChildren > nextStart) {
			const more = el('ul', 'PageListActions actions');
			const li = el('li', 'PageListActionMore');
			const a = el('a', '', o.moreLabel);
			a.href = String(nextStart);
			a.setAttribute('data-page-id', String(id));
			li.appendChild(a);
			more.appendChild(li);
			list.appendChild(more);
		}
		if (paginate && (data.page.numChildren > nextStart || data.start > 0)) list.insertBefore(pagination(id, data.start, data.limit, data.page.numChildren), list.firstChild);
		let added: HTMLElement = list;
		if (begin) {
			const top = listChildren([data.page]);
			const topItem = kids(top, '.PageListItem')[0];
			if (o.showRootPage) topItem.classList.add('PageListItemOpen');
			else { topItem.style.display = 'none'; top.classList.add('PageListRootHidden'); }
			top.appendChild(list);
			target.appendChild(top);
		} else if (target.classList.contains('PageList')) {
			if (replace) kids(target, '.PageListItem, .PageListActions').forEach(x => x.remove());
			kids(list, '.PageListItem, .PageListActions').forEach(x => target.appendChild(x));
			added = target;
		} else {
			target.insertAdjacentElement('afterend', list);
			target.setAttribute('data-start', String(data.start));
		}
		data.list = target;
		data.item = prev(target, '.PageListItem');
		ignoreClicks = false;
		triggerOpen(added);
		container.dispatchEvent(new CustomEvent('pageListChildrenDone', { bubbles: true, detail: data }));
	}

	const forceReload = (item: HTMLElement | null, reloadNow = false): void => {
		if (!item) return;
		if (item.classList.contains('PageList')) item = prev(item, '.PageListItem');
		if (!item) return;
		item.classList.add('PageListForceReload');
		const prefix = pageId(item) + '-';
		Object.keys(o.openPageData).forEach(k => { if (k.indexOf(prefix) === 0) delete o.openPageData[k]; });
		if (!reloadNow) return;
		if (item.classList.contains('PageListItemOpen')) { toggleItem(item); window.setTimeout(() => toggleItem(item as HTMLElement), 250); }
		else toggleItem(item);
	};

	const updateOpen = (): void => {
		const ids: string[] = [];
		root.querySelectorAll<HTMLElement>('.PageListItemOpen').forEach(li => {
			const key = pageId(li) + '-' + (parseInt(li.getAttribute('data-start') || '0', 10) || 0);
			if (ids.indexOf(key) < 0) ids.push(key);
		});
		// the server reads it as a CSV list ($input->cookie->array()): plain "id-start" values
		setCookie('pagelist_open', ids.join(','));
	};

	function toggleItem(li: HTMLElement): void {
		if (root.classList.contains('PageListSorting') || root.classList.contains('PageListSortSaving')) return;
		if (li.classList.contains('PageListItemOpen')) {
			let collapse = true;
			if (li.classList.contains('PageListID1') && !li.classList.contains('PageListForceReload')) {
				const open = Array.from(root.querySelectorAll<HTMLElement>('.PageListItemOpen:not(.PageListID1)'));
				if (open.length) { open.forEach(x => toggleItem(x)); collapse = false; }
			}
			if (collapse) {
				li.classList.remove('PageListItemOpen');
				const list = next(li, '.PageList');
				if (list) list.remove();
			}
			updateOpen();
		} else {
			li.classList.add('PageListItemOpen');
			if (numOf(li) > 0 || li.classList.contains('PageListForceReload')) {
				ignoreClicks = true;
				const own = o.openPageIDs.map(String).find(k => k.indexOf('-') > 0 && parseInt(k, 10) === pageId(li));
				// remembered as soon as the children are in (upstream waits 250 ms)
				void loadChildren(pageId(li), li, own ? parseInt(own.split('-')[1], 10) || 0 : 0, false).then(updateOpen);
			} else {
				updateOpen();
			}
		}
	}

	const refreshList = (id: number): void => {
		const item = root.querySelector('.PageListID' + id);
		let list = item ? item.parentElement as HTMLElement : null;
		const parentItem = list ? prev(list, '.PageListItem') : null;
		if (!list || !parentItem) return;
		const parentID = pageId(parentItem);
		let start = 0;
		const pag = kids(list, 'ul.' + o.paginationClass.split(' ').pop())[0];
		if (pag) {
			const info = JSON.parse(pag.getAttribute('data-pagination') || '{}');
			const active = pag.querySelector('.' + o.paginationLinkCurrentClass);
			if (active) start = (parseInt(active.getAttribute('href') || '0', 10) || 0) * info.limit;
		}
		let remove: HTMLElement[] = [];
		if (parentID === 1) { remove = Array.from(list.children) as HTMLElement[]; list = parentItem; }
		forceReload(list);
		void loadChildren(parentID, list, start, false, true, true).then(() => remove.forEach(x => x.remove()));
	};

	/* extras ****************************************************************************************/

	const clickExtras = (a: HTMLAnchorElement): void => {
		const extras = extrasData.get(a);
		if (!extras) return;
		const li = a.closest<HTMLElement>('.PageListItem') as HTMLElement;
		const actions = a.closest<HTMLElement>('.PageListActions') as HTMLElement;
		a.querySelector('i.fa, i[class*=fa-]')?.classList.toggle('fa-flip-horizontal');
		const open = actions.querySelectorAll('li.PageListActionExtra');
		if (open.length) { open.forEach(x => x.remove()); return; }
		let trash: HTMLElement | null = null;
		Object.keys(extras).forEach(key => {
			const extra = extras[key];
			const link = el('a', 'PageListActionExtra PageListAction' + extra.cn, extra.name);
			link.href = extra.url;
			if (extra.ajax) link.setAttribute('data-ajax', '1');
			const item = el('li', 'PageListActionExtra PageListAction' + extra.cn);
			item.appendChild(link);
			link.style.display = 'inline-block';
			if (extra.cn === 'Trash') { li.classList.add('trashable'); trash = item; } else actions.appendChild(item);
		});
		if (trash) actions.appendChild(trash);
	};

	const ajaxAction = async (link: HTMLAnchorElement): Promise<void> => {
		const li = link.closest<HTMLElement>('.PageListItem') as HTMLElement;
		const href = link.getAttribute('href') || '';
		const action = (href.match(/[?&]action=([-_a-zA-Z0-9]+)/) || [])[1];
		const id = parseInt((href.match(/[?&]id=([0-9]+)/) || [])[1] || '0', 10);
		kids(li, '.PageListActions').forEach(x => { x.style.display = 'none'; });
		const spin = spinner();
		li.appendChild(spin);
		const body = new URLSearchParams();
		body.set('action', action || '');
		body.set('id', String(id));
		body.set(container.getAttribute('data-token-name') || '', container.getAttribute('data-token-value') || '');
		let data: { success?: boolean; message?: string; remove?: boolean; refreshChildren?: number; child?: Child; newChild?: Child } = {};
		try {
			const res = await fetch(href + '&render=json', { method: 'POST', body, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
			data = await res.json();
		} catch (err) {
			data = { success: false, message: o.ajaxUnknownError };
		}
		spin.remove();
		if (!data.success) { kids(li, '.PageListActions').forEach(x => { x.style.display = ''; }); alertMsg(data.message || ''); return; }
		const parentItem = li.closest('.PageList') ? prev(li.closest('.PageList') as HTMLElement, '.PageListItem') : null;
		let fresh: HTMLElement | null = null;
		let addNew = false;
		if (data.child) fresh = listChild(data.child);
		else if (data.newChild) { fresh = listChild(data.newChild); addNew = true; }
		let msg: HTMLElement | null = null;
		if (fresh) { msg = el('span', 'notes', '&nbsp;' + icons.check + '&nbsp;' + (data.message || '')); fresh.appendChild(msg); }
		if (addNew && fresh) { li.insertAdjacentElement('afterend', fresh); forceReload(fresh.closest('.PageList') as HTMLElement); }
		else if (fresh) { if (li.classList.contains('PageListItemOpen')) fresh.classList.add('PageListItemOpen'); li.replaceWith(fresh); }
		window.setTimeout(() => {
			let n = numOf(parentItem);
			if (data.remove) { n--; adjustTotal(parentItem, -1); } else if (addNew) { n++; adjustTotal(parentItem, 1); }
			if (parentItem) { setNum(parentItem, n, false); forceReload(parentItem); }
			const item = fresh || li;
			if (data.remove) { const list = next(item, '.PageList'); if (list) list.remove(); item.remove(); }
			else if (msg) msg.remove();
		}, 1000);
		if (data.refreshChildren) forceReload(root.querySelector<HTMLElement>('.PageListID' + data.refreshChildren), true);
	};

	/* move ******************************************************************************************/

	let moving: HTMLElement | null = null;
	let from: HTMLElement | null = null;

	const clickMove = (a: HTMLAnchorElement): void => {
		if (ignoreClicks) return;
		const visible = Array.from(root.querySelectorAll<HTMLElement>('.PageListItem')).filter(x => x.offsetParent !== null);
		if (visible.length === 1) { a.style.textDecoration = 'line-through'; a.classList.add('ui-state-disabled'); return; }
		const li = a.closest<HTMLElement>('.PageListItem') as HTMLElement;
		if (li.classList.contains('PageListItemOpen')) toggleItem(li);
		// an open item without visible children gets an empty list to drop into
		root.querySelectorAll<HTMLElement>('.PageListItemOpen').forEach(open => {
			const list = next(open, '.PageList');
			if (numOf(open) > 1 && !(list && list.offsetParent !== null)) return;
			if (list && list.offsetParent !== null) return;
			const ph = el('div', 'PageListPlaceholder PageList');
			ph.appendChild(el('div', 'PageListItem PageListPlaceholderItem', '&nbsp;'));
			open.insertAdjacentElement('afterend', ph);
		});
		const note = el('span', 'PageListMoveNote detail', icons.sort + '&nbsp;' + o.moveInstructionLabel + '&nbsp;' + icons.left + '&nbsp;');
		const cancel = el('a', '', o.selectCancelLabel);
		cancel.href = '#';
		cancel.addEventListener('click', e => { e.preventDefault(); cancelMove(); });
		note.appendChild(cancel);
		const actions = kids(li, 'ul.PageListActions')[0];
		li.insertBefore(note, actions || null);
		li.classList.add('PageListSortItem');
		from = li.parentElement as HTMLElement;
		root.classList.add('PageListSorting');
		kids(kids(root, '.PageList')[0], '.PageList').forEach(x => x.classList.add('PageListSortingList'));
		moving = li;
	};

	const cancelMove = (): void => {
		root.querySelectorAll('.PageListSortingList').forEach(x => x.classList.remove('PageListSortingList'));
		if (moving) { moving.classList.remove('PageListSortItem'); moving.querySelectorAll('.PageListMoveNote').forEach(x => x.remove()); }
		root.querySelectorAll('.PageListPlaceholder').forEach(x => {
			if (x.querySelector('.PageListItem:not(.PageListPlaceholderItem)')) { x.classList.remove('PageListPlaceholder'); x.querySelectorAll('.PageListPlaceholderItem').forEach(p => p.remove()); }
			else x.remove();
		});
		root.classList.remove('PageListSorting');
		moving = null;
	};

	const stopMove = async (li: HTMLElement): Promise<void> => {
		let list = li.parentElement as HTMLElement;
		const origin = from;
		if (list.classList.contains('PageListPlaceholder')) {
			list.classList.remove('PageListPlaceholder');
			list.querySelectorAll('.PageListPlaceholderItem').forEach(x => x.remove());
		}
		let before = list.previousElementSibling as HTMLElement | null;
		if (before && !before.classList.contains('PageListItem')) before = before.previousElementSibling as HTMLElement | null;
		const parentID = before ? pageId(before) : 0;
		root.classList.add('PageListSortSaving');
		cancelMove();
		const spin = spinner();
		li.appendChild(spin);
		const sort = kids(list, '.PageListItem').map(x => pageId(x)).join(',') + ',';
		const body = new URLSearchParams();
		body.set('id', String(pageId(li)));
		body.set('parent_id', String(parentID));
		body.set('sort', sort);
		body.set(container.getAttribute('data-token-name') || '', container.getAttribute('data-token-value') || '');
		let data: { error?: boolean; message?: string } = {};
		try {
			const res = await fetch(o.ajaxMoveURL, { method: 'POST', body, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
			data = await res.json();
		} catch (err) {
			data = { error: true, message: o.ajaxUnknownError };
		}
		spin.remove();
		li.classList.remove('PageListSortItem');
		if (data && data.error) alertMsg(data.message || '');
		if (origin && origin !== list) {
			const fromItem = prev(origin, '.PageListItem');
			let n = numOf(fromItem);
			if (n > 0) { n--; adjustTotal(fromItem, -1); } else origin.remove();
			if (fromItem) { setNum(fromItem, n, false); forceReload(fromItem); }
			const toItem = prev(list, '.PageListItem');
			if (toItem) { adjustTotal(toItem, 1); setNum(toItem, numOf(toItem) + 1, false); forceReload(toItem); }
		}
		root.classList.remove('PageListSortSaving');
		li.dispatchEvent(new CustomEvent('pageMoved', { bubbles: true }));
	};

	// dragging the item that is moving: placed before or after the item under the pointer
	let dragId = -1;
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
		try { root.releasePointerCapture(e.pointerId); } catch (err) { /* released */ }
		const li = moving;
		li.classList.remove('PageListSortPlaceholder');
		void stopMove(li);
	};
	root.addEventListener('pointerup', drop);
	root.addEventListener('pointercancel', drop);

	/* events ****************************************************************************************/

	container.addEventListener('click', e => {
		if (legacyLoaded()) return;
		const t = e.target as HTMLElement;
		const page = t.closest<HTMLAnchorElement>('a.PageListPage');
		if (page && root.contains(page)) {
			e.preventDefault();
			const li = page.parentElement as HTMLElement;
			if (ignoreClicks && !li.classList.contains('PageListTriggerOpen')) return;
			toggleItem(li);
			return;
		}
		const more = t.closest<HTMLAnchorElement>('.PageListActionMore > a');
		if (more) {
			e.preventDefault();
			const list = more.closest('.PageList') as HTMLElement;
			(more.closest('ul') as HTMLElement).remove();
			void loadChildren(parseInt(more.getAttribute('data-page-id') || '0', 10), list, parseInt(more.getAttribute('href') || '0', 10) || 0, false);
			return;
		}
		const pag = t.closest<HTMLAnchorElement>('ul[data-pagination] a');
		if (pag) {
			e.preventDefault();
			const ul = pag.closest('ul') as HTMLElement;
			const info = JSON.parse(ul.getAttribute('data-pagination') || '{}');
			const start = (parseInt(pag.getAttribute('href') || '0', 10) || 0) * info.limit;
			const list = ul.parentElement as HTMLElement;
			kids(list, '.PageList').forEach(x => x.remove());
			ul.replaceWith(pagination(info.id, start, info.limit, info.total));
			void loadChildren(info.id, list, start, false, false, true).then(() => {
				const item = prev(list, '.PageListItem');
				if (item) item.setAttribute('data-start', String(start));
				updateOpen();
			});
			return;
		}
		const move = t.closest<HTMLAnchorElement>('.PageListActionMove > a');
		if (move) { e.preventDefault(); clickMove(move); return; }
		const extras = t.closest<HTMLAnchorElement>('.PageListActionExtras > a');
		if (extras) { e.preventDefault(); clickExtras(extras); return; }
		const ajax = t.closest<HTMLAnchorElement>('a.PageListActionExtra[data-ajax]');
		if (ajax) { e.preventDefault(); void ajaxAction(ajax); }
	});
	container.addEventListener('mouseover', e => {
		const a = (e.target as HTMLElement).closest('ul[data-pagination] a');
		if (a) a.classList.add(o.paginationHoverClass);
	});
	container.addEventListener('mouseout', e => {
		const a = (e.target as HTMLElement).closest('ul[data-pagination] a');
		if (a) a.classList.remove(o.paginationHoverClass);
	});
	document.addEventListener('pageListRefresh', e => refreshList(parseInt(String((e as CustomEvent).detail), 10)));

	if (o.useHoverActions) {
		root.classList.add('PageListUseHoverActions');
		let timer = 0;
		const show = (item: HTMLElement): void => {
			const actions = kids(item, '.PageListActions')[0];
			if (!actions) return;
			item.classList.add('PageListItemHover');
			actions.style.display = 'inline';
		};
		const hide = (item: HTMLElement): void => {
			const actions = kids(item, '.PageListActions')[0];
			if (item.classList.contains('PageListItemOpen') && actions && actions.classList.contains('PageListActionsKeepOpen')) return;
			item.classList.remove('PageListItemHover');
			if (actions) actions.style.display = '';
		};
		container.addEventListener('mouseover', e => {
			if (root.classList.contains('PageListSorting') || root.classList.contains('PageListSortSaving')) return;
			const item = (e.target as HTMLElement).closest<HTMLElement>('.PageListItem');
			if (!item || item.classList.contains('PageListItemHover')) return;
			const a = kids(item, 'a')[0];
			if (a && !a.matches(':hover')) return;
			window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				if (a && !a.matches(':hover')) return;
				root.querySelectorAll<HTMLElement>('.PageListItemHover').forEach(x => { if (x !== item) hide(x); });
				show(item);
			}, o.hoverActionDelay);
		});
		container.addEventListener('mouseout', e => {
			const item = (e.target as HTMLElement).closest<HTMLElement>('.PageListItem');
			if (!item || item.classList.contains('PageListItemOpen') || !item.classList.contains('PageListItemHover')) return;
			window.setTimeout(() => { if (!item.matches(':hover')) hide(item); }, o.hoverActionDelay * 0.7);
		});
		container.addEventListener('keydown', e => {
			const item = (e.target as HTMLElement).closest<HTMLElement>('.PageListItem');
			if (!item || e.key !== ' ') return;
			const actions = kids(item, '.PageListActions')[0];
			if (actions) actions.style.display = actions.offsetParent === null ? 'inline-block' : 'none';
			e.preventDefault();
		});
	}

	void loadChildren(o.rootPageID > 0 ? o.rootPageID : 1, root, 0, true);
}

let handover = false;

export function init(container: HTMLElement): void {
	if (legacyLoaded()) return;
	if (!handover) {
		handover = true;
		// the stack arrived: upstream's ProcessPageListInit() builds the tree again in the container
		document.addEventListener('pw-legacy-handover', () => {
			document.querySelectorAll<HTMLElement>('[data-pw-pagelist]').forEach(c => {
				c.querySelectorAll(':scope > .PageListRoot').forEach(r => r.remove());
				c.removeAttribute('data-pw-pagelist');
			});
		});
	}
	setupTree(container);
}

/**
 * InputfieldPageListSelect and InputfieldPageListSelectMultiple without jQuery (milestone 2.4,
 * ADR 0015). Upstream runs ProcessPageList.js (jQuery) in "select" mode; this is that mode on
 * the same markup and JSON endpoint (page/list/?render=JSON&mode=select), so ProcessPageList.css
 * and the theme style it as before:
 *
 *   div.PageListRoot (before the value input)
 *     div.PageListSelectHeader > p.PageListSelectName + ul.PageListActions > li > a.PageListSelectActionToggle
 *     div.PageList > div.PageListItem(.PageListItemOpen) > a.PageListPage + span.PageListNumChildren
 *                                                        + ul.PageListActions > li.PageListActionSelect > a
 *                  + div.PageList (its children; More link as ul.PageListActions > li.PageListActionMore)
 *
 * A click on a title opens or closes the item (its Select action shows on open items, as
 * upstream's CSS does). Select sets the value input and dispatches `change` plus `pageSelected`
 * (detail: { id, url, title }); the single variant closes the tree and updates the header, the
 * multiple variant appends to ol#<id>_items (sortable, removable; duplicates dropped) and marks
 * chosen pages "Selected".
 */

import { makeSortable } from '../util/sortable';
import { fetchOk, failed } from '../util/fail';

type Child = {
	id: number; label: string; path: string; template?: string; numChildren: number; numTotal?: number;
	status?: number; note?: string; addClass?: string; type?: string;
};
type ListData = { page: Child; children: Child[]; start: number; limit: number; error?: number; message?: string };

function adminUrl(): string {
	const pw = (window as unknown as { ProcessWire?: { config?: { urls?: { admin?: string }; LanguageSupport?: { language?: { id?: number } } } } }).ProcessWire;
	return (pw && pw.config && pw.config.urls && pw.config.urls.admin) || '/processwire/';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (html) e.innerHTML = html;
	return e;
}

function setup(input: HTMLInputElement, multiple: boolean): void {
	const initClass = multiple ? 'InputfieldPageListSelectMultipleInit' : 'InputfieldPageListSelectInit';
	if (input.classList.contains(initClass)) return;
	input.classList.add(initClass);
	const attr = (name: string, fallback = ''): string => input.getAttribute(name) ?? fallback;
	const rootID = parseInt(attr('data-root', '0'), 10) || 0;
	const labels = {
		start: attr('data-start', 'Change'), cancel: attr('data-cancel', 'Cancel'), select: attr('data-select', 'Select'),
		selected: attr('data-selected', 'Selected'), unselect: attr('data-unselect', 'Unselect'), more: attr('data-more', 'More'),
	};
	const labelName = attr('data-labelName');
	// the link dialog's language (upstream's langID option): labels and paths in that language
	const langID = parseInt(attr('data-lang', '0'), 10) || 0;
	const showPath = parseInt(attr('data-showPath', '0'), 10) > 0;
	const allowUnselect = !multiple && parseInt(attr('data-allowUnselect', '0'), 10) > 0;
	const ol = multiple ? document.getElementById(input.id + '_items') : null;

	const root = el('div', 'PageListRoot');
	input.parentNode!.insertBefore(root, input);
	input.style.display = 'none';

	const url = (id: number, start: number, limit?: number): string => {
		let u = adminUrl() + 'page/list/?id=' + id + '&render=JSON&start=' + start + '&mode=select';
		if (typeof limit === 'number') u += '&limit=' + limit;
		if (labelName) u += '&labelName=' + encodeURIComponent(labelName);
		if (langID) u += '&lang=' + langID;
		return u;
	};
	const getJSON = async (u: string): Promise<ListData> => {
		const res = await fetchOk(u);
		return res.json() as Promise<ListData>;
	};
	const selectedIds = (): string[] => input.value.split(',').filter(Boolean);

	// header with the current page and the Change / Cancel toggle
	const header = el('div', 'PageListSelectHeader');
	const name = el('p', 'PageListSelectName');
	const actions = el('ul', 'PageListActions PageListSelectActions actions');
	const toggle = el('a', 'PageListSelectActionToggle PageListSelectActionToggleStart');
	toggle.href = '#';
	toggle.textContent = labels.start;
	const li = el('li');
	li.appendChild(toggle);
	actions.appendChild(li);
	if (!multiple) header.appendChild(name);
	header.appendChild(actions);
	root.appendChild(header);

	const current = parseInt(input.value || '0', 10);
	if (!multiple && current > 0) {
		void getJSON(url(current, 0, 0)).then(data => {
			if (!data.page) return;
			let path = '';
			if (showPath) {
				path = data.page.path.replace(/\/$/, '');
				path = '<span class="detail">' + path.substring(0, path.lastIndexOf('/') + 1) + '</span> ';
			}
			name.innerHTML = path + data.page.label;
		});
	}

	const closeTree = (): void => {
		root.querySelectorAll(':scope > .PageList').forEach(l => l.remove());
		toggle.textContent = labels.start;
		toggle.classList.add('PageListSelectActionToggleStart');
		toggle.classList.remove('PageListSelectActionToggleCancel');
	};

	function markSelected(scope: ParentNode): void {
		if (!multiple) return;
		selectedIds().forEach(id => {
			scope.querySelectorAll('.PageListID' + id + ' > ul.PageListActions .PageListActionSelect > a').forEach(a => {
				a.classList.add('ui-state-disabled', 'pw-iplsm-disabled-' + id);
				a.textContent = labels.selected;
			});
		});
	}

	function item(child: Child, isRoot: boolean): HTMLElement {
		const div = el('div', 'PageListItem' + (child.template ? ' PageListTemplate_' + child.template : ''));
		div.setAttribute('data-page-id', String(child.id));
		div.classList.add(child.numChildren > 0 ? 'PageListHasChildren' : 'PageListNoChildren', 'PageListID' + child.id);
		const status = child.status || 0;
		if (status === 0) div.classList.add('PageListStatusOff', 'disabled');
		if (status & 2048) div.classList.add('PageListStatusUnpublished', 'secondary');
		if (status & 1024) div.classList.add('PageListStatusHidden', 'secondary');
		if (status & 512) div.classList.add('PageListStatusTemp', 'secondary');
		if (status & (16 | 8)) div.classList.add('PageListStatusSystem');
		if (status & 4) div.classList.add('PageListStatusLocked');
		if (child.addClass) child.addClass.split(/\s+/).filter(Boolean).forEach(c => div.classList.add(c));
		const a = el('a', 'PageListPage label', child.label);
		a.href = '#';
		a.title = child.path;
		div.appendChild(a);
		const n = child.numTotal ?? child.numChildren;
		if (n > 0) div.appendChild(el('span', 'PageListNumChildren detail', String(n)));
		if (child.note) div.appendChild(el('span', 'PageListNote detail', child.note));
		const acts = el('ul', 'PageListActions actions');
		let label = rootID === child.id ? '' : labels.select;
		if (allowUnselect && String(child.id) === input.value) label = labels.unselect;
		if (label) {
			const action = el('li', 'PageListActionSelect');
			const sel = el('a');
			sel.href = '#';
			sel.innerHTML = label;
			action.appendChild(sel);
			acts.appendChild(action);
		}
		div.appendChild(acts);
		if (isRoot) div.classList.add('PageListItemOpen');
		return div;
	}

	async function load(id: number, start: number, target: HTMLElement, begin: boolean): Promise<void> {
		let data: ListData;
		try {
			data = await getJSON(url(id, start));
		} catch (err) {
			failed('page list select', err);
			if (begin) closeTree();
			return;
		}
		if (data.error) {
			window.alert(data.message || 'Error');
			return;
		}
		const list = el('div', 'PageList');
		data.children.forEach(c => list.appendChild(item(c, false)));
		const next = data.start + data.limit;
		if (data.page.numChildren > next) {
			const more = el('a', '', labels.more);
			more.href = String(next);
			more.setAttribute('data-page-id', String(id));
			const moreUl = el('ul', 'PageListActions actions');
			const moreLi = el('li', 'PageListActionMore');
			moreLi.appendChild(more);
			moreUl.appendChild(moreLi);
			list.appendChild(moreUl);
		}
		if (begin) {
			const rootList = el('div', 'PageList');
			rootList.appendChild(item(data.page, true));
			rootList.appendChild(list);
			root.appendChild(rootList);
		} else if (target.classList.contains('PageList')) {
			Array.from(list.children).forEach(c => target.appendChild(c)); // "More": append to the same list
		} else {
			target.insertAdjacentElement('afterend', list);
		}
		markSelected(root);
		input.dispatchEvent(new CustomEvent('pageListChildrenDone', { detail: data }));
	}

	function choose(itemEl: HTMLElement, actionLink: HTMLElement): void {
		let id = parseInt(itemEl.getAttribute('data-page-id') || '0', 10);
		const a = itemEl.querySelector<HTMLAnchorElement>(':scope > a.PageListPage');
		let title = a ? a.textContent || '' : '';
		const path = a ? a.title : '';
		if (actionLink.textContent === labels.unselect) {
			id = 0;
			title = '';
		}
		if (multiple) {
			if (actionLink.classList.contains('ui-state-disabled')) return;
			actionLink.classList.add('ui-state-disabled', 'pw-iplsm-disabled-' + id);
			actionLink.textContent = labels.selected;
			if (ol) {
				const template = ol.querySelector<HTMLElement>(':scope > .itemTemplate');
				if (template) {
					const row = template.cloneNode(true) as HTMLElement;
					row.classList.remove('itemTemplate');
					const v = row.querySelector(':scope > .itemValue');
					const l = row.querySelector(':scope > .itemLabel');
					if (v) v.textContent = String(id);
					if (l) l.textContent = title;
					ol.appendChild(row);
					rebuildMultiple();
				}
			}
		} else {
			if (String(id) !== input.value) {
				input.value = id ? String(id) : '';
				input.dispatchEvent(new Event('change', { bubbles: true }));
			}
			name.textContent = title;
		}
		input.dispatchEvent(new CustomEvent('pageSelected', { detail: { id, url: path, title } }));
		if (!multiple) closeTree();
	}

	function rebuildMultiple(): void {
		if (!ol) return;
		const seen = new Set<string>();
		const values: string[] = [];
		Array.from(ol.children).forEach(row => {
			if (row.classList.contains('itemTemplate')) return;
			const v = row.querySelector(':scope > .itemValue')?.textContent || '';
			if (seen.has(v)) {
				row.remove();
				return;
			}
			seen.add(v);
			values.push(v);
		});
		input.value = values.join(',');
		input.dispatchEvent(new Event('change', { bubbles: true }));
	}

	toggle.addEventListener('click', e => {
		e.preventDefault();
		if (toggle.classList.contains('PageListSelectActionToggleStart')) {
			void load(rootID > 0 ? rootID : 1, 0, root, true);
			toggle.textContent = labels.cancel;
			toggle.classList.remove('PageListSelectActionToggleStart');
			toggle.classList.add('PageListSelectActionToggleCancel');
		} else {
			closeTree();
		}
	});

	root.addEventListener('click', e => {
		const target = e.target as HTMLElement;
		const more = target.closest<HTMLAnchorElement>('.PageListActionMore > a');
		if (more) {
			e.preventDefault();
			const list = more.closest('.PageList') as HTMLElement;
			const id = parseInt(more.getAttribute('data-page-id') || '0', 10);
			const start = parseInt(more.getAttribute('href') || '0', 10);
			(more.closest('ul') as HTMLElement).remove();
			void load(id, start, list, false);
			return;
		}
		const action = target.closest<HTMLElement>('.PageListActionSelect > a');
		if (action) {
			e.preventDefault();
			choose(action.closest('.PageListItem') as HTMLElement, action);
			return;
		}
		const page = target.closest<HTMLElement>('a.PageListPage');
		if (!page) return;
		e.preventDefault();
		const itemEl = page.closest('.PageListItem') as HTMLElement;
		if (itemEl.classList.contains('PageListItemOpen')) {
			itemEl.classList.remove('PageListItemOpen');
			const next = itemEl.nextElementSibling;
			if (next && next.classList.contains('PageList')) next.remove();
			return;
		}
		itemEl.classList.add('PageListItemOpen');
		if (itemEl.classList.contains('PageListHasChildren') && !(itemEl.nextElementSibling && itemEl.nextElementSibling.classList.contains('PageList'))) {
			void load(parseInt(itemEl.getAttribute('data-page-id') || '0', 10), 0, itemEl, false);
		}
	});

	if (ol) {
		makeSortable(ol, {
			items: 'li:not(.itemTemplate)',
			update(row) {
				rebuildMultiple();
				ol.dispatchEvent(new CustomEvent('sorted', { bubbles: true, detail: { item: row } }));
			},
		});
		ol.classList.add('InputfieldPageListSelectMultipleSortable');
		ol.addEventListener('click', e => {
			const remove = (e.target as HTMLElement).closest('a.itemRemove');
			if (!remove || !ol.contains(remove)) return;
			e.preventDefault();
			const row = remove.closest('li') as HTMLElement;
			const id = row.querySelector(':scope > .itemValue')?.textContent || '';
			row.remove();
			root.querySelectorAll('.pw-iplsm-disabled-' + CSS.escape(id)).forEach(a => {
				a.classList.remove('ui-state-disabled', 'pw-iplsm-disabled-' + id);
				a.textContent = labels.select;
			});
			rebuildMultiple();
		});
	}
}

export function init(input: HTMLElement): void {
	if (!(input instanceof HTMLInputElement)) return;
	setup(input, input.classList.contains('InputfieldPageListSelectMultipleData'));
}

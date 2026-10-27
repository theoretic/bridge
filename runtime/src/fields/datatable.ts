/**
 * MarkupAdminDataTable without jQuery (milestone 3.5, ADR 0016): upstream MarkupAdminDataTable.js
 * (core 3.0.274) and the part of JqueryTableSorter it uses, on table.AdminDataTable:
 *
 * - table.AdminDataTableSortable: a header click, or Enter/Space on a focused header, sorts each
 *   body by that column (numbers as numbers, ISO dates as dates, text by locale with numeric
 *   parts; empty cells last), again reverses; th.sorter-false never sorts. The key of a cell is its
 *   data-text, else a hidden sort key (.pw-table-sort-value, .sort-date), else an ISO date in its
 *   span.detail (the log viewer), else its text. Columns are counted with colspan. Classes as
 *   tablesorter's: tablesorter on the table, tablesorter-header(Row) on the header,
 *   tablesorter-headerAsc / -headerDesc / -headerUnSorted on the cells (the theme draws the
 *   arrows); aria-sort, aria-disabled and tabindex for keyboard and assistive technology. Since
 *   0.9.9 the theme also makes core's unsortable tables sortable (AdminThemeBridge
 *   ::sortableDataTable()). A table with a pager next to it sorts the rows of its page only, and
 *   says so (pw-table-paged, header title).
 * - table.AdminDataTableResponsive at 767 px or less: each cell gets its column label (div.th) and
 *   its content wrapped (div.td), as upstream; undone above.
 * - Shift-click on a checkbox sets every checkbox between it and the last one clicked, and sends
 *   `change` from each one it changed.
 * - window.AdminDataTable (pages without jQuery): init(), initTable(table), resize(), sort(table,
 *   column, dir), for code that calls upstream's object (the Lister after each refresh).
 * Column resizing (AdminDataTableResizable, a tablesorter widget) is not provided.
 */

import { legacyLoaded } from '../legacy';
import { installGlobal } from '../util/stubs';
import { label } from '../util/labels';
import { changed } from '../util/events';

const done = new WeakSet<HTMLTableElement>();
const mobile = (): boolean => window.innerWidth <= 767;
const ISO = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/;
let collator: Intl.Collator | null = null;

/** the cell that covers a column (colspan counted), or null */
function cellAt(row: HTMLTableRowElement, col: number): HTMLTableCellElement | null {
	let n = 0;
	for (const cell of Array.from(row.cells)) {
		n += cell.colSpan || 1;
		if (n > col) return n - (cell.colSpan || 1) === col && (cell.colSpan || 1) === 1 ? cell : null;
	}
	return null;
}

function keyOf(cell: HTMLTableCellElement | null): string {
	if (!cell) return '';
	const text = cell.getAttribute('data-text');
	if (text !== null) return text.trim();
	const hidden = cell.querySelector('.pw-table-sort-value, .sort-date');
	if (hidden) return (hidden.textContent || '').trim();
	const detail = cell.querySelector('.detail');
	const date = detail ? (detail.textContent || '').trim() : '';
	if (ISO.test(date)) return date;
	const td = cell.querySelector(':scope > .td');
	return ((td || cell).textContent || '').trim();
}

const asNumber = (v: string): number => Number(v.replace(/[\s,]/g, ''));

/** Sort the bodies of a table by a column (0-based, colspan counted); dir 'asc' or 'desc' */
export function sort(table: HTMLTableElement, col: number, dir: 'asc' | 'desc' = 'asc'): void {
	const bodies = Array.from(table.tBodies);
	const keys = bodies.map(body => Array.from(body.rows).map((row, i) => ({ row, i, key: keyOf(cellAt(row, col)) })));
	const filled = keys.flat().map(k => k.key).filter(k => k !== '');
	const kind = filled.length && filled.every(k => !isNaN(asNumber(k))) ? 'number'
		: filled.length && filled.every(k => ISO.test(k) && !isNaN(Date.parse(k.replace(' ', 'T')))) ? 'date' : 'text';
	if (!collator) collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	const by = (a: string, b: string): number => kind === 'number' ? asNumber(a) - asNumber(b)
		: kind === 'date' ? Date.parse(a.replace(' ', 'T')) - Date.parse(b.replace(' ', 'T'))
		: (collator as Intl.Collator).compare(a, b);
	const sign = dir === 'desc' ? -1 : 1;
	keys.forEach((list, b) => {
		list.sort((x, y) => {
			if (x.key === '' || y.key === '') return x.key === y.key ? x.i - y.i : x.key === '' ? 1 : -1;
			return sign * by(x.key, y.key) || x.i - y.i;
		});
		const body = bodies[b];
		list.forEach(k => body.appendChild(k.row));
	});
	const head = table.tHead ? table.tHead.rows[0] : null;
	if (!head) return;
	let n = 0;
	Array.from(head.cells).forEach(th => {
		const at = n;
		n += th.colSpan || 1;
		if (th.classList.contains('sorter-false') || !th.classList.contains('tablesorter-header')) return;
		const on = at === col;
		th.classList.toggle('tablesorter-headerAsc', on && dir === 'asc');
		th.classList.toggle('tablesorter-headerDesc', on && dir === 'desc');
		th.classList.toggle('tablesorter-headerUnSorted', !on);
		th.setAttribute('aria-sort', on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
	});
}

function setupSort(table: HTMLTableElement): void {
	const head = table.tHead ? table.tHead.rows[0] : null;
	if (!head || !table.tBodies.length) return;
	table.classList.add('tablesorter');
	head.classList.add('tablesorter-headerRow');
	const parent = table.parentElement;
	const paged = !!(parent && parent.querySelector('.MarkupPagerNav'));
	if (paged) table.classList.add('pw-table-paged');
	let n = 0;
	Array.from(head.cells).forEach(th => {
		const col = n;
		n += th.colSpan || 1;
		if (th.classList.contains('sorter-false')) {
			th.setAttribute('aria-disabled', 'true');
			return;
		}
		th.classList.add('tablesorter-header', 'tablesorter-headerUnSorted');
		th.setAttribute('aria-sort', 'none');
		th.tabIndex = 0;
		if (paged && !th.title) th.title = label('sortsPage', 'Sorts the rows on this page');
		const go = (): void => sort(table, col, th.classList.contains('tablesorter-headerAsc') ? 'desc' : 'asc');
		th.addEventListener('click', e => {
			if (legacyLoaded() || (e.target as HTMLElement).closest('a, input, button, select, label')) return;
			go();
		});
		th.addEventListener('keydown', e => {
			if (legacyLoaded() || e.target !== th || (e.key !== 'Enter' && e.key !== ' ')) return;
			e.preventDefault();
			go();
		});
	});
}

function labels(table: HTMLTableElement): string[] {
	const head = table.tHead ? table.tHead.rows[0] : null;
	if (!head) return [];
	return Array.from(head.cells).map(th => {
		const copy = th.cloneNode(true) as HTMLElement;
		copy.querySelectorAll('b, span').forEach(x => x.remove()); // Lister's sort name and arrow
		return copy.innerHTML.trim();
	});
}

function setupMobile(table: HTMLTableElement): void {
	if (table.classList.contains('AdminDataTableMobile') || !table.classList.contains('AdminDataTableResponsive')) return;
	table.classList.add('AdminDataTableMobile');
	const names = labels(table);
	Array.from(table.tBodies).forEach(tbody => Array.from(tbody.rows).forEach(row => Array.from(row.cells).forEach((cell, n) => {
		if (names[n] === undefined) return;
		if (!cell.querySelector(':scope > .td')) {
			const wrap = document.createElement('div');
			wrap.className = 'td';
			while (cell.firstChild) wrap.appendChild(cell.firstChild);
			cell.appendChild(wrap);
		}
		const th = document.createElement('div');
		th.className = 'th';
		th.innerHTML = names[n];
		cell.insertBefore(th, cell.firstChild);
		cell.classList.add('ui-helper-clearfix');
	})));
}

function undoMobile(table: HTMLTableElement): void {
	if (!table.classList.contains('AdminDataTableMobile')) return;
	table.classList.remove('AdminDataTableMobile');
	table.querySelectorAll('tbody td').forEach(cell => {
		cell.querySelectorAll(':scope > .th').forEach(x => x.remove());
		const td = cell.querySelector(':scope > .td');
		if (td) { while (td.firstChild) cell.insertBefore(td.firstChild, td); td.remove(); }
		cell.classList.remove('ui-helper-clearfix');
	});
}

function setupShiftClick(table: HTMLTableElement): void {
	let last: HTMLInputElement | null = null;
	table.addEventListener('click', e => {
		const box = e.target as HTMLInputElement;
		if (legacyLoaded() || !box.matches || !box.matches('input[type=checkbox]')) return;
		const boxes = Array.from(table.querySelectorAll<HTMLInputElement>('input[type=checkbox]'));
		if (last && (e as MouseEvent).shiftKey) {
			const a = boxes.indexOf(box);
			const b = boxes.indexOf(last);
			const on = last.checked;
			boxes.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => {
				if (x === box || x.checked === on) return;
				x.checked = on;
				changed(x);
			});
			if (box.checked !== on) { box.checked = on; changed(box); }
		}
		last = box;
	});
}

export function initTable(table: HTMLTableElement): void {
	if (legacyLoaded() || done.has(table)) return;
	done.add(table);
	if (table.classList.contains('AdminDataTableSortable')) setupSort(table);
	if (mobile()) setupMobile(table);
	if (table.querySelectorAll('input[type=checkbox]').length > 1) setupShiftClick(table);
}

export function resize(): void {
	document.querySelectorAll<HTMLTableElement>('table.AdminDataTableResponsive').forEach(t => { if (mobile()) setupMobile(t); else undoMobile(t); });
}

let ready = false;

export function init(table?: HTMLElement): void {
	if (legacyLoaded()) return;
	if (!ready) {
		ready = true;
		let timer = 0;
		window.addEventListener('resize', () => { window.clearTimeout(timer); timer = window.setTimeout(resize, 500); });
		// over the theme's stand-in too, replaying the tables' inline initTable() calls
		installGlobal('AdminDataTable', {
			native: true,
			init: () => document.querySelectorAll<HTMLTableElement>('table.AdminDataTable').forEach(initTable),
			initTable: (t: HTMLTableElement | { 0?: HTMLTableElement }) => { const el = (t as { 0?: HTMLTableElement })[0] || t; if (el instanceof HTMLTableElement) initTable(el); },
			resize,
			sort,
		});
	}
	if (table instanceof HTMLTableElement) initTable(table);
}

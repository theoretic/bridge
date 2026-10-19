/**
 * MarkupAdminDataTable without jQuery (milestone 3.5, ADR 0016): upstream MarkupAdminDataTable.js
 * (core 3.0.274) and the part of JqueryTableSorter it uses, on table.AdminDataTable:
 *
 * - table.AdminDataTableSortable: a header click sorts the body rows by that column (numbers as
 *   numbers, text by locale, with numeric parts), again reverses; th.sorter-false never sorts.
 *   Classes as tablesorter's: tablesorter on the table, tablesorter-header(Row) on the header,
 *   tablesorter-headerAsc / -headerDesc / -headerUnSorted on the cells (the theme styles them);
 *   aria-sort for assistive technology.
 * - table.AdminDataTableResponsive at 767 px or less: each cell gets its column label (div.th) and
 *   its content wrapped (div.td), as upstream; undone above.
 * - Shift-click on a checkbox sets every checkbox between it and the last one clicked.
 * - window.AdminDataTable (pages without jQuery): init(), initTable(table), resize(), for code
 *   that calls upstream's object (the Lister after each refresh).
 * Column resizing (AdminDataTableResizable, a tablesorter widget) is not provided.
 */

import { legacyLoaded } from '../legacy';

const done = new WeakSet<HTMLTableElement>();
const mobile = (): boolean => window.innerWidth <= 767;

function cellValue(row: HTMLTableRowElement, col: number): string {
	const cell = row.cells[col];
	if (!cell) return '';
	const td = cell.querySelector(':scope > .td');
	return ((td || cell).textContent || '').trim();
}

function setupSort(table: HTMLTableElement): void {
	const head = table.tHead ? table.tHead.rows[0] : null;
	const body = table.tBodies[0];
	if (!head || !body) return;
	table.classList.add('tablesorter');
	head.classList.add('tablesorter-headerRow');
	const ths = Array.from(head.cells);
	ths.forEach((th, col) => {
		if (th.classList.contains('sorter-false')) return;
		th.classList.add('tablesorter-header', 'tablesorter-headerUnSorted');
		th.setAttribute('aria-sort', 'none');
		th.addEventListener('click', e => {
			if (legacyLoaded() || (e.target as HTMLElement).closest('a, input, button, select')) return;
			const asc = !th.classList.contains('tablesorter-headerAsc');
			ths.forEach(other => {
				if (other.classList.contains('sorter-false')) return;
				other.classList.remove('tablesorter-headerAsc', 'tablesorter-headerDesc');
				other.classList.add('tablesorter-headerUnSorted');
				other.setAttribute('aria-sort', 'none');
			});
			th.classList.remove('tablesorter-headerUnSorted');
			th.classList.add(asc ? 'tablesorter-headerAsc' : 'tablesorter-headerDesc');
			th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
			const rows = Array.from(body.rows);
			const numeric = rows.every(r => { const v = cellValue(r, col).replace(/[\s,]/g, ''); return v === '' || !isNaN(Number(v)); });
			rows.sort((a, b) => {
				const x = cellValue(a, col);
				const y = cellValue(b, col);
				const r = numeric ? (Number(x.replace(/[\s,]/g, '')) || 0) - (Number(y.replace(/[\s,]/g, '')) || 0)
					: x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
				return asc ? r : -r;
			});
			rows.forEach(r => body.appendChild(r));
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
			boxes.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => { x.checked = (last as HTMLInputElement).checked; });
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
		const w = window as unknown as { AdminDataTable?: unknown; jQuery?: unknown };
		if (typeof w.jQuery === 'undefined' && typeof w.AdminDataTable === 'undefined') {
			w.AdminDataTable = {
				native: true,
				init: () => document.querySelectorAll<HTMLTableElement>('table.AdminDataTable').forEach(initTable),
				initTable: (t: HTMLTableElement | { 0?: HTMLTableElement }) => { const el = (t as { 0?: HTMLTableElement })[0] || t; if (el instanceof HTMLTableElement) initTable(el); },
				resize,
			};
		}
	}
	if (table instanceof HTMLTableElement) initTable(table);
}

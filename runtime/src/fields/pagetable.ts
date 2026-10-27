/**
 * InputfieldPageTable without jQuery (milestone 3.3, ADR 0016). Ports upstream
 * InputfieldPageTable.js (core 3.0.274) on the same markup: .InputfieldPageTableContainer[data-url,
 * data-noclose] > table (tbody tr[data-id], a.InputfieldPageTableEdit[data-url],
 * a.InputfieldPageTableDelete) + .InputfieldPageTableButtons > .InputfieldPageTableAdd[data-url],
 * then input.InputfieldPageTableSort (ids joined by |) and input.InputfieldPageTableDelete.
 *
 * - Add and Edit open the page editor (or page add) in the native dialog (elements/pw-dialog.ts),
 *   large: the window's submit buttons go to the dialog's footer; template, parent, Delete and
 *   Children are hidden there; a save that loads without errors or warnings closes it (not while
 *   adding, nor with data-noclose); when it closes after a page was opened, the table reloads by
 *   AJAX (data-url + InputfieldPageTableAdd=<id>, InputfieldPageTableSort=<order>), keeping rows
 *   marked for deletion; without a page id in data-url the whole page reloads.
 * - Rows sort by dragging (the sort input follows, `sorted` on the Inputfield); a double click on a
 *   cell edits the row; the trash link marks the row for deletion; "Select all" for orphans.
 */

import { makeSortable } from '../util/sortable';
import { legacyLoaded } from '../legacy';
import { changed, setValue } from '../util/events';

const sortables = new Map<HTMLElement, () => void>();

function dialog(): { open(url: string, size: string, options: Record<string, unknown>): void } | null {
	const bridge = (window as unknown as { Bridge?: { dialog?: { open(url: string, size: string, options: Record<string, unknown>): void } } }).Bridge;
	return bridge && bridge.dialog ? bridge.dialog : null;
}

function updateSort(tbody: HTMLElement): void {
	const container = tbody.closest('.InputfieldPageTableContainer');
	const input = container && container.parentElement ? container.parentElement.querySelector<HTMLInputElement>(':scope > .InputfieldPageTableSort') : null;
	setValue(input, Array.from(tbody.querySelectorAll('tr')).map(tr => tr.getAttribute('data-id')).join('|'));
}

function makeRowsSortable(container: HTMLElement): void {
	if (container.closest('.InputfieldRenderValueMode')) return;
	const old = sortables.get(container);
	if (old) old();
	const tbody = container.querySelector<HTMLElement>('table tbody');
	if (!tbody) return;
	sortables.set(container, makeSortable(tbody, {
		items: 'tr',
		threshold: 4,
		enabled: () => !legacyLoaded(),
		stop: () => updateSort(tbody),
		update: item => container.closest('.Inputfield')?.dispatchEvent(new CustomEvent('sorted', { bubbles: true, detail: { item } })),
	}));
}

async function reload(container: HTMLElement, pageID: number): Promise<void> {
	let url = (container.getAttribute('data-url') || '') + '&InputfieldPageTableAdd=' + pageID;
	const sort = container.parentElement?.querySelector<HTMLInputElement>(':scope > .InputfieldPageTableSort');
	if (sort && sort.value.length) url += '&InputfieldPageTableSort=' + sort.value.replace(/\|/g, ',');
	const m = /[?&]id=([^&#]*)/i.exec(url);
	if (!m || parseInt(m[1], 10) === 0) { window.location.reload(); return; }
	const res = await fetch(new URL(url, location.href).href, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
	container.innerHTML = await res.text();
	container.querySelectorAll('.Inputfield').forEach(li => li.dispatchEvent(new CustomEvent('reloaded', { bubbles: true, detail: { source: 'InputfieldPageTable' } })));
	makeRowsSortable(container);
	const del = container.parentElement?.querySelector<HTMLInputElement>(':scope > input.InputfieldPageTableDelete');
	(del ? del.value.split('|') : []).filter(Boolean).forEach(id => {
		container.querySelector(`tr[data-id="${CSS.escape(id)}"]`)?.classList.add('InputfieldPageTableDelete', 'ui-state-error-text', 'ui-state-disabled');
	});
	container.animate([{ backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--pw-primary-bg').trim() || '#ffffaa' }, { backgroundColor: 'transparent' }], { duration: 500 });
}

function openEditor(trigger: HTMLElement): void {
	const container = trigger.closest<HTMLElement>('.InputfieldPageTableContainer');
	const d = dialog();
	const url = trigger.getAttribute('data-url');
	if (!container || !d || !url) return;
	const noclose = parseInt(container.getAttribute('data-noclose') || '0', 10) > 0;
	let pageID = 0;
	d.open(url, 'large', {
		source: trigger,
		title: trigger.getAttribute('data-title') || undefined,
		buttons: '#content form button.ui-button[type=submit], #pw-content-body form button.ui-button[type=submit]',
		errors: '.NoticeError, .NoticeWarning, .ui-state-error',
		// upstream closes after a save in the editor, not after the add form (its next page is the editor)
		autoclose: (_button: HTMLElement, doc: Document) => !noclose && !doc.getElementById('ProcessPageAdd'),
		onLoad: (doc: Document) => {
			const id = doc.getElementById('Inputfield_id') as HTMLInputElement | null;
			pageID = id ? parseInt(id.value, 10) || 0 : 0;
			doc.querySelectorAll<HTMLElement>('#wrap_Inputfield_template, #wrap_template, #wrap_parent_id, #_ProcessPageEditDelete, #_ProcessPageEditChildren').forEach(el => {
				const li = el.tagName === 'A' ? el.closest('li') as HTMLElement | null : el;
				(li || el).style.display = 'none';
			});
		},
		onClose: () => { if (pageID > 0) void reload(container, pageID); },
	});
}

function toggleDelete(link: HTMLElement): void {
	const row = link.closest('tr');
	const tbody = row ? row.parentElement : null;
	if (!row || !tbody) return;
	row.classList.toggle('InputfieldPageTableDelete');
	row.classList.toggle('ui-state-error-text');
	row.classList.toggle('ui-state-disabled');
	const ids = Array.from(tbody.children).filter(tr => tr.classList.contains('InputfieldPageTableDelete')).map(tr => tr.getAttribute('data-id'));
	const container = link.closest('.InputfieldPageTableContainer');
	const input = container && container.parentElement ? container.parentElement.querySelector<HTMLInputElement>(':scope > input.InputfieldPageTableDelete') : null;
	setValue(input, ids.join('|'));
}

let documentReady = false;

function setupDocument(): void {
	if (documentReady) return;
	documentReady = true;
	document.addEventListener('click', e => {
		if (legacyLoaded()) return;
		const t = e.target as HTMLElement;
		const trigger = t.closest<HTMLElement>('.InputfieldPageTableAdd, .InputfieldPageTableEdit');
		if (trigger && trigger.closest('.InputfieldPageTableContainer')) {
			e.preventDefault();
			e.stopPropagation();
			openEditor(trigger);
			return;
		}
		const del = t.closest<HTMLElement>('a.InputfieldPageTableDelete');
		if (del) {
			e.preventDefault();
			toggleDelete(del);
			return;
		}
		const all = t.closest('.InputfieldPageTableOrphansAll');
		if (all) {
			e.preventDefault();
			const boxes = all.closest('.InputfieldPageTableOrphans')?.querySelectorAll<HTMLInputElement>('input') || [];
			const on = !(boxes[0] && boxes[0].checked);
			boxes.forEach(b => { if (b.checked !== on) { b.checked = on; changed(b); } });
		}
	}, true);
	document.addEventListener('dblclick', e => {
		if (legacyLoaded()) return;
		const td = (e.target as HTMLElement).closest('.InputfieldPageTable .AdminDataTable td');
		const edit = td ? td.closest('tr')?.querySelector<HTMLElement>('.InputfieldPageTableEdit') : null;
		if (edit) openEditor(edit);
	});
	document.addEventListener('pw-legacy-handover', () => {
		sortables.forEach(unsort => unsort());
		sortables.clear();
	});
}

export function init(inputfield: HTMLElement): void {
	if (legacyLoaded()) return;
	setupDocument();
	sortables.forEach((unsort, c) => { if (!c.isConnected) { unsort(); sortables.delete(c); } });
	inputfield.querySelectorAll<HTMLElement>('.InputfieldPageTableContainer').forEach(makeRowsSortable);
}

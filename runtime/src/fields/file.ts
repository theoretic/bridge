/**
 * InputfieldFile without jQuery (milestone 3.2, ADR 0016). Ports upstream InputfieldFile.js
 * (core 3.0.274) on the same markup:
 *
 * - list `ul.InputfieldFileList > li.InputfieldFileItem` (made from .InputfieldFileListPlaceholder
 *   when the field is empty), the wrapper's InputfieldFileEmpty / Single / Multiple;
 * - sort by dragging an item (each item's input.InputfieldFileSort renumbered, the Inputfield
 *   changed, `sorted` dispatched on it);
 * - delete: label.InputfieldFileDelete's checkbox marks the item (.InputfieldFileInfo
 *   ui-state-error) and hides its data; a double click toggles every item;
 * - tags: input.InputfieldFileTagsInput (free) and .InputfieldFileTagsSelect (from
 *   ProcessWire.config[data-configName].tags) become the native tag control (fields/texttags.ts);
 * - upload (fields/upload.ts) from the file input or a drop on the field: a progress row per file,
 *   the server's markup in place (replace, overwrite or append), errors as rows; the drop hint is
 *   hidden in fields 767 px wide or less; `AjaxUploadDone` on the list.
 *
 * Handover: when the legacy stack arrives later, upstream takes the field over: this widget
 * removes its listeners and sortable ('pw-legacy-handover', scripts/main.js) and upstream's own
 * initialisation runs on the restored markup. The tag controls stay (upstream skips them).
 */

import { makeSortable } from '../util/sortable';
import { setupTags, Opts as TagOpts } from './texttags';
import { uploadAllowed, uploadTarget, rejectReason, send, toElement, initItem, filesOf, UploadResult } from './upload';
import { legacyLoaded } from '../legacy';

type FieldState = { abort: AbortController; unsort: (() => void) | null };
const fields = new Map<HTMLElement, FieldState>();

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Empty / Single / Multiple by the number of items */
export function updateCount(inputfield: HTMLElement): void {
	const n = inputfield.querySelectorAll('.InputfieldFileItem, .gridImage:not(.gridImagePlaceholder)').length;
	inputfield.classList.toggle('InputfieldFileEmpty', n === 0);
	inputfield.classList.toggle('InputfieldFileSingle', n === 1);
	inputfield.classList.toggle('InputfieldFileMultiple', n > 1);
}

/** Tag inputs of file/image items (upstream initTags) */
export function initFileTags(root: ParentNode, inputfield: HTMLElement): void {
	root.querySelectorAll<HTMLInputElement>('input.InputfieldFileTagsInput:not(.selectized)').forEach(input => {
		setupTags(input, { delimiter: ' ', createOnBlur: true, closeAfterSelect: true });
	});
	const selects = root.querySelectorAll<HTMLInputElement>('input.InputfieldFileTagsSelect:not(.selectized)');
	if (!selects.length) return;
	const pw = (window as unknown as { ProcessWire?: { config?: Record<string, unknown> } }).ProcessWire;
	const cfg = (pw && pw.config) || {};
	let name = inputfield.getAttribute('data-configName') || '';
	let settings = cfg[name] as { tags?: string[]; allowUserTags?: boolean } | undefined;
	if (!settings && name.indexOf('_repeater') > -1) settings = cfg[name.replace(/_repeater\d+(_?)/, '$1')] as typeof settings;
	const tags: Record<string, string> = {};
	((settings && settings.tags) || []).forEach(t => { tags[t] = t; });
	const opts: TagOpts = { delimiter: ' ', tags, allowUserTags: !!(settings && settings.allowUserTags), createOnBlur: true, closeAfterSelect: true };
	selects.forEach(input => setupTags(input, opts));
}

function setDeleted(input: HTMLInputElement): void {
	const info = input.closest('.InputfieldFileInfo');
	if (!info) return;
	const collapsed = !!input.closest('.InputfieldFile.InputfieldItemListCollapse');
	info.classList.toggle('ui-state-error', input.checked);
	if (collapsed) return;
	const data = info.parentElement ? info.parentElement.querySelector<HTMLElement>(':scope > .InputfieldFileData') : null;
	if (data) data.style.display = input.checked ? 'none' : '';
}

let documentReady = false;

function setupDocument(): void {
	if (documentReady) return;
	documentReady = true;
	document.addEventListener('change', e => {
		if (legacyLoaded()) return;
		const input = e.target as HTMLInputElement;
		if (input.matches && input.matches('.InputfieldFileDelete input')) setDeleted(input);
	});
	document.addEventListener('dblclick', e => {
		if (legacyLoaded()) return;
		const label = (e.target as HTMLElement).closest('.InputfieldFileDelete');
		const list = label ? label.closest('.InputfieldFileList') : null;
		if (!label || !list) return;
		e.preventDefault();
		const own = label.querySelector<HTMLInputElement>('input');
		const on = !(own && own.checked);
		list.querySelectorAll<HTMLInputElement>('.InputfieldFileDelete input').forEach(i => {
			i.checked = on;
			i.dispatchEvent(new Event('change', { bubbles: true }));
		});
	});
	document.addEventListener('pw-legacy-handover', () => {
		fields.forEach((state, inputfield) => {
			state.abort.abort();
			if (state.unsort) state.unsort();
			inputfield.querySelectorAll('.InputfieldFileInit').forEach(el => el.classList.remove('InputfieldFileInit'));
			inputfield.removeAttribute('data-pw-file');
		});
		fields.clear();
	});
}

function sortable(inputfield: HTMLElement, list: HTMLElement): () => void {
	return makeSortable(list, {
		items: 'li.InputfieldFileItem',
		threshold: 4,
		enabled: () => !legacyLoaded() && list.querySelectorAll(':scope > li.InputfieldFileItem').length > 1,
		start: item => { const info = item.querySelector('.InputfieldFileInfo'); if (info) info.classList.add('ui-state-highlight'); },
		stop: item => {
			Array.from(list.children).forEach((li, n) => {
				const sort = li.querySelector<HTMLInputElement>('.InputfieldFileSort');
				if (sort) sort.value = String(n);
			});
			const info = item.querySelector('.InputfieldFileInfo');
			if (info) info.classList.remove('ui-state-highlight');
			inputfield.classList.add('InputfieldFileJustSorted', 'InputfieldStateChanged');
			window.setTimeout(() => inputfield.classList.remove('InputfieldFileJustSorted'), 500);
		},
		update: item => inputfield.dispatchEvent(new CustomEvent('sorted', { bubbles: true, detail: { item } })),
	});
}

function progressRow(file: File): { li: HTMLElement; bar: HTMLElement } {
	const li = document.createElement('li');
	li.className = 'InputfieldFile ui-widget AjaxUpload';
	li.innerHTML = '<p class="InputfieldFileInfo ui-widget ui-widget-header InputfieldItemHeader">' +
		"<i class='fa fa-fw fa-spin fa-spinner'></i> " +
		'<span class="InputfieldFileName">' + esc(file.name) + '</span>' +
		'<span class="InputfieldFileStats"> &bull; ' + Math.floor(file.size / 1024) + ' kb</span></p>' +
		'<div class="ui-progressbar ui-widget ui-widget-content ui-corner-all" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
		'<div class="ui-progressbar-value ui-widget-header InputfieldItemHeader ui-corner-left" style="width: 0%;"></div></div>';
	return { li, bar: li.querySelector('.ui-progressbar-value') as HTMLElement };
}

function errorRow(name: string, message: string): HTMLElement {
	const li = document.createElement('li');
	li.className = 'InputfieldFile ui-widget AjaxUpload';
	li.innerHTML = '<p class="InputfieldFileInfo ui-widget ui-widget-header InputfieldItemHeader ui-state-error">&nbsp; ' + esc(name) +
		' <span class="InputfieldFileStats"> &bull; ' + esc(message) + '</span></p>';
	return li;
}

function setupUpload(inputfield: HTMLElement, content: HTMLElement, list: HTMLElement, signal: AbortSignal): void {
	const upload = content.querySelector<HTMLElement>('.InputfieldFileUpload');
	const input = content.querySelector<HTMLInputElement>('input[type=file]');
	if (!upload || !input || content.classList.contains('InputfieldFileInit')) return;
	content.classList.add('InputfieldFileInit');
	const target = uploadTarget(upload);
	Array.from(list.children).forEach(li => li.classList.add('InputfieldFileItemExisting'));
	const dropHere = content.querySelector<HTMLElement>('.AjaxUploadDropHere');
	if (dropHere) {
		const fit = (): void => { dropHere.style.display = content.clientWidth <= 767 ? 'none' : ''; };
		fit();
		if (window.ResizeObserver) {
			const ro = new ResizeObserver(fit);
			ro.observe(content);
			signal.addEventListener('abort', () => ro.disconnect());
		}
	}
	let doneTimer = 0;

	const uploadFile = (file: File): void => {
		const { li: row, bar } = progressRow(file);
		list.appendChild(row);
		inputfield.classList.add('InputfieldStateChanged');
		updateCount(inputfield);
		send(file, target, {
			onProgress: pct => {
				bar.style.width = pct + '%';
				if (pct > 4) bar.innerHTML = '<span>' + pct + '%</span>';
			},
		}).then(results => {
			results.forEach(r => placeResult(r, row));
			row.remove();
			updateCount(inputfield);
			window.clearTimeout(doneTimer);
			doneTimer = window.setTimeout(() => {
				initFileTags(list, inputfield);
				list.dispatchEvent(new CustomEvent('AjaxUploadDone', { bubbles: true }));
			}, 500);
		}).catch(err => {
			row.replaceWith(errorRow(file.name, String(err && err.message || err)));
		});
	};

	const placeResult = (r: UploadResult, row: HTMLElement): void => {
		if (r.error) {
			row.insertAdjacentElement('afterend', errorRow(file(row), r.message || ''));
			return;
		}
		if (r.replace) {
			const first = list.querySelector(':scope > li.InputfieldFileItem');
			if (first) first.remove();
		}
		const item = toElement(r.markup || '');
		if (!item) return;
		if (r.overwrite) {
			const name = (item.querySelector('.InputfieldFileName') || {} as Element).textContent;
			const existing = Array.from(list.querySelectorAll<HTMLElement>(':scope > .InputfieldFileItemExisting'))
				.find(li => (li.querySelector('.InputfieldFileName') || {} as Element).textContent === name);
			if (existing) {
				const info = existing.querySelector('.InputfieldFileInfo');
				const newInfo = item.querySelector('.InputfieldFileInfo');
				if (info && newInfo) info.innerHTML = newInfo.innerHTML + "<i class='fa fa-check'></i>";
				const link = existing.querySelector('.InputfieldFileLink');
				const newLink = item.querySelector('.InputfieldFileLink');
				if (link && newLink) link.innerHTML = newLink.innerHTML;
				return;
			}
			item.classList.add('InputfieldFileItemExisting');
		}
		list.insertBefore(item, row);
		window.setTimeout(() => initItem(item, 'InputfieldFileUpload'), 500);
	};

	const file = (row: HTMLElement): string => ((row.querySelector('.InputfieldFileName') || {} as Element).textContent || '');

	const traverse = (files: File[]): void => {
		for (const f of files) {
			const reason = rejectReason(f, target);
			if (reason) list.appendChild(errorRow(f.name, reason));
			else uploadFile(f);
			if (target.maxFiles === 1) break;
		}
	};

	input.addEventListener('change', e => {
		if (legacyLoaded()) return;
		e.preventDefault();
		e.stopPropagation();
		traverse(filesOf(input.files));
		input.value = '';
	}, { signal });

	const hover = (on: boolean): void => {
		content.classList.toggle('ui-state-hover', on);
		inputfield.classList.toggle('pw-drag-in-file', on);
	};
	content.addEventListener('dragenter', e => { e.preventDefault(); hover(true); }, { signal });
	content.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); hover(true); }, { signal });
	content.addEventListener('dragleave', () => hover(false), { signal });
	content.addEventListener('drop', e => {
		e.preventDefault();
		e.stopPropagation();
		hover(false);
		if (e.dataTransfer) traverse(filesOf(e.dataTransfer.files));
	}, { signal });
}

export function init(inputfield: HTMLElement): void {
	if (legacyLoaded()) return;
	setupDocument();
	initFileTags(inputfield, inputfield);
	const content = inputfield.querySelector<HTMLElement>(':scope > .InputfieldContent');
	if (!content || inputfield.hasAttribute('data-pw-file')) return;
	inputfield.setAttribute('data-pw-file', '');
	let list = content.querySelector<HTMLElement>('.InputfieldFileList');
	if (!list) {
		list = document.createElement('ul');
		list.className = 'InputfieldFileList InputfieldFileListBlank';
		const placeholder = content.querySelector('.InputfieldFileListPlaceholder');
		if (placeholder) placeholder.replaceWith(list);
		else content.insertBefore(list, content.firstChild);
	}
	// fields an in-place save replaced
	fields.forEach((st, f) => { if (!f.isConnected) { st.abort.abort(); if (st.unsort) st.unsort(); fields.delete(f); } });
	const state: FieldState = { abort: new AbortController(), unsort: null };
	fields.set(inputfield, state);
	updateCount(inputfield);
	if (inputfield.closest('.InputfieldRenderValueMode')) return;
	state.unsort = sortable(inputfield, list);
	list.querySelectorAll<HTMLElement>('.ui-widget-header, .ui-state-default').forEach(el => {
		el.addEventListener('mouseenter', () => el.classList.add('ui-state-hover'), { signal: state.abort.signal });
		el.addEventListener('mouseleave', () => el.classList.remove('ui-state-hover'), { signal: state.abort.signal });
	});
	if (uploadAllowed()) setupUpload(inputfield, content, list, state.abort.signal);
}

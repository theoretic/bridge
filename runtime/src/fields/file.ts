/**
 * InputfieldFile without jQuery (milestone 3.2, ADR 0016). Ports upstream InputfieldFile.js
 * (core 3.0.274) on the same markup:
 *
 * - list `ul.InputfieldFileList > li.InputfieldFileItem` (made from .InputfieldFileListPlaceholder
 *   when the field is empty), the wrapper's InputfieldFileEmpty / Single / Multiple;
 * - sort by dragging an item (each item's input.InputfieldFileSort renumbered, the Inputfield
 *   changed, `sorted` dispatched on it);
 * - select several rows (util/selection.ts: Ctrl/Cmd+click, Shift+click, a rubber band from the
 *   field's background) and drag them together; a delete box of a selected row sets every selected
 *   row's box (0.14.0, ADR 0018);
 * - drag rows out onto another file or image field of the page: fields/files-move.ts, loaded at the
 *   first drag (dragOut(), shared with image.ts);
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

import { makeSortable, DragEnd } from '../util/sortable';
import { makeSelectable, Selectable } from '../util/selection';
import type { Mover } from './files-move';
import { setupTags, Opts as TagOpts } from './texttags';
import { uploadAllowed, uploadTarget, rejectReason, send, toElement, initItem, filesOf, UploadResult } from './upload';
import { legacyLoaded } from '../legacy';
import { setValue } from '../util/events';
import { onRemoval } from '../util/removal';
import { esc } from '../util/html';

type FieldState = { abort: AbortController; unsort: (() => void) | null; select: Selectable | null };
const fields = new Map<HTMLElement, FieldState>();
const drop = (st: FieldState): void => { st.abort.abort(); if (st.unsort) st.unsort(); if (st.select) st.select.destroy(); };
// per-element state, dropped when its element leaves the page (audit R6)
const prune = (): void => fields.forEach((st, f) => { if (!f.isConnected) { drop(st); fields.delete(f); } });
onRemoval(prune);

/**
 * Dragging items out of a file or image field onto another one (0.14.0): the sortable's `outside`
 * and its end, with fields/files-move.ts loaded at the first drag where uploads are possible (the
 * same page editor contract). Until it is in, a drag stays a sort.
 */
export function dragOut(inputfield: HTMLElement, list: HTMLElement): {
	load(): void;
	outside(item: HTMLElement, group: HTMLElement[], e: PointerEvent): boolean;
	end(end: DragEnd, group: HTMLElement[]): void;
} {
	let mover: Mover | null = null;
	let loading = false;
	return {
		load: () => {
			if (mover || loading || !uploadAllowed()) return;
			loading = true;
			void import('./files-move').then(m => { mover = m.mover(inputfield, list); }).catch(() => { loading = false; });
		},
		outside: (item, group, e) => !!mover && mover.probe(item, group, e),
		end: (end, group) => {
			if (!mover) return;
			if (end.outside) void mover.drop(group);
			else mover.cancel();
		},
	};
}

/** The items that travel with a pressed one: the selection when the item is in it */
export function groupOf(state: { select: Selectable | null }): (item: HTMLElement) => HTMLElement[] {
	return item => state.select && state.select.isSelected(item) ? state.select.selected() : [item];
}


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

let spreading = false;

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
		if (!input.matches || !input.matches('.InputfieldFileDelete input')) return;
		setDeleted(input);
		// a selected row's box sets the box of every selected row in its field
		const row = input.closest('li.InputfieldFileItem.pw-selected');
		const list = row ? row.parentElement : null;
		if (!list || spreading) return;
		spreading = true;
		list.querySelectorAll<HTMLInputElement>(':scope > li.InputfieldFileItem.pw-selected .InputfieldFileDelete input').forEach(box => {
			if (box === input || box.checked === input.checked) return;
			box.checked = input.checked;
			box.dispatchEvent(new Event('change', { bubbles: true }));
		});
		spreading = false;
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
			drop(state);
			inputfield.querySelectorAll('.InputfieldFileInit').forEach(el => el.classList.remove('InputfieldFileInit'));
			inputfield.querySelectorAll('[data-pw-file]').forEach(el => el.removeAttribute('data-pw-file'));
		});
		fields.clear();
	});
}

function sortable(inputfield: HTMLElement, list: HTMLElement, state: FieldState): () => void {
	const out = dragOut(inputfield, list);
	const infos = (group: HTMLElement[]): Element[] => group.map(li => li.querySelector('.InputfieldFileInfo')).filter(Boolean) as Element[];
	return makeSortable(list, {
		items: 'li.InputfieldFileItem',
		threshold: 4,
		// one row may still leave the field (drags between fields)
		enabled: () => !legacyLoaded() && list.querySelectorAll(':scope > li.InputfieldFileItem').length > 0,
		group: groupOf(state),
		outside: out.outside,
		start: (_item, group) => { out.load(); infos(group).forEach(info => info.classList.add('ui-state-highlight')); },
		stop: (_item, end, group) => {
			infos(group).forEach(info => info.classList.remove('ui-state-highlight'));
			out.end(end, group);
			if (end.outside || end.cancelled) return;
			Array.from(list.children).forEach((li, n) => {
				setValue(li.querySelector<HTMLInputElement>('.InputfieldFileSort'), String(n));
			});
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
	if (!content) return;
	// collapsed with AJAX: set up once its content is loaded (the loader announces 'reloaded')
	if (content.querySelector(':scope > .renderInputfieldAjax')) return;
	let list = content.querySelector<HTMLElement>('.InputfieldFileList');
	// marked on the list, as image.ts marks its grid: content a reload put in is set up again
	if (list && list.hasAttribute('data-pw-file')) return;
	if (!list) {
		list = document.createElement('ul');
		list.className = 'InputfieldFileList InputfieldFileListBlank';
		const placeholder = content.querySelector('.InputfieldFileListPlaceholder');
		if (placeholder) placeholder.replaceWith(list);
		else content.insertBefore(list, content.firstChild);
	}
	list.setAttribute('data-pw-file', '');
	// fields an in-place save replaced
	prune();
	const old = fields.get(inputfield);
	if (old) {
		drop(old);
		content.classList.remove('InputfieldFileInit');
	}
	const state: FieldState = { abort: new AbortController(), unsort: null, select: null };
	fields.set(inputfield, state);
	updateCount(inputfield);
	if (inputfield.closest('.InputfieldRenderValueMode')) return;
	state.select = makeSelectable(content, {
		items: 'li.InputfieldFileItem',
		ignore: 'a, input, select, textarea, button, label, [contenteditable], .selectize-control, .InputfieldFileData',
		enabled: () => !legacyLoaded(),
	});
	state.unsort = sortable(inputfield, list, state);
	list.querySelectorAll<HTMLElement>('.ui-widget-header, .ui-state-default').forEach(el => {
		el.addEventListener('mouseenter', () => el.classList.add('ui-state-hover'), { signal: state.abort.signal });
		el.addEventListener('mouseleave', () => el.classList.remove('ui-state-hover'), { signal: state.abort.signal });
	});
	if (uploadAllowed()) setupUpload(inputfield, content, list, state.abort.signal);
}

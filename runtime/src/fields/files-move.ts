/**
 * Files and images dragged out of their field onto another file or image field of the same page
 * (0.14.0, ADR 0018): a chunk of its own, loaded at the first drag of a file or image field
 * (file.ts dragOut()). The server side is lib/AdminThemeBridgeFiles.php.
 *
 * While the pointer is away from the source list (util/sortable.ts `outside`):
 * - a ghost (`div.pw-drag-ghost`, the lead's thumbnail or name, `data-pw-count`) follows it;
 * - the field under it is checked as an upload of the dragged files would be: its extensions
 *   and room (`.InputfieldFileMaxFiles`), from its upload element. It shows `pw-drop-ok`,
 *   `pw-drop-partial` (some stay, or a single-file field already holds a file) or `pw-drop-no`
 *   (none fits, a field of another page such as a repeater item, an AJAX field not loaded yet);
 * - a placeholder (`li.pw-drop-placeholder`) marks where they land in a multi-file field;
 * - a collapsed field opens after 600 ms.
 *
 * A drop with anything but `ok` asks first (`dialog.pw-ask.pw-ask-move`: what happens to each
 * item; Replace, Swap or Leave for a single-file field). The move is then posted to the page editor
 * (`bridgeFilesMove=1`, with the moved items' unsaved description and tags) and saved there; the
 * moved items are rendered by the target field (`?field=<name>&reloadInputfieldAjax=<name>`, as
 * Inputfields.reload() asks) and take the placeholder's place. Both fields get their sort inputs
 * renumbered, their count classes and `pw-files-moved` (detail: from, to, moved, swapped, errors).
 * Items the server refused stay where they were; why is said in the notice band.
 */

import { uploadTarget, busy, initItem } from './upload';
import { initFileTags, updateCount } from './file';
import { open as openField } from '../inputfields/collapse';
import { notice } from '../util/notice';
import { failed } from '../util/fail';
import { label } from '../util/labels';
import { esc } from '../util/html';

type Outcome = 'ok' | 'ext' | 'room' | 'single';
type Row = { li: HTMLElement; hash: string; name: string; ext: string; thumb: string; outcome: Outcome };
type State = 'ok' | 'partial' | 'no';
type Answer = { ok?: boolean; moved?: { hash: string; basename: string }[]; swapped?: { hash: string; basename: string }[]; errors?: { hash: string; basename: string; message: string }[]; message?: string };

export type Mover = {
	/** sortable's `outside`: true while the pointer is away from the source list */
	probe(lead: HTMLElement, group: HTMLElement[], e: PointerEvent): boolean;
	/** the pointer was released away from the source list */
	drop(group: HTMLElement[]): Promise<void>;
	/** the drag ended in the list or was cancelled */
	cancel(): void;
};

const FIELD = '.Inputfield[data-bridge-component="InputfieldFile"], .Inputfield[data-bridge-component="InputfieldImage"]';
const ITEM = 'li.InputfieldFileItem, li.gridImage:not(.gridImagePlaceholder):not(.gridImageUploading)';
const STATES = ['pw-drop-ok', 'pw-drop-partial', 'pw-drop-no'];

const contentOf = (field: Element): Element | null => field.querySelector(':scope > .InputfieldContent');
const listOf = (field: Element): HTMLElement | null => {
	const c = contentOf(field);
	return c ? c.querySelector<HTMLElement>('ul.InputfieldFileList[data-pw-file], ul.gridImages[data-pw-image]') : null;
};
const uploadOf = (field: Element): HTMLElement | null => {
	const c = contentOf(field);
	return c ? c.querySelector<HTMLElement>('.InputfieldFileUpload, .InputfieldImageUpload') : null;
};
const itemsOf = (list: Element): HTMLElement[] => Array.from(list.children).filter(c => c.matches(ITEM)) as HTMLElement[];
// the page a field belongs to: a repeater item's own page, else the edited page
const pageOf = (field: Element): string => { const item = field.closest('.InputfieldRepeaterItem'); return item ? item.getAttribute('data-page') || '?' : ''; };
const nameOf = (field: Element): string => (field.id || '').replace(/^wrap_Inputfield_/, '').replace(/_repeater\d+$/, '');
const extensions = (field: Element): string[] => { const up = uploadOf(field); return up ? uploadTarget(up).extensions.split(/\s+/).filter(Boolean) : []; };
const extOf = (name: string): string => (name.split('.').pop() || '').toLowerCase();

function basename(li: HTMLElement): string {
	const link = li.querySelector('a.InputfieldFileName');
	const img = li.querySelector('.gridImage__overflow img');
	const url = (link && link.getAttribute('href')) || (img && (img.getAttribute('data-original') || img.getAttribute('src'))) || '';
	try { return decodeURIComponent(url.split('?')[0].split('/').pop() || ''); } catch (err) { return url.split('?')[0].split('/').pop() || ''; }
}

function rowOf(li: HTMLElement): Row {
	const name = basename(li);
	const img = li.querySelector<HTMLImageElement>('.gridImage__overflow img');
	return { li, hash: li.id.replace(/^file_/, ''), name, ext: extOf(name), thumb: img ? img.getAttribute('src') || '' : '', outcome: 'ok' };
}

/** What an upload of the group into the field would give, item by item */
function assess(field: HTMLElement, group: HTMLElement[]): { state: State; rows: Row[]; single: boolean } {
	const up = uploadOf(field) as HTMLElement;
	const target = uploadTarget(up);
	const exts = target.extensions.split(/\s+/).filter(Boolean);
	const count = itemsOf(listOf(field) as HTMLElement).length;
	const single = target.maxFiles === 1;
	let room = target.maxFiles > 1 ? Math.max(0, target.maxFiles - count) : single ? 1 : Infinity;
	const rows = group.map(rowOf);
	for (const r of rows) {
		if (exts.indexOf(r.ext) < 0) { r.outcome = 'ext'; continue; }
		if (room <= 0) { r.outcome = 'room'; continue; }
		room--;
		if (single && count) r.outcome = 'single';
	}
	const fits = rows.filter(r => r.outcome === 'ok' || r.outcome === 'single').length;
	return { state: !fits ? 'no' : rows.every(r => r.outcome === 'ok') ? 'ok' : 'partial', rows, single };
}

/** The field's URL for its own markup, as Inputfields.reload() builds it */
function fieldUrl(field: HTMLElement): string {
	const form = field.closest('form');
	let url = form ? form.getAttribute('action') || '' : '';
	let name = (field.id || '').replace('wrap_Inputfield_', '');
	let fnsx = '';
	const item = name.indexOf('_repeater') > 0 ? field.closest<HTMLElement>('.InputfieldRepeaterItem') : null;
	if (item) {
		url = url.replace(/\?id=\d+/, '?id=' + item.getAttribute('data-page'));
		fnsx = item.getAttribute('data-fnsx') || '';
		name = name.replace(/_repeater\d+$/, '');
	}
	url += (url.indexOf('?') > -1 ? '&' : '?') + 'field=' + name + '&reloadInputfieldAjax=' + name;
	if (fnsx) url += '&fnsx=' + fnsx;
	return url;
}

/** The field's items as the server renders them now, by hash */
async function freshItems(field: HTMLElement): Promise<Map<string, HTMLElement>> {
	const res = await fetch(fieldUrl(field), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
	const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
	const found = doc.getElementById(field.id) || doc.getElementById('wrap_Inputfield_' + nameOf(field));
	const map = new Map<string, HTMLElement>();
	if (found) found.querySelectorAll<HTMLElement>('li.InputfieldFileItem[id^="file_"], li.gridImage[id^="file_"]').forEach(li => map.set(li.id.slice(5), li));
	return map;
}

function renumber(list: HTMLElement): void {
	itemsOf(list).forEach((li, n) => {
		const sort = li.querySelector<HTMLInputElement>('.InputfieldFileSort');
		if (sort) sort.value = String(n);
	});
}

/** Image fields size new tiles to their mode (image.ts is loaded wherever an image field is) */
async function layout(field: HTMLElement): Promise<void> {
	if (!field.matches('[data-bridge-component="InputfieldImage"]')) return;
	const m = await import('./image');
	const set = m.settings(field);
	if (field.classList.contains('InputfieldImageEditAll')) m.setListSize(field, set.listSize);
	else m.setGridSize(field, set.size);
}

/** Ask what to do with the items that do not simply move; null: cancelled */
function ask(field: HTMLElement, src: HTMLElement, rows: Row[]): Promise<Record<string, string> | null> {
	return new Promise(resolve => {
		const current = itemsOf(listOf(field) as HTMLElement)[0];
		const currentName = current ? basename(current) : '';
		const canSwap = !!current && extensions(src).indexOf(extOf(currentName)) > -1;
		const header = field.querySelector(':scope > .InputfieldHeader');
		const title = label('moveTo', 'Move to %s').replace('%s', header ? (header.textContent || '').trim() : nameOf(field));
		const d = document.createElement('dialog');
		d.className = 'pw-ask pw-ask-move';
		let html = `<form method="dialog"><p class="pw-ask-message">${esc(title)}</p><ul>`;
		rows.forEach(r => {
			const pic = r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : `<b class="pw-ask-move-ext">${esc(r.ext)}</b>`;
			let what = '';
			if (r.outcome === 'ok') what = esc(label('moveGoes', 'Moves'));
			else if (r.outcome === 'ext') what = esc(label('moveBadExt', 'Stays: this field does not take .%s files').replace('%s', r.ext));
			else if (r.outcome === 'room') what = esc(label('moveNoRoom', 'Stays: no room in this field'));
			const choice = r.outcome !== 'single' ? '' : `<select class="pw-select" name="${esc(r.hash)}">` +
				`<option value="replace">${esc(label('moveReplace', 'Replace %s (it is deleted)').replace('%s', currentName))}</option>` +
				(canSwap ? `<option value="swap">${esc(label('moveSwap', 'Swap: %s goes to the other field').replace('%s', currentName))}</option>` : '') +
				`<option value="skip">${esc(label('moveSkip', 'Leave it where it is'))}</option></select>`;
			html += `<li class="pw-ask-move-is-${r.outcome}">${pic}<span>${esc(r.name)}${what ? `<span class="detail">${what}</span>` : ''}</span>${choice}</li>`;
		});
		html += '</ul><div class="pw-ask-buttons">' +
			'<button type="submit" value="ok" class="ui-button pw-button"></button>' +
			`<button type="submit" value="cancel" class="ui-button pw-button ui-priority-secondary">${esc(label('cancel', 'Cancel'))}</button></div></form>`;
		d.innerHTML = html;
		const button = d.querySelector('button[value="ok"]') as HTMLButtonElement;
		const choices = (): Record<string, string> => {
			const out: Record<string, string> = {};
			d.querySelectorAll<HTMLSelectElement>('select').forEach(s => { out[s.name] = s.value; });
			return out;
		};
		const count = (): void => {
			const c = choices();
			const n = rows.filter(r => r.outcome === 'ok' || (r.outcome === 'single' && c[r.hash] !== 'skip')).length;
			button.textContent = label('moveButton', 'Move %d').replace('%d', String(n));
			button.disabled = n === 0;
		};
		d.addEventListener('change', count);
		count();
		document.body.appendChild(d);
		d.addEventListener('close', () => {
			resolve(d.returnValue === 'ok' ? choices() : null);
			d.remove();
		});
		d.showModal();
		(d.querySelector('select') || button).focus();
	});
}

export function mover(src: HTMLElement, list: HTMLElement): Mover {
	let ghost: HTMLElement | null = null;
	let placeholder: HTMLElement | null = null;
	let current: HTMLElement | null = null;
	let state: State = 'no';
	let rows: Row[] = [];
	let spring = 0;

	const unmark = (): void => {
		window.clearTimeout(spring);
		if (current) current.classList.remove(...STATES);
		if (placeholder) placeholder.remove();
		placeholder = null;
	};
	const reset = (): void => {
		unmark();
		current = null;
		state = 'no';
		rows = [];
		if (ghost) ghost.remove();
		ghost = null;
	};

	const makeGhost = (lead: HTMLElement, group: HTMLElement[]): HTMLElement => {
		const g = document.createElement('div');
		g.className = 'pw-drag-ghost';
		const r = rowOf(lead);
		g.innerHTML = (r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : '') + `<span>${esc(r.name)}</span>`;
		if (group.length > 1) g.setAttribute('data-pw-count', String(group.length));
		document.body.appendChild(g);
		return g;
	};

	const place = (field: HTMLElement, x: number, y: number): void => {
		const target = listOf(field) as HTMLElement;
		const grid = target.classList.contains('gridImages') && !field.classList.contains('InputfieldImageEditAll');
		if (!placeholder || placeholder.parentElement !== target) {
			if (placeholder) placeholder.remove();
			placeholder = document.createElement('li');
			if (target.classList.contains('gridImages')) {
				const size = (target.getAttribute('data-size') || '130') + 'px';
				placeholder.className = 'ImageOuter gridImage gridImagePlaceholder pw-drop-placeholder';
				placeholder.innerHTML = '<div class="gridImage__overflow"></div>';
				const o = placeholder.firstElementChild as HTMLElement;
				o.style.width = grid ? size : '100%';
				o.style.height = grid ? size : '8px';
			} else {
				placeholder.className = 'pw-drop-placeholder';
			}
			target.insertBefore(placeholder, target.querySelector(':scope > .InputfieldImageEdit'));
		}
		const under = document.elementFromPoint(x, y);
		const other = under ? under.closest<HTMLElement>(ITEM) : null;
		if (!other || other.parentElement !== target) return;
		const r = other.getBoundingClientRect();
		const before = grid ? x < r.left + r.width / 2 : y < r.top + r.height / 2;
		target.insertBefore(placeholder, before ? other : other.nextSibling);
	};

	const probe = (lead: HTMLElement, group: HTMLElement[], e: PointerEvent): boolean => {
		const box = list.getBoundingClientRect();
		const inside = e.clientX >= box.left - 8 && e.clientX <= box.right + 8 && e.clientY >= box.top - 8 && e.clientY <= box.bottom + 8;
		// uploads first: their answers go into these lists
		if (inside || document.body.classList.contains('pw-uploading') || !lead.id) { reset(); return false; }
		if (!ghost) ghost = makeGhost(lead, group);
		ghost.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
		const under = document.elementFromPoint(e.clientX, e.clientY);
		let field = under ? under.closest<HTMLElement>(FIELD) : null;
		if (field === src) field = null;
		if (field !== current) {
			unmark();
			current = field;
			if (field && field.classList.contains('InputfieldStateCollapsed')) spring = window.setTimeout(() => openField(field as HTMLElement), 600);
		}
		if (!current) { ghost.removeAttribute('data-pw-drop'); rows = []; state = 'no'; return true; }
		const usable = !current.classList.contains('InputfieldRenderValueMode') && !!listOf(current) && !!uploadOf(current)
			&& pageOf(current) === pageOf(src) && !current.closest('dialog');
		const seen = usable ? assess(current, group) : null;
		state = seen ? seen.state : 'no';
		rows = seen ? seen.rows : [];
		STATES.forEach(c => (current as HTMLElement).classList.toggle(c, c === 'pw-drop-' + state));
		ghost.setAttribute('data-pw-drop', state);
		if (seen && state !== 'no' && !seen.single) place(current, e.clientX, e.clientY);
		else if (placeholder) { placeholder.remove(); placeholder = null; }
		return true;
	};

	const drop = async (group: HTMLElement[]): Promise<void> => {
		const field = current;
		const seen = state;
		const items = rows;
		const targetList = field ? listOf(field) : null;
		// where they land: the placeholder's index among the field's items, else the end
		let index = -1;
		let anchor: Element | null = null;
		if (placeholder && targetList && placeholder.parentElement === targetList) {
			index = itemsOf(targetList).filter(li => placeholder && (li.compareDocumentPosition(placeholder) & Node.DOCUMENT_POSITION_FOLLOWING)).length;
			anchor = placeholder.nextElementSibling;
			while (anchor && !anchor.matches(ITEM) && !anchor.classList.contains('InputfieldImageEdit')) anchor = anchor.nextElementSibling;
		}
		reset();
		if (!field || !targetList || seen === 'no' || !items.length || !group.length) return;
		if (document.body.classList.contains('pw-uploading')) { notice(label('moveWait', 'Wait for the uploads to finish, then move the files.')); return; }
		let resolve: Record<string, string> = {};
		if (seen !== 'ok') {
			const answer = await ask(field, src, items);
			if (!answer) return;
			resolve = answer;
		}
		const take = items.filter(r => r.outcome === 'ok' || (r.outcome === 'single' && resolve[r.hash] && resolve[r.hash] !== 'skip'));
		if (!take.length) return;
		const up = uploadTarget(uploadOf(field) as HTMLElement);
		const url = up.url.replace(/([?&])InputfieldFileAjax=1&?/, '$1').replace(/[?&]$/, '');
		const body = new FormData();
		body.append('bridgeFilesMove', '1');
		body.append('from', nameOf(src));
		body.append('to', nameOf(field));
		body.append('index', String(index));
		if (up.tokenName) body.append(up.tokenName, up.tokenValue);
		// unsaved description and tags travel with the file; JSON, as core's input keeps arrays one level deep
		const meta: Record<string, Record<string, string>> = {};
		take.forEach(r => {
			body.append('ids[]', r.hash);
			if (resolve[r.hash]) body.append(`resolve[${r.hash}]`, resolve[r.hash]);
			r.li.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[name], textarea[name]').forEach(input => {
				const key = (input.name.match(/^(description\d*|tags)_/) || [])[1];
				if (key) (meta[r.hash] = meta[r.hash] || {})[key] = input.value;
			});
		});
		body.append('meta', JSON.stringify(meta));
		busy(true);
		field.classList.add('pw-moving');
		let data: Answer = {};
		try {
			const res = await fetch(url, { method: 'POST', body, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
			data = JSON.parse(await res.text()) as Answer;
		} catch (err) {
			busy(false);
			field.classList.remove('pw-moving');
			failed('moving files', err);
			return;
		}
		const moved = data.moved || [];
		const swapped = data.swapped || [];
		const sourceList = list;
		try {
			if (moved.length) {
				const fresh = await freshItems(field);
				const back = swapped.length ? await freshItems(src) : new Map<string, HTMLElement>();
				const missing = moved.some(m => !fresh.has(m.hash)) || swapped.some(m => !back.has(m.hash));
				const reload = (window as unknown as { Inputfields?: { reload?(f: HTMLElement): void } }).Inputfields;
				if (missing && reload && reload.reload) {
					reload.reload(field);
					reload.reload(src);
				} else {
					const first = sourceList.querySelector<HTMLElement>(':scope > #file_' + CSS.escape(moved[0].hash));
					swapped.forEach(s => {
						const li = document.adoptNode(back.get(s.hash) as HTMLElement);
						sourceList.insertBefore(li, first);
						initItem(li, 'InputfieldFileMove');
						initFileTags(li, src);
					});
					moved.forEach(m => { const old = sourceList.querySelector(':scope > #file_' + CSS.escape(m.hash)); if (old) old.remove(); });
					// a single-file field: the file it held was deleted or swapped
					if (up.maxFiles === 1) itemsOf(targetList).forEach(li => li.remove());
					if (anchor && anchor.parentElement !== targetList) anchor = null;
					if (!anchor) anchor = targetList.querySelector(':scope > .InputfieldImageEdit');
					moved.forEach(m => {
						const li = document.adoptNode(fresh.get(m.hash) as HTMLElement);
						targetList.insertBefore(li, anchor);
						initItem(li, 'InputfieldFileMove');
						initFileTags(li, field);
					});
					renumber(sourceList);
					renumber(targetList);
					await layout(field);
					if (swapped.length) await layout(src);
				}
			}
		} catch (err) {
			failed('moving files', err);
		}
		busy(false);
		field.classList.remove('pw-moving');
		updateCount(src);
		updateCount(field);
		const errors = data.errors || [];
		errors.forEach(x => notice((x.basename ? x.basename + ': ' : '') + x.message));
		if (!moved.length && !errors.length && data.message) notice(data.message);
		const detail = { from: nameOf(src), to: nameOf(field), moved, swapped, errors };
		[src, field].forEach(f => f.dispatchEvent(new CustomEvent('pw-files-moved', { bubbles: true, detail })));
	};

	return { probe, drop, cancel: reset };
}

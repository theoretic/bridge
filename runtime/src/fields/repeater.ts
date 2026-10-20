/**
 * InputfieldRepeater without jQuery (milestone 3.3, ADR 0016). Ports upstream InputfieldRepeater.js
 * (core 3.0.274) on the same markup: li.InputfieldRepeater[data-name, data-page, data-min,
 * data-max, data-depth] > .InputfieldContent > ul.Inputfields > li.InputfieldRepeaterItem[data-page,
 * data-depth] (with its hidden loaded_, sort_, depth_, publish_ and delete_ inputs), the template
 * li.InputfieldRepeaterNewItem and p.InputfieldRepeaterAddItem with a.InputfieldRepeaterAddLink.
 *
 * - Item headers get the drag handle and controls: delete (double click: all), on/off,
 *   copy / clone / paste (a choice dialog, util/choose.ts, the `<field>_copy` cookie), settings,
 *   insert before / after (hover shows where), open/close; labels get {secondary} text.
 * - Items load by AJAX when opened (editorUrl ?repeater_edit=), are added by AJAX (?repeater_add=,
 *   ?repeater_clone=, repeater_not=) or from the template (noAjaxAdd), get sorted by their
 *   handle; with depth, dragging sideways by 50 px changes it (family-friendly: children move
 *   along, never deeper than one below the item above).
 * - Min / max items hide the add link and disable delete and clone; remembered open items
 *   (`repeaters_open` cookie), accordion, family open/close.
 * - Events as upstream: repeateradd, repeaterdelete, repeaterundelete, repeaterinsert, sorted on the
 *   Inputfield, reloaded (InputfieldRepeaterItemEdit / InputfieldRepeaterItemAdd) and cloned on new
 *   content.
 *
 * Handover: when the legacy stack arrives (an item with a legacy field was opened), the controls
 * and handles this widget added are removed ('pw-legacy-handover') and upstream initialises the
 * repeater as if fresh.
 */

import { makeSortable } from '../util/sortable';
import { getCookie, setCookie } from '../util/cookie';
import { choose } from '../util/choose';
import { legacyLoaded } from '../legacy';
import { runScripts } from '../util/scripts';
import { open as openField, close as closeField, isCollapsed } from '../inputfields/collapse';

const DEPTH = 50;
type Cfg = { editorUrl?: string; labels?: Record<string, string> };
const repeaters = new Map<HTMLElement, () => void>();
let adding = false;
let toggleTimer = 0;
let insertTimer = 0;

function cfg(): Cfg {
	const pw = (window as unknown as { ProcessWire?: { config?: Record<string, unknown> } }).ProcessWire;
	return ((pw && pw.config && pw.config.InputfieldRepeater) || {}) as Cfg;
}
const label = (key: string): string => (cfg().labels || {})[key] || '';
function pageVersion(): number {
	const pw = (window as unknown as { ProcessWire?: { config?: { PagesVersions?: { version?: number } } } }).ProcessWire;
	return (pw && pw.config && pw.config.PagesVersions && pw.config.PagesVersions.version) || 0;
}
function confirmed(message: string, fn: () => void): void {
	const pw = (window as unknown as { ProcessWire?: { confirm?: (m: string, ok: () => void) => void } }).ProcessWire;
	if (pw && pw.confirm) pw.confirm(message, fn);
	else if (window.confirm(message)) fn();
}
function alertMsg(message: string): void {
	const pw = (window as unknown as { ProcessWire?: { alert?: (m: string) => void } }).ProcessWire;
	if (pw && pw.alert) pw.alert(message); else window.alert(message);
}

const children = (el: Element | null, selector: string): HTMLElement[] =>
	el ? Array.from(el.children).filter(c => c.matches(selector)) as HTMLElement[] : [];
const child = (el: Element | null, selector: string): HTMLElement | null => children(el, selector)[0] || null;

function repeaterOf(el: Element): HTMLElement | null { return el.closest<HTMLElement>('.InputfieldRepeater'); }
function listOf(repeater: Element): HTMLElement | null { return child(child(repeater, '.InputfieldContent'), 'ul.Inputfields'); }
function itemFields(item: Element): HTMLElement | null { return child(child(item, '.InputfieldContent'), '.Inputfields'); }
function header(item: Element): HTMLElement | null { return child(item, '.InputfieldHeader'); }
function fieldName(repeater: HTMLElement): string {
	return repeater.getAttribute('data-name') || (repeater.id || '').replace('wrap_Inputfield_', '').replace(/_LPID\d+$/, '');
}
function disabled(icon: Element): boolean {
	if (!icon.classList.contains('pw-icon-disabled')) return false;
	alertMsg(label('disabledMinMax'));
	return true;
}

/* depth ******************************************************************************************/

export function itemDepth(item: Element): number { return parseInt(item.getAttribute('data-depth') || '0', 10) || 0; }

function setDepth(item: HTMLElement, depth: number, max?: number, noValidate = false): number {
	if (depth < 1) depth = 0;
	if (max !== undefined && depth > max) depth = max;
	const repeater = repeaterOf(item);
	if (!noValidate && repeater && repeater.classList.contains('InputfieldRepeaterFamilyFriendly')) {
		let prev = item.previousElementSibling as HTMLElement | null;
		while (prev && (!prev.classList.contains('InputfieldRepeaterItem') || prev.classList.contains('InputfieldRepeaterNewItem'))) prev = prev.previousElementSibling as HTMLElement | null;
		if (prev) { if (depth - itemDepth(prev) > 1) depth = itemDepth(prev) + 1; } else depth = 0;
	}
	const input = child(itemFields(item), '.InputfieldRepeaterItemDepth');
	const field = input ? input.querySelector<HTMLInputElement>('input') : null;
	if (field) field.value = String(depth);
	item.setAttribute('data-depth', String(depth));
	item.style.paddingLeft = depth > 0 ? depth * DEPTH + 'px' : '0';
	item.classList.toggle('InputfieldRepeaterItemHasDepth', depth > 0);
	return depth;
}

function insertDepth(item: HTMLElement, before: boolean): number {
	const depth = itemDepth(item);
	if (before) return depth;
	let next = item.nextElementSibling as HTMLElement | null;
	if (next && next.classList.contains('InputfieldRepeaterNewItem') && !next.classList.contains('InputfieldRepeaterInsertItem')) next = null;
	const nextDepth = next && next.classList.contains('InputfieldRepeaterItem') ? itemDepth(next) : depth;
	return Math.max(depth, nextDepth);
}

function depthChildren(item: HTMLElement): HTMLElement[] {
	const out: HTMLElement[] = [];
	const start = itemDepth(item);
	let next = item.nextElementSibling as HTMLElement | null;
	while (next && next.classList.contains('InputfieldRepeaterItem') && !next.classList.contains('InputfieldRepeaterNewItem') && itemDepth(next) > start) {
		out.push(next);
		next = next.nextElementSibling as HTMLElement | null;
	}
	return out;
}

function initDepths(repeater: HTMLElement): void {
	repeater.querySelectorAll<HTMLInputElement>('.InputfieldRepeaterItemDepth input').forEach(input => {
		const item = input.closest<HTMLElement>('.InputfieldRepeaterItem');
		if (!item) return;
		const left = (parseInt(input.value, 10) || 0) * DEPTH;
		item.style.paddingLeft = left + 'px';
		item.classList.toggle('InputfieldRepeaterItemHasDepth', left > 0);
	});
	const list = listOf(repeater);
	if (list) list.style.position = 'relative';
}

/* state ******************************************************************************************/

function setSort(item: HTMLElement, n: number): void {
	const wrap = child(itemFields(item), '.InputfieldRepeaterItemSort');
	const input = wrap ? wrap.querySelector<HTMLInputElement>('.InputfieldRepeaterSort') : null;
	if (input) input.value = String(n);
}

function updateState(item: Element): void {
	if (!item.closest('.InputfieldRepeaterRememberOpen')) return;
	let val = '';
	document.querySelectorAll('.InputfieldRepeaterItem:not(.InputfieldStateCollapsed)').forEach(el => {
		const id = parseInt(el.getAttribute('data-page') || '0', 10);
		if (id > 0) val += id + '|';
	});
	setCookie('repeaters_open', val);
}

function checkMinMax(repeater: HTMLElement | null): void {
	if (!repeater || (!repeater.classList.contains('InputfieldRepeaterMax') && !repeater.classList.contains('InputfieldRepeaterMin'))) return;
	const max = parseInt(repeater.getAttribute('data-max') || '0', 10);
	const min = parseInt(repeater.getAttribute('data-min') || '0', 10);
	if (max <= 0 && min <= 0) return;
	const content = child(repeater, '.InputfieldContent');
	const list = listOf(repeater);
	if (!content || !list) return;
	const num = children(list, 'li').filter(li => !li.classList.contains('InputfieldRepeaterDeletePending') && !li.classList.contains('InputfieldRepeaterOff') && li.offsetParent !== null).length;
	const add = child(content, '.InputfieldRepeaterAddItem');
	const items = children(list, '.InputfieldRepeaterItem');
	if (max > 0) {
		const full = num >= max;
		if (add) add.style.display = full ? 'none' : '';
		items.forEach(it => { const c = header(it)?.querySelector('.InputfieldRepeaterClone'); if (c) c.classList.toggle('pw-icon-disabled', full); });
	}
	if (min > 0) {
		const low = num <= min;
		content.classList.toggle('InputfieldRepeaterTrashHidden', low);
		items.forEach(it => {
			const h = header(it);
			if (!h) return;
			const pending = it.classList.contains('InputfieldRepeaterDeletePending');
			h.querySelectorAll('.InputfieldRepeaterTrash').forEach(t => t.classList.toggle('pw-icon-disabled', low && !pending));
			h.querySelectorAll('.InputfieldRepeaterToggle.fa-toggle-on').forEach(t => t.classList.toggle('pw-icon-disabled', low));
		});
	}
}

function updateAccordion(item: HTMLElement): void {
	const repeater = repeaterOf(item);
	if (!repeater || !repeater.classList.contains('InputfieldRepeaterAccordion') || !item.parentElement) return;
	let passed = false;
	let scroll = false;
	children(item.parentElement, '.InputfieldRepeaterItem').forEach(sib => {
		if (sib === item) { passed = true; return; }
		if (isCollapsed(sib) || sib.offsetParent === null) return;
		if (!passed) scroll = true;
		closeField(sib);
	});
	if (scroll) scrollToItem(item);
}

function toggleFamily(item: HTMLElement, open: boolean): void {
	const repeater = repeaterOf(item);
	if (!repeater || !repeater.classList.contains('InputfieldRepeaterFamilyToggle') || !repeater.classList.contains('InputfieldRepeaterDepth')) return;
	const depth = itemDepth(item);
	for (const kid of depthChildren(item)) {
		if (itemDepth(kid) !== depth + 1) continue;
		if (open) openField(kid); else closeField(kid);
	}
}

function scrollToItem(item: HTMLElement): void {
	const repeater = repeaterOf(item);
	if (repeater && repeater.classList.contains('InputfieldRepeaterNoScroll')) return;
	window.scrollTo({ top: item.getBoundingClientRect().top + window.scrollY - 10, behavior: 'smooth' });
}

/** {text} parts of a label are secondary; #n follows the item's position for new items */
function adjustLabel(item: HTMLElement, increment: boolean): void {
	const el = header(item)?.querySelector<HTMLElement>('.InputfieldRepeaterItemLabel');
	if (!el) return;
	let html = el.innerHTML;
	const before = html;
	if (increment && html.indexOf('#') > -1 && item.parentElement) {
		const n = children(item.parentElement, '.InputfieldRepeaterItem').filter(s => s !== item && s.offsetParent !== null).length + 1;
		html = html.replace(/#[0-9]+/, '#' + n);
	}
	while (html.indexOf('}') > -1) {
		html = html.replace(/\{/, '<span class="ui-priority-secondary" style="font-weight:normal">').replace(/}/, '</span>');
	}
	if (html !== before) el.innerHTML = html;
}

/* headers ****************************************************************************************/

function icon(classes: string, title: string): HTMLElement {
	const i = document.createElement('i');
	i.className = 'fa ' + classes;
	if (title) i.title = title;
	return i;
}

function initHeader(h: HTMLElement, repeater: HTMLElement, renderValue: boolean): void {
	if (h.classList.contains('InputfieldRepeaterHeaderInit')) return;
	const item = h.parentElement as HTMLElement;
	let ic = item.getAttribute('data-icon') || 'fa-arrows';
	if (ic.indexOf('fa-') !== 0) ic = 'fa-' + ic;
	if (item.classList.contains('InputfieldRepeaterNewItem')) {
		ic = 'fa-plus-circle';
		h.classList.add('ui-priority-secondary');
	}
	h.classList.add('ui-state-default', 'InputfieldRepeaterHeaderInit');
	h.insertBefore(icon('fa-fw ' + ic + ' InputfieldRepeaterDrag', ''), h.firstChild);
	if (!renderValue) {
		const controls = document.createElement('span');
		controls.className = 'InputfieldRepeaterItemControls';
		const toggle = icon('InputfieldRepeaterToggle ' + (item.classList.contains('InputfieldRepeaterOff') ? 'fa-toggle-off' : 'fa-toggle-on'), label('toggle'));
		toggle.setAttribute('data-on', 'fa-toggle-on');
		toggle.setAttribute('data-off', 'fa-toggle-off');
		const parts: HTMLElement[] = [icon('fa-trash InputfieldRepeaterTrash', label('remove')), toggle];
		if (!repeater.classList.contains('InputfieldRepeaterNoAjaxAdd')) {
			const clone = icon('fa-copy InputfieldRepeaterClone', label('clone'));
			clone.style.display = 'block';
			parts.push(clone);
		}
		if (repeater.classList.contains('InputfieldRepeaterHasSettings')) parts.push(icon('fa-gear InputfieldRepeaterSettingsToggle ui-priority-secondary', label('settings')));
		parts.push(icon('fa-download InputfieldRepeaterInsertAfter', label('insertAfter')));
		parts.push(icon('fa-upload InputfieldRepeaterInsertBefore', label('insertBefore')));
		const collapse = h.querySelector('.toggle-icon');
		if (collapse) parts.push(collapse as HTMLElement);
		parts.forEach(p => controls.appendChild(p));
		h.insertBefore(controls, h.firstChild);
	}
	adjustLabel(item, false);
}

/* AJAX *******************************************************************************************/

function itemUrl(repeater: HTMLElement, extra: string, pageID?: number): string {
	const url = (cfg().editorUrl || '') + '?id=' + (pageID || repeater.getAttribute('data-page')) + '&field=' + encodeURIComponent(fieldName(repeater));
	const version = pageVersion();
	return url + (version ? '&version=' + version : '') + extra;
}

async function getHtml(url: string): Promise<Document> {
	const res = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
	return new DOMParser().parseFromString(await res.text(), 'text/html');
}

/** inline scripts of new content run (upstream runScripts); legacy content once the stack is there */
function runFieldScripts(root: HTMLElement): Promise<void> {
	const scripts = Array.from(root.querySelectorAll<HTMLScriptElement>('.Inputfield script'));
	return runScripts(scripts, { legacy: !!root.querySelector('[data-bridge-legacy]') });
}

function initContent(root: HTMLElement, source: string): void {
	const bridge = (window as unknown as { Bridge?: { Inputfields?: { init(r: ParentNode): void } } }).Bridge;
	if (bridge && bridge.Inputfields) bridge.Inputfields.init(root);
	root.querySelectorAll('.Inputfield').forEach(li => li.dispatchEvent(new CustomEvent('reloaded', { bubbles: true, detail: { source } })));
}

async function loadItem(item: HTMLElement): Promise<void> {
	const loaded = item.querySelector<HTMLInputElement>('.InputfieldRepeaterLoaded');
	const repeater = repeaterOf(item);
	if (!loaded || !repeater || parseInt(loaded.value, 10) > 0) return;
	loaded.value = '1';
	item.classList.add('InputfieldRepeaterItemLoading');
	const content = child(item, '.InputfieldContent');
	const fields = loaded.closest<HTMLElement>('.Inputfields');
	const spinner = item.querySelector<HTMLElement>('.InputfieldRepeaterDrag');
	let ic = item.getAttribute('data-icon') || 'fa-arrows';
	if (ic.indexOf('fa-') !== 0) ic = 'fa-' + ic;
	if (spinner) { spinner.classList.remove(ic); spinner.classList.add('fa-spin', 'fa-spinner'); }
	if (content) content.style.display = 'none';
	const pageID = repeater.getAttribute('data-page') || '';
	let extra = '&repeater_edit=' + item.getAttribute('data-page');
	if (repeater.classList.contains('InputfieldRenderValueMode')) extra += '&inrvm=1';
	if (repeater.classList.contains('InputfieldNoDraft')) extra += '&nodraft=1';
	let rid = (repeater.id || '').replace(/_repeater\d+$/, '').replace('_LPID' + pageID, '');
	const context = repeater.getAttribute('data-context');
	if (context) rid = rid.replace(context, '');
	try {
		const doc = await getHtml(itemUrl(repeater, extra));
		const source = doc.getElementById(rid);
		const wrappers = source ? source.querySelectorAll<HTMLElement>(':scope > .InputfieldContent > .Inputfields > .InputfieldRepeaterItem > .InputfieldContent > .Inputfields > .InputfieldWrapper') : [];
		const added: HTMLElement[] = [];
		wrappers.forEach(w => { const el = document.importNode(w, true) as HTMLElement; fields?.appendChild(el); added.push(el); });
		item.classList.remove('InputfieldRepeaterItemLoading');
		if (fields) initContent(fields, 'InputfieldRepeaterItemEdit');
		const nested = added.some(w => w.querySelector('.InputfieldRepeater'));
		if (nested) added.forEach(w => w.querySelectorAll<HTMLElement>('.InputfieldRepeater').forEach(r => initRepeater(r)));
		else item.querySelectorAll<HTMLElement>('.InputfieldRepeaterSettings').forEach(s => { s.style.display = 'none'; });
		if (content) content.style.display = '';
		if (spinner) { spinner.classList.remove('fa-spin', 'fa-spinner'); spinner.classList.add(ic); }
		updateAccordion(item);
		toggleFamily(item, true);
		if (fields) await runFieldScripts(fields);
	} catch (err) {
		item.classList.remove('InputfieldRepeaterItemLoading');
		if (content) content.style.display = '';
		console.error('Bridge repeater: item load failed', err);
	}
}

async function addItem(link: HTMLElement): Promise<void> {
	adding = true;
	const repeater = repeaterOf(link);
	const list = repeater ? listOf(repeater) : null;
	if (!repeater || !list) { adding = false; return; }
	const qty = link.parentElement ? link.parentElement.querySelector<HTMLInputElement>(':scope > input') : null;
	const useAjax = !(link.getAttribute('data-noajax') || '').length;
	let cloneID: string | null = link.getAttribute('data-clone');
	let pageID = 0;
	let depth = 0;
	let redoSort = false;
	const place = (el: HTMLElement): void => {
		let id = el.id + '_';
		while (document.getElementById(id)) id += '_';
		el.id = id;
		const insert = child(list, '.InputfieldRepeaterInsertItem');
		if (insert) {
			depth = itemDepth(insert);
			el.classList.add('InputfieldStateCollapsed');
			const ti = header(el)?.querySelector<HTMLElement>('.toggle-icon');
			if (ti) (ti.getAttribute('data-to') || '').split(/\s+/).filter(Boolean).forEach(c => ti.classList.toggle(c));
			insert.replaceWith(el);
			redoSort = true;
		} else {
			list.appendChild(el);
		}
		el.style.display = 'block';
		adjustLabel(el, true);
		link.dispatchEvent(new CustomEvent('repeateradd', { bubbles: true, detail: { item: el } }));
	};
	if (cloneID) {
		link.removeAttribute('data-clone');
		if (cloneID.indexOf(':') > 0) {
			const a = cloneID.split(':');
			pageID = parseInt(a[0], 10);
			cloneID = a[1];
		}
	}
	if (!useAjax) {
		const tpl = child(list, '.InputfieldRepeaterNewItem');
		const total = children(list, '.InputfieldRepeaterNewItem').length;
		if (tpl && total > 0) {
			const copy = tpl.cloneNode(true) as HTMLElement;
			copy.querySelectorAll('.InputfieldRepeaterHeaderInit').forEach(h => h.classList.remove('InputfieldRepeaterHeaderInit'));
			const h = header(copy);
			if (h) { h.querySelectorAll('.InputfieldRepeaterDrag, .InputfieldRepeaterItemControls').forEach(x => x.remove()); }
			place(copy);
			if (h) initHeader(h, repeater, false);
			if (qty) qty.value = String(total);
			checkMinMax(repeater);
		}
		adding = false;
		return;
	}
	const spinner = link.parentElement ? link.parentElement.querySelector<HTMLElement>('.InputfieldRepeaterSpinner') : null;
	const on = (spinner && spinner.getAttribute('data-on') || '').split(/\s+/).filter(Boolean);
	const off = (spinner && spinner.getAttribute('data-off') || '').split(/\s+/).filter(Boolean);
	if (spinner) { spinner.classList.remove(...off); spinner.classList.add(...on); }
	const inputfieldPageID = parseInt(repeater.getAttribute('data-page') || '0', 10);
	let extra = cloneID ? '&repeater_clone=' + cloneID + '&repeater_clone_to=' + inputfieldPageID : '&repeater_add=' + link.getAttribute('data-type');
	const existing = list.querySelectorAll('.InputfieldRepeaterItem:not(.InputfieldRepeaterNewItem)');
	if (existing.length) extra += '&repeater_not=' + Array.from(existing).map(el => el.getAttribute('data-page')).join(',') + ',';
	try {
		const doc = await getHtml(itemUrl(repeater, extra, pageID || inputfieldPageID));
		if (spinner) { spinner.classList.remove(...on); spinner.classList.add(...off); }
		const found = doc.querySelector<HTMLElement>('.InputfieldRepeaterItemRequested');
		if (!found) { adding = false; return; }
		const item = document.importNode(found, true) as HTMLElement;
		place(item);
		initContent(item, 'InputfieldRepeaterItemAdd');
		initItem(item);
		if (cloneID) {
			item.querySelectorAll('.Inputfield').forEach(li => li.dispatchEvent(new CustomEvent('cloned', { bubbles: true, detail: { source: 'InputfieldRepeaterItemAdd' } })));
			item.querySelectorAll<HTMLInputElement>('.InputfieldTableRowID').forEach(i => { i.value = '0'; });
		}
		if (redoSort) children(list, '.InputfieldRepeaterItem').forEach((it, n) => setSort(it, n));
		else setSort(item, list.children.length);
		if (depth) setDepth(item, depth);
		if (!isCollapsed(item)) scrollToItem(item);
		updateState(item);
		checkMinMax(repeater);
		updateAccordion(item);
		item.querySelectorAll<HTMLElement>('.InputfieldRepeater').forEach(r => initRepeater(r));
		repeater.classList.add('InputfieldStateChanged');
		await runFieldScripts(item);
	} catch (err) {
		if (spinner) { spinner.classList.remove(...on); spinner.classList.add(...off); }
		console.error('Bridge repeater: add failed', err);
	}
	window.setTimeout(() => { adding = false; }, 500);
}

/* clone, copy, paste, insert *********************************************************************/

function copyName(repeater: HTMLElement): string { return repeater.getAttribute('data-name') + '_copy'; }

function placeholderFor(item: HTMLElement, before: boolean, suffix: string): HTMLElement | null {
	const tpl = item.classList.contains('InputfieldRepeaterNewItem') ? item : item.parentElement ? child(item.parentElement, '.InputfieldRepeaterNewItem') : null;
	if (!tpl || !item.parentElement) return null;
	children(item.parentElement, '.InputfieldRepeaterInsertItem').forEach(x => x.remove());
	const ph = tpl.cloneNode(true) as HTMLElement;
	ph.classList.add('InputfieldRepeaterInsertItem', before ? 'InputfieldRepeaterInsertItemBefore' : 'InputfieldRepeaterInsertItemAfter');
	ph.id = tpl.id + '-' + suffix;
	if (before) item.parentElement.insertBefore(ph, item);
	else item.insertAdjacentElement('afterend', ph);
	return ph;
}

function cloneItem(item: HTMLElement, before: boolean | undefined, paste: { page: number; item: number } | null): void {
	const repeater = repeaterOf(item);
	const add = repeater ? child(child(repeater, '.InputfieldContent'), '.InputfieldRepeaterAddItem')?.querySelector<HTMLElement>('.InputfieldRepeaterAddLink') : null;
	if (!repeater || !add) return;
	const next = item.nextElementSibling;
	const depth = itemDepth(item);
	if (before === undefined) before = !!next && next.classList.contains('InputfieldRepeaterItem') && depth < itemDepth(next);
	const ph = placeholderFor(item, before, paste ? 'paste' : 'clone');
	if (!ph) return;
	const h = header(ph);
	if (h) h.innerHTML = "<i class='fa fa-spin fa-spinner'></i>";
	setDepth(ph, insertDepth(item, before));
	ph.style.display = '';
	add.setAttribute('data-clone', paste ? paste.page + ':' + paste.item : item.getAttribute('data-page') || '');
	void addItem(add);
}

async function copyClonePaste(item: HTMLElement): Promise<void> {
	const repeater = repeaterOf(item);
	if (!repeater) return;
	const id = item.getAttribute('data-page');
	const memory = getCookie<{ page: number; item: number }>(copyName(repeater));
	const copied = memory && typeof memory === 'object' ? memory : null;
	const pasteID = copied ? copied.item : 0;
	const note = pasteID > 0 ? "<i class='fa fa-paste fa-fw'></i>" + label('copyInMemory') + ' (id ' + pasteID + ')' : '';
	const action = await choose(label('selectAction') + ' (id ' + id + ')', [
		{ value: 'copy', label: label('copy') },
		{ value: 'clone-before', label: label('cloneBefore') },
		{ value: 'clone-after', label: label('cloneAfter') },
		{ value: 'paste-before', label: label('pasteBefore'), disabled: !copied },
		{ value: 'paste-after', label: label('pasteAfter'), disabled: !copied, selected: pasteID > 0 },
		{ value: 'clear', label: label('clear'), disabled: !copied },
	], note);
	if (!action) return;
	if (action === 'copy') {
		setCookie(copyName(repeater), { page: parseInt(repeater.getAttribute('data-page') || '0', 10), item: parseInt(id || '0', 10), field: repeater.getAttribute('data-name') });
		repeater.classList.add('InputfieldRepeaterCanPaste');
		item.animate([{ opacity: 1 }, { opacity: .3 }, { opacity: 1 }], { duration: 400 });
	} else if (action === 'clone-before' || action === 'clone-after') {
		cloneItem(item, action === 'clone-before', null);
	} else if ((action === 'paste-before' || action === 'paste-after') && copied) {
		cloneItem(item, action === 'paste-before', copied);
	} else if (action === 'clear') {
		document.cookie = copyName(repeater) + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
		repeater.classList.remove('InputfieldRepeaterCanPaste');
	}
}

function insert(item: HTMLElement, before: boolean): void {
	if (adding) return;
	adding = true;
	window.clearTimeout(insertTimer);
	const depth = insertDepth(item, before);
	const ph = placeholderFor(item, before, 'placeholder');
	if (!ph) { adding = false; return; }
	ph.classList.remove('hov');
	const h = header(ph);
	if (h) h.innerHTML = "<i class='fa fa-spin fa-spinner'></i>";
	if (depth > 0) setDepth(ph, depth);
	ph.style.display = '';
	if (!before && !isCollapsed(item)) scrollToItem(ph);
	const links = item.parentElement && item.parentElement.parentElement
		? Array.from(item.parentElement.parentElement.querySelectorAll<HTMLElement>(':scope > .InputfieldRepeaterAddItem .InputfieldRepeaterAddLink')) : [];
	if (links.length === 1) {
		void addItem(links[0]);
	} else if (links.length > 1) {
		item.dispatchEvent(new CustomEvent('repeaterinsert', { bubbles: true, detail: { insertItem: ph, item, before } }));
		adding = false;
	} else {
		adding = false;
	}
}

/* delete, on/off, settings, open all *************************************************************/

function deleteItem(trash: HTMLElement): void {
	const h = trash.closest<HTMLElement>('.InputfieldHeader');
	const item = h ? h.parentElement as HTMLElement : null;
	if (!h || !item || disabled(trash)) return;
	if (item.classList.contains('InputfieldRepeaterNewItem')) {
		const qty = item.parentElement?.parentElement?.querySelector<HTMLInputElement>(':scope > .InputfieldRepeaterAddItem > input');
		if (qty) qty.value = String((parseInt(qty.value, 10) || 0) - 1);
		const repeater = repeaterOf(item);
		item.remove();
		checkMinMax(repeater);
		return;
	}
	const box = document.getElementById('delete_repeater' + item.getAttribute('data-page')) as HTMLInputElement | null;
	const on = !(box && box.checked);
	if (box) box.checked = on;
	h.classList.toggle('ui-state-error', on);
	h.classList.toggle('ui-state-default', !on);
	item.classList.toggle('InputfieldRepeaterDeletePending', on);
	if (on && !isCollapsed(item)) closeField(item);
	item.dispatchEvent(new CustomEvent(on ? 'repeaterdelete' : 'repeaterundelete', { bubbles: true }));
	const parent = item.parentElement?.closest('.Inputfield');
	if (on && parent) parent.classList.add('InputfieldStateChanged');
	checkMinMax(repeaterOf(item));
}

function toggleItem(toggle: HTMLElement): void {
	window.clearTimeout(toggleTimer);
	toggleTimer = window.setTimeout(() => {
		if (disabled(toggle)) return;
		const item = toggle.closest<HTMLElement>('.InputfieldRepeaterItem');
		if (!item) return;
		const onCls = toggle.getAttribute('data-on') || 'fa-toggle-on';
		const offCls = toggle.getAttribute('data-off') || 'fa-toggle-off';
		const input = Array.from(item.querySelectorAll<HTMLInputElement>('.InputfieldRepeaterPublish')).find(i => i.closest('.InputfieldRepeaterItem') === item);
		const turnOff = toggle.classList.contains(onCls);
		toggle.classList.toggle(onCls, !turnOff);
		toggle.classList.toggle(offCls, turnOff);
		item.classList.toggle('InputfieldRepeaterUnpublished', turnOff);
		item.classList.toggle('InputfieldRepeaterOff', turnOff);
		if (!turnOff) item.classList.add('InputfieldRepeaterWasUnpublished');
		if (input) {
			input.value = turnOff ? '-1' : '1';
			input.dispatchEvent(new Event('change', { bubbles: true }));
		}
		checkMinMax(repeaterOf(item));
	}, 250);
}

function openAll(toggle: HTMLElement): void {
	window.clearTimeout(toggleTimer);
	const repeater = repeaterOf(toggle);
	const list = repeater ? listOf(repeater) : null;
	if (!repeater || !list || repeater.classList.contains('InputfieldRepeaterAccordion')) return;
	const items = children(list, '.InputfieldRepeaterItem');
	if (!items.length) return;
	const opening = isCollapsed(items[0]);
	confirmed(label(opening ? 'openAll' : 'collapseAll'), () => {
		items.forEach(it => { if (opening && isCollapsed(it)) openField(it); else if (!opening && !isCollapsed(it)) closeField(it); });
	});
}

function toggleSettings(gear: HTMLElement): void {
	const item = gear.closest<HTMLElement>('.InputfieldRepeaterItem');
	if (!item) return;
	let parent = itemFields(item);
	let settings = child(parent, '.InputfieldRepeaterSettings');
	if (!settings) {
		parent = child(child(parent, '.InputfieldWrapper'), '.Inputfields');
		settings = child(parent, '.InputfieldRepeaterSettings');
	}
	if (isCollapsed(item)) openField(item);
	if (!settings) return;
	const show = settings.offsetParent === null;
	settings.style.display = show ? '' : 'none';
	gear.classList.toggle('ui-priority-secondary', !show);
}

/* sortable ***************************************************************************************/

function sortable(repeater: HTMLElement, list: HTMLElement): () => void {
	const max = parseInt(repeater.getAttribute('data-depth') || '0', 10) || 0;
	const family = repeater.classList.contains('InputfieldRepeaterFamilyFriendly');
	let kids: HTMLElement[] = [];
	let startDepth = 0;
	if (max > 0) initDepths(repeater);
	return makeSortable(list, {
		items: 'li.InputfieldRepeaterItem:not(.InputfieldRepeaterNewItem)',
		handle: '.InputfieldRepeaterDrag',
		enabled: () => !legacyLoaded(),
		start: item => {
			header(item)?.classList.add('ui-state-highlight');
			startDepth = itemDepth(item);
			kids = family && max > 0 ? depthChildren(item) : [];
			kids.forEach(k => { k.style.display = 'none'; });
		},
		move: (item, { dx }) => {
			if (max <= 0) return;
			const depth = startDepth + Math.round(dx / DEPTH);
			const h = header(item);
			if (h) h.classList.toggle('ui-state-error', depth > max);
			if (h) h.classList.toggle('InputfieldRepeaterItemOOB', depth > max);
		},
		stop: (item, { dx }) => {
			const h = header(item);
			if (max > 0) {
				setDepth(item, startDepth + Math.round(dx / DEPTH), max);
				if (h) h.classList.remove('ui-state-error', 'InputfieldRepeaterItemOOB');
			}
			if (kids.length) {
				const diff = itemDepth(item) - startDepth;
				let after = item;
				kids.forEach(k => {
					if (diff) setDepth(k, itemDepth(k) + diff, max, true);
					after.insertAdjacentElement('afterend', k);
					k.style.display = '';
					after = k;
				});
				kids = [];
			}
			if (h) h.classList.remove('ui-state-highlight');
			children(list, 'li').forEach((li, n) => {
				const input = li.querySelector<HTMLInputElement>('.InputfieldRepeaterSort');
				if (input) input.value = String(n);
			});
			repeater.dispatchEvent(new CustomEvent('sorted', { bubbles: true, detail: { item } }));
			if (max > 0 && startDepth !== itemDepth(item)) repeater.classList.add('InputfieldStateChanged');
		},
		update: () => repeater.classList.add('InputfieldStateChanged'),
	});
}

/* init *******************************************************************************************/

function initItem(item: HTMLElement): void {
	const repeater = repeaterOf(item);
	const h = header(item);
	if (!repeater || !h) return;
	initHeader(h, repeater, !!item.closest('.InputfieldRenderValueMode'));
	h.querySelectorAll<HTMLElement>('.InputfieldRepeaterTrash').forEach(hoverTrash);
}

function hoverTrash(trash: HTMLElement): void {
	const lbl = trash.closest<HTMLElement>('label');
	if (!lbl) return;
	trash.addEventListener('mouseenter', () => { if (!lbl.closest('.InputfieldRepeaterDeletePending')) lbl.classList.add('ui-state-error'); });
	trash.addEventListener('mouseleave', () => { if (!(lbl.parentElement && lbl.parentElement.classList.contains('InputfieldRepeaterDeletePending'))) lbl.classList.remove('ui-state-error'); });
}

export function initRepeater(repeater: HTMLElement): void {
	const list = listOf(repeater);
	if (!list || list.classList.contains('InputfieldRepeaterInit')) return;
	list.classList.add('InputfieldRepeaterInit');
	const renderValue = !!list.closest('.InputfieldRenderValueMode');
	if (repeater.classList.contains('InputfieldRepeaterHasSettings')) repeater.querySelectorAll<HTMLElement>('.InputfieldRepeaterSettings').forEach(s => { s.style.display = 'none'; });
	children(list, '.InputfieldRepeaterItem').forEach(item => {
		const h = header(item);
		if (h) initHeader(h, repeater, renderValue);
	});
	if (renderValue) { initDepths(repeater); return; }
	list.querySelectorAll<HTMLElement>(':scope > .InputfieldRepeaterItem > .InputfieldHeader .InputfieldRepeaterTrash').forEach(hoverTrash);
	repeaters.set(repeater, sortable(repeater, list));
	if (repeater.classList.contains('InputfieldRepeaterMax') || repeater.classList.contains('InputfieldRepeaterMin')) checkMinMax(repeater);
}

let documentReady = false;

function setupDocument(): void {
	if (documentReady) return;
	documentReady = true;
	// capture: runs before the header's own open/close handler (collapse.ts), which a control
	// click must not reach (upstream stops it the same way)
	document.addEventListener('click', e => {
		if (legacyLoaded()) return;
		const t = e.target as HTMLElement;
		const control = t.closest<HTMLElement>('.InputfieldRepeaterItemControls i:not(.toggle-icon), .InputfieldRepeaterAddLink, .InputfieldRepeaterPaste, .InputfieldRepeaterInsertItem');
		if (!control || !control.closest('.InputfieldRepeater')) return;
		e.preventDefault();
		e.stopPropagation();
		if (control.classList.contains('InputfieldRepeaterTrash')) deleteItem(control);
		else if (control.classList.contains('InputfieldRepeaterToggle')) toggleItem(control);
		else if (control.classList.contains('InputfieldRepeaterClone')) { if (!disabled(control)) void copyClonePaste(control.closest('.InputfieldRepeaterItem') as HTMLElement); }
		else if (control.classList.contains('InputfieldRepeaterSettingsToggle')) toggleSettings(control);
		else if (control.classList.contains('InputfieldRepeaterInsertBefore')) insert(control.closest('.InputfieldRepeaterItem') as HTMLElement, true);
		else if (control.classList.contains('InputfieldRepeaterInsertAfter')) insert(control.closest('.InputfieldRepeaterItem') as HTMLElement, false);
		else if (control.classList.contains('InputfieldRepeaterAddLink')) void addItem(control);
		else if (control.classList.contains('InputfieldRepeaterPaste')) {
			const repeater = repeaterOf(control);
			const tpl = repeater ? child(listOf(repeater), '.InputfieldRepeaterNewItem') : null;
			const memory = repeater ? getCookie<{ page: number; item: number }>(copyName(repeater)) : null;
			if (tpl && memory && typeof memory === 'object') cloneItem(tpl, false, memory);
		} else if (control.classList.contains('InputfieldRepeaterInsertItem')) {
			const target = control.getAttribute('data-insert-for');
			const item = target ? document.getElementById(target) : null;
			if (item) insert(item, control.classList.contains('InputfieldRepeaterInsertItemBefore'));
		}
	}, true);
	document.addEventListener('dblclick', e => {
		if (legacyLoaded()) return;
		const t = e.target as HTMLElement;
		const trash = t.closest<HTMLElement>('.InputfieldRepeaterItemControls .InputfieldRepeaterTrash');
		const toggle = t.closest<HTMLElement>('.InputfieldRepeaterItemControls .InputfieldRepeaterToggle');
		if (toggle) { e.preventDefault(); e.stopPropagation(); openAll(toggle); return; }
		if (!trash || disabled(trash)) return;
		const li = trash.closest('li');
		if (!li || !li.parentElement) return;
		const undelete = li.classList.contains('InputfieldRepeaterDeletePending');
		const all = (): void => children(li.parentElement, 'li').forEach(item => {
			const tr = header(item)?.querySelector<HTMLElement>('.InputfieldRepeaterTrash');
			if (tr && item.classList.contains('InputfieldRepeaterDeletePending') === undelete) deleteItem(tr);
		});
		if (undelete) all(); else confirmed(label('removeAll'), all);
	}, true);
	document.addEventListener('opened', e => {
		if (legacyLoaded()) return;
		const item = e.target as HTMLElement;
		if (!item.classList || !item.classList.contains('InputfieldRepeaterItem')) return;
		updateState(item);
		const loaded = item.querySelector<HTMLInputElement>('.InputfieldRepeaterLoaded');
		if (loaded && parseInt(loaded.value, 10) > 0) { updateAccordion(item); toggleFamily(item, true); return; }
		void loadItem(item);
	});
	document.addEventListener('closed', e => {
		if (legacyLoaded()) return;
		const item = e.target as HTMLElement;
		if (!item.classList || !item.classList.contains('InputfieldRepeaterItem')) return;
		updateState(item);
		toggleFamily(item, false);
	});
	// hovering insert before / after shows where the new item would go (after a second)
	document.addEventListener('mouseover', e => {
		if (legacyLoaded() || adding) return;
		const action = (e.target as HTMLElement).closest<HTMLElement>('.InputfieldRepeaterInsertBefore, .InputfieldRepeaterInsertAfter');
		if (!action) return;
		const item = action.closest<HTMLElement>('.InputfieldRepeaterItem');
		if (!item || action.classList.contains('hov')) return;
		const before = action.classList.contains('InputfieldRepeaterInsertBefore');
		action.classList.add('hov');
		window.clearTimeout(insertTimer);
		insertTimer = window.setTimeout(() => {
			if (!action.classList.contains('hov') || adding) return;
			const ph = placeholderFor(item, before, 'insert');
			if (!ph) return;
			ph.querySelectorAll<HTMLElement>('.InputfieldRepeaterItemControls').forEach(c => { c.style.display = 'none'; });
			const lbl = ph.querySelector('.InputfieldRepeaterItemLabel');
			if (lbl) lbl.textContent = label('insertHere');
			ph.setAttribute('data-insert-for', item.id);
			setDepth(ph, insertDepth(item, before));
			ph.style.display = '';
			ph.addEventListener('mouseleave', () => ph.remove(), { once: true });
		}, 1000);
	});
	document.addEventListener('mouseout', e => {
		const action = (e.target as HTMLElement).closest<HTMLElement>('.InputfieldRepeaterInsertBefore, .InputfieldRepeaterInsertAfter');
		if (!action || adding) return;
		action.classList.remove('hov');
		window.clearTimeout(insertTimer);
	});
	document.addEventListener('pw-legacy-handover', () => {
		repeaters.forEach((unsort, repeater) => {
			unsort();
			repeater.querySelectorAll('.InputfieldRepeaterInit').forEach(el => el.classList.remove('InputfieldRepeaterInit'));
			repeater.querySelectorAll<HTMLElement>('.InputfieldRepeaterHeaderInit').forEach(h => {
				const ti = h.querySelector('.InputfieldRepeaterItemControls .toggle-icon');
				if (ti) h.appendChild(ti);
				h.querySelectorAll('.InputfieldRepeaterItemControls, .InputfieldRepeaterDrag').forEach(x => x.remove());
				h.classList.remove('InputfieldRepeaterHeaderInit');
			});
			repeater.querySelectorAll('.InputfieldRepeaterAddLinkInit').forEach(a => a.classList.remove('InputfieldRepeaterAddLinkInit'));
			repeater.removeAttribute('data-pw-repeater');
		});
		repeaters.clear();
	});
}

export function init(repeater: HTMLElement): void {
	if (legacyLoaded()) return;
	setupDocument();
	repeaters.forEach((unsort, r) => { if (!r.isConnected) { unsort(); repeaters.delete(r); } });
	repeater.setAttribute('data-pw-repeater', '');
	initRepeater(repeater);
}

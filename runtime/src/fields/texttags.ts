/**
 * InputfieldTextTags without jQuery or selectize (milestone 2.4, ADR 0015). Upstream turns the
 * field into a selectize control; this builds selectize's DOM, so fields.css styles it as before:
 *
 *   div.selectize-control.<classes>.(multi|single).plugin-remove_button
 *     div.selectize-input.items(.not-full|.full)(.has-items)(.focus)(.dropdown-active)
 *       div.item[data-value] (+ a.remove)  ...  input[type=text]
 *     div.selectize-dropdown.(multi|single) > div.selectize-dropdown-content
 *       div.option[data-selectable][data-value](.active)  div.create
 *
 * Two upstream modes (data-opts JSON on the original element):
 * - input.InputfieldTextTagsInput: free tags, the value is the tags joined by `delimiter`;
 * - select.InputfieldTextTagsSelect: tags from `tags` (or ProcessWire.config[cfgName]), new ones
 *   when `allowUserTags`, suggestions from `tagsUrl` ({q}) when set; page fields prefix numeric
 *   values with "_" as upstream does.
 * maxItems (1 = single), closeAfterSelect, createOnBlur and addLabel are honoured. The original
 * element keeps the value (hidden, .selectized) and dispatches `change`.
 */

import { makeSortable } from '../util/sortable';
import { on } from '../legacy';
import { esc } from '../util/html';

export type Opts = {
	delimiter?: string; closeAfterSelect?: boolean; createOnBlur?: boolean; maxItems?: number;
	allowUserTags?: boolean; tags?: Record<string, string>; cfgName?: string; tagsUrl?: string; addLabel?: string;
};
type Tag = { value: string; label: string };


/**
 * Build the tag control for an input or select. Options come from its data-opts JSON unless
 * given (the file and image tags inputs, fields/file.ts, have none). For an input, `tags` are
 * suggestions, and `allowUserTags: false` limits it to them.
 */
export function setupTags(original: HTMLInputElement | HTMLSelectElement, given?: Opts): void {
	if (original.classList.contains('selectized')) return;
	let o: Opts = given || {};
	if (!given) try { o = JSON.parse(original.getAttribute('data-opts') || '{}'); } catch (e) { /* defaults */ }
	const isSelect = original instanceof HTMLSelectElement;
	const delimiter = o.delimiter || ' ';
	const max = o.maxItems && o.maxItems > 0 ? o.maxItems : 0;
	const single = max === 1;
	const isPageField = !!original.closest('.InputfieldPage');
	const pw = (window as unknown as { ProcessWire?: { config?: Record<string, unknown> } }).ProcessWire;
	const tagMap = (isSelect && o.cfgName && pw && pw.config ? pw.config[o.cfgName] : o.tags) as Record<string, string> | undefined || {};
	const known: Map<string, string> = new Map(Object.keys(tagMap).map(k => [k, String(tagMap[k])] as [string, string]));
	if (isSelect) Array.from((original as HTMLSelectElement).options).forEach(opt => { if (opt.value && !known.has(opt.value)) known.set(opt.value, opt.textContent || opt.value); });
	const allowCreate = isSelect || o.allowUserTags === false ? !!o.allowUserTags : true;

	let items: Tag[] = isSelect
		? Array.from((original as HTMLSelectElement).selectedOptions).filter(x => x.value).map(x => ({ value: x.value, label: known.get(x.value) || x.textContent || x.value }))
		: (original as HTMLInputElement).value.split(delimiter).map(v => v.trim()).filter(Boolean).map(v => ({ value: v, label: v }));
	let remote: Tag[] = [];
	let active = -1;

	const control = document.createElement('div');
	// the control carries the original's classes, as selectize's does; marked selectized too, or a
	// late legacy stack's InputfieldTextTags() (`.InputfieldTextTagsSelect:not(.selectized)`, any
	// element) would try to build a control from it (JSON.parse of its missing data-opts)
	control.className = ('selectize-control ' + original.className.replace(/\bselectized\b/, '') + (single ? ' single' : ' multi') + (single ? '' : ' plugin-remove_button') + ' selectized').replace(/\s+/g, ' ').trim();
	const box = document.createElement('div');
	box.className = 'selectize-input items';
	const text = document.createElement('input');
	text.type = 'text';
	text.autocomplete = 'off';
	text.setAttribute('autocapitalize', 'off');
	if (original.id) text.id = original.id + '-selectized';
	const placeholder = original.getAttribute('placeholder');
	if (placeholder) text.placeholder = placeholder;
	const dropdown = document.createElement('div');
	dropdown.className = 'selectize-dropdown ' + (single ? 'single' : 'multi');
	dropdown.style.display = 'none';
	const content = document.createElement('div');
	content.className = 'selectize-dropdown-content';
	dropdown.appendChild(content);
	control.append(box, dropdown);
	original.insertAdjacentElement('afterend', control);
	original.classList.add('selectized');
	original.style.display = 'none';
	original.tabIndex = -1;
	// the label points at the original: send it to the typing input
	if (original.id) document.querySelectorAll<HTMLLabelElement>('label[for="' + CSS.escape(original.id) + '"]').forEach(l => { l.htmlFor = text.id; });

	// as selectize's autoGrow: the typing input is as wide as its text, so it sits after the chips
	const grow = (): void => {
		const len = Math.max(text.value.length, items.length ? 1 : (text.placeholder || '').length, 1);
		text.style.width = (len + 1) + 'ch';
	};

	const sync = (): void => {
		if (isSelect) {
			const sel = original as HTMLSelectElement;
			items.forEach(t => {
				let opt = Array.from(sel.options).find(x => x.value === t.value);
				if (!opt) {
					opt = new Option(t.label, t.value);
					sel.appendChild(opt);
				}
				sel.appendChild(opt); // option order follows item order
			});
			Array.from(sel.options).forEach(x => { x.selected = items.some(t => t.value === x.value); });
		} else {
			(original as HTMLInputElement).value = items.map(t => t.value).join(delimiter);
		}
		original.dispatchEvent(new Event('change', { bubbles: true }));
	};

	const renderItems = (): void => {
		box.querySelectorAll(':scope > .item').forEach(el => el.remove());
		// the typing input first: the chips go before it (a field saved with tags renders them at once)
		if (text.parentElement !== box) box.appendChild(text);
		items.forEach(t => {
			const div = document.createElement('div');
			div.className = 'item';
			div.setAttribute('data-value', t.value);
			div.innerHTML = esc(t.label) + (single ? '' : '<a href="javascript:void(0)" class="remove" tabindex="-1" title="Remove">×</a>');
			box.insertBefore(div, text);
		});
		const full = !!max && items.length >= max;
		box.classList.toggle('has-items', items.length > 0);
		box.classList.toggle('full', full);
		box.classList.toggle('not-full', !full);
		text.style.display = full && !single ? 'none' : '';
		grow();
	};

	const candidates = (): Tag[] => {
		const q = text.value.trim().toLowerCase();
		const taken = new Set(items.map(t => t.value));
		const pool: Tag[] = [];
		known.forEach((label, value) => pool.push({ value, label }));
		remote.forEach(t => { if (!known.has(t.value)) pool.push(t); });
		return pool.filter(t => !taken.has(t.value) && (!q || t.label.toLowerCase().indexOf(q) > -1 || t.value.toLowerCase().indexOf(q) > -1));
	};

	const canCreate = (q: string): boolean => {
		if (!q || !allowCreate) return false;
		return !items.some(t => t.value === q) && !Array.from(known.keys()).some(k => k === q);
	};

	const renderDropdown = (): void => {
		const list = candidates();
		const q = text.value.trim();
		let html = '';
		if (canCreate(q)) html += '<div class="create" data-selectable data-value="' + esc(q) + '">' + (o.addLabel || 'Add') + ' <strong>' + esc(q) + '</strong>&hellip;</div>';
		list.forEach(t => { html += '<div class="option" data-selectable data-value="' + esc(t.value) + '">' + esc(t.label) + '</div>'; });
		content.innerHTML = html;
		active = -1;
		const show = html.length > 0 && document.activeElement === text;
		dropdown.style.display = show ? 'block' : 'none';
		box.classList.toggle('dropdown-active', show);
		if (show) {
			dropdown.style.width = control.offsetWidth + 'px';
			// as selectize: the first matching option is highlighted; "Add ..." only when nothing matches
			if (q) {
				const opts = Array.from(content.querySelectorAll('[data-selectable]'));
				const firstOption = opts.findIndex(el => el.classList.contains('option'));
				setActive(firstOption > -1 ? firstOption : 0);
			}
		}
	};

	const setActive = (n: number): void => {
		const opts = content.querySelectorAll<HTMLElement>('[data-selectable]');
		opts.forEach((el, i) => el.classList.toggle('active', i === n));
		active = n;
		if (opts[n]) opts[n].scrollIntoView({ block: 'nearest' });
	};

	const add = (value: string, label?: string): void => {
		value = value.trim();
		if (!value || items.some(t => t.value === value)) return;
		if (max && items.length >= max) {
			if (single) items = [];
			else return;
		}
		items.push({ value, label: label || known.get(value) || value });
		text.value = '';
		renderItems();
		sync();
		if (o.closeAfterSelect !== false || single) {
			dropdown.style.display = 'none';
			box.classList.remove('dropdown-active');
			if (single) text.blur();
		} else {
			renderDropdown();
		}
	};

	const remove = (value: string): void => {
		items = items.filter(t => t.value !== value);
		renderItems();
		sync();
	};

	let timer = 0;
	let seq = 0;
	const lookup = (): void => {
		if (!o.tagsUrl) return;
		const q = text.value.trim();
		window.clearTimeout(timer);
		if (!q) return;
		timer = window.setTimeout(async () => {
			const li = original.closest('.Inputfield');
			if (li) li.classList.add('InputfieldAjaxLoading');
			const mine = ++seq;
			let found: Tag[] = [];
			try {
				const url = new URL((o.tagsUrl as string).replace('{q}', encodeURIComponent(q)), location.href);
				// the header only on this site, as jQuery adds it: on another host it asks a CORS
				// preflight that a tags service answering plain GETs may refuse
				const headers: Record<string, string> = url.origin === location.origin ? { 'X-Requested-With': 'XMLHttpRequest' } : {};
				const res = await fetch(url.href, { credentials: 'same-origin', headers });
				const data = await res.json() as Array<unknown>;
				found = data.map(item => {
					if (item && typeof item === 'object') {
						const it = item as { value: unknown; label?: string };
						const value = typeof it.value === 'number' && isPageField ? '_' + it.value : String(it.value);
						return { value, label: it.label !== undefined ? String(it.label) : value };
					}
					const s = String(item);
					return isPageField && /^\d+$/.test(s) ? { value: '_' + s, label: s } : { value: s, label: s };
				});
			} catch (e) {
				found = [];
			}
			// an answer to an older query never replaces a newer one
			if (mine !== seq) return;
			remote = found;
			if (li) li.classList.remove('InputfieldAjaxLoading');
			renderDropdown();
		}, 300);
	};

	on(box, 'mousedown', e => {
		const t = e.target as HTMLElement;
		if (t.closest('a.remove')) return;
		if (t !== text) {
			e.preventDefault();
			text.focus();
		}
	});
	on(box, 'click', e => {
		const removeLink = (e.target as HTMLElement).closest('a.remove');
		if (!removeLink) return;
		e.preventDefault();
		const item = removeLink.closest('.item');
		if (item) remove(item.getAttribute('data-value') || '');
	});
	on(dropdown, 'mousedown', e => {
		e.preventDefault(); // keep the focus in the typing input
		const opt = (e.target as HTMLElement).closest<HTMLElement>('[data-selectable]');
		if (opt) add(opt.getAttribute('data-value') || '', opt.classList.contains('create') ? undefined : opt.textContent || undefined);
	});
	on(text, 'focus', () => {
		box.classList.add('focus', 'input-active');
		renderDropdown();
	});
	on(text, 'blur', () => {
		box.classList.remove('focus', 'input-active', 'dropdown-active');
		dropdown.style.display = 'none';
		const q = text.value.trim();
		if (q && o.createOnBlur && canCreate(q)) add(q);
		else if (!isSelect && q && allowCreate) add(q); // a free-tag input keeps what was typed
		text.value = '';
	});
	on(text, 'input', () => {
		grow();
		const v = text.value;
		if (!isSelect && delimiter.trim() && v.indexOf(delimiter) > -1) {
			v.split(delimiter).map(x => x.trim()).filter(x => x && (allowCreate || known.has(x))).forEach(x => add(x));
			text.value = '';
			return;
		}
		if (!isSelect && delimiter === ' ' && / $/.test(v) && (allowCreate || known.has(v.trim()))) {
			add(v);
			return;
		}
		renderDropdown();
		lookup();
	});
	on(text, 'keydown', e => {
		const opts = content.querySelectorAll<HTMLElement>('[data-selectable]');
		const open = dropdown.style.display !== 'none';
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			if (!open || !opts.length) return;
			e.preventDefault();
			setActive(e.key === 'ArrowDown' ? (active + 1) % opts.length : (active - 1 + opts.length) % opts.length);
		} else if (e.key === 'Enter' || (e.key === 'Tab' && open && active > -1)) {
			if (e.key === 'Enter') e.preventDefault(); // never submit the form from here
			if (open && active > -1 && opts[active]) {
				const opt = opts[active];
				if (e.key === 'Tab') e.preventDefault();
				add(opt.getAttribute('data-value') || '', opt.classList.contains('create') ? undefined : opt.textContent || undefined);
			} else if (canCreate(text.value.trim())) {
				add(text.value.trim());
			}
		} else if (e.key === 'Backspace' && !text.value && items.length) {
			remove(items[items.length - 1].value);
		} else if (e.key === 'Escape') {
			dropdown.style.display = 'none';
			box.classList.remove('dropdown-active');
		}
	});

	renderItems();
	if (!single) {
		makeSortable(box, {
			items: '.item',
			axis: 'xy',
			update() {
				const order = Array.from(box.querySelectorAll(':scope > .item')).map(el => el.getAttribute('data-value'));
				items.sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value));
				sync();
			},
		});
		control.classList.add('plugin-drag_drop');
	}
}

export function init(el: HTMLElement): void {
	if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) setupTags(el);
}

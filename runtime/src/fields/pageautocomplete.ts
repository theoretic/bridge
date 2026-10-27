/**
 * InputfieldPageAutocomplete without jQuery (milestone 2.4, ADR 0015). Ports upstream
 * InputfieldPageAutocomplete.js on the same markup:
 *
 *   ol#<id>_items[data-id][data-name] > li.itemTemplate (cloned for new items) + li > .itemValue
 *     .itemLabel a.itemRemove i.itemSort          (list mode; ol.hideDeleted removes, else toggles .delete)
 *   input.InputfieldPageAutocompleteData#<id>[data-url][data-label][data-search][data-operator][data-max]
 *   input#<id>_input[.no_list][.and_words][.allow_any][data-disablechars]  (the search box)
 *   i.InputfieldPageAutocompleteStatus[data-spin|found|add|none-class]  .InputfieldPageAutocompleteRemove
 *   .InputfieldPageAutocompleteNote[data-adding]   input#_<name>_add_items (when adding is allowed)
 *
 * Suggestions come from the data-url (ProcessPageSearch JSON) with <search><operator><term>.
 * Picking adds an item (list mode) or sets the single value (no_list); Enter adds the typed text
 * as a new page when adding is allowed (negative ids, labels in _<name>_add_items). The value
 * input dispatches `change` after every edit.
 */

import { attachAutocomplete, Suggestion } from '../util/autocomplete';
import { makeSortable } from '../util/sortable';
import { on } from '../legacy';

type Page = { page_id: number; label: string };

function rebuildInput(ol: HTMLElement): void {
	const id = ol.getAttribute('data-id') || '';
	const name = ol.getAttribute('data-name') || '';
	const input = document.getElementById(id) as HTMLInputElement | null;
	if (!input) return;
	const max = parseInt(input.getAttribute('data-max') || '0', 10);
	let items = Array.from(ol.children).filter(li => !li.classList.contains('itemTemplate')) as HTMLElement[];
	if (max > 0 && items.length > max) {
		items.slice(0, items.length - max).forEach(li => li.remove());
		items = items.slice(items.length - max);
	}
	const values: string[] = [];
	let added = '';
	items.forEach(li => {
		if (li.classList.contains('delete')) return;
		const v = parseInt(li.querySelector(':scope > .itemValue')?.textContent || '0', 10);
		if (!v) return;
		values.push(String(v));
		if (v < 0) added += (li.querySelector(':scope > .itemLabel')?.textContent || '') + '\n';
	});
	input.value = values.join(',');
	const addItems = document.getElementById('_' + name + '_add_items') as HTMLInputElement | null;
	if (addItems) addItems.value = added;
}

function triggerChange(el: HTMLElement): void {
	const field = el.classList.contains('InputfieldPageAutocompleteData') ? el
		: (el.closest('.Inputfield') || el).querySelector<HTMLElement>('.InputfieldPageAutocompleteData');
	if (field) field.dispatchEvent(new Event('change', { bubbles: true }));
}

function pageSelected(ol: HTMLElement, page: Page): void {
	const text = document.getElementById((ol.getAttribute('data-id') || '') + '_input') as HTMLInputElement | null;
	if (text) text.blur();
	const dup = Array.from(ol.children).find(li => !li.classList.contains('itemTemplate') &&
		parseInt(li.querySelector(':scope > .itemValue')?.textContent || '0', 10) === page.page_id) as HTMLElement | undefined;
	if (dup) {
		dup.classList.add('pw-highlight');
		window.setTimeout(() => dup.classList.remove('pw-highlight'), 800);
		return;
	}
	const template = ol.querySelector<HTMLElement>(':scope > .itemTemplate');
	if (!template) return;
	const li = template.cloneNode(true) as HTMLElement;
	li.classList.remove('itemTemplate');
	const value = li.querySelector(':scope > .itemValue');
	if (value) value.textContent = String(page.page_id);
	const label = li.querySelector<HTMLElement>(':scope > .itemLabel');
	const a = label ? label.querySelector<HTMLAnchorElement>(':scope > a') : null;
	if (a) {
		a.textContent = page.label;
		a.setAttribute('href', (a.getAttribute('href') || '') + page.page_id);
	} else if (label) {
		label.textContent = page.label;
	}
	ol.appendChild(li);
	rebuildInput(ol);
	triggerChange(ol);
}

function setIconPosition(icon: HTMLElement | null, side: 'left' | 'right'): void {
	if (!icon) return;
	icon.style.display = '';
	const iconHeight = icon.offsetHeight;
	const parent = icon.parentElement;
	if (!iconHeight || !parent) {
		icon.style.display = 'none';
		return;
	}
	const top = (parent.offsetHeight - iconHeight) / 2;
	icon.style.top = top + 'px';
	if (side === 'left') icon.style.left = (top / 2) + 'px';
	else icon.style.right = (top / 4) + 'px';
}

function setup(data: HTMLInputElement): void {
	if (data.classList.contains('InputfieldPageAutocompleteInit')) return;
	data.classList.add('InputfieldPageAutocompleteInit');
	const id = data.id;
	const url = data.getAttribute('data-url') || '';
	const labelField = data.getAttribute('data-label') || 'title';
	const searchField = data.getAttribute('data-search') || 'title';
	const operator = data.getAttribute('data-operator') || '%=';
	const ol = document.getElementById(id + '_items');
	const input = document.getElementById(id + '_input') as HTMLInputElement | null;
	if (!input) return;
	const box = input.parentElement as HTMLElement;
	const icon = box.querySelector<HTMLElement>('.InputfieldPageAutocompleteStatus');
	const note = box.querySelector<HTMLElement>('.InputfieldPageAutocompleteNote');
	const disableChars = input.getAttribute('data-disablechars') || '';
	const noList = input.classList.contains('no_list');
	const addItemsId = '_' + id.replace('Inputfield_', '') + '_add_items';
	let numAdded = 0;
	const baseIconClass = icon ? icon.className : '';
	const setIcon = (kind: string): void => {
		if (!icon) return;
		const cls = kind ? icon.getAttribute('data-' + kind + '-class') || '' : '';
		icon.className = kind ? (cls + ' InputfieldPageAutocompleteStatus fw').trim() : baseIconClass;
	};
	const hasDisableChar = (s: string): boolean => !!disableChars && Array.from(disableChars).some(c => s.indexOf(c) > -1);
	const addAllowed = (): boolean => !!document.getElementById(addItemsId);

	setIconPosition(icon, 'left');
	if (icon) on(icon, 'click', () => input.focus());

	if (noList) {
		input.setAttribute('data-selectedLabel', input.value);
		const remove = box.querySelector<HTMLElement>('.InputfieldPageAutocompleteRemove');
		setIconPosition(remove, 'right');
		if (remove) {
			on(remove, 'click', () => {
				data.value = '';
				data.dispatchEvent(new Event('change', { bubbles: true }));
				input.value = '';
				input.placeholder = '';
				input.setAttribute('data-selectedLabel', '');
				input.dispatchEvent(new Event('change', { bubbles: true }));
				input.focus();
			});
			const sync = (): void => { remove.style.display = input.value.length ? '' : 'none'; };
			on(input, 'change', sync);
			sync();
		}
		on(input, 'focus', () => {
			if (!data.value.length || hasDisableChar(data.value) || input.classList.contains('added_item')) return;
			input.placeholder = input.getAttribute('data-selectedLabel') || '';
			input.value = '';
		});
	}

	attachAutocomplete(input, {
		minLength: 2,
		source: async term => {
			if (hasDisableChar(term)) return [];
			setIcon('spin');
			let q = term;
			if (input.classList.contains('and_words') && q.indexOf(' ') > 0) q = q.replace(/\s+/g, ',');
			const ajaxUrl = url + '&' + searchField + operator.replace(/%/g, '%25') + encodeURIComponent(q);
			const res = await fetch(ajaxUrl, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
			const json = await res.json() as { total: number; matches: Array<Record<string, unknown>> };
			if (json.total > 0) {
				setIcon('found');
			} else if (addAllowed()) {
				setIcon('add');
				if (note) note.style.display = '';
			} else {
				setIcon('none');
			}
			return (json.matches || []).map(m => ({ label: String(m[labelField] ?? ''), value: String(m[labelField] ?? ''), page_id: Number(m.id) }));
		},
		select: (item: Suggestion) => {
			if (noList) {
				input.value = item.label;
				input.setAttribute('data-selectedLabel', item.label);
				input.dispatchEvent(new Event('change', { bubbles: true }));
				data.value = String(item.page_id);
				data.dispatchEvent(new Event('change', { bubbles: true }));
				input.blur();
			} else if (ol) {
				pageSelected(ol, { page_id: Number(item.page_id), label: item.label });
				input.value = '';
				input.focus();
			}
		},
	});

	on(input, 'blur', () => {
		setIcon('');
		if (note) note.style.display = 'none';
		if (noList) {
			if (data.value.length || input.value.length) {
				if (!input.classList.contains('allow_any') && !input.classList.contains('added_item')) {
					input.value = input.getAttribute('data-selectedLabel') || '';
					input.placeholder = '';
				}
			} else {
				input.value = '';
				input.placeholder = '';
				input.setAttribute('data-selectedLabel', '');
			}
		}
	});
	on(input, 'keyup', () => setIcon(''));
	on(input, 'keydown', e => {
		if (e.key === 'Enter') {
			e.preventDefault(); // never submit the form from the search box
			if (!addAllowed()) return;
			const label = input.value.trim();
			if (!label) {
				input.blur();
				return;
			}
			numAdded++;
			const page: Page = { page_id: -numAdded, label };
			if (noList) {
				data.value = String(page.page_id);
				const addItems = document.getElementById(addItemsId) as HTMLInputElement | null;
				if (addItems) addItems.value = page.label;
				input.classList.add('added_item');
				input.blur();
				let addNote = note ? note.parentElement?.querySelector<HTMLElement>('.InputfieldPageAutocompleteNoteAdd') : null;
				if (!addNote && note) {
					addNote = document.createElement('div');
					addNote.className = 'notes InputfieldPageAutocompleteNote InputfieldPageAutocompleteNoteAdd';
					note.insertAdjacentElement('afterend', addNote);
				}
				if (addNote) {
					addNote.textContent = (note ? note.getAttribute('data-adding') || '' : '') + ' ' + page.label;
					addNote.style.display = '';
				}
			} else if (ol) {
				pageSelected(ol, page);
				input.value = '';
				input.focus();
			}
			if (note) note.style.display = 'none';
			return;
		}
		if (numAdded && noList) {
			const addItems = document.getElementById(addItemsId) as HTMLInputElement | null;
			const addNote = note ? note.parentElement?.querySelector<HTMLElement>('.InputfieldPageAutocompleteNoteAdd') : null;
			if (addNote && addItems && addItems.value !== input.value) {
				addNote.remove();
				data.value = '';
				addItems.value = '';
				numAdded--;
			}
		}
	});

	if (ol) {
		makeSortable(ol, {
			items: 'li:not(.itemTemplate)',
			update(item) {
				rebuildInput(ol);
				triggerChange(ol);
				ol.dispatchEvent(new CustomEvent('sorted', { bubbles: true, detail: { item } }));
			},
		});
		ol.classList.add('InputfieldPageAutocompleteSortable');
		on(ol, 'mouseover', e => {
			const li = (e.target as HTMLElement).closest('li');
			if (li && li.parentElement === ol) { li.classList.remove('ui-state-default'); li.classList.add('ui-state-hover'); }
		});
		on(ol, 'mouseout', e => {
			const li = (e.target as HTMLElement).closest('li');
			if (li && li.parentElement === ol) { li.classList.remove('ui-state-hover'); li.classList.add('ui-state-default'); }
		});
		on(ol, 'click', e => {
			const remove = (e.target as HTMLElement).closest('a.itemRemove');
			if (!remove || !ol.contains(remove)) return;
			e.preventDefault();
			const li = remove.closest('li') as HTMLElement;
			if (ol.classList.contains('hideDeleted')) li.remove();
			else li.classList.toggle('delete');
			rebuildInput(ol);
			triggerChange(ol);
		});
	}
}

export function init(el: HTMLElement): void {
	if (el instanceof HTMLInputElement) setup(el);
}

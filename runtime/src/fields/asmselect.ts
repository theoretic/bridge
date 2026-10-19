/**
 * asmSelect without jQuery (milestone 2.4, ADR 0015). A port of upstream's jquery.asmselect.js
 * 2.0 (Ryan Cramer, MIT): same options (ProcessWire.config.InputfieldAsmSelect merged with the
 * select's data-asmopt), same markup and classes, so the theme's CSS and the server's processing
 * see what they always did:
 *
 *   div.asmContainer#asmContainerN > select.asmSelect#asmSelectN (the picker)
 *                                  + ol.asmList#asmListN > li.asmListItem[rel=<option id>]
 *                                  + the original select[multiple], hidden, holding the value
 *
 * Picking an option adds a list item and selects the original option; the remove link deselects
 * it (or marks it deleted, value prefixed, when hideDeleted is off and it was saved before);
 * sorting reorders the original options. Each change dispatches `change` on the original select
 * (detail: { option, value, id, item, type: add | drop | sort }); a `change` from elsewhere
 * (InputfieldPage's dependent selects) rebuilds the widget. Parent/child options (asmParent,
 * data-asmParent) and the field-list fieldset mode (_END items) work as upstream.
 *
 * Edit links open the native dialog (milestone 3.6) with the edit page's buttons in its footer; a
 * submit copies the page's #asmListItemStatus / #asmListItemDesc (or the inputs with those classes)
 * into the item, which then gets `asmItemUpdated`, and the dialog closes once the save has loaded
 * without errors (upstream closed it at the click).
 */

import { makeSortable } from '../util/sortable';

type AsmOptions = {
	listType: string; sortable: boolean; addable: boolean; deletable: boolean; highlight: boolean;
	fieldset: boolean; addItemTarget: string; hideWhenAdded: boolean; hideWhenEmpty: boolean;
	debugMode: boolean; jQueryUI: boolean; hideDeleted: boolean; deletedOpacity: number;
	deletedPrepend: string; useSelect2: boolean; sortLabel: string; removeLabel: string;
	highlightAddedLabel: string; highlightRemovedLabel: string; containerClass: string;
	selectClass: string; optionDisabledClass: string; listClass: string; listSortableClass: string;
	listItemClass: string; listItemLabelClass: string; listItemDescClass: string;
	listItemStatusClass: string; listItemHandleClass: string; removeClass: string; editClass: string;
	highlightClass: string; deletedClass: string; editLink: string; editLabel: string;
	editLinkOnlySelected: boolean; editLinkModal: boolean | string; optionParentClass: string;
	optionParentIcon: string; optionChildAttr: string; optionParentOpenClass: string;
	optionChildClass: string; optionChildIndent: string; optionParentLabel: string;
	[key: string]: unknown;
};

const DEFAULTS: AsmOptions = {
	listType: 'ol', sortable: false, addable: true, deletable: true, highlight: false, fieldset: false,
	addItemTarget: 'bottom', hideWhenAdded: false, hideWhenEmpty: false, debugMode: false, jQueryUI: true,
	hideDeleted: true, deletedOpacity: 0.5, deletedPrepend: '-', useSelect2: true,
	sortLabel: '<span class="asmIcon asmIconSort">&#8597;</span>',
	removeLabel: '<span class="asmIcon asmIconRemove">&times;</span>',
	highlightAddedLabel: 'Added: ', highlightRemovedLabel: 'Removed: ',
	containerClass: 'asmContainer', selectClass: 'asmSelect', optionDisabledClass: 'asmOptionDisabled',
	listClass: 'asmList', listSortableClass: 'asmListSortable', listItemClass: 'asmListItem',
	listItemLabelClass: 'asmListItemLabel', listItemDescClass: 'asmListItemDesc',
	listItemStatusClass: 'asmListItemStatus', listItemHandleClass: 'asmListItemHandle',
	removeClass: 'asmListItemRemove', editClass: 'asmListItemEdit', highlightClass: 'asmHighlight',
	deletedClass: 'asmListItemDeleted', editLink: '', editLabel: '<span class="ui-icon ui-icon-extlink"></span>',
	editLinkOnlySelected: true, editLinkModal: true, optionParentClass: 'asmParent', optionParentIcon: '⬇',
	optionChildAttr: 'data-asmParent', optionParentOpenClass: 'asmParentOpen', optionChildClass: 'asmChild',
	optionChildIndent: '&nbsp;&nbsp; ', optionParentLabel: '← Click again to make selection',
};

type PW = { config?: Record<string, unknown> };

function optionsFor(original: HTMLSelectElement): AsmOptions {
	const pw = (window as unknown as { ProcessWire?: PW }).ProcessWire;
	const config = pw && pw.config;
	const options: AsmOptions = Object.assign({}, DEFAULTS);
	const id = original.id;
	if (!config) {
		options.sortable = true;
	} else if (id && config[id] && typeof config[id] === 'object') {
		Object.assign(options, config[id]);
	} else if (config.InputfieldAsmSelect && typeof config.InputfieldAsmSelect === 'object') {
		Object.assign(options, config.InputfieldAsmSelect);
	}
	const data = original.getAttribute('data-asmopt');
	if (data) {
		try {
			const parsed = JSON.parse(data);
			if (parsed && typeof parsed === 'object') {
				Object.assign(options, parsed);
				// Repeater/Matrix and others look the instance options up by id
				if (config && id && typeof config[id] === 'undefined') config[id] = options;
			}
		} catch (e) { /* invalid JSON: keep the defaults */ }
	}
	return options;
}

function html(markup: string): Element | null {
	const t = document.createElement('template');
	t.innerHTML = markup.trim();
	return t.content.firstElementChild;
}

let instances = 0;

function setup(original: HTMLSelectElement): void {
	if (original.hasAttribute('data-pw-asm')) return;
	original.setAttribute('data-pw-asm', '');
	const options = optionsFor(original);
	if (options.deletable && !options.addable) options.hideDeleted = false;

	let index = instances++;
	while (document.getElementById(options.containerClass + index)) index++;

	let building = false;
	let ignoreOriginalChange = false;
	let highlightSpan: HTMLElement | null = null;
	let select2: HTMLSelectElement | null = null;
	const fieldsetCloseItems: Record<string, HTMLOptionElement> = {};

	original.querySelectorAll('option[selected]').forEach(o => o.classList.add('asmOriginalSelected'));

	const select = document.createElement('select');
	select.className = (options.selectClass + ' ' + original.className).trim();
	select.name = options.selectClass + index;
	select.id = options.selectClass + index;
	if (!options.addable) select.style.display = 'none';

	const ol = document.createElement(options.listType === 'ul' ? 'ul' : 'ol');
	ol.className = options.listClass;
	ol.id = options.listClass + index;

	const container = document.createElement('div');
	container.className = options.containerClass;
	container.id = options.containerClass + index;

	const originalOption = (id: string | null): HTMLOptionElement | null =>
		id ? original.querySelector<HTMLOptionElement>('#' + CSS.escape(id)) : null;
	const pickerOption = (rel: string, where: HTMLSelectElement = select): HTMLOptionElement | null =>
		where.querySelector<HTMLOptionElement>('option[rel="' + CSS.escape(rel) + '"]');
	const listItem = (rel: string): HTMLElement | null =>
		Array.from(ol.children).find(li => li.getAttribute('rel') === rel) as HTMLElement | undefined || null;

	function getSelect2(): HTMLSelectElement {
		if (!select2) select2 = document.createElement('select');
		return select2;
	}

	function selectFirstItem(): void {
		if (select.options.length) select.options[0].selected = true;
	}

	function disableSelectOption(option: HTMLOptionElement | null): void {
		if (!option) return;
		option.classList.add(options.optionDisabledClass);
		option.selected = false;
		option.disabled = true;
		if (options.hideWhenEmpty && Array.from(select.options).filter(o => !o.disabled).length < 2) select.style.display = 'none';
		if (options.hideWhenAdded) option.hidden = true;
	}

	function enableSelectOption(option: HTMLOptionElement | null): void {
		if (!option) return;
		option.classList.remove(options.optionDisabledClass);
		option.disabled = false;
		if (options.hideWhenEmpty) select.style.display = '';
		if (options.hideWhenAdded) option.hidden = false;
	}

	function childOptions(parentValue: string, where: HTMLSelectElement): HTMLOptionElement[] {
		return Array.from(where.querySelectorAll<HTMLOptionElement>(
			'option.' + options.optionChildClass + '[' + options.optionChildAttr + '="' + CSS.escape(parentValue) + '"]'));
	}

	function hideSelectOptions(list: HTMLOptionElement[]): void {
		list.forEach(option => {
			if (options.useSelect2) {
				getSelect2().appendChild(option);
				if (option.classList.contains(options.optionParentOpenClass)) hideSelectOptions(childOptions(option.value, select));
			} else {
				option.hidden = true;
			}
		});
	}

	function showSelectOptions(list: HTMLOptionElement[], after?: HTMLOptionElement): void {
		list.forEach(option => {
			if (options.useSelect2) {
				if (after) {
					after.insertAdjacentElement('afterend', option);
					after = option;
				} else {
					select.appendChild(option);
				}
			} else {
				option.hidden = false;
			}
		});
	}

	function addSelectOption(optionId: string, disabled = false): void {
		const source = originalOption(optionId);
		if (!source) return;
		const option = document.createElement('option');
		option.innerHTML = source.innerHTML;
		option.value = source.value;
		option.setAttribute('rel', optionId);
		if (source.classList.contains(options.optionParentClass)) option.classList.add(options.optionParentClass);
		if (disabled) disableSelectOption(option);
		const parentAttr = source.getAttribute(options.optionChildAttr);
		if (parentAttr) {
			option.classList.add(options.optionChildClass);
			option.setAttribute(options.optionChildAttr, parentAttr);
			if (options.useSelect2) {
				getSelect2().appendChild(option);
			} else {
				option.hidden = true;
				select.appendChild(option);
			}
		} else {
			select.appendChild(option);
		}
	}

	function setHighlight(item: HTMLElement | null, label: string, remain = false): void {
		if (!options.highlight) return;
		const old = document.getElementById(options.highlightClass + index);
		if (old) old.remove();
		const span = document.createElement('span');
		span.className = options.highlightClass;
		span.id = options.highlightClass + index;
		const itemLabel = item ? item.querySelector('.' + options.listItemLabelClass) : null;
		span.innerHTML = label;
		if (itemLabel) span.appendChild(document.createTextNode(itemLabel.textContent || ''));
		select.insertAdjacentElement('afterend', span);
		if (remain) {
			highlightSpan = span;
		} else {
			window.setTimeout(() => span.remove(), 1500);
		}
	}

	function openEditLink(href: string, link: HTMLElement): void {
		const bridge = (window as unknown as { Bridge?: { dialog?: { open: (url: string, size?: string, options?: Record<string, unknown>) => void } } }).Bridge;
		if (!bridge || !bridge.dialog) { window.location.href = href; return; }
		const item = link.closest<HTMLElement>('.' + options.listItemClass);
		const isSubmit = (b: HTMLElement): boolean => b.getAttribute('type') === 'submit';
		bridge.dialog.open(href, 'medium', {
			source: link,
			buttons: (options.editLinkButtonSelector as string) || 'form button.ui-button:visible',
			autoclose: (b: HTMLElement) => isSubmit(b),
			close: 'button:not([type=submit])',
			onButton: (b: HTMLElement, doc: Document) => {
				if (!item || !isSubmit(b)) return;
				let updated = false;
				const find = (cls: string): HTMLInputElement | null => doc.getElementById(cls) as HTMLInputElement | null || doc.querySelector<HTMLInputElement>('input.' + cls + ', select.' + cls + ', textarea.' + cls);
				const status = find(options.listItemStatusClass);
				if (status) {
					const target = item.querySelector('.' + options.listItemStatusClass);
					if (target) target.innerHTML = status.value;
					updated = true;
				}
				const desc = find(options.listItemDescClass);
				if (desc) {
					const target = item.querySelector('.' + options.listItemDescClass);
					const a = target ? target.querySelector('a') : null;
					if (a) a.textContent = desc.value; else if (target) target.textContent = desc.value;
					updated = true;
				}
				if (item.animate) item.animate([{ opacity: .4 }, { opacity: 1 }], { duration: 500 });
				if (updated) item.dispatchEvent(new CustomEvent('asmItemUpdated', { bubbles: true }));
			},
		});
	}

	function editLinkFor(label: string, href: string): HTMLAnchorElement {
		const a = document.createElement('a');
		a.innerHTML = label;
		a.href = href;
		a.insertAdjacentHTML('beforeend', options.editLabel);
		if (options.editLinkModal === 'longclick') {
			a.classList.add('asmEditLinkModalLongclick');
			let timer = 0;
			let long = false;
			a.addEventListener('pointerdown', () => { long = false; timer = window.setTimeout(() => { long = true; openEditLink(a.getAttribute('href') || href, a); }, 600); });
			a.addEventListener('pointerup', () => window.clearTimeout(timer));
			a.addEventListener('pointerleave', () => window.clearTimeout(timer));
			a.addEventListener('click', e => { if (long) e.preventDefault(); });
		} else if (options.editLinkModal) {
			a.addEventListener('click', e => { e.preventDefault(); openEditLink(a.getAttribute('href') || href, a); });
		}
		return a;
	}

	function triggerOriginalChange(optionId: string, type: string): void {
		ignoreOriginalChange = true;
		const option = originalOption(optionId);
		original.dispatchEvent(new CustomEvent('change', {
			bubbles: true,
			detail: { option, value: option ? option.value : '', id: optionId, item: listItem(optionId), type },
		}));
		ignoreOriginalChange = false;
	}

	function setupFieldsets(): void {
		ol.querySelectorAll('span.asmFieldsetIndent').forEach(s => s.remove());
		Array.from(ol.children).forEach(li => {
			const span = li.querySelector(':scope > span.' + options.listItemLabelClass);
			let label = span ? (span.textContent || '') : '';
			if (label.slice(-4) !== '_END') return;
			label = label.slice(0, -4);
			let item = li as HTMLElement;
			item.classList.add('asmFieldset', 'asmFieldsetEnd');
			for (;;) {
				const prev = item.previousElementSibling as HTMLElement | null;
				if (!prev || !prev.classList.contains(options.listItemClass)) break;
				item = prev;
				const prevSpan = item.querySelector(':scope > span.' + options.listItemLabelClass);
				if (prevSpan && prevSpan.textContent === label) {
					item.classList.add('asmFieldset', 'asmFieldsetStart');
					break;
				}
				if (prevSpan) prevSpan.insertAdjacentHTML('afterbegin', '<span class="asmFieldsetIndent"></span>');
			}
		});
	}

	function findFieldsetCloseItems(): void {
		Array.from(original.options).forEach(o => {
			const name = o.text;
			if (name.indexOf('_END') > 0 && name.slice(-4) === '_END') fieldsetCloseItems[name] = o;
		});
	}

	function addListItem(optionId: string): void {
		const source = originalOption(optionId);
		if (!source) return;
		const item = document.createElement('li');
		item.setAttribute('rel', optionId);
		item.classList.add(options.listItemClass);
		const label = document.createElement('span');
		label.className = options.listItemLabelClass;
		const status = document.createElement('span');
		status.className = options.listItemStatusClass;
		if (source.getAttribute('data-status')) status.innerHTML = source.getAttribute('data-status') as string;
		const desc = document.createElement('span');
		desc.className = options.listItemDescClass;
		if (options.editLink.length > 0 && (source.selected || !options.editLinkOnlySelected)) {
			const href = options.editLink.replace(/\{value\}/, source.value);
			label.classList.add(options.editClass);
			label.appendChild(editLinkFor(source.innerHTML, href));
			const d = source.getAttribute('data-desc');
			if (d) {
				desc.classList.add(options.editClass);
				desc.appendChild(editLinkFor(d, href));
			}
		} else {
			label.innerHTML = source.innerHTML;
			const d = source.getAttribute('data-desc');
			if (d) desc.innerHTML = d;
		}
		item.append(label, desc, status);
		if (options.deletable) {
			const remove = document.createElement('a');
			remove.href = '#';
			remove.className = options.removeClass;
			remove.innerHTML = options.removeLabel;
			remove.addEventListener('click', e => {
				e.preventDefault();
				dropListItem(optionId);
			});
			item.appendChild(remove);
		}
		if (options.jQueryUI) {
			item.classList.add('ui-state-default');
			item.addEventListener('mouseenter', () => { item.classList.add('ui-state-hover'); item.classList.remove('ui-state-default'); });
			item.addEventListener('mouseleave', () => { item.classList.add('ui-state-default'); item.classList.remove('ui-state-hover'); });
			if (options.sortable) {
				const handle = html(source.getAttribute('data-handle') || options.sortLabel);
				if (handle) {
					handle.classList.add(options.listItemHandleClass);
					item.insertBefore(handle, item.firstChild);
				}
			}
		}
		if (!building) {
			if (source.selected) return; // already in the list
			source.selected = true;
		}
		if (options.addItemTarget === 'top' && !building) {
			ol.insertBefore(item, ol.firstChild);
			if (options.sortable) original.insertBefore(source, original.firstChild);
		} else {
			ol.appendChild(item);
			if (options.sortable) original.appendChild(source);
		}
		disableSelectOption(pickerOption(optionId));
		if (!building) {
			setHighlight(item, options.highlightAddedLabel);
			selectFirstItem();
			if (options.fieldset) {
				const name = source.text;
				if (name.indexOf('_END') > 0 && name.slice(-4) === '_END') {
					item.classList.add('asmFieldset', 'asmFieldsetEnd');
				} else if (fieldsetCloseItems[name + '_END']) {
					item.classList.add('asmFieldset', 'asmFieldsetStart');
					const close = fieldsetCloseItems[name + '_END'];
					if (close.id) addListItem(close.id);
				}
			}
		}
	}

	function dropListItem(optionId: string, highlight = true): void {
		const source = originalOption(optionId);
		const item = listItem(optionId);
		if (!source) return;
		if (options.hideDeleted || !source.classList.contains('asmOriginalSelected')) {
			source.selected = false;
			if (item) item.remove();
			enableSelectOption(pickerOption(optionId));
			if (highlight && item) setHighlight(item, options.highlightRemovedLabel);
		} else if (item) {
			const value = source.getAttribute('value') || source.text;
			if (item.classList.contains(options.deletedClass)) {
				item.classList.remove(options.deletedClass);
				if (options.deletedOpacity !== 1) item.style.opacity = '1';
				source.setAttribute('value', value.substring(options.deletedPrepend.length));
			} else {
				item.classList.add(options.deletedClass);
				if (options.deletedOpacity !== 1) item.style.opacity = String(options.deletedOpacity);
				source.setAttribute('value', options.deletedPrepend + value);
			}
		}
		triggerOriginalChange(optionId, 'drop');
	}

	function parentOptionSelected(option: HTMLOptionElement): void {
		const open = option.classList.contains(options.optionParentOpenClass);
		const where = options.useSelect2 && !open ? getSelect2() : select;
		const children = childOptions(option.value, where);
		let label = option.innerHTML;
		const count = children.filter(c => !c.disabled).length;
		if (open) {
			hideSelectOptions(children);
			label = label.replace(/\s*\+\d+ .$/, '');
			option.classList.remove(options.optionParentOpenClass);
			option.selected = false;
		} else {
			let indent = options.optionChildIndent;
			if (option.classList.contains(options.optionChildClass)) indent += indent;
			const plainIndent = html('<span>' + options.optionChildIndent + '</span>');
			const indentText = plainIndent ? plainIndent.textContent || '' : '';
			children.forEach(child => {
				if ((child.textContent || '').indexOf(indentText) !== 0) child.innerHTML = indent + child.innerHTML;
			});
			showSelectOptions(children, option);
			Array.from(select.selectedOptions).forEach(o => { o.selected = false; });
			if (!option.classList.contains(options.optionChildClass)) {
				select.querySelectorAll<HTMLOptionElement>('.' + options.optionParentOpenClass).forEach(other => {
					if (other !== option) parentOptionSelected(other); // accordion: close the open one
				});
			}
			option.classList.add(options.optionParentOpenClass);
			option.selected = true;
			label += ' +' + count + ' ' + options.optionParentIcon;
			const keep = options.highlight;
			options.highlight = true;
			setHighlight(null, options.optionParentLabel, true);
			options.highlight = keep;
		}
		option.innerHTML = label;
	}

	function buildSelect(): void {
		building = true;
		const title = original.getAttribute('title') || '';
		const first = document.createElement('option');
		first.textContent = title;
		select.insertBefore(first, select.firstChild);
		let active = 0;
		Array.from(original.options).forEach((o, n) => {
			if (!o.id) o.id = 'asm' + index + 'option' + n;
			if (o.selected) {
				addListItem(o.id);
				addSelectOption(o.id, true);
			} else if (o.disabled) {
				addSelectOption(o.id, true);
			} else {
				active++;
				addSelectOption(o.id);
			}
		});
		if (!options.debugMode) original.style.display = 'none';
		selectFirstItem();
		if (options.hideWhenEmpty) select.style.display = active > 0 ? '' : 'none';
		building = false;
	}

	select.addEventListener('change', e => {
		e.stopPropagation(); // the picker is not a value of the form: change tracking follows the original
		const option = select.selectedOptions[0];
		if (highlightSpan) {
			highlightSpan.remove();
			highlightSpan = null;
		}
		if (!option || !option.value) return;
		if (option.classList.contains(options.optionParentClass)) {
			parentOptionSelected(option);
			return;
		}
		const rel = option.getAttribute('rel') || '';
		addListItem(rel);
		triggerOriginalChange(rel, 'add');
		if (option.classList.contains(options.optionChildClass)) {
			const parent = select.querySelector<HTMLOptionElement>('option[value="' + CSS.escape(option.getAttribute(options.optionChildAttr) || '') + '"]');
			if (parent) parent.selected = true;
		}
	});

	original.addEventListener('change', () => {
		if (ignoreOriginalChange) return;
		select.innerHTML = '';
		if (select2) select2.innerHTML = '';
		ol.innerHTML = '';
		buildSelect();
		if (options.fieldset) setupFieldsets();
	});

	// wrap: container > picker + list + original
	original.parentNode!.insertBefore(container, original);
	container.append(select, ol, original);
	buildSelect();

	if (options.sortable) {
		const moved: HTMLElement[] = [];
		makeSortable(ol, {
			items: 'li.' + options.listItemClass,
			cancel: 'a.asmEditLinkModalLongclick',
			start(item) {
				if (!item.classList.contains('asmFieldsetStart')) return;
				const label = item.querySelector('.' + options.listItemLabelClass);
				const stop = (label ? label.textContent : '') + '_END';
				for (let next = item.nextElementSibling as HTMLElement | null; next; next = next.nextElementSibling as HTMLElement | null) {
					moved.push(next);
					const nextLabel = next.querySelector('.' + options.listItemLabelClass);
					if (nextLabel && nextLabel.textContent === stop) break;
				}
				moved.forEach(m => { m.style.display = 'none'; });
			},
			stop(item) {
				let last = item;
				moved.forEach(m => {
					last.insertAdjacentElement('afterend', m);
					m.style.display = '';
					last = m;
				});
				const hadFieldset = moved.length > 0;
				moved.length = 0;
				if (options.fieldset) setupFieldsets();
				if (hadFieldset) sync(item);
			},
			update(item) {
				if (item.classList.contains('asmFieldsetStart')) return; // synced in stop()
				sync(item);
			},
		});
		ol.classList.add(options.listSortableClass);
	}

	function sync(item: HTMLElement): void {
		Array.from(ol.children).forEach(li => {
			const o = originalOption(li.getAttribute('rel'));
			if (o) original.appendChild(o);
		});
		triggerOriginalChange(item.getAttribute('rel') || '', 'sort');
		ol.dispatchEvent(new CustomEvent('sorted', { bubbles: true, detail: { item } }));
	}

	if (options.fieldset) {
		setupFieldsets();
		findFieldsetCloseItems();
		original.addEventListener('rebuild', () => findFieldsetCloseItems());
	}
	if (select2) {
		const helper = select2 as HTMLSelectElement;
		helper.className = select.className.replace(/\basmSelect\b/, '').trim();
		helper.id = select.id + '-helper';
		helper.style.display = 'none';
		select.insertAdjacentElement('afterend', helper);
	}
	original.dispatchEvent(new CustomEvent('init', { bubbles: false }));
}

export function init(el: HTMLElement): void {
	if (el instanceof HTMLSelectElement && el.multiple) setup(el);
}

/**
 * InputfieldSelector (the selector builder) without jQuery (milestone 2.4, ADR 0015). Ports
 * upstream InputfieldSelector.js on its markup and its AJAX actions (./?InputfieldSelector=
 * opval | subfield-opval | autocomplete | test, answered by the module wherever it rendered):
 *
 *   .InputfieldSelector input.selector-value[data-template-ids]   (the selector, hidden)
 *   ul.selector-list > li.selector-row(.selector-template-row)(.has-subfield)
 *       select.select-field[data-type] + .subfield + .opval (select.select-operator + .input-value
 *       [.input-value-autocomplete][.input-value-subselect]) + input.input-or + a.delete-row
 *   a.selector-add  .selector-preview[data-init-value]  .selector-counter  .or-notes
 *
 * Changing a field loads its operator/value controls; any change rebuilds the selector string
 * (OR values and OR fields through the input-or checkboxes, template-limited field options,
 * quoting, _custom groups), writes it to the hidden input with `change`, previews it and asks the
 * module for the match count. Value widgets arriving over AJAX (dates) are initialised by the
 * widget registry.
 */

import { attachAutocomplete } from '../util/autocomplete';
import { initWidgets } from './registry';

const SPINNER = "<i class='fa fa-lg fa-spin fa-spinner'></i>";
let lastSelector = '';
let ready = false;

const entities = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const fadeIn = (el: Element | null): void => { if (el) (el as HTMLElement).style.display = ''; };
const hide = (el: Element | null): void => { if (el) (el as HTMLElement).style.display = 'none'; };

function setOption(option: HTMLOptionElement, enabled: boolean): void {
	option.disabled = !enabled;
	option.hidden = !enabled;
}

function valueHasOperator(value: string): boolean {
	for (const op of ['=', '<', '>']) {
		const pos = value.indexOf(op);
		if (pos > -1 && value.substring(pos - 1, pos) !== '\\') return true;
	}
	return false;
}

function fieldOf(el: Element): HTMLElement | null {
	return el.closest<HTMLElement>('.InputfieldSelector');
}

function addRow(context: Element): void {
	const field = fieldOf(context);
	const list = field ? field.querySelector('.selector-list') : null;
	const template = list ? list.querySelector<HTMLElement>('.selector-template-row') : null;
	if (!list || !template) return;
	const row = template.cloneNode(true) as HTMLElement;
	row.classList.remove('selector-template-row');
	row.querySelectorAll('.opval').forEach(o => { o.innerHTML = ''; });
	const select = row.querySelector<HTMLSelectElement>('.select-field');
	if (select) select.value = '';
	row.querySelectorAll<HTMLOptionElement>('option:disabled').forEach(o => { o.hidden = true; });
	list.appendChild(row);
}

function deleteRow(link: Element): void {
	const row = link.closest<HTMLElement>('.selector-row');
	if (!row) return;
	const field = fieldOf(row);
	const select = row.querySelector<HTMLSelectElement>('.select-field');
	if (field && select && select.value === 'template') {
		field.querySelectorAll<HTMLOptionElement>('select.select-field option:disabled').forEach(o => setOption(o, true));
	}
	const sibling = (row.previousElementSibling || row.nextElementSibling) as HTMLElement | null;
	row.remove();
	if (sibling) changeAny(sibling);
}

function toggleNamesLabels(select: HTMLSelectElement): void {
	const root = fieldOf(select);
	if (!root) return;
	const current = root.classList.contains('InputfieldSelector_names') ? 'names' : 'labels';
	const next = current === 'labels' ? 'names' : 'labels';
	root.querySelectorAll('.select-field, .select-subfield').forEach(sel => {
		sel.querySelectorAll('option').forEach(option => {
			const name = option.getAttribute('data-name');
			if (!name) {
				if (option.value === 'toggle-names-labels') option.innerHTML = option.getAttribute('data-' + current) || option.innerHTML;
				return;
			}
			option.innerHTML = current === 'labels' ? name : (option.getAttribute('data-label') || name);
		});
	});
	root.classList.remove('InputfieldSelector_' + current);
	root.classList.add('InputfieldSelector_' + next);
	select.value = select.getAttribute('data-selected') || '';
}

function setupAutocomplete(input: HTMLInputElement, field: string, name: string): void {
	if (input.hasAttribute('data-pw-autocomplete')) return;
	input.setAttribute('data-pw-autocomplete', '');
	const root = fieldOf(input);
	const counter = root ? root.querySelector<HTMLElement>('.selector-counter') : null;
	attachAutocomplete(input, {
		minLength: 2,
		source: async term => {
			if (counter) counter.innerHTML = SPINNER;
			const res = await fetch('./?InputfieldSelector=autocomplete&field=' + encodeURIComponent(field) + '&name=' + encodeURIComponent(name) + '&q=' + encodeURIComponent(term),
				{ credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
			const data = await res.json() as { items: Array<{ label: string; value: string }> };
			if (counter) counter.innerHTML = '';
			return (data.items || []).map(i => ({ label: i.label, value: String(i.value) }));
		},
		select: item => {
			const value = input.parentElement ? input.parentElement.querySelector<HTMLInputElement>(':scope > .input-value') : null;
			if (value) {
				value.value = item.value;
				value.setAttribute('data-label', item.label);
			}
			input.value = item.label;
			input.blur();
			if (value) changeAny(value);
		},
	});
	input.addEventListener('focus', () => {
		const value = input.parentElement ? input.parentElement.querySelector<HTMLInputElement>(':scope > .input-value') : null;
		if (value) value.value = '';
		input.value = '';
		changeAny(input);
	});
}

async function changeField(select: HTMLSelectElement): Promise<void> {
	let field = select.value;
	if (!field) return;
	if (field === 'toggle-names-labels') {
		toggleNamesLabels(select);
		return;
	}
	const row = select.closest<HTMLElement>('.selector-row');
	const root = fieldOf(select);
	if (!row || !root) return;
	let action = 'opval';
	const opval = row.querySelector<HTMLElement>(':scope > .opval');
	if (opval) opval.innerHTML = '';
	select.setAttribute('data-selected', field);
	const hidden = root.querySelector<HTMLInputElement>('.selector-value');
	const name = hidden ? hidden.name : '';
	let type = select.getAttribute('data-type') || '';
	if (/\.$/.test(field)) {
		action = 'subfield-opval';
		field = field.indexOf('@') > -1 ? field.substring(1, field.length - 1) : field.substring(0, field.length - 1);
		row.classList.add('has-subfield');
	} else if (/\.id$/.test(field)) {
		field = 'id';
		type = 'selector';
	} else if (select.classList.contains('select-field')) {
		const sub = row.querySelector(':scope > .subfield');
		if (sub) sub.innerHTML = '';
		row.classList.remove('has-subfield');
	}
	const spinner = document.createElement('span');
	spinner.innerHTML = SPINNER;
	row.appendChild(spinner);
	const res = await fetch('./?InputfieldSelector=' + action + '&field=' + encodeURIComponent(field) + '&type=' + encodeURIComponent(type) + '&name=' + encodeURIComponent(name),
		{ credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
	const data = await res.text();
	spinner.remove();
	const fill = (target: Element | null, html: string): void => {
		if (!target) return;
		target.innerHTML = html;
		target.querySelectorAll<HTMLElement>(':scope > :not(.input-or)').forEach(fadeIn);
	};
	if (action === 'subfield-opval') {
		const parts = data.split('<split>');
		fill(row.querySelector(':scope > .subfield'), parts[0] || '');
		fill(opval, parts[1] || '');
	} else {
		fill(opval, data);
	}
	if (opval) {
		changeAny(select);
		const ac = opval.querySelector<HTMLInputElement>('.input-value-autocomplete');
		if (ac) setupAutocomplete(ac, field, name);
		initWidgets(opval); // date pickers and other value widgets
	}
}

function changeAny(item: Element): void {
	const root = fieldOf(item);
	if (!root) return;
	const hidden = root.querySelector<HTMLInputElement>('.selector-value');
	if (!hidden) return;
	type Part = { not: boolean; field: string; operator: string; value: string; mayOrValue: boolean; mayOrField: boolean;
		useOrValue: boolean; useOrField: boolean; isOrGroup: boolean; checkbox: HTMLInputElement | null } | null;
	const parts: Part[] = [];
	let test = '';
	let showOrNotes = false;
	const templateIDs = (hidden.getAttribute('data-template-ids') || '').split(',').filter(Boolean);
	const selects = Array.from(root.querySelectorAll<HTMLSelectElement>('.selector-row select.select-field'));
	selects.forEach(select => {
		const row = select.parentElement as HTMLElement;
		let fieldName = select.value;
		if (!fieldName) return;
		if (fieldName === 'template') {
			const tid = parseInt((row.querySelector<HTMLInputElement>('.input-value') || { value: '' }).value, 10);
			if (tid > 0) templateIDs.push(String(tid));
		}
		if (row.classList.contains('has-subfield')) {
			const sub = row.querySelector<HTMLSelectElement>('.select-subfield');
			const subfield = sub ? sub.value : '';
			if (subfield) {
				const selOpt = sub ? sub.selectedOptions[0] : null;
				if (subfield.indexOf('.') > 0) fieldName = fieldName.indexOf('@') > -1 ? '@' + subfield : subfield;
				else if (selOpt && selOpt.classList.contains('select-subfield-default')) fieldName = subfield;
				else fieldName += subfield;
				if (fieldName.indexOf('.data') > 0) fieldName = fieldName.replace(/\.data$/, '');
			}
		}
		const opSel = row.querySelector<HTMLSelectElement>('.opval > .select-operator');
		let op = opSel ? opSel.value : '';
		const valueEl = opSel ? opSel.nextElementSibling as HTMLInputElement | null : null;
		let value = valueEl && valueEl.classList.contains('input-value') ? valueEl.value : '';
		let prefix = '';
		if (op && op.indexOf('"') > -1) {
			value = ' ';
			if (valueEl) valueEl.disabled = true;
		} else if (valueEl && valueEl.disabled) {
			valueEl.disabled = false;
		}
		if (op && op.indexOf('!') === 0 && op !== '!=' && op !== '!=""') {
			prefix = '!';
			op = op.substring(1);
		}
		if (value) {
			if (valueEl && valueEl.classList.contains('input-value-subselect') && valueHasOperator(value)) {
				value = '[' + value + ']';
			} else if (fieldName !== '_custom' && op.indexOf('"') < 0) {
				if (value.indexOf('"') > -1) value = value.indexOf("'") === -1 ? "'" + value + "'" : '"' + value.replace(/"/g, '') + '"';
				else if (!/^[-_a-zA-Z0-9]*$/.test(value)) value = '"' + value + '"';
			}
		}
		const mayOrValue = !!value && test.indexOf(',' + prefix + fieldName + '~' + op + '~') > -1;
		const mayOrField = !!value && test.indexOf('~' + op + '~' + value + ',') > -1;
		const checkbox = row.querySelector<HTMLInputElement>('.input-or');
		const useOrValue = mayOrValue && !!checkbox && checkbox.checked;
		const useOrField = mayOrField && !!checkbox && checkbox.checked;
		const disable = (sel: string, on: boolean) => row.querySelectorAll<HTMLInputElement | HTMLSelectElement>(sel).forEach(x => { x.disabled = on; });
		if (useOrValue) {
			row.classList.add('has-or-value');
			disable('.select-field, .select-operator, .select-subfield', true);
		} else if (row.classList.contains('has-or-value')) {
			row.classList.remove('has-or-value');
			disable('.select-field, .select-operator, .select-subfield', false);
		}
		if (useOrField) {
			row.classList.add('has-or-field');
			disable('.input-value, .select-operator', true);
		} else if (row.classList.contains('has-or-field')) {
			row.classList.remove('has-or-field');
			disable('.input-value, .select-operator', false);
		}
		parts.push({ not: prefix === '!', field: fieldName, operator: op, value, mayOrValue, mayOrField, useOrValue, useOrField,
			isOrGroup: (useOrField || useOrValue) && fieldName === '_custom', checkbox });
		if (mayOrField || mayOrValue) showOrNotes = true;
		test += ',' + prefix + fieldName + '~' + op + '~' + value + ',';
	});

	if (templateIDs.length) {
		selects.forEach(select => {
			let disabled = 0;
			select.querySelectorAll('option').forEach(option => {
				const templates = option.getAttribute('data-templates');
				if (templates === null || templates === '*') return;
				const found = templateIDs.some(id => templates.indexOf('|' + id + '|') > -1);
				if (found) setOption(option, true);
				else {
					if (!option.selected) setOption(option, false);
					disabled++;
				}
			});
			if (disabled && !(select.parentElement as HTMLElement).classList.contains('selector-template-row')) {
				select.querySelectorAll<HTMLOptionElement>('option:disabled').forEach(o => { o.hidden = true; });
			}
		});
	}

	let selector = '';
	for (let n = 0; n < parts.length; n++) {
		const s = parts[n];
		if (!s) continue;
		if (!s.value.length && !hidden.classList.contains('allow-blank')) continue;
		if (selector.length) selector += ', ';
		for (let i = 0; i < parts.length; i++) {
			const si = parts[i];
			if (i === n || !si) continue;
			if (si.field === '_custom' && si.isOrGroup) {
				s.isOrGroup = true;
			} else if (si.mayOrField && si.value === s.value && si.operator === s.operator) {
				if (si.checkbox) si.checkbox.style.display = '';
				if (si.useOrField) { s.field += '|' + si.field; parts[i] = null; }
			} else if (si.mayOrValue && si.field === s.field && si.operator === s.operator) {
				if (si.checkbox) si.checkbox.style.display = '';
				if (si.useOrValue) { s.value += '|' + si.value; parts[i] = null; }
			} else if (!si.mayOrValue && !si.mayOrField && si.checkbox) {
				si.checkbox.style.display = 'none';
			}
		}
		if (s.field.indexOf('.') !== s.field.lastIndexOf('.') && s.field.indexOf('|') < 0) s.field = s.field.substring(0, s.field.lastIndexOf('.'));
		if (s.field === '_custom') {
			selector += s.isOrGroup ? s.field + '=(' + s.value.replace('(', '').replace(')', '').trim() + ')' : s.field + '="' + s.value.trim() + '"';
		} else {
			selector += (s.not ? '!' : '') + s.field + s.operator + s.value.trim();
		}
	}

	const content = item.closest('.InputfieldContent') || root;
	const preview = content.querySelector<HTMLElement>('.selector-preview');
	let init = preview ? preview.getAttribute('data-init-value') || '' : '';
	if (init) init += ', ';
	if (selector.length && selector !== lastSelector && preview) {
		if (!preview.classList.contains('selector-preview-disabled')) {
			preview.innerHTML = '<code>' + entities(init + selector) + '</code>';
			fadeIn(preview);
		}
		const counter = preview.parentElement ? preview.parentElement.querySelector<HTMLElement>(':scope > .selector-counter') : null;
		if (counter && !counter.classList.contains('selector-counter-disabled')) {
			counter.innerHTML = SPINNER;
			lastSelector = selector;
			const body = new URLSearchParams({ selector });
			void fetch('./?InputfieldSelector=test&name=' + encodeURIComponent(hidden.name), {
				method: 'POST', body, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' },
			}).then(r => r.text()).then(html => { counter.innerHTML = html; });
		}
	}
	if (hidden.value !== selector) {
		hidden.value = selector;
		if (!selector.length && preview) {
			hide(preview);
			const counter = preview.parentElement ? preview.parentElement.querySelector<HTMLElement>(':scope > .selector-counter') : null;
			if (counter) counter.innerHTML = '';
		}
		hidden.dispatchEvent(new Event('change', { bubbles: true }));
	}
	lastSelector = selector;
	const notes = root.querySelector<HTMLElement>('.or-notes');
	if (notes) notes.style.display = showOrNotes ? '' : 'none';
}

function setupEvents(): void {
	if (ready) return;
	ready = true;
	document.addEventListener('change', e => {
		const t = e.target as HTMLElement;
		if (!t || !t.closest || !fieldOf(t)) return;
		if (t.matches('select.select-field, select.select-subfield')) void changeField(t as HTMLSelectElement);
		else if (t.matches('input, select, textarea') && !t.matches('.input-value-autocomplete, .selector-value')) changeAny(t);
	});
	let timer = 0;
	document.addEventListener('keyup', e => {
		const t = e.target as HTMLInputElement;
		if (!t || !t.matches || !t.matches('.InputfieldSelector input.input-value')) return;
		window.clearTimeout(timer);
		if (t.classList.contains('input-value-subselect') && valueHasOperator(t.value)) {
			const preview = (t.closest('.InputfieldContent') || document).querySelector<HTMLElement>('.selector-preview');
			if (preview) preview.innerHTML = 'Subselect detected: when done <a href="#" onclick="return false">click here to commit your change</a>.';
			return;
		}
		timer = window.setTimeout(() => changeAny(t), 100);
	});
	document.addEventListener('click', e => {
		const t = e.target as HTMLElement;
		if (!t || !t.closest) return;
		const add = t.closest('.InputfieldSelector .selector-add');
		if (add) {
			e.preventDefault();
			addRow(add);
			return;
		}
		const del = t.closest('.InputfieldSelector a.delete-row');
		if (del) {
			e.preventDefault();
			deleteRow(del);
		}
	});
}

export function init(root: HTMLElement): void {
	if (root.hasAttribute('data-pw-selector')) return;
	root.setAttribute('data-pw-selector', '');
	setupEvents();
	root.querySelectorAll<HTMLElement>('.selector-preview').forEach(hide);
	const hidden = root.querySelector<HTMLInputElement>('input.selector-value');
	const name = hidden ? hidden.name : '';
	root.querySelectorAll<HTMLElement>('.selector-row').forEach(row => {
		const ac = row.querySelector<HTMLInputElement>('.input-value-autocomplete');
		if (!ac) return;
		const sub = row.querySelector<HTMLSelectElement>('.select-subfield');
		const field = sub ? sub.value : (row.querySelector<HTMLSelectElement>('.select-field') || { value: '' }).value;
		setupAutocomplete(ac, field, name);
	});
	if (!root.querySelector('.selector-preview-disabled')) {
		const first = root.querySelector('.input-value');
		if (first) changeAny(first);
	}
}

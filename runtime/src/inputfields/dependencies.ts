/**
 * showIf / requiredIf dependencies on upstream markup, without jQuery.
 *
 * Contract (upstream InputfieldWrapper + inputfields.js, re-implemented from its documented
 * behaviour, not copied):
 *   li.Inputfield[data-show-if="selector"], li.Inputfield[data-required-if="selector"]
 *   selector: conditions joined by "," (all must match)
 *   condition: field(|field2)(.subfield) operator value(|value2)
 *   operator: = != < > <= >= %= *=   (%= and *= are "contains")
 *   field resolves to #Inputfield_<field>, then #<field>, then a checkbox/radio group named
 *   <field> or <field>[] (checked values). ".count" compares the number of values.
 *   Values: numeric strings compare as numbers; quotes are stripped.
 *   "!=" must hold against every value of a multi-value field.
 *
 * Classes written: InputfieldStateHidden (hide), InputfieldStateRequired + input.required.
 * Event dispatched on the li: 'showIf' (detail: { visible: boolean }) when visibility changes.
 */

import { legacyLoaded } from '../legacy';

type Operator = '=' | '!=' | '<' | '>' | '<=' | '>=' | '%=' | '*=';

interface Condition {
	fields: string[];
	subfield: string;
	operator: Operator;
	values: Array<string | number>;
}

interface Rule {
	type: 'show' | 'required';
	target: HTMLElement;
	conditions: Condition[];
}

const CONDITION = /^\s*([-_.|a-zA-Z0-9]+)(=|!=|<=|>=|<|>|%=|\*=)(.+?)\s*$/;

function trimQuotes(value: string): string {
	const v = value.trim();
	if (v.length >= 2) {
		const first = v[0];
		const last = v[v.length - 1];
		if ((first === '"' || first === "'") && first === last) return v.slice(1, -1);
	}
	return v;
}

function parseValue(raw: string): string | number {
	const str = raw.trim();
	if (str === '') return '';
	if (/^-?\d+$/.test(str)) return parseInt(str, 10);
	if (/^-?\d*\.\d+$/.test(str)) return parseFloat(str);
	return str;
}

export function parseSelector(selector: string): Condition[] {
	const conditions: Condition[] = [];
	for (const part of selector.split(',')) {
		const m = part.match(CONDITION);
		if (!m) continue;
		let field = m[1];
		if (field.startsWith('forpage_repeater')) field = field.replace(/forpage_repeater\d+\./g, '');
		else if (field.startsWith('forpage.')) field = field.replace('forpage.', '').replace(/_repeater\d+/g, '');
		const fields = field.split('|').map(f => f.split('.')[0]);
		const dot = field.indexOf('.');
		const subfield = dot > 0 ? field.slice(dot + 1).split('|')[0] : '';
		const values = m[3].split('|').map(v => parseValue(trimQuotes(v)));
		conditions.push({ fields, subfield, operator: m[2] as Operator, values });
	}
	return conditions;
}

/**
 * Current value(s) of a source field by name, in the scope of a form
 */
function readValues(name: string, scope: ParentNode): Array<string | number> | null {
	const byId =
		(scope.querySelector(`#Inputfield_${cssEscape(name)}`) as HTMLElement | null) ||
		(scope.querySelector(`#${cssEscape(name)}`) as HTMLElement | null);
	if (byId) {
		if (byId instanceof HTMLInputElement && (byId.type === 'checkbox' || byId.type === 'radio')) {
			return byId.checked ? [parseValue(byId.value)] : ['', 0];
		}
		if (byId instanceof HTMLSelectElement) {
			return Array.from(byId.selectedOptions).map(o => parseValue(o.value));
		}
		if (byId instanceof HTMLInputElement || byId instanceof HTMLTextAreaElement) {
			const v = byId.value;
			if (byId.closest('.InputfieldPage') && /^[,0-9]+$/.test(v) && v.includes(',')) {
				return v.split(',').map(parseValue);
			}
			return [parseValue(v)];
		}
	}
	// checkbox / radio groups: inputs named "name" or "name[]"
	const group = scope.querySelectorAll<HTMLInputElement>(
		`input[name="${cssEscape(name)}"], input[name="${cssEscape(name)}[]"]`,
	);
	if (group.length) {
		const checked = Array.from(group).filter(i => i.checked).map(i => parseValue(i.value));
		return checked.length ? checked : ['', 0];
	}
	return null;
}

function cssEscape(s: string): string {
	return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&');
}

function matchValue(operator: Operator, value: string | number, wanted: string | number): boolean {
	if (operator === '=' || operator === '!=') {
		const eq = String(value) === String(wanted) || (typeof value === 'number' && typeof wanted === 'number' && value === wanted);
		return operator === '=' ? eq : !eq;
	}
	switch (operator) {
		case '<': return value < wanted;
		case '>': return value > wanted;
		case '<=': return value <= wanted;
		case '>=': return value >= wanted;
		case '%=':
		case '*=': return String(value).indexOf(String(wanted)) > -1;
	}
	return false;
}

function conditionMatches(c: Condition, scope: ParentNode): boolean {
	for (const field of c.fields) {
		let values = readValues(field, scope);
		if (values === null) continue;
		if (c.subfield === 'count') values = [values.filter(v => v !== '' && v !== 0).length];
		const required = c.operator === '!=' ? values.length * c.values.length : 1;
		let matched = 0;
		for (const v of values) {
			for (const w of c.values) {
				if (matchValue(c.operator, v, w)) matched++;
			}
		}
		if (matched >= required) return true;
	}
	return false;
}

// parsed selectors per field and attribute, parsed again only when the attribute changes (audit P1:
// every keystroke parsed every rule of the form)
const parsed = { show: new WeakMap<HTMLElement, { src: string; conditions: Condition[] }>(), required: new WeakMap<HTMLElement, { src: string; conditions: Condition[] }>() };

function conditionsOf(li: HTMLElement, type: 'show' | 'required', src: string): Condition[] {
	const cached = parsed[type].get(li);
	if (cached && cached.src === src) return cached.conditions;
	const conditions = parseSelector(src);
	parsed[type].set(li, { src, conditions });
	return conditions;
}

function collectRules(root: ParentNode): Rule[] {
	const rules: Rule[] = [];
	root.querySelectorAll<HTMLElement>('.Inputfield[data-show-if], .Inputfield[data-required-if]').forEach(li => {
		if (li.closest('.InputfieldFormNoDependencies')) return;
		const show = li.getAttribute('data-show-if');
		const req = li.getAttribute('data-required-if');
		if (show) rules.push({ type: 'show', target: li, conditions: conditionsOf(li, 'show', show) });
		if (req) rules.push({ type: 'required', target: li, conditions: conditionsOf(li, 'required', req) });
	});
	return rules;
}

/** The names a condition may know a changed control by (readValues() looks them up the same ways) */
function sourceNames(el: HTMLElement): string[] {
	const names: string[] = [];
	const name = el.getAttribute('name');
	if (name) names.push(name.replace(/\[\]$/, ''));
	if (el.id) names.push(el.id, el.id.replace(/^Inputfield_/, ''));
	return names;
}

function scopeOf(li: HTMLElement): ParentNode {
	return li.closest('form') || li.closest('.InputfieldForm') || document;
}

export function isHidden(li: HTMLElement): boolean {
	return li.classList.contains('InputfieldStateHidden');
}

function setVisible(li: HTMLElement, visible: boolean): boolean {
	if (visible === !isHidden(li)) return false;
	li.classList.toggle('InputfieldStateHidden', !visible);
	li.dispatchEvent(new CustomEvent('showIf', { bubbles: true, detail: { visible } }));
	return true;
}

function setRequired(li: HTMLElement, required: boolean): void {
	li.classList.toggle('InputfieldStateRequired', required);
	li.querySelectorAll<HTMLInputElement>('input:not([type=hidden]), select, textarea').forEach(el => {
		el.classList.toggle('required', required);
	});
}

/**
 * Evaluate every rule under root. Returns true when some visibility changed.
 */
export function evaluate(root: ParentNode, only?: string[]): boolean {
	let changed = false;
	let rules = collectRules(root);
	if (only && only.length) {
		// the fields whose rules name a changed control, each with all its rules (required depends
		// on the field's own visibility)
		const targets = new Set(rules.filter(r => r.conditions.some(c => c.fields.some(f => only.indexOf(f) > -1))).map(r => r.target));
		rules = rules.filter(r => targets.has(r.target));
	}
	for (const rule of rules) {
		const scope = scopeOf(rule.target);
		const ok = rule.conditions.every(c => conditionMatches(c, scope));
		if (rule.type === 'show') {
			if (setVisible(rule.target, ok)) changed = true;
		} else {
			setRequired(rule.target, ok && !isHidden(rule.target));
		}
	}
	return changed;
}

export function initDependencies(root: ParentNode, onChange?: () => void): void {
	if (evaluate(root) && onChange) onChange();
}

export function setupDependencyEvents(onChange?: () => void): void {
	const handler = (e: Event) => {
		if (legacyLoaded()) return;
		const el = e.target as HTMLElement;
		if (!el || el.nodeType !== 1) return;
		const form = el.closest('form, .InputfieldForm') || document;
		// a control names its field; an event from anything else (a widget's wrapper) checks all rules
		const names = el.matches('input, select, textarea') ? sourceNames(el) : [];
		if (evaluate(form, names.length ? names : undefined) && onChange) onChange();
	};
	document.addEventListener('change', handler);
	document.addEventListener('input', handler);
}

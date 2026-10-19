/**
 * Form behaviours of upstream inputfields.js, without jQuery (Phase 2, ADR 0015). Same DOM
 * contract and classes, so legacy code and the theme read the same state:
 *
 * - change tracking: a `change` or `input` on a control inside .InputfieldForm adds
 *   InputfieldStateChanged to its .Inputfield (not inside .InputfieldIgnoreChanges); `change`
 *   also dispatches a bubbling 'changed' event on the Inputfield, as upstream triggers it.
 * - leave warning: a form with .InputfieldFormConfirm that holds a changed Inputfield asks
 *   before the page unloads, unless it is being submitted (.InputfieldFormSubmitted).
 * - Enter guard: in a form with two or more submit buttons, Enter in a field does not submit;
 *   the nearest visible submit button gets the focus instead (upstream InputfieldIntentions).
 * - invalid fields: when the browser reports a control invalid, its collapsed Inputfields and
 *   its <pw-tabs> panel open and it gets the focus (upstream InputfieldRequirements).
 *
 * Every handler checks legacyLoaded() at event time: once the legacy stack is on the page,
 * upstream owns these behaviours.
 */

import { legacyLoaded } from '../legacy';
import { open as openInputfield, isCollapsed } from './collapse';

const CONTROL = 'input, select, textarea';
// focusing one of these must not arm the Enter guard: they are buttons, not text entry
const NOT_ENTRY = new Set(['submit', 'button', 'image', 'reset', 'hidden', 'checkbox', 'radio', 'file']);

let ready = false;
// the field that armed the Enter guard in its form (the guard is per form, like upstream's class)
const armedBy = new WeakMap<HTMLFormElement, HTMLElement>();

function inputfieldOf(control: Element): HTMLElement | null {
	if (!control.closest('.InputfieldForm')) return null;
	if (control.closest('.InputfieldIgnoreChanges')) return null;
	return control.closest<HTMLElement>('.Inputfield');
}

function markChanged(e: Event, dispatch: boolean): void {
	if (legacyLoaded()) return;
	const target = e.target as Element;
	if (!target || !target.matches || !target.matches(CONTROL)) return;
	const li = inputfieldOf(target);
	if (!li) return;
	li.classList.add('InputfieldStateChanged');
	if (dispatch) li.dispatchEvent(new CustomEvent('changed', { bubbles: true }));
}

function hasUnsavedChanges(): HTMLFormElement | null {
	const forms = document.querySelectorAll<HTMLFormElement>('form.InputfieldFormConfirm:not(.InputfieldFormSubmitted)');
	for (const form of Array.from(forms)) {
		if (form.querySelector('.InputfieldStateChanged')) return form;
	}
	return null;
}

function submitButtons(root: ParentNode): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>('button[type=submit], input[type=submit]'));
}

function isVisible(el: HTMLElement): boolean {
	return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

/** Nearest visible submit button, walking out from the field through enclosing .Inputfields */
function nearestButton(field: HTMLElement, form: HTMLFormElement): HTMLElement | null {
	let scope: Element | null = field.closest('.Inputfields');
	while (scope) {
		const button = submitButtons(scope).find(isVisible);
		if (button) return button;
		scope = scope.parentElement ? scope.parentElement.closest('.Inputfields') : null;
	}
	return submitButtons(form).find(isVisible) || null;
}

/** Open everything that hides a control: collapsed Inputfields (outermost first) and its tab */
function reveal(control: HTMLElement): void {
	const collapsed: HTMLElement[] = [];
	for (let li = control.closest<HTMLElement>('.Inputfield'); li; li = li.parentElement ? li.parentElement.closest<HTMLElement>('.Inputfield') : null) {
		if (isCollapsed(li)) collapsed.unshift(li);
	}
	collapsed.forEach(li => openInputfield(li));
	const panel = control.closest<HTMLElement>('pw-tabs > section[id]');
	const tabs = panel ? panel.parentElement as (HTMLElement & { activate?: (id: string, push: boolean) => void }) : null;
	if (tabs && panel && typeof tabs.activate === 'function') tabs.activate(panel.id, false);
}

export function setupFormEvents(): void {
	if (ready) return;
	ready = true;

	document.addEventListener('change', e => markChanged(e, true));
	document.addEventListener('input', e => markChanged(e, false));

	window.addEventListener('beforeunload', e => {
		if (legacyLoaded()) return;
		const form = hasUnsavedChanges();
		if (!form) return;
		e.preventDefault();
		// older browsers show (or at least need) a returnValue; the text itself is ignored today
		(e as BeforeUnloadEvent).returnValue = form.getAttribute('data-confirm') || 'unsaved';
	});

	// Enter guard: arm on focus of a text-entry control in a multi-button form, disarm on blur
	document.addEventListener('focusin', e => {
		if (legacyLoaded()) return;
		const field = e.target as HTMLElement;
		if (!field || !field.matches || !field.matches('input, select')) return;
		if (field instanceof HTMLInputElement && NOT_ENTRY.has(field.type)) return;
		const form = field.closest<HTMLFormElement>('form.InputfieldForm');
		if (!form || submitButtons(form).length < 2) return;
		armedBy.set(form, field);
	});
	document.addEventListener('focusout', e => {
		const form = (e.target as Element)?.closest?.<HTMLFormElement>('form.InputfieldForm');
		if (form && armedBy.get(form) === e.target) armedBy.delete(form);
	});

	document.addEventListener('submit', e => {
		if (legacyLoaded()) return;
		const form = e.target as HTMLFormElement;
		if (!form || !form.classList || !form.classList.contains('InputfieldForm')) return;
		const field = armedBy.get(form);
		if (field && document.activeElement === field) {
			e.preventDefault();
			e.stopImmediatePropagation();
			const button = nearestButton(field, form);
			if (button) {
				button.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
				button.focus();
			}
			return;
		}
		if (form.classList.contains('InputfieldFormConfirm')) form.classList.add('InputfieldFormSubmitted');
	}, true);

	// invalid controls: 'invalid' does not bubble, so listen in the capture phase
	document.addEventListener('invalid', e => {
		if (legacyLoaded()) return;
		const control = e.target as HTMLElement;
		if (!control || !control.closest || !control.closest('.InputfieldForm')) return;
		reveal(control);
		window.setTimeout(() => { try { control.focus(); } catch (err) { /* not focusable */ } }, 0);
	}, true);
}

/**
 * Announce a value that code changed (docs/contract.md: a bubbling `change` after programmatic
 * value changes), so change tracking, the leave warning and showIf/requiredIf see it as they see
 * the user's own edits. `input` where a `change` would mean "the user chose this" to a listener
 * (the page name's "keep my own name" flag).
 */
export function changed(el: Element | null | undefined, type: 'change' | 'input' = 'change'): void {
	if (el) el.dispatchEvent(new Event(type, { bubbles: true }));
}

/** Set a form control's value and announce it, only when it differs */
export function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null | undefined, value: string): void {
	if (!el || el.value === value) return;
	el.value = value;
	changed(el);
}

/**
 * An icon or span that acts on a click becomes a keyboard button (audit R7): focusable, named, and
 * Enter or Space clicks it, so the handlers bound to its click run unchanged. One delegated
 * listener for all of them.
 */

let listening = false;

export function keyButton(el: HTMLElement, name?: string): void {
	if (el.hasAttribute('data-pw-keybutton')) return;
	el.setAttribute('data-pw-keybutton', '');
	if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
	el.setAttribute('role', 'button');
	if (name && !el.getAttribute('aria-label')) el.setAttribute('aria-label', name);
	if (listening) return;
	listening = true;
	document.addEventListener('keydown', e => {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		const t = e.target as HTMLElement | null;
		if (!t || !t.matches || !t.matches('[data-pw-keybutton]')) return;
		e.preventDefault();
		t.click();
	});
}

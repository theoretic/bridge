/**
 * Collapse / expand of Inputfields on upstream markup, without jQuery.
 *
 * Markup contract (upstream InputfieldWrapper):
 *   li.Inputfield[.InputfieldStateCollapsed][.collapsedN] > label.InputfieldHeader > i.toggle-icon[data-to]
 *   li.Inputfield > div.InputfieldContent
 *   AJAX-collapsed fields hold div.renderInputfieldAjax > input[type=hidden][value=url] inside the content.
 *
 * Classes written: InputfieldStateToggle (on headers that toggle), InputfieldStateCollapsed,
 * InputfieldStateWasCollapsed, InputfieldAjaxLoading. Events dispatched on the li (bubbling):
 * 'opened', 'closed', 'reloaded' (detail: { source: 'InputfieldAjaxLoad' }).
 *
 * collapsed9 = "never collapse" (no toggle). Everything else toggles on header click.
 */

import { legacyLoaded } from '../legacy';
import { runScripts } from '../util/scripts';
import { label } from '../util/labels';
import { failed } from '../util/fail';

const HEADER = '.InputfieldHeader, .ui-widget-header';

export function initCollapse(root: ParentNode): void {
	const items = root.querySelectorAll<HTMLElement>('.Inputfield');
	items.forEach(li => {
		if (li.classList.contains('collapsed9')) return;
		const header = childHeader(li);
		if (!header) return;
		header.classList.add('InputfieldStateToggle');
		// the header is a <label> (it names the field's input): the toggle icon takes the keyboard
		// instead, as a button (audit R7)
		const icon = header.querySelector<HTMLElement>('i.toggle-icon');
		if (icon && !icon.hasAttribute('tabindex')) {
			icon.tabIndex = 0;
			icon.setAttribute('role', 'button');
			icon.setAttribute('aria-label', label('toggle', 'Open or close'));
		}
		if (li.classList.contains('InputfieldStateCollapsed')) syncIcon(li, true);
		else if (icon && icon.getAttribute('role') === 'button') icon.setAttribute('aria-expanded', 'true');
	});
}

function childHeader(li: HTMLElement): HTMLElement | null {
	for (const child of Array.from(li.children)) {
		if (child.matches(HEADER)) return child as HTMLElement;
	}
	return null;
}

function syncIcon(li: HTMLElement, collapsed: boolean): void {
	const header = childHeader(li);
	const icon = header?.querySelector<HTMLElement>('i.toggle-icon');
	if (!icon) return;
	if (icon.getAttribute('role') === 'button') icon.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
	const to = (icon.getAttribute('data-to') || '').split(/\s+/).filter(Boolean);
	if (to.length !== 2) return;
	// data-to lists "open-class closed-class"; upstream toggles both. Normalise instead.
	icon.classList.remove(to[0], to[1]);
	icon.classList.add(collapsed ? to[1] : to[0]);
}

export function isCollapsed(li: HTMLElement): boolean {
	return li.classList.contains('InputfieldStateCollapsed');
}

export function open(li: HTMLElement): void {
	if (!isCollapsed(li)) return;
	const ajax = ajaxPlaceholder(li);
	if (ajax) {
		void loadAjax(li, ajax);
		return;
	}
	li.classList.remove('InputfieldStateCollapsed');
	li.classList.add('InputfieldStateWasCollapsed');
	syncIcon(li, false);
	li.dispatchEvent(new CustomEvent('opened', { bubbles: true }));
}

export function close(li: HTMLElement): void {
	if (isCollapsed(li)) return;
	if (li.classList.contains('collapsed9')) return;
	li.classList.add('InputfieldStateCollapsed');
	li.classList.remove('InputfieldStateWasCollapsed');
	syncIcon(li, true);
	li.dispatchEvent(new CustomEvent('closed', { bubbles: true }));
}

export function toggle(li: HTMLElement): void {
	if (isCollapsed(li)) open(li);
	else close(li);
}

function ajaxPlaceholder(li: HTMLElement): HTMLElement | null {
	for (const child of Array.from(li.children)) {
		if (child.classList.contains('InputfieldContent')) {
			const p = child.querySelector<HTMLElement>(':scope > .renderInputfieldAjax');
			if (p) return p;
		}
		if (child.classList.contains('renderInputfieldAjax')) return child as HTMLElement;
	}
	return null;
}

async function loadAjax(li: HTMLElement, placeholder: HTMLElement): Promise<void> {
	const urlInput = placeholder.querySelector<HTMLInputElement>(':scope > input');
	const url = urlInput?.value || '';
	if (!url) return;
	if (li.classList.contains('InputfieldAjaxLoading')) return;
	li.classList.remove('collapsed10', 'collapsed11');
	li.classList.add('InputfieldAjaxLoading');
	// a spinner in the header while it loads, as upstream shows (audit U10)
	const spinner = document.createElement('i');
	spinner.className = 'fa fa-fw fa-spin fa-spinner InputfieldAjaxSpinner';
	spinner.setAttribute('aria-hidden', 'true');
	const header = childHeader(li);
	if (header) header.appendChild(spinner);
	try {
		const res = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
		const html = await res.text();
		// an error (a status, or admin.php's JSON message) is never put in the field, as upstream's
		// $.get(..., 'html') success callback never sees one
		if (!res.ok || html.trim().indexOf('{') === 0) throw new Error('HTTP ' + res.status + ' ' + html.trim().slice(0, 200));
		const tpl = document.createElement('template');
		tpl.innerHTML = html;
		li.classList.remove('InputfieldAjaxLoading', 'InputfieldStateCollapsed');
		li.classList.add('InputfieldStateWasCollapsed');
		syncIcon(li, false);
		const scripts = Array.from(tpl.content.querySelectorAll('script'));
		placeholder.replaceWith(tpl.content);
		// inline scripts run, as with upstream's jQuery html(); content that needs the legacy stack
		// (marked by the theme) runs them once the stack is there
		// a legacy field's content: the theme's observer loads the stack and announces it
		// (upstream's 'reloaded', once); here that would be a second one (audit B3)
		const legacy = li.matches('[data-bridge-legacy]') || !!li.querySelector('[data-bridge-legacy]');
		if (scripts.length) await runScripts(scripts, { legacy });
		if (!legacy) li.dispatchEvent(new CustomEvent('reloaded', { bubbles: true, detail: { source: 'InputfieldAjaxLoad' } }));
		li.dispatchEvent(new CustomEvent('opened', { bubbles: true }));
	} catch (err) {
		li.classList.remove('InputfieldAjaxLoading');
		failed('ajax load of ' + url, err);
	} finally {
		spinner.remove();
	}
}

/**
 * Delegated header click. Ignores clicks on controls inside the header and steps aside when
 * the legacy stack owns the page.
 */
export function setupCollapseEvents(): void {
	document.addEventListener('click', e => {
		if (legacyLoaded()) return;
		const target = e.target as HTMLElement;
		// controls inside the header have their own job (the language tabs toggle shows all languages)
		if (target.closest('a, button, input, select, textarea, .InputfieldHeaderAction, .langTabsToggle')) return;
		const header = target.closest<HTMLElement>('.InputfieldStateToggle');
		if (!header) return;
		const li = header.parentElement;
		if (!li || !li.classList.contains('Inputfield')) return;
		e.preventDefault();
		toggle(li);
	});
	document.addEventListener('keydown', e => {
		if (legacyLoaded() || (e.key !== 'Enter' && e.key !== ' ')) return;
		const icon = (e.target as HTMLElement).closest<HTMLElement>('.InputfieldStateToggle > i.toggle-icon[role=button], .InputfieldStateToggle i.toggle-icon[role=button]');
		const li = icon ? icon.closest<HTMLElement>('.InputfieldStateToggle')?.parentElement : null;
		if (!li || !li.classList.contains('Inputfield')) return;
		e.preventDefault();
		toggle(li);
	});
	// a WireTab whose content is AJAX-collapsed loads when its tab opens (upstream inputfields.js
	// does this on 'wiretabclick'; the native WireTabs, scripts/wire-tabs.js, sends this event)
	document.addEventListener('pw-wiretabs-change', e => {
		if (legacyLoaded()) return;
		const tab = (e as CustomEvent<{ tab: HTMLElement | null }>).detail.tab;
		if (tab && tab.classList.contains('collapsed10')) open(tab);
	});
}

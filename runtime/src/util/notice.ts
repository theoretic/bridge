/**
 * A warning in the theme's notice band from the client side (component import failures, audit B24;
 * failed requests, R4); a chunk of its own, loaded only when there is something to say. Announced
 * to assistive technology (role=status) and closable with the band's own close link (audit U9).
 */

import { label } from './labels';

const noticed = new Set<string>();
export function notice(text: string): void {
	if (noticed.has(text) || !document.body) return;
	noticed.add(text);
	// the markup core's AdminThemeFramework::renderNotices() prints (in the theme's place for it)
	let list = document.querySelector<HTMLElement>('#notices');
	if (!list) {
		list = document.createElement('ul');
		list.id = 'notices';
		list.className = 'pw-notices';
		const masthead = document.getElementById('pw-masthead');
		if (masthead) masthead.after(list);
		else document.body.prepend(list);
	}
	if (!list.hasAttribute('role')) {
		list.setAttribute('role', 'status');
		list.setAttribute('aria-live', 'polite');
	}
	const li = document.createElement('li');
	li.className = 'NoticeWarning pw-notice-warning';
	const icon = document.createElement('i');
	icon.className = 'fa fa-fw fa-exclamation-circle';
	icon.setAttribute('aria-hidden', 'true');
	li.append(icon, ' ', text);
	if (!list.querySelector('.pw-notice-remove, .notice-remove')) {
		// the theme script's delegated handler closes the band (scripts/main.js, as for the server's)
		const close = document.createElement('a');
		close.className = 'pw-notice-remove notice-remove';
		close.href = '#';
		close.title = label('close', 'Close');
		close.setAttribute('aria-label', close.title);
		close.innerHTML = "<i class='fa fa-times' aria-hidden='true'></i>";
		li.prepend(close);
	}
	list.appendChild(li);
}

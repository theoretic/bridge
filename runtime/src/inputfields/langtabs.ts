/**
 * Language tabs (LanguageTabs, multi-language fields) without jQuery (milestone 2.4, ADR 0015).
 * Same markup contract as upstream LanguageTabs.js with its jQuery UI mode off (Bridge sets
 * jQueryUI=false): div.langTabs > ul > li > a.langTabLink[href=#panel][data-lang], panels are the
 * ul's .LanguageSupport siblings, the open one carries .LanguageSupportCurrent and its li the
 * configured liActiveClass (ProcessWire.config.LanguageTabs). Also as upstream:
 * - setup adds .langTabsInit, .hasLangTabs on the Inputfield, .langTabsContainer on its content
 *   and a span.langTabsToggle in the header (show all languages at once, and back);
 * - a click on the open tab (a "double click") opens that language in every field of the form,
 *   remembered for the request in the langTabsDC cookie;
 * - cfg.activeTab is opened first.
 * LanguageTabs' inline `setupLanguageTabs($('#form'))` runs only with jQuery (the theme guards it).
 * Tabs set up here carry data-pw-native and keep working when the legacy stack arrives later.
 */

import { legacyLoaded } from '../legacy';

type Config = { activeTab?: number; liActiveClass?: string; labelOpen?: string; labelClose?: string; requestId?: string };

function cfg(): Config {
	const w = window as unknown as { ProcessWire?: { config?: { LanguageTabs?: Config } } };
	return w.ProcessWire?.config?.LanguageTabs || {};
}

function panels(link: HTMLElement): HTMLElement[] {
	const ul = link.closest('ul');
	if (!ul || !ul.parentElement) return [];
	return Array.from(ul.parentElement.children).filter(el => el.classList.contains('LanguageSupport')) as HTMLElement[];
}

function activate(link: HTMLElement): void {
	const href = link.getAttribute('href') || '';
	const id = href.indexOf('#') > -1 ? href.slice(href.indexOf('#') + 1) : '';
	panels(link).forEach(panel => panel.classList.toggle('LanguageSupportCurrent', panel.id === id));
	const ul = link.closest('ul');
	const active = cfg().liActiveClass || 'uk-active';
	if (ul) {
		ul.querySelectorAll(':scope > li').forEach(li => li.classList.remove(active, 'uk-active'));
		const li = link.closest('li');
		if (li) li.classList.add(active);
	}
	link.dispatchEvent(new CustomEvent('clicklangtab', { bubbles: true }));
}

function isOpen(link: HTMLElement): boolean {
	const href = link.getAttribute('href') || '';
	const id = href.slice(href.indexOf('#') + 1);
	const panel = id ? document.getElementById(id) : null;
	return !!panel && panel.classList.contains('LanguageSupportCurrent');
}

function setup(tabs: HTMLElement): void {
	if (tabs.classList.contains('langTabsInit')) return;
	const field = tabs.closest<HTMLElement>('.Inputfield');
	const content = field ? field.querySelector<HTMLElement>(':scope > .InputfieldContent') : null;
	if (content && !field!.querySelector('.langTabsContainer')) content.classList.add('langTabsContainer');
	tabs.classList.add('langTabsInit');
	// upstream binds its handlers per element at setup: tabs set up here stay the runtime's even
	// if the legacy stack arrives later
	tabs.setAttribute('data-pw-native', '');
	if (field) field.classList.add('hasLangTabs');
	const header = tabs.parentElement && tabs.parentElement.classList.contains('InputfieldContent')
		? tabs.parentElement.previousElementSibling as HTMLElement | null : null;
	if (header && header.classList.contains('InputfieldHeader') && !header.querySelector(':scope > .langTabsToggle')) {
		const toggle = document.createElement('span');
		toggle.className = 'langTabsToggle';
		toggle.title = cfg().labelOpen || '';
		toggle.innerHTML = "<i class='fa fa-folder-o'></i>";
		header.appendChild(toggle);
	}
	const links = Array.from(tabs.querySelectorAll<HTMLElement>('a.langTabLink, a[data-lang]'));
	links.forEach(a => a.classList.add('langTabLink'));
	const first = links[cfg().activeTab || 0] || links[0];
	if (first) activate(first);
}

/** Open the language remembered by a double click earlier in this request (langTabsDC cookie) */
function restoreRemembered(root: ParentNode): void {
	const match = document.cookie.match(/(?:^|;\s*)langTabsDC=([^;]*)/);
	const requestId = cfg().requestId;
	if (!match || !requestId) return;
	const value = decodeURIComponent(match[1]);
	if (value.indexOf('-' + requestId) < 1) return;
	const langId = value.split('-')[0];
	root.querySelectorAll<HTMLElement>('a.langTab' + CSS.escape(langId)).forEach(activate);
}

export function initLanguageTabs(root: ParentNode): void {
	if (legacyLoaded()) return;
	root.querySelectorAll<HTMLElement>('.langTabs').forEach(setup);
	if (root instanceof HTMLElement && root.classList.contains('langTabs')) setup(root);
	restoreRemembered(root);
}

function toggleAll(toggle: HTMLElement): void {
	const header = toggle.closest('.InputfieldHeader');
	const content = header ? header.nextElementSibling as HTMLElement | null : null;
	const field = header ? header.parentElement : null;
	const tabs = content ? content.querySelector<HTMLElement>(':scope > .langTabs') : null;
	if (!content || !field || !tabs) return;
	const ul = tabs.querySelector<HTMLElement>(':scope > ul');
	const icon = toggle.querySelector('i');
	if (content.classList.contains('langTabsContainer')) {
		// show every language: all panels open, tabs hidden
		content.classList.remove('langTabsContainer');
		field.classList.remove('hasLangTabs');
		field.classList.add('langTabsOff');
		toggle.classList.add('langTabsOff');
		tabs.querySelectorAll('.LanguageSupport').forEach(p => p.classList.add('LanguageSupportCurrent'));
		if (ul) ul.style.display = 'none';
		toggle.title = cfg().labelClose || '';
		if (icon) icon.className = 'fa fa-folder-open-o';
	} else {
		content.classList.add('langTabsContainer');
		field.classList.add('hasLangTabs');
		field.classList.remove('langTabsOff');
		toggle.classList.remove('langTabsOff');
		if (ul) ul.style.display = '';
		toggle.title = cfg().labelOpen || '';
		if (icon) icon.className = 'fa fa-folder-o';
		const active = cfg().liActiveClass || 'uk-active';
		const current = tabs.querySelector<HTMLElement>('li.' + CSS.escape(active) + ' > a') || tabs.querySelector<HTMLElement>('a.langTabLink');
		if (current) activate(current);
	}
}

let ready = false;

export function setupLanguageTabEvents(): void {
	if (ready) return;
	ready = true;
	document.addEventListener('click', e => {
		const target = e.target as HTMLElement;
		if (!target || !target.closest) return;
		const field = target.closest('.Inputfield');
		if (legacyLoaded() && !(field && field.querySelector('.langTabs[data-pw-native]'))) return;
		const toggle = target.closest<HTMLElement>('.langTabsToggle');
		if (toggle) {
			e.preventDefault();
			e.stopPropagation(); // the header would collapse the field
			toggleAll(toggle);
			return;
		}
		const link = target.closest<HTMLElement>('.langTabs a.langTabLink');
		if (!link) return;
		e.preventDefault();
		if (isOpen(link)) {
			// a click on the open tab: this language in every field of the form, remembered
			const lang = link.getAttribute('data-lang') || '';
			const scope = link.closest('form') || document;
			if (lang) scope.querySelectorAll<HTMLElement>('a.langTab' + CSS.escape(lang)).forEach(activate);
			const requestId = cfg().requestId;
			if (lang && requestId) document.cookie = 'langTabsDC=' + encodeURIComponent(lang + '-' + requestId) + '; path=/; SameSite=Lax';
		} else {
			activate(link);
		}
	});
}

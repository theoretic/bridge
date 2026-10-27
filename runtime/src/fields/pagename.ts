/**
 * Page name and title without jQuery (milestone 3.1, ADR 0016). Ports upstream
 * InputfieldPageName.js and InputfieldPageTitle.js (core 3.0.274):
 *
 * - InputfieldPageName: typing shows the sanitized name in the URL preview (#<input id>_path
 *   strong, with a trailing slash when data-slashUrls says so); leaving the input writes the
 *   sanitized name into it. Rules from ProcessWire.config.InputfieldPageName (replacements,
 *   charset, whitelist).
 * - InputfieldPageTitle on the add-page screen (#ProcessPageAdd): the title fills an empty name as
 *   it is typed (per language, Inputfield_title__<id> -> Inputfield__pw_page_name<id>), until the
 *   name is edited by hand or already has a value.
 * - InputfieldPageTitleCustom (data-name-field, data-name-delimiter): the title fills the named
 *   input with ProcessWire.config.InputfieldPageTitle.replacements, until that input is changed.
 */

import { changed } from '../util/events';
import { on } from '../legacy';
import { pwConfig } from '../util/pw';

type NameConfig = { replacements?: Record<string, string>; charset?: string; whitelist?: string };


const QUOTES = /['""'«»‘’‚‛“”„‟‹›「」『』〝〞〟﹁﹂﹃﹄＂＇｢｣]/g;

export function sanitize(value: string): string {
	const cfg = pwConfig<NameConfig>('InputfieldPageName');
	let name = value.toLowerCase().trim();
	const replacements = cfg.replacements || {};
	for (const srch in replacements) {
		if (name.indexOf(srch) < 0) continue;
		name = name.split(srch).join(replacements[srch]);
	}
	name = name.replace(QUOTES, '');
	if (cfg.charset === 'UTF8') {
		const whitelist = cfg.whitelist || '';
		if (whitelist.length) name = Array.from(name).map(c => (whitelist.indexOf(c) < 0 ? '-' : c)).join('');
	} else {
		name = name.replace(/[^-_.a-z0-9 ]/g, '-');
	}
	name = name.replace(/\s+/g, '-');
	name = name.replace(/\.\.+/g, '.');
	name = name.replace(/(\.-|-\.)/g, '-');
	name = name.replace(/(^[-_.]+|[-_.]+$)/g, '');
	name = name.replace(/--+/g, '-');
	if (name.length > 128) name = name.trim().substring(0, 128).split('-').slice(0, -1).join(' ');
	return name;
}

function updatePreview(input: HTMLInputElement, value: string): void {
	const path = document.getElementById(input.id + '_path');
	if (!path) return;
	const slash = parseInt(path.getAttribute('data-slashUrls') || '0', 10) > 0 ? '/' : '';
	const strong = path.querySelector('strong');
	if (strong) strong.textContent = value.length > 0 ? value + slash : '';
}

/** Write a name as upstream's blur handler does (also used when a title fills the name) */
function commitName(input: HTMLInputElement): void {
	const value = sanitize(input.value);
	input.value = value;
	updatePreview(input, value);
}

function initName(wrap: HTMLElement): void {
	wrap.querySelectorAll<HTMLInputElement>('input[type=text]').forEach(input => {
		if (input.hasAttribute('data-pw-name')) return;
		input.setAttribute('data-pw-name', '');
		on(input, 'keyup', () => updatePreview(input, sanitize(input.value)));
		on(input, 'blur', () => commitName(input));
		updatePreview(input, sanitize(input.value));
	});
}

/** The add-page screen: title fills each empty name (upstream InputfieldPageTitle()) */
function initAddTitle(): void {
	document.querySelectorAll<HTMLInputElement>('.InputfieldPageName .LanguageSupport input[type=text]').forEach(input => {
		if (input.value.length > 0) input.classList.add('InputfieldPageNameNoUpdate');
	});
	if (!document.getElementById('ProcessPageAdd')) return;
	const onTitle = (e: Event): void => {
		const title = e.target as HTMLInputElement;
		const name = document.getElementById(title.id.replace(/Inputfield_title_*/, 'Inputfield__pw_page_name')) as HTMLInputElement | null;
		if (!name || name.classList.contains('InputfieldPageNameNoUpdate')) return;
		name.value = title.value;
		commitName(name);
		changed(name, 'input');
	};
	document.querySelectorAll<HTMLInputElement>('.InputfieldPageTitle:not(.InputfieldPageTitleCustom) input[type=text]').forEach(title => {
		on(title, 'keyup', onTitle);
		on(title, 'change', onTitle);
	});
	document.querySelectorAll<HTMLInputElement>('.InputfieldPageName input').forEach(name => {
		name.setAttribute('data-prev', name.value);
		on(name, 'change', () => {
			if (name.value !== name.getAttribute('data-prev')) name.classList.add('InputfieldPageNameNoUpdate');
		});
	});
}

/** A title with its own name field and delimiter (upstream InputfieldPageTitleCustom()) */
function initCustomTitle(wrap: HTMLElement): void {
	const nameInput = document.querySelector<HTMLInputElement>(`input[name="${wrap.getAttribute('data-name-field') || ''}"]`);
	if (!nameInput || nameInput.value.length) return;
	const delimiter = wrap.getAttribute('data-name-delimiter') || '';
	const titleInput = wrap.querySelector<HTMLInputElement>('input');
	if (!titleInput) return;
	const replacements = pwConfig<{ replacements?: Record<string, string> }>('InputfieldPageTitle').replacements || {};
	const toName = (title: string, strict: boolean): string => {
		let name = '';
		let last = '';
		for (const ch of title) {
			let c = ch;
			if (/^[a-zA-Z0-9]$/.test(c)) {
				if (delimiter.length && strict) c = c.toLowerCase();
			} else if (c === delimiter) {
				// kept
			} else if (typeof replacements[c] !== 'undefined') {
				c = replacements[c];
			} else if (delimiter.length && name.length) {
				c = delimiter;
			} else {
				c = '';
			}
			if ((c === '_' || c === '-') && c !== delimiter) c = delimiter;
			if (strict && c === delimiter && last === delimiter) continue;
			last = c;
			name += c;
		}
		if (strict && name.length && name.slice(-1) === delimiter) name = name.substring(0, name.length - 1);
		return name;
	};
	const onTitle = (): void => {
		if (nameInput.classList.contains('InputfieldPageTitleDone')) return;
		nameInput.value = toName(titleInput.value, true);
		nameInput.dispatchEvent(new Event('blur'));
		changed(nameInput, 'input');
	};
	on(titleInput, 'keyup', onTitle);
	on(titleInput, 'change', onTitle);
	nameInput.setAttribute('data-prev', nameInput.value);
	on(nameInput, 'change', () => {
		const val = nameInput.value.length ? toName(nameInput.value, false) : '';
		if (val.length && val !== nameInput.getAttribute('data-prev')) nameInput.classList.add('InputfieldPageTitleDone');
	});
	on(nameInput, 'keyup', () => {
		if (nameInput.value.length) nameInput.value = toName(nameInput.value, false);
	});
}

let titlesDone = false;

export function init(el: HTMLElement): void {
	if (el.classList.contains('InputfieldPageName')) initName(el);
	if (titlesDone) return;
	// upstream runs the title part once, on document ready, for the whole page
	titlesDone = true;
	const name = document.getElementById('Inputfield__pw_page_name') as HTMLInputElement | null;
	if (name && !name.value.length) {
		initAddTitle();
	} else {
		document.querySelectorAll<HTMLElement>('.InputfieldPageTitleCustom').forEach(initCustomTitle);
	}
}

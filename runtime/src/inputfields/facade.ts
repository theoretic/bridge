/**
 * window.Inputfields on pages without the legacy stack (Phase 2, ADR 0015): the calls core and
 * third-party scripts make on upstream's object, answered by the runtime. Installed only when
 * jQuery is absent and nothing defined window.Inputfields; upstream inputfields.js replaces it
 * when the legacy stack loads (its global `var Inputfields` reassigns the property).
 *
 * Targets are resolved like upstream's Inputfields.inputfield(): an element (the .Inputfield or
 * anything inside it), a jQuery-like list, a CSS selector, or a field name ('title' finds
 * #wrap_Inputfield_title).
 */

import { open, close, toggle, isCollapsed } from './collapse';
import { isHidden } from './dependencies';
import { installGlobal } from '../util/stubs';
import { runScripts } from '../util/scripts';

type Target = string | Element | ArrayLike<Element> | null | undefined;

function resolve(target: Target): HTMLElement[] {
	let els: Element[] = [];
	if (!target) return [];
	if (typeof target === 'string') {
		const looksLikeSelector = /^[#.[]|[\s>:]/.test(target);
		if (looksLikeSelector) {
			els = Array.from(document.querySelectorAll(target));
		} else {
			// upstream's order: a control by name, by id, by name[], then the wrapper ids
			// (a match outside any Inputfield, such as the masthead search's name=q, is skipped)
			const q = (sel: string): Element | null => {
				try {
					return Array.from(document.querySelectorAll(sel)).find(e => !!e.closest('.Inputfield')) || null;
				} catch {
					return null;
				}
			};
			const n = CSS.escape(target);
			const el = q(`:is(input, select, textarea, button)[name="${n}"]`) || q(`:is(input, select, textarea, button)#${n}`)
				|| q(`:is(input, select, textarea, button)[name="${n}[]"]`) || q(`#${n}.Inputfield`)
				|| q(`#wrap_Inputfield_${n}.Inputfield`) || q(`#wrap_${n}.Inputfield`) || document.getElementById('Inputfield_' + target);
			if (el) els = [el];
		}
	} else if ((target as Element).nodeType === 1) {
		els = [target as Element];
	} else if (typeof (target as ArrayLike<Element>).length === 'number') {
		els = Array.from(target as ArrayLike<Element>);
	}
	const out: HTMLElement[] = [];
	els.forEach(el => {
		const li = el.classList && el.classList.contains('Inputfield') ? el as HTMLElement : el.closest<HTMLElement>('.Inputfield');
		if (li && out.indexOf(li) < 0) out.push(li);
	});
	return out;
}

function control(li: HTMLElement): HTMLElement | null {
	return li.querySelector<HTMLElement>('.InputfieldContent :is(input:not([type=hidden]), select, textarea, button)');
}

export const InputfieldsFacade = {
	native: true,
	inputfield(target: Target): HTMLElement | null {
		return resolve(target)[0] || null;
	},
	open(target: Target): void {
		resolve(target).forEach(li => open(li));
	},
	close(target: Target): void {
		resolve(target).forEach(li => close(li));
	},
	toggle(target: Target): void {
		resolve(target).forEach(li => toggle(li));
	},
	isCollapsed(target: Target): boolean {
		const li = resolve(target)[0];
		return !!li && isCollapsed(li);
	},
	hidden(target: Target): boolean {
		const li = resolve(target)[0];
		return !!li && isHidden(li);
	},
	/** Open the field (and its collapsed parents) and focus its control */
	focus(target: Target): void {
		const li = resolve(target)[0];
		if (!li) return;
		for (let p: HTMLElement | null = li; p; p = p.parentElement ? p.parentElement.closest<HTMLElement>('.Inputfield') : null) {
			// a field on an inactive WireTab: show that tab (its link is a#_<content id>)
			const tab = p.classList.contains('WireTab') && p.style.display === 'none' && p.id ? document.getElementById('_' + p.id) : null;
			if (tab) tab.click();
			if (isCollapsed(p)) open(p);
		}
		const c = control(li);
		li.scrollIntoView({ block: 'center', behavior: 'smooth' });
		if (c) window.setTimeout(() => c.focus(), 0);
	},
	/** find(): bring the field into view, opened, as upstream does before highlighting it */
	find(target: Target): void {
		InputfieldsFacade.focus(target);
	},
	/** highlight(): flash the field's background, as upstream does */
	highlight(target: Target): void {
		resolve(target).forEach(li => {
			if (li.animate) li.animate([{ backgroundColor: 'var(--pw-highlight, #ffffaa)' }, { backgroundColor: 'transparent' }], { duration: 1500 });
		});
	},
	/** hashAction('find-name' | 'focus-name' | 'highlight-name'): upstream's URL fragment actions */
	hashAction(hash: string): void {
		hash = hash.replace(/^#/, '');
		const pos = hash.indexOf('-');
		if (pos < 3 || hash.length < pos + 2 || document.getElementById(hash)) return;
		const action = hash.substring(0, pos);
		const name = hash.substring(pos + 1);
		if (action === 'find') InputfieldsFacade.find(name);
		else if (action === 'focus') InputfieldsFacade.focus(name);
		else if (action === 'highlight') InputfieldsFacade.highlight(name);
	},
	/** changed(target) reads, changed(target, bool) sets InputfieldStateChanged */
	changed(target: Target, value?: boolean): boolean {
		const li = resolve(target)[0];
		if (!li) return false;
		if (typeof value === 'boolean') li.classList.toggle('InputfieldStateChanged', value);
		return li.classList.contains('InputfieldStateChanged');
	},
	name(target: Target): string {
		const li = resolve(target)[0];
		const c = li ? li.querySelector<HTMLInputElement>('.InputfieldContent [name]') : null;
		return c ? c.name.replace(/\[\]$/, '') : '';
	},
	label(target: Target): string {
		const li = resolve(target)[0];
		const header = li ? li.querySelector<HTMLElement>(':scope > .InputfieldHeader') : null;
		return header ? (header.textContent || '').trim() : '';
	},
	/**
	 * reload(): fetch the field again from its form's action (upstream's InputfieldReloadEvent:
	 * ?field=name&reloadInputfieldAjax=name), swap its content in, then `reloaded`. New fields
	 * inside are initialised by the runtime's content observer.
	 */
	reload(target: Target, extraData?: { queryString?: string }): void {
		resolve(target).forEach(li => {
			const form = li.closest('form');
			if (!li.id || !form) return;
			let name = li.id.replace('wrap_Inputfield_', '');
			let url = form.getAttribute('action') || '';
			let fnsx = '';
			const item = name.indexOf('_repeater') > 0 ? li.closest<HTMLElement>('.InputfieldRepeaterItem') : null;
			if (item) {
				url = url.replace(/\?id=\d+/, '?id=' + item.getAttribute('data-page'));
				fnsx = item.getAttribute('data-fnsx') || '';
				name = name.replace(/_repeater\d+$/, '');
			}
			url += (url.indexOf('?') > -1 ? '&' : '?') + 'field=' + name + '&reloadInputfieldAjax=' + name;
			if (fnsx) url += '&fnsx=' + fnsx;
			if (extraData && extraData.queryString) url += '&' + extraData.queryString;
			fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
				.then(r => r.text())
				.then(html => {
					if (html.indexOf('{') === 0) return;
					const doc = new DOMParser().parseFromString(html, 'text/html');
					const found = doc.getElementById(li.id) || (item ? doc.getElementById('wrap_Inputfield_' + name) : null);
					const content = found ? found.querySelector(':scope > .InputfieldContent') : null;
					const mine = li.querySelector(':scope > .InputfieldContent');
					if (!content || !mine) return;
					mine.innerHTML = content.innerHTML;
					return runScripts(mine, { legacy: !!li.querySelector('[data-bridge-legacy]') }).then(() => {
						li.dispatchEvent(new CustomEvent('reloaded', { bubbles: true, detail: { source: 'reload' } }));
					});
				})
				.catch(err => console.error('Bridge: reload failed for', url, err));
		});
	},
};

export function installFacade(): void {
	if (typeof (window as unknown as { jQuery?: unknown }).jQuery !== 'undefined') return;
	// over the theme's stand-in too; what inline code called on it runs after the theme's tabs
	// have been set up (they run at DOMContentLoaded too)
	if (!installGlobal('Inputfields', InputfieldsFacade, true)) return;
	if (window.location.hash) window.setTimeout(() => InputfieldsFacade.hashAction(window.location.hash), 0);
}

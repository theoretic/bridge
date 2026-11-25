/**
 * Ctrl+click (Cmd+click on a Mac) and middle click open link-like elements in a new tab, as they
 * do on a link (1.5.0; a chunk of its own since 1.5.1, loaded by the runtime entry, so the classic
 * main.js keeps its size budget). Upstream renders some navigation as buttons or scripts that
 * ignore the keys: the module list's Settings (a button that ProcessModule.js sends on), Install
 * and Delete (form submits, whose confirm clicks again without the key), a button inside a link
 * (Add New), links that open a dialog (.pw-modal, .pw-panel, PageTable and asmSelect edit links),
 * a page title in the tree (middle click only: Ctrl/Cmd+click selects tree rows, 1.6.0) and a
 * Lister title (they open the row; here they open the page's editor). One listener on window in the capture phase runs before the theme's and upstream's
 * own (legacy stack or not); a plain click, Shift and Alt are never touched, and a real link the
 * list does not name is left to the browser.
 *
 * Public, on ProcessWireAdminTheme.newTab (scripts/main.js holds the object): add(selector,
 * fn(el) -> url or '') adds a kind of element, in effect before this chunk loads too;
 * open(url) opens a URL as a Ctrl+click on a link would (from this chunk). data-pw-href on any
 * element makes it a link: a click goes there, a modified click opens a tab.
 */

type Resolver = { selector: string; url: (el: Element) => string | null };
type Api = { resolvers?: Resolver[]; open?: (url: string, e?: MouseEvent) => void };
type Tagged = HTMLButtonElement & { pwNewTab?: boolean };

const attr = (el: Element | null, name: string): string => (el && el.getAttribute(name)) || '';

/** A dialog's URL as a page of its own: without modal=..., pw_panel=... ('#' and javascript: none) */
function page(href: string): string {
	if (!href || href.charAt(0) === '#') return '';
	try {
		const url = new URL(href, location.href);
		if (!/^https?:$/.test(url.protocol)) return '';
		url.searchParams.delete('modal');
		url.searchParams.delete('pw_panel');
		return url.href;
	} catch {
		return '';
	}
}

// selector -> URL; the first match with a URL wins, kinds added through the API first
const BUILT_IN: Resolver[] = [
	{ selector: '[data-pw-href]', url: el => attr(el, 'data-pw-href') },
	{ selector: 'button.ProcessModuleSettings', url: el => {
		const tr = el.closest('tr');
		const a = tr && tr.querySelector('.ConfigurableModule') ? tr.querySelector('.ConfigurableModule')!.closest('a[href]') : null;
		return a ? attr(a, 'href') + '&collapse_info=1' : '';
	} },
	// the page tree (not a page select field: its rows have no Edit)
	{ selector: 'a.PageListPage', url: el => attr(el.parentElement && el.parentElement.querySelector(':scope > .PageListActions > .PageListActionEdit > a[href]'), 'href') },
	{ selector: 'a.actions_toggle', url: el => {
		const cell = el.closest('td') || el.parentElement;
		return attr(cell && cell.querySelector('.actions a.PageEdit:not(.PageAdd)[href]'), 'href');
	} },
	{ selector: '.InputfieldPageTableEdit', url: el => page(attr(el, 'data-url') || attr(el, 'href')) },
	{ selector: '.asmListItem a[href]', url: el => page(attr(el, 'href')) },
	// in-page panels (data-panel-id) have no page to open
	{ selector: '.pw-modal, .pw-panel', url: el => el.hasAttribute('data-panel-id') ? '' : page(attr(el, 'href') || attr(el, 'data-href')) },
	{ selector: 'a[href] > button', url: el => attr(el.parentElement, 'href') },
];

// form buttons that post to a page of their own: they post in a new tab
const SUBMITS = 'button[data-install], button[data-delete]';

/** Is this a new-tab click: Ctrl or Cmd with the main button, or the middle button */
function wanted(e: MouseEvent): boolean {
	if (!e.isTrusted || e.altKey || e.shiftKey) return false;
	if (e.button === 1) return e.type !== 'click';
	return e.button === 0 && e.type === 'click' && (e.ctrlKey || e.metaKey);
}

function resolve(api: Api, t: EventTarget | null): { url?: string; submit?: Tagged } | null {
	if (!(t instanceof Element)) return null;
	const submit = t.closest<Tagged>(SUBMITS);
	if (submit && submit.form && !submit.disabled) return { submit };
	for (const r of (api.resolvers || []).concat(BUILT_IN)) {
		const el = t.closest(r.selector);
		const url = el ? r.url(el) : '';
		if (url) return { url };
	}
	return null;
}

/** Open a URL in a new tab as a Ctrl+click on a link does (the browser decides about the front) */
function open(url: string, e?: MouseEvent): void {
	const a = document.createElement('a');
	a.href = url;
	a.rel = 'noopener';
	a.hidden = true;
	document.body.appendChild(a);
	const meta = !!(e && e.metaKey);
	a.dispatchEvent(new MouseEvent('click', { cancelable: true, view: window, ctrlKey: !meta, metaKey: meta }));
	a.remove();
}

function done(button: Tagged | null): void {
	if (!button || !button.pwNewTab) return;
	button.pwNewTab = false;
	button.removeAttribute('formtarget');
}

let started = false;

export function start(): void {
	if (started) return;
	started = true;
	const theme = (window as unknown as { ProcessWireAdminTheme?: { newTab?: Api } }).ProcessWireAdminTheme;
	const api: Api = (theme && theme.newTab) || {};
	api.open = open;
	const handle = (e: MouseEvent): void => {
		if (!wanted(e)) {
			// a plain click on a button left set for a new tab: this one stays here
			if (e.isTrusted && e.type === 'click' && e.target instanceof Element) done(e.target.closest<Tagged>(SUBMITS));
			return;
		}
		// a page tree title: Ctrl/Cmd+click selects rows (the tree's own), the middle button opens the editor
		if (e.type === 'click' && e.target instanceof Element && e.target.closest('a.PageListPage')) return;
		const found = resolve(api, e.target);
		if (!found) return;
		if (found.submit) {
			// formtarget stays until that submit has gone (a confirm or a risk check may ask first)
			found.submit.setAttribute('formtarget', '_blank');
			found.submit.pwNewTab = true;
			// a middle click does not click: click it, so its confirm asks first. A Ctrl+click goes
			// on as it is (the browser's own Ctrl+submit is a new tab too)
			if (e.type !== 'click') {
				e.preventDefault();
				found.submit.click();
			}
			return;
		}
		e.preventDefault();
		e.stopImmediatePropagation();
		open(found.url!, e);
	};
	window.addEventListener('click', handle, true);
	window.addEventListener('auxclick', handle, true);
	// the middle button's press would start autoscroll (Windows) on what is not a link
	window.addEventListener('mousedown', e => {
		if (e.button === 1 && e.isTrusted && resolve(api, e.target)) e.preventDefault();
	}, true);
	// the post has gone (nothing stopped it): the button submits here again
	window.addEventListener('submit', e => {
		const button = e.submitter as Tagged | null;
		if (button && button.pwNewTab) window.setTimeout(() => { if (!e.defaultPrevented) done(button); }, 0);
	});
	// data-pw-href: a plain click follows it (after everyone else had their say)
	document.addEventListener('click', e => {
		if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || !(e.target instanceof Element)) return;
		const el = e.target.closest<HTMLElement>('[data-pw-href]');
		const href = attr(el, 'data-pw-href');
		if (!href || el!.closest('a[href]') || (el as HTMLButtonElement).disabled) return;
		e.preventDefault();
		window.location.assign(href);
	});
}

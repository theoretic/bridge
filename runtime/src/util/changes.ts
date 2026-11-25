/**
 * Changes made elsewhere (1.6.0): on a screen that prints its dependency snapshot
 * (`script#pw-deps`, AdminThemeBridgeChanges::changeDeps()), a return to the tab (pw-tab-focus,
 * scripts/main.js) asks the server what changed since (one GET of the screen's URL with
 * `bridgeChanges=1` and `deps`, the snapshot as JSON). The answer's cursor and the page's modified
 * time replace the snapshot's, so a change is shown once per tab. Anything found opens a native
 * <dialog class="pw-changes"> (role alertdialog): per object what, who and when, a before/after
 * table of the properties the user may see, and what it means here when that is known. Reload page
 * asks first when a form holds unsaved changes; Keep editing (and Escape, the close button, the
 * backdrop) closes it and lists the changes in a banner under the headline until the page reloads.
 *
 * The tab's id (sessionStorage, so modal iframes share it) goes into the snapshot and into every
 * `_bridge_tab` input the theme adds to its forms, and into an `X-Bridge-Tab` header on every
 * XMLHttpRequest and fetch() POST to the admin (uploads, legacy AJAX saves, moves between file fields), so the server skips this tab's own saves.
 */

import { label } from './labels';
import { esc } from './html';
import { toHTML } from './trusted';
import { adminUrl } from './pw';
import { fetchOk } from './fail';
import { fill, confirm } from './danger';

type Diff = Record<string, unknown>;
type Entry = { kind: string; action: string; ts: number; user: string; you: boolean; object: number; name: string; label: string; in: string; diff: Diff; named: string[]; hidden: number };
type Answer = { cursor: number; page: { modified: number; user: string; you: boolean } | null; changes: Entry[]; more: boolean; message?: string; modified?: number };
type Deps = { screen: string; cursor: number; page: { modified: number } | null; tab?: string };

const KEY = 'bridge-tab';
const TITLES: Record<string, [string, string]> = {
	'page-edit': ['changesTitle', 'This page changed elsewhere'],
	'page-add': ['changesAddTitle', 'What this new page depends on changed elsewhere'],
	'field-edit': ['changesFieldTitle', 'This field changed elsewhere'],
	'template-edit': ['changesTemplateTitle', 'This template changed elsewhere'],
};
const ACTIONS: Record<string, [string, string]> = {
	saved: ['changesSaved', 'changed'],
	renamed: ['changesRenamed', 'renamed'],
	deleted: ['changesDeleted', 'deleted'],
	trashed: ['changesTrashed', 'moved to the trash'],
	moved: ['changesMoved', 'moved'],
};

let deps: Deps | null = null;
let busy = false;
let dialog: HTMLDialogElement | null = null;
// the banner's lines, since the page loaded
const listed: string[] = [];

/** This tab's id: kept in sessionStorage (one per tab, shared by its frames), else for this page only */
function tabId(): string {
	let id = '';
	try {
		id = sessionStorage.getItem(KEY) || '';
	} catch { /* storage off */ }
	if (/^[\w-]{8,64}$/.test(id)) return id;
	const a = new Uint32Array(3);
	crypto.getRandomValues(a);
	id = Array.from(a, n => n.toString(36)).join('-');
	try {
		sessionStorage.setItem(KEY, id);
	} catch { /* storage off */ }
	return id;
}

/** The forms with unsaved changes (the leave warning's rule, inputfields/forms.ts) */
const unsavedForms = (): HTMLFormElement[] => Array.from(document.querySelectorAll<HTMLFormElement>('form.InputfieldFormConfirm:not(.InputfieldFormSubmitted)'))
	.filter(f => f.querySelector('.InputfieldStateChanged'));

/** The names of the fields with unsaved changes */
function unsavedNames(): string[] {
	const names: string[] = [];
	unsavedForms().forEach(f => f.querySelectorAll('.InputfieldStateChanged').forEach(li => {
		const m = /^wrap_Inputfield_(.+)$/.exec(li.id);
		if (m && names.indexOf(m[1]) < 0) names.push(m[1]);
	}));
	return names;
}

function when(ts: number): string {
	const s = Math.round(ts - Date.now() / 1000);
	const rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, { numeric: 'auto' });
	if (s > -60) return rtf.format(s, 'second');
	if (s > -3600) return rtf.format(Math.round(s / 60), 'minute');
	if (s > -86400) return rtf.format(Math.round(s / 3600), 'hour');
	return rtf.format(Math.round(s / 86400), 'day');
}

const who = (user: string, you: boolean, ts: number): string => (you ? label('changesYou', 'you, in another tab') : user || '?') + ', ' + when(ts);

/** A value as a line of text, cut */
function text(v: unknown): string {
	const s = v === null || v === undefined || v === '' ? '–' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
	return s.length > 200 ? s.slice(0, 199) + '…' : s;
}

const words = (v: unknown): string[] => text(v).toLowerCase().split(/[\s,|]+/).filter(w => w && w !== '–');

/** What a change is, as text, with the editor's URL when there is one */
function what(e: Entry): [string, string] {
	const name = e.label || e.name || '#' + e.object;
	const url = e.action === 'deleted' ? '' : adminUrl() + 'setup/';
	switch (e.kind) {
		case 'page': return [label('changesPage', 'This page'), ''];
		case 'field': return [fill('changesField', 'Field %s', name), url && url + 'field/edit?id=' + e.object];
		case 'context': return [fill('changesFieldIn', 'Field %s on template %s', name, e.in), url && url + 'field/edit?id=' + e.object];
		case 'template': return [fill('changesTemplate', 'Template %s', name), url && url + 'template/edit?id=' + e.object];
		default: return [fill('changesFieldgroup', 'Fields of template %s', name), ''];
	}
}

/** One block of the dialog; the banner's line goes to `listed` */
function block(e: Entry, unsaved: string[]): string {
	const [title, url] = what(e);
	const act = ACTIONS[e.action] || ACTIONS.saved;
	const byLine = who(e.user, e.you, e.ts);
	listed.push(title + ' · ' + label(act[0], act[1]) + ' · ' + byLine);
	const head = url ? `<a href="${esc(url)}" data-pw-href="${esc(url)}">${esc(title)}</a>` : esc(title);
	let rows = '';
	const lines: string[] = [];
	const changed: string[] = [];
	for (const key of Object.keys(e.diff)) {
		const v = e.diff[key];
		if (e.kind === 'fieldgroup' && Array.isArray(v)) {
			if (v.length) lines.push(fill(key === 'added' ? 'changesAdded' : 'changesRemoved', key === 'added' ? 'Fields added: %d' : 'Fields removed: %d', v.length));
		} else if (e.kind === 'fieldgroup') {
			if (v) lines.push(label('changesReordered', 'Fields reordered'));
		} else if (Array.isArray(v) && v.length === 2) {
			rows += `<tr><th scope="row">${esc(key)}</th><td>${esc(text(v[0]))}</td><td>${esc(text(v[1]))}</td></tr>`;
			if (key === 'extensions') {
				const now = words(v[1]);
				const gone = words(v[0]).filter(w => now.indexOf(w) < 0);
				if (gone.length) lines.push(fill('changesExtGone', 'Uploads you add now are checked against the new types: %s no longer allowed.', gone.join(', ')));
			}
		} else {
			changed.push(key);
		}
	}
	if (changed.length) lines.unshift(fill('changesProps', 'Changed: %s', changed.join(', ')));
	if (e.named.length) lines.push(fill('changesNamed', 'Also changed, not shown: %s', e.named.join(', ')));
	if (e.hidden) lines.push(fill('changesHidden', 'Other settings changed (%d)', e.hidden));
	// a save of this page: the unsaved fields it touches (all of them when the log has no detail)
	if (e.kind === 'page') {
		const hit = changed.length ? unsaved.filter(n => changed.indexOf(n) >= 0) : unsaved;
		if (hit.length) lines.push(fill('changesOverwrite', 'Your unsaved changes to %s may overwrite this save.', hit.join(', ')));
	}
	return `<section class="pw-changes-item"><h3>${head} <small>${esc(label(act[0], act[1]))}</small></h3>` +
		`<p class="pw-changes-who">${esc(byLine)}</p>` +
		(rows ? `<table class="pw-changes-diff"><thead><tr><th>${esc(label('changesProperty', 'Setting'))}</th><th>${esc(label('changesBefore', 'Before'))}</th><th>${esc(label('changesAfter', 'After'))}</th></tr></thead><tbody>${rows}</tbody></table>` : '') +
		lines.map(l => `<p>${esc(l)}</p>`).join('') + '</section>';
}

/** Reload, asking first while a form holds unsaved changes */
function reload(): void {
	const forms = unsavedForms();
	const go = (): void => {
		forms.forEach(f => f.classList.add('InputfieldFormSubmitted'));
		location.reload();
	};
	if (!forms.length) return go();
	void confirm({ title: forms[0].getAttribute('data-confirm') || label('discardChanges', 'This page has unsaved changes. Leave it?'), danger: true }).then(ok => { if (ok) go(); });
}

/** The banner under the headline: every change seen since the page loaded */
function banner(): void {
	let b = document.querySelector<HTMLElement>('.pw-changes-banner');
	if (!b) {
		b = document.createElement('div');
		b.className = 'pw-changes-banner';
		b.setAttribute('role', 'status');
		const head = document.getElementById('pw-content-title');
		if (head) head.after(b);
		else (document.getElementById('pw-content-body') || document.body).prepend(b);
	}
	const t = TITLES[deps!.screen];
	b.innerHTML = toHTML(`<p>${esc(label(t[0], t[1]))}</p><ul>` +
		listed.map(l => `<li>${esc(l)}</li>`).join('') + `</ul><button type="button" class="ui-button pw-button ui-priority-secondary" data-pw-changes="reload">${esc(label('changesReload', 'Reload page'))}</button>`);
}

function show(answer: Answer): void {
	const unsaved = unsavedNames();
	let body = '';
	if (answer.message) {
		listed.push(answer.message);
		body = `<p>${esc(answer.message)}</p>`;
	} else {
		const hasPageRows = answer.changes.some(e => e.kind === 'page');
		if (answer.page && !hasPageRows) {
			body += block({ kind: 'page', action: 'saved', ts: answer.page.modified, user: answer.page.user, you: answer.page.you, object: 0,
				name: '', label: '', in: '', diff: {}, named: [], hidden: 0 }, unsaved);
		}
		answer.changes.forEach(e => { body += block(e, unsaved); });
		if (answer.more) body += `<p>${esc(label('changesMore', 'More changes were left out.'))}</p>`;
	}
	const t = TITLES[deps!.screen];
	if (!dialog) {
		dialog = document.createElement('dialog');
		dialog.className = 'pw-changes';
		dialog.setAttribute('role', 'alertdialog');
		dialog.setAttribute('aria-labelledby', 'pw-changes-title');
		dialog.addEventListener('close', banner);
		dialog.addEventListener('click', e => {
			const d = dialog!;
			const r = d.getBoundingClientRect();
			if (e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) d.close();
		});
		document.body.appendChild(dialog);
	}
	// a later check while it is still open: the new changes go on top
	const old = dialog.open ? dialog.querySelector('.pw-changes-body')!.innerHTML : '';
	dialog.innerHTML = toHTML(`<div class="pw-changes-head"><p class="pw-ask-message" id="pw-changes-title">${esc(label(t[0], t[1]))}</p>` +
		`<button type="button" class="pw-drawer-close" data-pw-changes="close" aria-label="${esc(label('close', 'Close'))}">×</button></div>` +
		`<div class="pw-changes-body">${body}${old}</div><div class="pw-ask-buttons">` +
		`<button type="button" class="ui-button pw-button" data-pw-changes="reload">${esc(label('changesReload', 'Reload page'))}</button>` +
		`<button type="button" class="ui-button pw-button ui-priority-secondary" data-pw-changes="close">${esc(label('changesKeep', 'Keep editing'))}</button></div>`);
	if (!dialog.open) dialog.showModal();
	dialog.querySelector<HTMLButtonElement>('.pw-ask-buttons [data-pw-changes="close"]')!.focus();
}

/** Ask the server what changed since the snapshot; one request at a time */
function check(): void {
	if (busy || !deps) return;
	busy = true;
	const url = new URL(location.href);
	url.hash = '';
	url.searchParams.set('bridgeChanges', '1');
	url.searchParams.set('deps', JSON.stringify(deps));
	fetchOk(url.href, { cache: 'no-store' }).then(r => r.json()).then((answer: Answer) => {
		if (!deps || !answer || typeof answer.cursor !== 'number') return;
		deps.cursor = Math.max(deps.cursor, answer.cursor);
		if (answer.page && deps.page) deps.page.modified = answer.page.modified;
		// this tab saved the page last: no entry, but the time moves on all the same
		if (typeof answer.modified === 'number' && deps.page) deps.page.modified = answer.modified;
		if (answer.message || answer.page || (answer.changes && answer.changes.length)) show(answer);
	}).catch(err => console.warn('Bridge: changes check', err)).then(() => { busy = false; });
}

export function start(): void {
	const el = document.getElementById('pw-deps');
	if (deps || !el) return;
	try {
		deps = JSON.parse(el.textContent || '') as Deps;
	} catch {
		return;
	}
	if (!deps || !TITLES[deps.screen]) {
		deps = null;
		return;
	}
	const id = deps.tab = tabId();
	document.querySelectorAll<HTMLInputElement>('input[name="_bridge_tab"]').forEach(i => { i.value = id; });
	// forms that arrive later, and saves that post a FormData of the form (AJAX saves)
	document.addEventListener('formdata', e => {
		if ((e.target as HTMLFormElement).querySelector('input[name="_bridge_tab"]')) e.formData.set('_bridge_tab', id);
	});
	// AJAX saves (uploads: the native widget and the legacy stack post with XMLHttpRequest; the
	// theme's own fetch() saves, such as moves between file fields) say which tab they come from,
	// on a same-origin admin URL only
	const ours = (method: string, url: string | URL): boolean => {
		try {
			const u = new URL(String(url), location.href);
			return u.origin === location.origin && u.pathname.indexOf(new URL(adminUrl(), location.href).pathname) === 0 && !/^(GET|HEAD)$/i.test(method);
		} catch {
			return false;
		}
	};
	const proto = XMLHttpRequest.prototype as XMLHttpRequest & { pwTab?: boolean };
	const open = proto.open, send = proto.send;
	proto.open = function (this: XMLHttpRequest & { pwTab?: boolean }, method: string, url: string | URL, ...rest: unknown[]) {
		this.pwTab = ours(method, url);
		return (open as (...a: unknown[]) => void).apply(this, [method, url, ...rest]);
	} as typeof proto.open;
	proto.send = function (this: XMLHttpRequest & { pwTab?: boolean }, body?: Document | XMLHttpRequestBodyInit | null) {
		if (this.pwTab) this.setRequestHeader('X-Bridge-Tab', id);
		return send.call(this, body);
	};
	const fetchOrig = window.fetch;
	window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
		const req = input instanceof Request ? input : null;
		if (ours((init && init.method) || (req ? req.method : 'GET'), req ? req.url : input as string | URL)) {
			const headers = new Headers((init && init.headers) || (req ? req.headers : undefined));
			headers.set('X-Bridge-Tab', id);
			init = Object.assign({}, init, { headers });
		}
		return fetchOrig.call(window, input, init);
	};
	document.addEventListener('pw-tab-focus', check);
	document.addEventListener('click', e => {
		const b = (e.target as Element).closest && (e.target as Element).closest('[data-pw-changes]');
		if (!b) return;
		if (b.getAttribute('data-pw-changes') === 'reload') reload();
		else if (dialog && dialog.open) dialog.close();
	});
}

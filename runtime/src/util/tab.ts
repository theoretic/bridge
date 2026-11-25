/**
 * The tab's id for the change log (1.6.0): kept in sessionStorage, so a tab's modal frames share
 * it. mark() puts it into every `_bridge_tab` input the theme adds to its forms, and into an
 * `X-Bridge-Tab` header on every XMLHttpRequest and fetch() POST to the admin (uploads, legacy AJAX
 * saves, moves between file fields), so the server skips this tab's own saves. With `anyForm` (a
 * modal frame, Q12) every POST form to the admin sends it too, such as the image editor's.
 */

import { adminUrl } from './pw';

const KEY = 'bridge-tab';

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

let marked = '';
let anyForms = false;

/** Send the tab's id with this document's saves; returns it */
export function mark(anyForm: boolean): string {
	anyForms = anyForms || anyForm;
	if (marked) return marked;
	const id = marked = tabId();
	// a same-origin admin URL, and not a GET
	const ours = (method: string, url: string | URL): boolean => {
		try {
			const u = new URL(String(url), location.href);
			return u.origin === location.origin && u.pathname.indexOf(new URL(adminUrl(), location.href).pathname) === 0 && !/^(GET|HEAD)$/i.test(method);
		} catch {
			return false;
		}
	};
	document.querySelectorAll<HTMLInputElement>('input[name="_bridge_tab"]').forEach(i => { i.value = id; });
	// forms that arrive later, and saves that post a FormData of the form (AJAX saves)
	document.addEventListener('formdata', e => {
		const f = e.target as HTMLFormElement;
		if (f.querySelector('input[name="_bridge_tab"]') || (anyForms && ours(f.getAttribute('method') || 'GET', f.getAttribute('action') || location.href))) e.formData.set('_bridge_tab', id);
	});
	// AJAX saves (uploads: the native widget and the legacy stack post with XMLHttpRequest; the
	// theme's own fetch() saves, such as moves between file fields)
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
	return id;
}

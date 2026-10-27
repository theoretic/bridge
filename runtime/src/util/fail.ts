/**
 * Requests that can fail (audit R4): an HTTP error is an error, not content to place in the page,
 * and a failure is told to the user in the notice band, not only to the console.
 */

import { label } from './labels';

/** fetch() as the admin's AJAX calls make it, rejecting on an HTTP error status */
export async function fetchOk(url: string, init: RequestInit = {}): Promise<Response> {
	const headers = Object.assign({ 'X-Requested-With': 'XMLHttpRequest' }, init.headers || {});
	const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, init, { headers }));
	if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + url);
	return res;
}

/** Log a failure and show one translated notice for it */
export function failed(context: string, err: unknown): void {
	console.error('Bridge: ' + context, err);
	void import('./notice').then(m => m.notice(label('requestFailed', 'A request to the server failed. Reload the page and try again.')));
}

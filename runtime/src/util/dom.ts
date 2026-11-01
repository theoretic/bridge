/**
 * DOM helpers the field widgets share (audit AR2); its own module, so only the chunks that use
 * it load it
 */

import { toHTML } from './trusted';

/** An element with a class and markup (audit AR2: the page tree and the page picker had one each) */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (html) e.innerHTML = toHTML(html);
	return e;
}

/** The file name of a file or image item, from its link or its image (guards.ts, files-move.ts) */
export function fileName(li: Element): string {
	const link = li.querySelector('a.InputfieldFileName');
	const img = li.querySelector('.gridImage__overflow img');
	const url = (link && link.getAttribute('href')) || (img && (img.getAttribute('data-original') || img.getAttribute('src'))) || '';
	const last = url.split('?')[0].split('/').pop() || '';
	try { return decodeURIComponent(last); } catch (err) { return last; }
}

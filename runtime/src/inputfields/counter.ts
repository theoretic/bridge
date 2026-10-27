/**
 * Character / word counter for InputfieldText `showCount` (and Textarea), without jQuery
 * (Phase 2, ADR 0015). Same contract as upstream InputfieldTextLength.js: inputs carry
 * .InputfieldTextLength and data-showCount (1 = characters, 2 = words), limits come from
 * data-minlength and maxlength / data-maxlength, labels from ProcessWire.config.InputfieldTextLength
 * (word1, words, char1, chars, min, max with %d). The note is div.InputfieldTextLengthNote right
 * after the input, holding <small class="detail">; CKEditor textareas are left to upstream.
 */

import { legacyLoaded } from '../legacy';
import { esc } from '../util/html';

type Labels = { word1: string; words: string; char1: string; chars: string; min: string; max: string };

const FALLBACK: Labels = {
	word1: '1 word', words: '%d words', char1: '1 character', chars: '%d characters',
	min: '(at least %d required)', max: '(%d max)',
};

function labels(): Labels {
	const w = window as unknown as { ProcessWire?: { config?: { InputfieldTextLength?: Partial<Labels> } } };
	return Object.assign({}, FALLBACK, w.ProcessWire?.config?.InputfieldTextLength || {});
}

function count(input: HTMLInputElement | HTMLTextAreaElement, words: boolean): number {
	const value = input.value.trim();
	if (!words) return value.length;
	if (!value.length) return 0;
	return value.replace(/[\r\n\t,:.!?/]+/g, ' ').replace(/\s\s+/g, ' ').trim().split(' ').length;
}

function intAttr(input: Element, ...names: string[]): number {
	for (const name of names) {
		const v = parseInt(input.getAttribute(name) || '', 10);
		if (v > 0) return v;
	}
	return 0;
}

const escape = esc;

export function updateCounter(input: HTMLInputElement | HTMLTextAreaElement): void {
	const mode = input.getAttribute('data-showCount') || input.getAttribute('data-showcount');
	const l = labels();
	let note = '';
	if (mode === '1') {
		const len = count(input, false);
		const min = intAttr(input, 'data-minlength');
		const max = intAttr(input, 'maxlength', 'data-maxlength');
		let error = false;
		note = escape(len === 1 ? l.char1 : l.chars.replace('%d', String(len))) + ' ';
		if (min && len > 0 && len < min) {
			note += "<span class='InputfieldTextLengthError'>" + escape(l.min.replace('%d', String(min))) + '</span>';
			error = true;
		}
		if (max) {
			if (len > max) {
				note += "<span class='InputfieldTextLengthError'>" + escape(l.max.replace('%d', String(max))) + '</span>';
				error = true;
			} else if (!error) {
				note += escape(l.max.replace('%d', String(max)));
			}
		}
	} else if (mode === '2') {
		const len = count(input, true);
		if (len === 1) note = escape(l.word1);
		else if (len > 1) note = escape(l.words.replace('%d', String(len)));
	}
	let el = input.nextElementSibling;
	if (!el || !el.classList.contains('InputfieldTextLengthNote')) el = null;
	if (!note) {
		if (el) el.remove();
		return;
	}
	if (!el) {
		el = document.createElement('div');
		el.className = 'InputfieldTextLengthNote';
		input.insertAdjacentElement('afterend', el);
	}
	const html = "<small class='detail'>" + note + '</small>';
	if (el.innerHTML !== html) el.innerHTML = html; // unchanged text: no DOM write
}

function counted(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
	const el = target as HTMLElement | null;
	if (!el || !el.classList || !el.classList.contains('InputfieldTextLength')) return null;
	if (el.closest('.InputfieldCKEditor')) return null; // the editor's own content, upstream's job
	return el as HTMLInputElement | HTMLTextAreaElement;
}

export function initCounters(root: ParentNode): void {
	if (legacyLoaded()) return;
	root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('.InputfieldTextLength').forEach(input => {
		if (!counted(input)) return;
		updateCounter(input);
	});
}

let ready = false;

export function setupCounterEvents(): void {
	if (ready) return;
	ready = true;
	// 'input' covers typing; keyup only added a second update per key (audit P5)
	for (const type of ['input', 'change', 'focusin']) {
		document.addEventListener(type, e => {
			if (legacyLoaded()) return;
			const input = counted(e.target);
			if (input) updateCounter(input);
		});
	}
}

/**
 * InputfieldPassword without jQuery (milestone 3.6, ADR 0016). Ports upstream InputfieldPassword.js
 * and the jquery.complexify.js plugin it uses (Dan Palmer, WTFPL; core 3.0.274), on the same
 * markup: input.InputfieldPasswordComplexify[data-minlength, data-banMode, data-factor] with its
 * .pass-scores (data-requirements: letter upper lower digit other space minlength) and
 * .pass-percent, the confirm input with .pass-confirm, an optional old-password input, the
 * show/hide mask.
 *
 * - Each keystroke scores the password: requirements met (.pass-require-good), then same as the
 *   old one, failing, too short, common (the banlist, upstream's plain jquery.complexify.banlist.js
 *   loaded on demand), invalid, weak, medium, good, excellent (.on), with its percentage.
 * - The confirm input is enabled only for an acceptable password and reports pending, partial
 *   (n/m), no or yes (p.pass-matches).
 * - A new password makes both inputs required (unless the field is required anyway).
 * Character classes use the browser's Unicode property escapes in place of XRegExp.
 */

import { on } from '../legacy';

const CHARSETS: Array<[number, number]> = [
	[0x20, 0x20], [0x30, 0x39], [0x41, 0x5A], [0x61, 0x7A], [0x21, 0x2F], [0x3A, 0x40], [0x5B, 0x60], [0x7B, 0x7E],
	[0x80, 0xFF], [0x100, 0x17F], [0x180, 0x24F], [0x250, 0x2AF], [0x2B0, 0x2FF], [0x300, 0x36F], [0x370, 0x3FF],
	[0x400, 0x4FF], [0x530, 0x58F], [0x590, 0x5FF], [0x600, 0x6FF], [0x700, 0x74F], [0x780, 0x7BF], [0x900, 0x97F],
	[0x980, 0x9FF], [0xA00, 0xA7F], [0xA80, 0xAFF], [0xB00, 0xB7F], [0xB80, 0xBFF], [0xC00, 0xC7F], [0xC80, 0xCFF],
	[0xD00, 0xD7F], [0xD80, 0xDFF], [0xE00, 0xE7F], [0xE80, 0xEFF], [0xF00, 0xFFF], [0x1000, 0x109F], [0x10A0, 0x10FF],
	[0x1100, 0x11FF], [0x1200, 0x137F], [0x13A0, 0x13FF], [0x1400, 0x167F], [0x1680, 0x169F], [0x16A0, 0x16FF],
	[0x1780, 0x17FF], [0x1800, 0x18AF], [0x1E00, 0x1EFF], [0x1F00, 0x1FFF], [0x2000, 0x206F], [0x2070, 0x209F],
	[0x20A0, 0x20CF], [0x20D0, 0x20FF], [0x2100, 0x214F], [0x2150, 0x218F], [0x2190, 0x21FF], [0x2200, 0x22FF],
	[0x2300, 0x23FF], [0x2400, 0x243F], [0x2440, 0x245F], [0x2460, 0x24FF], [0x2500, 0x257F], [0x2580, 0x259F],
	[0x25A0, 0x25FF], [0x2600, 0x26FF], [0x2700, 0x27BF], [0x2800, 0x28FF], [0x2E80, 0x2EFF], [0x2F00, 0x2FDF],
	[0x2FF0, 0x2FFF], [0x3000, 0x303F], [0x3040, 0x309F], [0x30A0, 0x30FF], [0x3100, 0x312F], [0x3130, 0x318F],
	[0x3190, 0x319F], [0x31A0, 0x31BF], [0x3200, 0x32FF], [0x3300, 0x33FF], [0x3400, 0x4DB5], [0x4E00, 0x9FFF],
	[0xA000, 0xA48F], [0xA490, 0xA4CF], [0xAC00, 0xD7A3], [0xD800, 0xDB7F], [0xDB80, 0xDBFF], [0xDC00, 0xDFFF],
	[0xE000, 0xF8FF], [0xF900, 0xFAFF], [0xFB00, 0xFB4F], [0xFB50, 0xFDFF], [0xFE20, 0xFE2F], [0xFE30, 0xFE4F],
	[0xFE50, 0xFE6F], [0xFE70, 0xFEFE], [0xFEFF, 0xFEFF], [0xFF00, 0xFFEF], [0xFFF0, 0xFFFD],
];
const MIN_COMPLEXITY = 49;
const MAX_COMPLEXITY = 120;

let banlist: Promise<string[]> | null = null;

/** upstream's banlist: a plain script in the deferred stack list that sets COMPLEXIFY_BANLIST */
function loadBanlist(): Promise<string[]> {
	const w = window as unknown as { COMPLEXIFY_BANLIST?: string[]; ProcessWire?: { config?: { AdminThemeBridge?: { legacyScripts?: string[] } } } };
	if (w.COMPLEXIFY_BANLIST) return Promise.resolve(w.COMPLEXIFY_BANLIST);
	if (banlist) return banlist;
	const urls = ((w.ProcessWire && w.ProcessWire.config && w.ProcessWire.config.AdminThemeBridge && w.ProcessWire.config.AdminThemeBridge.legacyScripts) || [])
		.filter(u => /complexify\.banlist(\.min)?\.js/.test(u));
	banlist = new Promise(resolve => {
		if (!urls.length) { resolve([]); return; }
		const s = document.createElement('script');
		s.src = urls[0];
		s.onload = () => resolve(w.COMPLEXIFY_BANLIST || []);
		s.onerror = () => resolve([]);
		document.head.appendChild(s);
	});
	return banlist;
}

export function complexity(password: string, opts: { banned: string[]; banMode: string; factor: number; minimumChars: number }): { valid: boolean; complexity: number } {
	const lower = password.toLowerCase();
	const banned = opts.banMode === 'strict'
		? opts.banned.some(b => lower.indexOf(b.toLowerCase()) !== -1)
		: opts.banned.indexOf(password) > -1;
	let c = 0;
	if (banned) {
		c = 1;
	} else {
		for (const [from, to] of CHARSETS) {
			for (let i = password.length - 1; i >= 0; i--) {
				const code = password.charCodeAt(i);
				if (from <= code && code <= to) { c += to - from + 1; break; }
			}
		}
	}
	let score = Math.log(Math.pow(c, password.length)) * (1 / (opts.factor || 1));
	const valid = score > MIN_COMPLEXITY && password.length >= opts.minimumChars;
	score = Math.min(100, (score / MAX_COMPLEXITY) * 100);
	return { valid, complexity: score };
}

const TESTS: Record<string, (v: string, min: number) => boolean> = {
	letter: v => /\p{L}/u.test(v),
	upper: v => /\p{Lu}/u.test(v),
	lower: v => /\p{Ll}/u.test(v),
	digit: v => /\p{N}/u.test(v),
	other: v => /\p{P}/u.test(v) || /\p{S}/u.test(v),
	space: v => /\p{Z}/u.test(v),
	minlength: (v, min) => v.length >= min,
};

export function init(wrap: HTMLElement): void {
	const input = wrap.querySelector<HTMLInputElement>('input.InputfieldPasswordComplexify');
	if (!input || input.hasAttribute('data-pw-password')) return;
	input.setAttribute('data-pw-password', '');
	const confirm = wrap.querySelector<HTMLInputElement>('.InputfieldPasswordConfirm');
	const confirms = confirm && confirm.nextElementSibling && confirm.nextElementSibling.classList.contains('pass-confirm') ? confirm.nextElementSibling as HTMLElement : null;
	const old = wrap.querySelector<HTMLInputElement>('input.InputfieldPasswordOld');
	const scoresWrap = input.parentElement ? input.parentElement.querySelector<HTMLElement>(':scope > .pass-scores') : null;
	const scores = scoresWrap ? Array.from(scoresWrap.children) as HTMLElement[] : [];
	const requirements = (scoresWrap && scoresWrap.getAttribute('data-requirements') || '').split(' ').filter(Boolean);
	const minlength = parseInt(input.getAttribute('data-minlength') || '0', 10) || 0;
	const opts = { banned: [] as string[], banMode: input.getAttribute('data-banMode') || 'loose', factor: parseFloat(input.getAttribute('data-factor') || '1'), minimumChars: minlength };
	const score = (cls: string): HTMLElement | null => scores.find(s => s.classList.contains(cls)) || null;

	if (old) {
		input.disabled = true;
		const unlock = (): void => {
			if (!old.value.length) return;
			input.disabled = false;
			['keyup', 'input', 'change', 'blur'].forEach(t => old.removeEventListener(t, unlock));
		};
		['keyup', 'input', 'change', 'blur'].forEach(t => on(old, t, unlock));
	}
	if (confirm) confirm.disabled = true;

	const evaluate = (): void => {
		const val = input.value;
		const len = val.length;
		const r = complexity(val, opts);
		let good = 0;
		if (len > 0) {
			requirements.forEach(req => {
				const pass = TESTS[req] ? TESTS[req](val, minlength) : true;
				wrap.querySelectorAll('.pass-require-' + req).forEach(el => {
					el.classList.toggle('pass-require-good', pass);
					el.classList.toggle('ui-priority-secondary', pass);
				});
				if (pass) good++;
			});
		} else {
			wrap.querySelectorAll('.pass-require-good').forEach(el => el.classList.remove('pass-require-good', 'ui-priority-secondary'));
		}
		if (len === 0) { scores.forEach(s => s.classList.remove('on')); return; }
		let cur: HTMLElement | null;
		if (old && old.value === val) cur = score('pass-same');
		else if (good < requirements.length) cur = score('pass-fail');
		else if (len < minlength) cur = score('pass-short');
		else if (!r.valid) cur = score('pass-common');
		else if (r.complexity === 0) cur = score('pass-invalid');
		else if (r.complexity < 50) cur = score('pass-weak');
		else if (r.complexity < 70) cur = score('pass-medium');
		else if (r.complexity < 100) cur = score('pass-good');
		else cur = score('pass-excellent');
		if (cur && !cur.classList.contains('on')) { scores.forEach(s => s.classList.remove('on')); cur.classList.add('on'); }
		const bad = !cur || ['pass-fail', 'pass-short', 'pass-common', 'pass-invalid', 'pass-same'].some(c => (cur as HTMLElement).classList.contains(c));
		if (confirm) {
			if (bad) {
				confirm.disabled = true;
				confirm.value = '';
				confirm.dispatchEvent(new Event('change', { bubbles: true }));
			} else {
				confirm.disabled = false;
			}
		}
		if (!bad && cur) {
			cur.querySelectorAll('small').forEach(s => s.remove());
			cur.insertAdjacentHTML('beforeend', `<small style='margin-left:0.5em'>(${Math.floor(r.complexity)}%)</small>`);
		}
		if (confirm && confirm.value.length) confirm.dispatchEvent(new Event('change', { bubbles: true }));
	};
	['keyup', 'focus', 'input', 'mouseup'].forEach(t => on(input, t, evaluate));
	void loadBanlist().then(list => { opts.banned = list; if (input.value) evaluate(); });

	on(input, 'change', () => {
		if (input.value.length) {
			input.required = true;
			if (confirm) confirm.required = true;
		} else if (!input.closest('.InputfieldStateRequired')) {
			input.required = false;
			if (confirm) confirm.required = false;
		}
	});

	if (confirm) {
		const check = (): void => {
			const v1 = input.value;
			const v2 = confirm.value;
			const p = input.closest('p');
			if (p) p.classList.remove('pass-matches');
			if (!confirms) return;
			let cur: Element | null;
			if (!v2.length) cur = confirms.querySelector(':scope > .confirm-pending');
			else if (v1 === v2) { cur = confirms.querySelector(':scope > .confirm-yes'); if (p) p.classList.add('pass-matches'); }
			else if (v1.indexOf(v2) === 0) {
				cur = confirms.querySelector(':scope > .confirm-qty');
				const span = cur ? cur.querySelector('span') : null;
				if (span) span.innerHTML = v2.length + '/' + v1.length;
			} else cur = confirms.querySelector(':scope > .confirm-no');
			if (cur) { Array.from(confirms.children).forEach(c => c.classList.remove('on')); cur.classList.add('on'); }
		};
		on(confirm, 'keyup', check);
		on(confirm, 'change', check);
	}

	const mask = wrap.querySelector<HTMLElement>('.pass-mask');
	if (mask) {
		const show = mask.querySelector<HTMLElement>('.pass-mask-show');
		const hide = mask.querySelector<HTMLElement>('.pass-mask-hide');
		if (hide) hide.style.display = 'none';
		if (show) on(show, 'click', e => {
			e.preventDefault();
			show.style.display = 'none';
			if (hide) hide.style.display = '';
			wrap.querySelectorAll<HTMLInputElement>('input[type=password]').forEach(i => { i.type = 'text'; i.classList.add('pass-unmask'); });
		});
		if (hide) on(hide, 'click', e => {
			e.preventDefault();
			hide.style.display = 'none';
			if (show) show.style.display = '';
			wrap.querySelectorAll<HTMLInputElement>('input.pass-unmask').forEach(i => { i.type = 'password'; i.classList.remove('pass-unmask'); });
		});
	}

	// Firefox fills a remembered password into a new-password input: undo it after a second
	window.setTimeout(() => {
		wrap.querySelectorAll<HTMLInputElement>("input[autocomplete='new-password']").forEach(i => {
			if (i.value.length < 1 || (i.getAttribute('value') || '').length > 0) return;
			i.value = '';
			i.dispatchEvent(new Event('keyup'));
			i.dispatchEvent(new Event('change', { bubbles: true }));
			const li = i.closest('.Inputfield');
			if (li) li.classList.remove('InputfieldStateChanged');
		});
	}, 1000);
}

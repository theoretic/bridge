/**
 * InputfieldDatetime without jQuery (milestone 2.4, ADR 0015). Upstream uses jQuery UI's
 * datepicker plus the timepicker add-on for the "text" type and a small jQuery script for the
 * "select" type; the "html" type needs no script. Same markup contracts:
 *
 * text: input.InputfieldDatetimeDatepicker.InputfieldDatetimeDatepicker{1 button | 2 inline | 3 focus}
 *       [data-dateformat (jQuery UI tokens)][data-timeformat][data-timeselect][data-ts][data-ampm]
 *       [data-yearrange][data-datepicker (JSON: changeMonth, changeYear, showButtonPanel,
 *       showOtherMonths, ...)]. The calendar is jQuery UI's markup (div.ui-datepicker, its header,
 *       table.ui-datepicker-calendar, ui-state-default / -active / -highlight), which the theme
 *       styles; a time row of selects (div.ui-timepicker-div) when a time format is set. Button
 *       mode shows a.pw-ui-datepicker-trigger after the input, as upstream does.
 * select: .InputfieldDatetimeSelect > select.InputfieldDatetimeMonth/Day/Year +
 *       input.InputfieldDatetimeValue; an impossible day is cleared (.InputfieldDatetimeError),
 *       the year select's "-" / "+" options extend the range.
 *
 * Names and the first weekday come from ProcessWire.config.InputfieldDatetimeDatepickerDefaults /
 * ...Options when given, else from Intl for the page language. Not ported: numberOfMonths > 1.
 */

import { on } from '../legacy';
import { label } from '../util/labels';
import { esc } from '../util/html';

type Regional = {
	monthNames: string[]; monthNamesShort: string[]; dayNames: string[]; dayNamesShort: string[];
	dayNamesMin: string[]; firstDay: number; prevText: string; nextText: string;
	currentText: string; closeText: string;
};

type PickerOptions = Regional & {
	changeMonth: boolean; changeYear: boolean; showButtonPanel: boolean; showOtherMonths: boolean;
	yearRange: string; [key: string]: unknown;
};

function regionalFromIntl(lang = document.documentElement.lang || navigator.language || 'en'): Regional {
	const month = (m: number, style: 'long' | 'short'): string =>
		new Intl.DateTimeFormat(lang, { month: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2021, m, 1)));
	// 2021-01-03 was a Sunday
	const day = (d: number, style: 'long' | 'short' | 'narrow'): string =>
		new Intl.DateTimeFormat(lang, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2021, 0, 3 + d)));
	let firstDay = 1;
	try {
		const info = (new Intl.Locale(lang) as unknown as { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } });
		const w = info.getWeekInfo ? info.getWeekInfo() : info.weekInfo;
		if (w && w.firstDay) firstDay = w.firstDay % 7;
	} catch (e) { /* older engines: Monday */ }
	const range = (n: number) => Array.from({ length: n }, (_, i) => i);
	return {
		monthNames: range(12).map(m => month(m, 'long')),
		monthNamesShort: range(12).map(m => month(m, 'short')),
		dayNames: range(7).map(d => day(d, 'long')),
		dayNamesShort: range(7).map(d => day(d, 'short')),
		dayNamesMin: range(7).map(d => day(d, 'short').slice(0, 2)),
		firstDay, prevText: '‹', nextText: '›', currentText: esc(label('today', 'Today')), closeText: esc(label('done', 'Done')),
	};
}

function config(name: string): Record<string, unknown> {
	const pw = (window as unknown as { ProcessWire?: { config?: Record<string, unknown> } }).ProcessWire;
	const v = pw && pw.config ? pw.config[name] : null;
	return v && typeof v === 'object' ? v as Record<string, unknown> : {};
}

const pad = (n: number, len = 2): string => String(n).padStart(len, '0');

/** Format with jQuery UI datepicker tokens */
export function formatDate(format: string, date: Date, r: Regional): string {
	let out = '';
	let literal = false;
	for (let i = 0; i < format.length; i++) {
		const c = format[i];
		if (literal) {
			if (c === "'" && format[i + 1] !== "'") literal = false;
			else out += c === "'" ? (i++, "'") : c;
			continue;
		}
		const count = (): number => { let n = 1; while (format[i + 1] === c) { n++; i++; } return n; };
		switch (c) {
			case 'd': out += count() === 2 ? pad(date.getDate()) : date.getDate(); break;
			case 'o': {
				const doy = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 864e5);
				out += count() === 2 ? pad(doy, 3) : doy;
				break;
			}
			case 'D': out += count() === 2 ? r.dayNames[date.getDay()] : r.dayNamesShort[date.getDay()]; break;
			case 'm': out += count() === 2 ? pad(date.getMonth() + 1) : date.getMonth() + 1; break;
			case 'M': out += count() === 2 ? r.monthNames[date.getMonth()] : r.monthNamesShort[date.getMonth()]; break;
			case 'y': out += count() === 2 ? date.getFullYear() : pad(date.getFullYear() % 100); break;
			case '@': out += date.getTime(); break;
			case '!': out += date.getTime() * 10000 + 621355968000000000; break;
			case "'": if (format[i + 1] === "'") { out += "'"; i++; } else literal = true; break;
			default: out += c;
		}
	}
	return out;
}

/** Parse with jQuery UI datepicker tokens; null when the text does not match */
export function parseDate(format: string, text: string, r: Regional): Date | null {
	let pos = 0;
	let year = -1, month = -1, day = -1;
	let literal = false;
	const num = (max: number): number => {
		const m = text.slice(pos).match(new RegExp('^\\d{1,' + max + '}'));
		if (!m) throw new Error('number');
		pos += m[0].length;
		return parseInt(m[0], 10);
	};
	const name = (names: string[]): number => {
		const sorted = names.map((n, i) => [n, i] as [string, number]).sort((a, b) => b[0].length - a[0].length);
		for (const [n, i] of sorted) {
			if (text.substr(pos, n.length).toLowerCase() === n.toLowerCase()) { pos += n.length; return i; }
		}
		throw new Error('name');
	};
	try {
		for (let i = 0; i < format.length; i++) {
			const c = format[i];
			if (literal) {
				if (c === "'" && format[i + 1] !== "'") { literal = false; continue; }
				if (c === "'") i++;
				if (text[pos] !== c) throw new Error('literal');
				pos++;
				continue;
			}
			const count = (): number => { let n = 1; while (format[i + 1] === c) { n++; i++; } return n; };
			switch (c) {
				case 'd': count(); day = num(2); break;
				case 'o': count(); num(3); break;
				case 'D': name(count() === 2 ? r.dayNames : r.dayNamesShort); break;
				case 'm': count(); month = num(2) - 1; break;
				case 'M': month = name(count() === 2 ? r.monthNames : r.monthNamesShort); break;
				case 'y': {
					const four = count() === 2;
					year = num(four ? 4 : 2);
					if (!four) year += year < 50 ? 2000 : 1900;
					break;
				}
				case '@': { const ms = num(15); return new Date(ms); }
				case "'": if (format[i + 1] === "'") { i++; if (text[pos++] !== "'") throw new Error('q'); } else literal = true; break;
				default: if (text[pos] !== c) throw new Error('literal'); pos++;
			}
		}
	} catch (e) {
		return null;
	}
	if (year < 0 || month < 0 || day < 1) return null;
	const d = new Date(year, month, day);
	return d.getMonth() === month ? d : null;
}

type Time = { h: number; m: number; s: number };

function formatTime(format: string, t: Time): string {
	return format.replace(/HH|H|hh|h|mm|m|ss|s|TT|T|tt|t|'[^']*'/g, tok => {
		const h12 = t.h % 12 === 0 ? 12 : t.h % 12;
		switch (tok) {
			case 'HH': return pad(t.h);
			case 'H': return String(t.h);
			case 'hh': return pad(h12);
			case 'h': return String(h12);
			case 'mm': return pad(t.m);
			case 'm': return String(t.m);
			case 'ss': return pad(t.s);
			case 's': return String(t.s);
			case 'TT': return t.h < 12 ? 'AM' : 'PM';
			case 'T': return t.h < 12 ? 'A' : 'P';
			case 'tt': return t.h < 12 ? 'am' : 'pm';
			case 't': return t.h < 12 ? 'a' : 'p';
			default: return tok.slice(1, -1);
		}
	});
}

function parseTime(text: string): Time {
	const m = text.match(/(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?\s*([ap])?/i);
	if (!m) return { h: 0, m: 0, s: 0 };
	let h = parseInt(m[1], 10);
	if (m[4]) {
		const pm = m[4].toLowerCase() === 'p';
		if (pm && h < 12) h += 12;
		if (!pm && h === 12) h = 0;
	}
	return { h, m: m[2] ? parseInt(m[2], 10) : 0, s: m[3] ? parseInt(m[3], 10) : 0 };
}

function yearBounds(range: string, around: number): [number, number] {
	const now = new Date().getFullYear();
	const part = (p: string): number => {
		if (/^c[+-]\d+$/.test(p)) return around + parseInt(p.slice(1), 10);
		if (/^[+-]\d+$/.test(p)) return now + parseInt(p, 10);
		return parseInt(p, 10) || now;
	};
	const [a, b] = (range || 'c-10:c+10').split(':');
	return [part(a), part(b || a)];
}

// one popup at a time: opening a picker closes the one that is open
let closeOpen: (() => void) | null = null;

function setupPicker(input: HTMLInputElement): void {
	if (input.classList.contains('initDatepicker')) return;
	input.classList.add('initDatepicker');
	const inline = input.classList.contains('InputfieldDatetimeDatepicker2');
	const onFocus = input.classList.contains('InputfieldDatetimeDatepicker3');
	const dateFormat = input.getAttribute('data-dateformat') || 'yy-mm-dd';
	const timeFormat = inline ? '' : (input.getAttribute('data-timeformat') || '');
	const ampm = parseInt(input.getAttribute('data-ampm') || '0', 10) > 0 && /[hHtT]/.test(timeFormat) && !/HH|H/.test(timeFormat);
	let attrOptions: Record<string, unknown> = {};
	try { attrOptions = JSON.parse(input.getAttribute('data-datepicker') || '{}'); } catch (e) { /* defaults */ }
	const overrides = Object.assign({}, config('InputfieldDatetimeDatepickerDefaults'), attrOptions, config('InputfieldDatetimeDatepickerOptions'));
	const o: PickerOptions = Object.assign(regionalFromIntl(), {
		changeMonth: true, changeYear: true, showButtonPanel: false, showOtherMonths: false, yearRange: '',
	}, overrides) as PickerOptions;
	// the value is read back by PHP's date parser, which knows English names only (upstream's
	// picker writes English unless a jQuery UI i18n file is loaded): the calendar shows the admin's
	// language, the input gets English names, or the names the site's options set
	const valueNames: Regional = Object.assign(regionalFromIntl('en'), overrides);
	if (input.getAttribute('data-yearrange')) o.yearRange = input.getAttribute('data-yearrange') as string;

	const ts = parseInt(input.getAttribute('data-ts') || '0', 10);
	// the parser stops after the date tokens, so a trailing time does not disturb it
	const valueDate = (): Date | null => {
		const text = input.value.trim();
		return text ? parseDate(dateFormat, text, valueNames) || parseDate(dateFormat, text, o) : null;
	};
	const valueTime = (): Time => {
		const m = input.value.match(/(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m?\.?)?)\s*$/i);
		return m ? parseTime(m[1]) : { h: 0, m: 0, s: 0 };
	};
	let selected: Date | null = valueDate() || (ts > 1 ? new Date(ts) : null);
	let time: Time = timeFormat ? valueTime() : { h: 0, m: 0, s: 0 };
	let view = selected ? new Date(selected.getFullYear(), selected.getMonth(), 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

	const box = document.createElement('div');
	box.className = 'ui-datepicker ui-widget ui-widget-content ui-helper-clearfix ui-corner-all' + (inline ? ' ui-datepicker-inline' : '');
	if (!inline) {
		box.style.position = 'absolute';
		box.style.display = 'none';
		box.style.zIndex = '200';
		// in <body> only while open (audit R6): a picker per field, repeater item and selector row
		// would otherwise leave a hidden popup behind for each
	} else {
		input.insertAdjacentElement('afterend', box);
	}

	const write = (): void => {
		if (!selected) return;
		input.value = formatDate(dateFormat, selected, valueNames) +(timeFormat ? ' ' + formatTime(timeFormat, time) : '');
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new Event('change', { bubbles: true }));
	};

	const render = (): void => {
		const y = view.getFullYear();
		const m = view.getMonth();
		const [fromYear, toYear] = yearBounds(o.yearRange, selected ? selected.getFullYear() : y);
		let title = '';
		if (o.changeMonth) {
			title += '<select class="ui-datepicker-month" aria-label="month">' + o.monthNamesShort.map((n, i) =>
				'<option value="' + i + '"' + (i === m ? ' selected' : '') + '>' + n + '</option>').join('') + '</select>';
		} else {
			title += '<span class="ui-datepicker-month">' + o.monthNames[m] + '</span>';
		}
		if (o.changeYear) {
			let years = '';
			for (let yy = Math.min(fromYear, y); yy <= Math.max(toYear, y); yy++) years += '<option value="' + yy + '"' + (yy === y ? ' selected' : '') + '>' + yy + '</option>';
			title += '<select class="ui-datepicker-year" aria-label="year">' + years + '</select>';
		} else {
			title += '&nbsp;<span class="ui-datepicker-year">' + y + '</span>';
		}
		let head = '';
		for (let i = 0; i < 7; i++) {
			const d = (i + o.firstDay) % 7;
			head += '<th' + (d === 0 || d === 6 ? ' class="ui-datepicker-week-end"' : '') + '><span title="' + o.dayNames[d] + '">' + o.dayNamesMin[d] + '</span></th>';
		}
		const first = new Date(y, m, 1);
		const lead = (first.getDay() - o.firstDay + 7) % 7;
		const days = new Date(y, m + 1, 0).getDate();
		const today = new Date();
		let rows = '';
		let cell = 0;
		for (let week = 0; cell < lead + days; week++) {
			rows += '<tr>';
			for (let i = 0; i < 7; i++, cell++) {
				const date = new Date(y, m, cell - lead + 1);
				const inMonth = date.getMonth() === m;
				if (!inMonth && !o.showOtherMonths) {
					rows += '<td class="ui-datepicker-other-month ui-datepicker-unselectable ui-state-disabled">&nbsp;</td>';
					continue;
				}
				const isToday = date.toDateString() === today.toDateString();
				const isSel = !!selected && date.toDateString() === selected.toDateString();
				rows += '<td class="' + (inMonth ? '' : 'ui-datepicker-other-month ') + (isToday ? 'ui-datepicker-today' : '') +
					'" data-date="' + date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate() + '"><a class="ui-state-default' +
					(isToday ? ' ui-state-highlight' : '') + (isSel ? ' ui-state-active' : '') + '" href="#">' + date.getDate() + '</a></td>';
			}
			rows += '</tr>';
		}
		let timeRow = '';
		if (timeFormat) {
			const opts = (n: number, step = 1, sel = 0, fmt = (v: number) => pad(v)) => {
				let s = '';
				for (let v = 0; v < n; v += step) s += '<option value="' + v + '"' + (v === sel ? ' selected' : '') + '>' + fmt(v) + '</option>';
				return s;
			};
			const hours = ampm
				? opts(24, 1, time.h, v => (v % 12 === 0 ? 12 : v % 12) + (v < 12 ? ' am' : ' pm'))
				: opts(24, 1, time.h);
			timeRow = '<div class="ui-timepicker-div"><select class="ui-timepicker-hour" aria-label="hour">' + hours + '</select>' +
				(/m/.test(timeFormat) ? ' : <select class="ui-timepicker-minute" aria-label="minute">' + opts(60, 1, time.m) + '</select>' : '') +
				(/s/.test(timeFormat) ? ' : <select class="ui-timepicker-second" aria-label="second">' + opts(60, 1, time.s) + '</select>' : '') + '</div>';
		}
		const panel = o.showButtonPanel || timeFormat
			? '<div class="ui-datepicker-buttonpane ui-widget-content"><button type="button" class="ui-datepicker-current ui-state-default ui-priority-secondary ui-corner-all">' +
				o.currentText + '</button>' + (inline ? '' : '<button type="button" class="ui-datepicker-close ui-state-default ui-priority-primary ui-corner-all">' + o.closeText + '</button>') + '</div>'
			: '';
		box.innerHTML =
			'<div class="ui-datepicker-header ui-widget-header ui-helper-clearfix ui-corner-all">' +
			'<a class="ui-datepicker-prev ui-corner-all" href="#" title="' + o.prevText + '" aria-label="' + o.prevText + '"><i class="fa fa-angle-left"></i></a>' +
			'<a class="ui-datepicker-next ui-corner-all" href="#" title="' + o.nextText + '" aria-label="' + o.nextText + '"><i class="fa fa-angle-right"></i></a>' +
			'<div class="ui-datepicker-title">' + title + '</div></div>' +
			'<table class="ui-datepicker-calendar"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table>' +
			timeRow + panel;
	};

	const position = (): void => {
		const r = input.getBoundingClientRect();
		box.style.left = (r.left + window.scrollX) + 'px';
		box.style.top = (r.bottom + window.scrollY + 4) + 'px';
	};
	const isOpen = (): boolean => inline || box.style.display !== 'none';
	let trigger: HTMLAnchorElement | null = null;
	const open = (): void => {
		if (inline || isOpen()) return;
		if (closeOpen) closeOpen();
		closeOpen = close;
		selected = valueDate() || selected;
		if (selected) view = new Date(selected.getFullYear(), selected.getMonth(), 1);
		if (!box.isConnected) document.body.appendChild(box);
		render();
		position();
		box.style.display = 'block';
		document.addEventListener('mousedown', outside);
	};
	const close = (): void => {
		if (inline) return;
		box.style.display = 'none';
		box.remove();
		document.removeEventListener('mousedown', outside);
		if (closeOpen === close) closeOpen = null;
	};
	// a press outside the picker, its input and its trigger closes it (listening only while open)
	function outside(e: MouseEvent): void {
		const t = e.target as HTMLElement;
		if (box.contains(t) || t === input || (trigger && trigger.contains(t))) return;
		close();
	}

	on(box, 'mousedown', e => {
		if (!(e.target as HTMLElement).closest('select')) e.preventDefault(); // keep the input focused
	});
	on(box, 'click', e => {
		const t = e.target as HTMLElement;
		if (t.closest('.ui-datepicker-prev, .ui-datepicker-next')) {
			e.preventDefault();
			view = new Date(view.getFullYear(), view.getMonth() + (t.closest('.ui-datepicker-prev') ? -1 : 1), 1);
			render();
			return;
		}
		const td = t.closest<HTMLElement>('td[data-date]');
		if (td && t.closest('a')) {
			e.preventDefault();
			const [yy, mm, dd] = (td.getAttribute('data-date') as string).split('-').map(Number);
			selected = new Date(yy, mm, dd);
			write();
			if (timeFormat) render();
			else close();
			if (inline) render();
			return;
		}
		if (t.closest('.ui-datepicker-current')) {
			const now = new Date();
			selected = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			if (timeFormat) time = { h: now.getHours(), m: now.getMinutes(), s: now.getSeconds() };
			view = new Date(now.getFullYear(), now.getMonth(), 1);
			write();
			render();
			return;
		}
		if (t.closest('.ui-datepicker-close')) close();
	});
	on(box, 'change', e => {
		const t = e.target as HTMLSelectElement;
		if (t.classList.contains('ui-datepicker-month')) view = new Date(view.getFullYear(), parseInt(t.value, 10), 1);
		else if (t.classList.contains('ui-datepicker-year')) view = new Date(parseInt(t.value, 10), view.getMonth(), 1);
		else if (t.className.indexOf('ui-timepicker-') === 0) {
			if (t.classList.contains('ui-timepicker-hour')) time.h = parseInt(t.value, 10);
			if (t.classList.contains('ui-timepicker-minute')) time.m = parseInt(t.value, 10);
			if (t.classList.contains('ui-timepicker-second')) time.s = parseInt(t.value, 10);
			if (!selected) selected = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
			write();
			return;
		}
		render();
	});

	if (inline) {
		render();
	} else if (onFocus) {
		on(input, 'focus', open);
		on(input, 'click', open);
	} else {
		trigger = document.createElement('a');
		trigger.className = 'pw-ui-datepicker-trigger';
		trigger.href = '#';
		trigger.innerHTML = "<i class='fa fa-calendar'></i>";
		input.insertAdjacentElement('afterend', trigger);
		on(trigger, 'mousedown', e => e.preventDefault());
		on(trigger, 'click', e => {
			e.preventDefault();
			if (isOpen()) close();
			else { input.focus(); open(); }
		});
	}
	on(input, 'blur', () => window.setTimeout(() => { if (document.activeElement && box.contains(document.activeElement)) return; close(); }, 150));
	on(input, 'keydown', e => { if (e.key === 'Escape') close(); });
	on(input, 'change', () => {
		const d = valueDate();
		if (d) {
			selected = d;
			view = new Date(d.getFullYear(), d.getMonth(), 1);
			if (isOpen()) render();
		}
	});
}

function setupSelect(wrap: HTMLElement): void {
	if (wrap.hasAttribute('data-pw-datetime')) return;
	wrap.setAttribute('data-pw-datetime', '');
	on(wrap, 'change', e => {
		const select = e.target as HTMLSelectElement;
		if (!select.matches || !select.matches('select')) return;
		const parent = select.parentElement as HTMLElement;
		if (select.classList.contains('InputfieldDatetimeYear')) extendYears(select);
		const get = (cls: string) => parent.querySelector<HTMLSelectElement>(':scope > .' + cls);
		const monthEl = get('InputfieldDatetimeMonth');
		const dayEl = get('InputfieldDatetimeDay');
		const yearEl = get('InputfieldDatetimeYear');
		const valueEl = parent.querySelector<HTMLInputElement>(':scope > .InputfieldDatetimeValue');
		const month = parseInt(monthEl ? monthEl.value : '', 10);
		let day = parseInt(dayEl ? dayEl.value : '', 10);
		const year = parseInt(yearEl ? yearEl.value : '', 10);
		const date = month && day && year ? new Date(year, month - 1, day) : null;
		if (date && date.getMonth() + 1 !== month) {
			day = 0;
			if (dayEl) { dayEl.value = ''; dayEl.classList.add('InputfieldDatetimeError'); }
		} else if (dayEl) {
			dayEl.classList.remove('InputfieldDatetimeError');
		}
		if (valueEl) valueEl.value = date && day ? year + '-' + month + '-' + day : '';
	});
}

function extendYears(select: HTMLSelectElement): void {
	const value = select.value;
	if (value !== '-' && value !== '+') return;
	const option = select.querySelector<HTMLOptionElement>('option[value="' + value + '"]') as HTMLOptionElement;
	const blank = select.querySelector<HTMLOptionElement>('option[value=""]');
	let from = parseInt(select.getAttribute('data-from-year') || '0', 10);
	let to = parseInt(select.getAttribute('data-to-year') || '0', 10);
	const span = Math.max(to - from, 10);
	if (value === '-') {
		to = from - 1;
		from -= span;
		for (let n = to; n >= from; n--) select.insertBefore(new Option(String(n), String(n)), select.firstChild);
		option.innerHTML = '&lt; ' + from;
		select.insertBefore(option, select.firstChild);
		if (blank) select.insertBefore(blank, select.firstChild);
		select.value = String(to);
		select.setAttribute('data-from-year', String(from));
	} else {
		from = to + 1;
		to += span;
		for (let n = from; n <= to; n++) select.appendChild(new Option(String(n), String(n)));
		option.innerHTML = '&gt; ' + to;
		select.appendChild(option);
		select.value = String(from);
		select.setAttribute('data-to-year', String(to));
	}
}

export function init(el: HTMLElement): void {
	if (el instanceof HTMLInputElement) setupPicker(el);
	else setupSelect(el);
}

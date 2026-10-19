/**
 * InputfieldIcon without jQuery (milestone 3.6, ADR 0016). Ports upstream InputfieldIcon.js (core
 * 3.0.274): the select's choice shows in the field header icon (ProcessWire.icon() markup with
 * Font Awesome 6), and typing three or more letters in .InputfieldIconSearch shows the matching
 * icons in .InputfieldIconAll (built once from the select's options); a click on one selects it
 * (again: clears it), Enter takes the first match.
 */

type PW = { config?: { adminIcons?: { version?: string | number } }; icon?: (name: string, extra?: string) => string };

function pw(): PW {
	return ((window as unknown as { ProcessWire?: PW }).ProcessWire) || {};
}

function fa6(): boolean {
	const p = pw();
	return !!(p.config && p.config.adminIcons && parseInt(String(p.config.adminIcons.version), 10) >= 6 && p.icon);
}

function iconHtml(value: string, extraClass = ''): string {
	const p = pw();
	if (fa6() && p.icon) {
		const html = p.icon(value.replace(/^fa-/, ''), 'fw');
		return extraClass ? html.replace(/'><\/i>$/, ` ${extraClass}' title='${value}'></i>`) : html;
	}
	return `<i class='fa fw ${value}${extraClass ? ' ' + extraClass : ''}' title='${value}'></i>`;
}

export function init(wrap: HTMLElement): void {
	const select = wrap.querySelector<HTMLSelectElement>('select');
	if (!select || select.hasAttribute('data-pw-icon')) return;
	select.setAttribute('data-pw-icon', '');
	const search = wrap.querySelector<HTMLInputElement>('.InputfieldIconSearch');
	const all = wrap.querySelector<HTMLElement>('.InputfieldIconAll');
	select.addEventListener('change', () => {
		const val = select.value;
		if (val.length) {
			const header = wrap.querySelector<HTMLElement>('.InputfieldHeader > i:first-child');
			if (header) {
				const tmp = document.createElement('span');
				tmp.innerHTML = fa6() ? iconHtml(val) : `<i class='fa fa-fw ${val}'></i>`;
				const i = tmp.firstElementChild;
				if (i) header.className = i.className;
				if (header.parentElement && header.parentElement.animate) header.parentElement.animate([{ opacity: .4 }, { opacity: 1 }], { duration: 500 });
			}
		}
		select.classList.remove('on');
	});
	if (!search || !all) return;
	all.style.display = 'none';
	search.addEventListener('keydown', e => {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		const first = Array.from(all.querySelectorAll<HTMLElement>('i')).find(i => i.style.display !== 'none');
		if (first) first.click();
	});
	search.addEventListener('input', () => {
		const term = search.value.toLowerCase().replace(/^fa-/, '').trim();
		if (term.length < 3) { all.style.display = 'none'; return; }
		if (!all.classList.contains('initialized')) {
			all.classList.add('initialized');
			all.insertAdjacentHTML('beforeend', Array.from(select.options).filter(o => o.value).map(o => iconHtml(o.value, 'InputfieldIconItem')).join(''));
			all.addEventListener('click', e => {
				const i = (e.target as HTMLElement).closest('i');
				if (!i) return;
				if (i.classList.contains('on')) {
					i.classList.remove('on');
					select.value = '';
				} else {
					all.querySelectorAll('.on').forEach(x => x.classList.remove('on'));
					i.classList.add('on');
					select.value = i.getAttribute('title') || '';
				}
				select.dispatchEvent(new Event('change', { bubbles: true }));
			});
		}
		let any = false;
		all.querySelectorAll<HTMLElement>('i').forEach(i => {
			const name = (i.getAttribute('title') || '').replace(/^fa-/, '').toLowerCase();
			const show = name.indexOf(term) >= 0;
			i.style.display = show ? '' : 'none';
			if (show) any = true;
		});
		all.style.display = any ? '' : 'none';
		if (any) {
			all.querySelectorAll('.on').forEach(x => x.classList.remove('on'));
			if (select.value) all.querySelector(`[title="${CSS.escape(select.value)}"]`)?.classList.add('on');
		}
	});
}

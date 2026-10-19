/**
 * InputfieldPage without jQuery (milestone 2.4, ADR 0015). Ports upstream InputfieldPage.js:
 *
 * - "Add new" (InputfieldPageAdd): the link p.InputfieldPageAddButton > a shows or hides the
 *   following p.InputfieldPageAddItems (and clears its inputs when hiding).
 * - Dependent selects: an input.findPagesSelector whose selector refers to another field of the
 *   page (=page.<field>, or =item.<field> inside a repeater item) reloads this field's options
 *   from page/search/for when that field changes, keeping what was selected; asmSelect rebuilds
 *   from the change event of its original select.
 *
 * The inner widget (Select, Radios, Checkboxes, asmSelect, ...) is initialised by its own entry.
 */

type Match = { id: number; name: string; [key: string]: unknown };

function adminUrl(): string {
	const pw = (window as unknown as { ProcessWire?: { config?: { urls?: { admin?: string } } } }).ProcessWire;
	return (pw && pw.config && pw.config.urls && pw.config.urls.admin) || '/processwire/';
}

function valueOf(el: HTMLSelectElement | HTMLInputElement): string {
	if (el instanceof HTMLSelectElement && el.multiple) {
		return Array.from(el.selectedOptions).map(o => o.value).join(',');
	}
	return el.value;
}

async function reloadOptions(source: HTMLSelectElement | HTMLInputElement, target: HTMLSelectElement,
	selector: string, formatName: string, labelField: string, part: string, changed: boolean): Promise<void> {
	const v = valueOf(source);
	if (!v) {
		if (target.options.length) {
			target.innerHTML = '';
			target.dispatchEvent(new Event('change', { bubbles: true }));
		}
		return;
	}
	let query = selector.replace(part, '=' + v.replace(/,/g, '|'));
	query = query.replace(/,\s*/g, '&').replace(/\./g, '-').replace(/_LPID[0-9]+/g, '');
	let url = adminUrl() + 'page/search/for?' + query + '&limit=9999&get=' + encodeURIComponent(labelField);
	if (formatName) url += '&format_name=' + encodeURIComponent(formatName);
	const res = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
	if (!res.ok) return;
	const data = await res.json() as { matches?: Match[] };
	const matches = data.matches || [];
	const stale = new Set(Array.from(target.options));
	let selectedCount = 0;
	for (const page of matches) {
		const existing = Array.from(target.options).find(o => o.value === String(page.id));
		const selected = !!existing && existing.selected;
		if (existing) {
			stale.delete(existing);
			existing.remove();
		}
		if (selected) selectedCount++;
		let label = formatName ? String(page[formatName] || '') : '';
		if (!label) label = String(page[labelField] || '');
		if (!label) label = page.name;
		const option = document.createElement('option');
		option.value = String(page.id);
		option.textContent = label;
		if (selected) {
			option.selected = true;
			option.setAttribute('selected', 'selected');
		}
		target.appendChild(option);
	}
	stale.forEach(o => o.remove());
	if (!target.multiple) {
		const blank = document.createElement('option');
		blank.value = '';
		blank.innerHTML = '&nbsp;';
		if (!selectedCount) blank.selected = true;
		target.insertBefore(blank, target.firstChild);
	}
	if (changed || target.closest('.InputfieldAsmSelect')) target.dispatchEvent(new Event('change', { bubbles: true }));
}

function initSelector(input: HTMLInputElement): void {
	let selector = input.value;
	const hasPage = selector.indexOf('=page.') > -1;
	const hasItem = selector.indexOf('=item.') > -1;
	if (!hasPage && !hasItem) return;
	if (hasItem) selector = selector.split('=item.').join('=page.');
	const labelField = input.getAttribute('data-label') || 'name';
	const formatName = input.getAttribute('data-formatname') || '';
	const wrap = input.closest<HTMLElement>('.InputfieldPage');
	if (!wrap || !wrap.id) return;
	const target = document.getElementById(wrap.id.replace(/^wrap_/, ''));
	if (!(target instanceof HTMLSelectElement)) return;
	const repeaterItems: HTMLElement[] = [];
	for (let p = input.closest<HTMLElement>('.InputfieldRepeaterItem'); p; p = p.parentElement ? p.parentElement.closest<HTMLElement>('.InputfieldRepeaterItem') : null) repeaterItems.push(p);
	for (const part of selector.match(/(=page\.[_a-zA-Z0-9]+)/g) || []) {
		const name = part.replace('=page.', '');
		let source = document.getElementById('Inputfield_' + name) as HTMLSelectElement | HTMLInputElement | null;
		if ((!source || hasItem) && repeaterItems.length) {
			for (const item of repeaterItems) {
				const inItem = document.getElementById('Inputfield_' + name + '_repeater' + item.getAttribute('data-page'));
				if (inItem) {
					source = inItem as HTMLSelectElement | HTMLInputElement;
					break;
				}
			}
		}
		if (!source) continue;
		const from = source;
		from.addEventListener('change', () => { void reloadOptions(from, target, selector, formatName, labelField, part, true); });
		const hasChoices = Array.from(target.options).some(o => o.value !== '');
		if (valueOf(from) && !target.value && !hasChoices) {
			window.setTimeout(() => { void reloadOptions(from, target, selector, formatName, labelField, part, false); }, 100);
		}
	}
}

export function init(wrap: HTMLElement): void {
	if (wrap.hasAttribute('data-pw-page')) return;
	wrap.setAttribute('data-pw-page', '');
	wrap.addEventListener('click', e => {
		const a = (e.target as HTMLElement).closest('p.InputfieldPageAddButton a');
		if (!a || !wrap.contains(a)) return;
		e.preventDefault();
		const items = (a.parentElement as HTMLElement).nextElementSibling as HTMLElement | null;
		if (!items || !items.classList.contains('InputfieldPageAddItems')) return;
		const shown = items.offsetParent !== null || getComputedStyle(items).display !== 'none';
		if (shown) {
			items.style.display = 'none';
			items.querySelectorAll<HTMLInputElement>('input, textarea, select').forEach(i => { i.value = ''; });
		} else {
			items.style.display = 'block';
		}
	});
	wrap.querySelectorAll<HTMLInputElement>('.findPagesSelector').forEach(initSelector);
}

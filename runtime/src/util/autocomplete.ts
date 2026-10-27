/**
 * Autocomplete menu without jQuery UI (Phase 2). Same markup and classes as jQuery UI's
 * autocomplete, which the theme already styles (35-jqueryui.css):
 *
 *   ul.ui-autocomplete.ui-menu.ui-front.ui-widget.ui-widget-content (in <body>, under the input)
 *     > li.ui-menu-item > a.ui-menu-item-wrapper  (.ui-state-active on the highlighted one)
 *
 * Typing waits `delay` ms, needs `minLength` characters, then asks `source` for suggestions.
 * Arrow keys move, Enter or a click selects, Escape or blur closes. While the menu has an active
 * item, Enter is consumed (the field's own Enter handling does not run).
 */

export type Suggestion = { label: string; value: string; [key: string]: unknown };

export type AutocompleteOptions = {
	minLength?: number;
	delay?: number;
	source: (term: string) => Promise<Suggestion[]>;
	select: (item: Suggestion) => void;
};

export function attachAutocomplete(input: HTMLInputElement, options: AutocompleteOptions): void {
	const minLength = options.minLength ?? 2;
	const delay = options.delay ?? 300;
	let timer = 0;
	let request = 0;
	let items: Suggestion[] = [];
	let active = -1;
	const menu = document.createElement('ul');
	menu.className = 'ui-autocomplete ui-menu ui-front ui-widget ui-widget-content';
	menu.setAttribute('role', 'listbox');
	menu.style.display = 'none';
	menu.style.position = 'absolute';
	// in <body> only while open, with its resize listener (audit R6): one per attached input would
	// otherwise stay behind for every repeater item and reloaded field

	const close = (): void => {
		menu.style.display = 'none';
		menu.remove();
		window.removeEventListener('resize', reposition);
		active = -1;
		input.setAttribute('aria-expanded', 'false');
	};

	const position = (): void => {
		const r = input.getBoundingClientRect();
		menu.style.left = (r.left + window.scrollX) + 'px';
		menu.style.top = (r.bottom + window.scrollY + 2) + 'px';
		menu.style.width = r.width + 'px';
	};

	const highlight = (n: number): void => {
		const links = menu.querySelectorAll('a.ui-menu-item-wrapper');
		links.forEach((a, i) => a.classList.toggle('ui-state-active', i === n));
		active = n;
		const a = links[n] as HTMLElement | undefined;
		if (a) a.scrollIntoView({ block: 'nearest' });
	};

	const render = (list: Suggestion[]): void => {
		items = list;
		menu.innerHTML = '';
		if (!list.length) {
			close();
			return;
		}
		list.forEach((item, n) => {
			const li = document.createElement('li');
			li.className = 'ui-menu-item';
			const a = document.createElement('a');
			a.className = 'ui-menu-item-wrapper';
			a.setAttribute('role', 'option');
			a.textContent = item.label;
			a.addEventListener('mousedown', e => e.preventDefault()); // keep the focus in the input
			a.addEventListener('click', () => choose(n));
			a.addEventListener('mouseenter', () => highlight(n));
			li.appendChild(a);
			menu.appendChild(li);
		});
		if (!menu.isConnected) document.body.appendChild(menu);
		position();
		menu.style.display = 'block';
		window.addEventListener('resize', reposition);
		input.setAttribute('aria-expanded', 'true');
		active = -1;
	};

	const choose = (n: number): void => {
		const item = items[n];
		close();
		if (item) options.select(item);
	};

	const search = (): void => {
		const term = input.value;
		if (term.length < minLength) {
			close();
			return;
		}
		const id = ++request;
		options.source(term).then(list => {
			if (id === request && document.activeElement === input) render(list);
		}).catch(() => close());
	};

	input.setAttribute('autocomplete', 'off');
	input.setAttribute('aria-autocomplete', 'list');
	input.addEventListener('input', () => {
		window.clearTimeout(timer);
		timer = window.setTimeout(search, delay);
	});
	input.addEventListener('keydown', e => {
		const open = menu.style.display !== 'none';
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			if (!open) return;
			e.preventDefault();
			const n = items.length;
			highlight(e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n);
		} else if (e.key === 'Enter' && open && active > -1) {
			e.preventDefault();
			e.stopImmediatePropagation();
			choose(active);
		} else if (e.key === 'Escape' && open) {
			e.preventDefault();
			close();
		}
	});
	input.addEventListener('blur', () => window.setTimeout(close, 150));
	function reposition(): void { if (menu.style.display !== 'none') position(); }
}

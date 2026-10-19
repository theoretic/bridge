/**
 * <pw-tabs>: tabs with URL-hash state, light DOM, no dependencies.
 *
 * Markup:
 *   <pw-tabs>
 *     <section id="one" data-tab="Label one">…</section>
 *     <section id="two" data-tab="Label two">…</section>
 *   </pw-tabs>
 *
 * The element inserts <ul class="pw-tabs-nav" role="tablist"> before the sections. The active
 * section id is reflected in location.hash (replaceState) and in the `active` attribute.
 * Dispatches 'pw-tabs-change' (detail: { id }) on change. Keyboard: arrows, Home, End.
 */

export class PwTabs extends HTMLElement {
	private nav: HTMLUListElement | null = null;

	static get observedAttributes(): string[] {
		return ['active'];
	}

	connectedCallback(): void {
		if (!this.nav) this.render();
		const fromHash = location.hash ? location.hash.slice(1) : '';
		const initial = this.getAttribute('active') || (fromHash && this.sectionById(fromHash) ? fromHash : '') || this.sections()[0]?.id || '';
		if (initial) this.activate(initial, false);
		window.addEventListener('hashchange', this.onHashChange);
	}

	disconnectedCallback(): void {
		window.removeEventListener('hashchange', this.onHashChange);
	}

	attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
		if (name === 'active' && newValue && newValue !== oldValue && this.nav) this.activate(newValue, false);
	}

	sections(): HTMLElement[] {
		return Array.from(this.children).filter(c => c.tagName === 'SECTION' && c.id) as HTMLElement[];
	}

	sectionById(id: string): HTMLElement | null {
		return this.sections().find(s => s.id === id) || null;
	}

	private render(): void {
		const nav = document.createElement('ul');
		nav.className = 'pw-tabs-nav';
		nav.setAttribute('role', 'tablist');
		for (const section of this.sections()) {
			section.setAttribute('role', 'tabpanel');
			section.setAttribute('aria-labelledby', `tab-${section.id}`);
			const li = document.createElement('li');
			li.setAttribute('role', 'presentation');
			const a = document.createElement('a');
			a.id = `tab-${section.id}`;
			a.href = `#${section.id}`;
			a.setAttribute('role', 'tab');
			a.textContent = section.getAttribute('data-tab') || section.id;
			a.addEventListener('click', e => {
				e.preventDefault();
				this.activate(section.id, true);
			});
			a.addEventListener('keydown', e => this.onKey(e, section.id));
			li.appendChild(a);
			nav.appendChild(li);
		}
		this.insertBefore(nav, this.firstChild);
		this.nav = nav;
	}

	activate(id: string, pushHash: boolean): void {
		const target = this.sectionById(id);
		if (!target) return;
		for (const section of this.sections()) {
			const active = section === target;
			section.hidden = !active;
			const tab = this.nav?.querySelector<HTMLAnchorElement>(`#tab-${CSS.escape(section.id)}`);
			if (tab) {
				tab.setAttribute('aria-selected', active ? 'true' : 'false');
				tab.tabIndex = active ? 0 : -1;
				tab.parentElement?.classList.toggle('pw-active', active);
			}
		}
		if (this.getAttribute('active') !== id) this.setAttribute('active', id);
		if (pushHash && location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
		this.dispatchEvent(new CustomEvent('pw-tabs-change', { bubbles: true, detail: { id } }));
	}

	private onHashChange = (): void => {
		const id = location.hash.slice(1);
		if (id && this.sectionById(id)) this.activate(id, false);
	};

	private onKey(e: KeyboardEvent, id: string): void {
		const ids = this.sections().map(s => s.id);
		const i = ids.indexOf(id);
		let next = -1;
		if (e.key === 'ArrowRight') next = (i + 1) % ids.length;
		else if (e.key === 'ArrowLeft') next = (i - 1 + ids.length) % ids.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = ids.length - 1;
		if (next < 0) return;
		e.preventDefault();
		this.activate(ids[next], true);
		this.nav?.querySelector<HTMLAnchorElement>(`#tab-${CSS.escape(ids[next])}`)?.focus();
	}
}

export function defineTabs(): void {
	if (!customElements.get('pw-tabs')) customElements.define('pw-tabs', PwTabs);
}

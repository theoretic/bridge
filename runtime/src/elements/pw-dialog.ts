/**
 * <pw-dialog>: native <dialog> hosting an iframe, the no-jQuery counterpart of upstream's
 * pw-modal (JqueryUI/modal.js, core 3.0.274). Keeps the link contract: a.pw-modal[href], data-href
 * on other elements, data-pw-modal-href override, size classes pw-modal-small|medium|large|full,
 * `modal=1` appended to the URL, title from the link's title attribute, and modal.js's options
 * (milestone 3.3):
 * - data-buttons: a selector of buttons in the window's page; they are hidden there (unless
 *   .pw-modal-button-visible) and shown in the dialog's footer, a click clicks the original;
 * - data-autoclose: such a click closes the dialog when the next page loads without errors
 *   (.NoticeError, .ui-state-error); a selector limits it to matching buttons;
 * - data-close: buttons that close it at once; .pw-modal-cancel in the window always does.
 * `pw-modal-closed` is dispatched on the opening element (bubbling) and on document, detail
 * { dialog, abort } (abort: closed by its close button, the backdrop or Escape).
 * Scripts can open it with options (Bridge.dialog.open, the page table): onLoad runs after each
 * page load in the window, onClose when it closes, autoclose may be a function of the button.
 */

import { legacyLoaded } from '../legacy';
import { label } from '../util/labels';

export type DialogSize = 'small' | 'medium' | 'large' | 'full';

export type DialogOptions = {
	title?: string;
	/** selector of buttons in the window to show in the footer (data-buttons) */
	buttons?: string;
	/** close after the next page load without errors: true, a selector of buttons, or a test */
	autoclose?: boolean | string | ((button: HTMLElement, doc: Document) => boolean);
	/** selector of buttons that close at once (data-close) */
	close?: string;
	/** what counts as an error that keeps the dialog open after an autoclose save */
	errors?: string;
	/** the element that opened it: receives pw-modal-closed */
	source?: HTMLElement | null;
	onLoad?: (doc: Document, dialog: PwDialog) => void;
	onClose?: (info: { abort: boolean }) => void;
	/** a footer button was clicked: before its original is clicked (asmSelect reads the window then) */
	onButton?: (original: HTMLElement, doc: Document) => void;
	/** footer buttons of the caller's own, after the window's (the field creator's "Close & Add") */
	moreButtons?: (doc: Document) => Array<{ html: string; secondary?: boolean; click: () => void }>;
};

export class PwDialog extends HTMLElement {
	private dialog: HTMLDialogElement | null = null;
	private frame: HTMLIFrameElement | null = null;
	private titleEl: HTMLElement | null = null;
	private footer: HTMLElement | null = null;
	private options: DialogOptions = {};
	private closeOnLoad = false;
	private abort = true;

	connectedCallback(): void {
		if (this.dialog) return;
		const dialog = document.createElement('dialog');
		dialog.className = 'pw-dialog';
		const bar = document.createElement('div');
		bar.className = 'pw-dialog-bar';
		const title = document.createElement('span');
		title.className = 'pw-dialog-title';
		const closeBtn = document.createElement('button');
		closeBtn.type = 'button';
		closeBtn.className = 'pw-dialog-close';
		closeBtn.setAttribute('aria-label', label('close', 'Close'));
		closeBtn.textContent = '×';
		closeBtn.addEventListener('click', () => this.close(true));
		bar.append(title, closeBtn);
		const frame = this.makeFrame();
		const footer = document.createElement('div');
		footer.className = 'pw-dialog-buttons';
		dialog.append(bar, frame, footer);
		dialog.addEventListener('close', () => {
			if (this.frame) this.frame.src = 'about:blank';
			footer.innerHTML = '';
			dialog.classList.remove('pw-dialog-busy');
			const opts = this.options;
			this.options = {};
			this.closed(opts, this.abort);
		});
		dialog.addEventListener('cancel', () => { this.abort = true; }); // Escape
		dialog.addEventListener('click', e => {
			if (e.target === dialog) this.close(true); // backdrop
		});
		this.appendChild(dialog);
		this.dialog = dialog;
		this.frame = frame;
		this.titleEl = title;
		this.footer = footer;
	}

	private makeFrame(): HTMLIFrameElement {
		const frame = document.createElement('iframe');
		frame.className = 'pw-modal-window pw-dialog-frame';
		frame.setAttribute('frameborder', '0');
		frame.addEventListener('load', () => { if (frame === this.frame) this.loaded(); });
		return frame;
	}

	/** tell the opener (source, document, onClose) that its window is gone */
	private closed(opts: DialogOptions, abort: boolean): void {
		const detail = { dialog: this, abort };
		if (opts.source && opts.source.isConnected) opts.source.dispatchEvent(new CustomEvent('pw-modal-closed', { bubbles: true, detail }));
		document.dispatchEvent(new CustomEvent('pw-modal-closed', { detail }));
		if (opts.onClose) opts.onClose({ abort });
	}

	open(url: string, size: DialogSize = 'medium', options: DialogOptions = {}): void {
		if (!this.dialog || !this.frame) return;
		// the shared window is taken over while open: its first opener hears it closed (aborted),
		// as it would if the window had been closed first (audit B16)
		if (this.dialog.open) {
			const previous = this.options;
			this.options = {};
			this.closed(previous, true);
		}
		// a fresh window per opening: reopening right after a close would race the blank page the
		// closed one is navigating to (Firefox then drops the new URL)
		const frame = this.makeFrame();
		this.frame.replaceWith(frame);
		this.frame = frame;
		// modal=1 goes before a #hash (the template editor's #find-columnWidth)
		const hashAt = url.indexOf('#');
		const hash = hashAt > -1 ? url.substring(hashAt) : '';
		if (hash) url = url.substring(0, hashAt);
		const sep = url.includes('?') ? '&' : '?';
		this.options = options;
		this.closeOnLoad = false;
		this.abort = true;
		if (this.footer) this.footer.innerHTML = '';
		if (this.titleEl) this.titleEl.textContent = options.title || '';
		this.frame.src = (/[?&]modal=/.test(url) ? url : `${url}${sep}modal=1`) + hash;
		this.dialog.className = `pw-dialog pw-dialog-${size}`;
		if (!this.dialog.open) this.dialog.showModal();
		document.dispatchEvent(new CustomEvent('pw-modal-opened', { detail: { dialog: this, url } }));
	}

	/** close; abort tells listeners it was dismissed rather than finished */
	close(abort = false): void {
		if (!this.dialog?.open) return;
		this.abort = abort;
		this.dialog.close();
	}

	/** the page in the window, when it is ours to read */
	document(): Document | null {
		try {
			return this.frame?.contentDocument || null;
		} catch {
			return null;
		}
	}

	private loaded(): void {
		const doc = this.document();
		if (!doc || !doc.body || !this.dialog?.open || doc.location.href === 'about:blank') return;
		const opts = this.options;
		this.dialog.classList.remove('pw-dialog-busy');
		if (this.closeOnLoad) {
			this.closeOnLoad = false;
			if (!doc.querySelector(opts.errors || '.NoticeError, .ui-state-error')) {
				this.close(false);
				return;
			}
		}
		if (this.titleEl && !opts.title) this.titleEl.textContent = doc.title || '';
		if (opts.onLoad) opts.onLoad(doc, this);
		doc.addEventListener('click', e => {
			const t = e.target as Element;
			if (t && t.closest && t.closest('.pw-modal-cancel')) {
				e.preventDefault();
				this.close(false);
			}
		});
		this.setButtons(doc);
	}

	private setButtons(doc: Document): void {
		const footer = this.footer;
		const opts = this.options;
		if (!footer) return;
		footer.innerHTML = '';
		const seen: string[] = [];
		// jQuery's :visible (upstream asmSelect's button selector) as a filter
		const visibleOnly = !!opts.buttons && opts.buttons.indexOf(':visible') > -1;
		const selector = opts.buttons ? opts.buttons.replace(/:visible/g, '') : '';
		if (selector) Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter(b => !visibleOnly || b.offsetParent !== null).forEach(original => {
			const html = original.innerHTML.trim();
			if (!html || seen.indexOf(html) > -1) return;
			seen.push(html);
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'ui-button pw-button pw-dialog-button' + (original.classList.contains('ui-priority-secondary') ? ' ui-priority-secondary' : '');
			button.innerHTML = html;
			button.querySelectorAll('.ui-button-text').forEach(span => span.classList.remove('ui-button-text'));
			button.addEventListener('click', () => {
				const closeNow = !!opts.close && original.matches(opts.close);
				const auto = typeof opts.autoclose === 'function' ? opts.autoclose(original, doc)
					: typeof opts.autoclose === 'string' && opts.autoclose.length > 1 ? original.matches(opts.autoclose)
						: opts.autoclose === true || opts.autoclose === '' || opts.autoclose === '1';
				if (auto) {
					this.closeOnLoad = true;
					this.dialog?.classList.add('pw-dialog-busy');
				}
				if (opts.onButton) opts.onButton(original, doc);
				original.click();
				if (closeNow) this.close(false);
			});
			footer.appendChild(button);
			if (!original.classList.contains('pw-modal-button-visible')) original.style.display = 'none';
		});
		if (opts.moreButtons) opts.moreButtons(doc).forEach(b => {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'ui-button pw-button pw-dialog-button' + (b.secondary ? ' ui-priority-secondary' : '');
			button.innerHTML = b.html;
			button.addEventListener('click', () => b.click());
			footer.appendChild(button);
		});
	}
}

export function defineDialog(): void {
	if (!customElements.get('pw-dialog')) customElements.define('pw-dialog', PwDialog);
}

let shared: PwDialog | null = null;

export function sharedDialog(): PwDialog {
	if (!shared || !shared.isConnected) {
		shared = document.createElement('pw-dialog') as PwDialog;
		document.body.appendChild(shared);
	}
	return shared;
}

function sizeOf(el: HTMLElement): DialogSize {
	if (el.classList.contains('pw-modal-large')) return 'large';
	if (el.classList.contains('pw-modal-small')) return 'small';
	if (el.classList.contains('pw-modal-full')) return 'full';
	return 'medium';
}

function hrefOf(el: HTMLElement): string {
	const override = el.getAttribute('data-pw-modal-href');
	if (override) return override;
	if (el instanceof HTMLAnchorElement && el.getAttribute('href')) return el.getAttribute('href') as string;
	const parentLink = el.closest('a');
	if (parentLink?.getAttribute('href')) return parentLink.getAttribute('href') as string;
	return el.getAttribute('data-href') || '';
}

/**
 * A pw-panel link's URL as upstream panel.js loads it (modal=panel, pw_panel=1, or 2 with
 * pw-panel-links), the hash kept at the end. None for an in-page panel (data-panel-id, href
 * '#id': the core's Debug Mode Tools, opened by scripts/debug-tools.js)
 */
function panelUrl(el: HTMLElement): string {
	const href = el.getAttribute('data-href') || el.getAttribute('href') || '';
	if (!href || href[0] === '#') return '';
	const [path, hash] = href.split('#');
	const sep = path.includes('?') ? '&' : '?';
	return `${path}${sep}modal=panel&pw_panel=${el.classList.contains('pw-panel-links') ? 2 : 1}${hash ? '#' + hash : ''}`;
}

/** open the shared dialog for a .pw-modal / .pw-panel element, with the link's options */
function openFor(el: HTMLElement): boolean {
	const panel = !el.classList.contains('pw-modal');
	const href = panel ? panelUrl(el) : hrefOf(el);
	if (!href || href === '#') return false;
	const autoclose = el.getAttribute('data-autoclose');
	sharedDialog().open(href, panel ? 'large' : sizeOf(el), panel ? { source: el } : {
		source: el,
		title: el.getAttribute('title') || undefined,
		buttons: el.getAttribute('data-buttons') || undefined,
		autoclose: autoclose === null ? false : autoclose,
		close: [el.getAttribute('data-close'), '.pw-modal-cancel'].filter(Boolean).join(', '),
	});
	return true;
}

/**
 * Delegated click on .pw-modal, and on .pw-panel (upstream's slide-in panel, JqueryUI/panel.js,
 * opens here as a large dialog); steps aside when upstream modal.js (jQuery) is present. As
 * modal.js: .pw-modal-longclick links are followed on a click and open the dialog on a press of
 * 600 ms (the page tree's Edit and View); .pw-modal-dblclick elements open it on a double click,
 * and a single click on a link inside one is followed after 700 ms unless a second click comes.
 */
export function setupModalLinks(): void {
	let pressTimer = 0;
	let pressed: HTMLElement | null = null;
	let swallow = false;
	let clicks = 0;
	let clickTimer = 0;
	let allow = false;
	document.addEventListener('click', e => {
		if (legacyLoaded()) return;
		const t = e.target as HTMLElement;
		if (swallow) {
			// the click that ends a long press opened the dialog already
			swallow = false;
			e.preventDefault();
			return;
		}
		const dbl = t.closest<HTMLElement>('.pw-modal-dblclick');
		const link = dbl ? t.closest<HTMLAnchorElement>('a') : null;
		if (dbl && link && dbl.contains(link)) {
			if (allow) { allow = false; return; }
			e.preventDefault();
			clicks++;
			if (clicks === 1) {
				clickTimer = window.setTimeout(() => { clicks = 0; allow = true; link.click(); }, 700);
			} else {
				window.clearTimeout(clickTimer);
				clicks = 0;
				openFor(dbl);
			}
			return;
		}
		const el = t.closest<HTMLElement>('.pw-modal, .pw-panel');
		if (!el || el.classList.contains('pw-modal-longclick') || el.classList.contains('pw-modal-dblclick')) return;
		if (openFor(el)) e.preventDefault();
	});
	document.addEventListener('dblclick', e => {
		if (legacyLoaded()) return;
		const el = (e.target as HTMLElement).closest<HTMLElement>('.pw-modal-dblclick');
		if (!el || el.querySelector('a')) return; // links inside count clicks themselves
		e.preventDefault();
		openFor(el);
	});
	document.addEventListener('pointerdown', e => {
		if (legacyLoaded() || e.button !== 0) return;
		const el = (e.target as HTMLElement).closest<HTMLElement>('.pw-modal-longclick');
		if (!el) return;
		pressed = el;
		window.clearTimeout(pressTimer);
		pressTimer = window.setTimeout(() => {
			if (pressed !== el) return;
			pressed = null;
			if (openFor(el)) { swallow = true; window.setTimeout(() => { swallow = false; }, 1000); }
		}, 600);
	});
	const release = (): void => { window.clearTimeout(pressTimer); pressed = null; };
	document.addEventListener('pointerup', release);
	document.addEventListener('pointercancel', release);
	document.addEventListener('contextmenu', e => { if (pressed) { e.preventDefault(); } });
}

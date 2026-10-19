/**
 * InputfieldImage without jQuery (milestone 3.2, ADR 0016). Ports upstream InputfieldImage.js
 * (core 3.0.274) on the same markup: ul.gridImages > li.gridImage (.gridImage__overflow img with
 * data-w, data-h, data-original, data-focus; .gridImage__hover; .ImageData), the shared edit panel
 * li.InputfieldImageEdit, the upload element .InputfieldImageUpload.
 *
 * - View modes in the header (a.InputfieldImageListToggle: list, left, grid; active
 *   --active), thumbnail size slider (input.InputfieldImageSizeSlider, a range), both kept in
 *   upstream's `InputfieldImage` cookie per field ({ size, listSize, mode }); list mode is
 *   .InputfieldImageEditAll. Grid thumbnails are cropped around the focus point (and its zoom with
 *   .InputfieldImageFocusZoom), left mode shows them whole (gridImages[data-ragged]).
 * - Edit panel (grid and left modes): .gridImage__edit opens it below the row of its image and
 *   moves the item's .ImageData children into it (back when it closes); a click elsewhere, the
 *   close button or another image closes it.
 * - Sort by dragging (renumbers input.InputfieldFileSort, `sorted` on the Inputfield), trash
 *   toggles the delete box (double click: every image), click to rename (input.InputfieldFileRename),
 *   action select note, focus point (fields/image-focus.ts), full-size view in a lightbox.
 * - Width classes InputfieldImageNarrow / Medium / Wide (500 / 900 px).
 * - Upload (fields/image-upload.ts, on demand; fields/upload.ts): file input, a drop on the field, a drop between images (placed
 *   there), a drop on the edit panel's image (replaces it), optional resizing in the browser
 *   (upstream PWImageResizer and piexif, plain scripts, loaded on demand).
 * - Crop and Variations open windows that talk to the page through jQuery (parent.jQuery):
 *   on a page without it they load the legacy stack first (scripts/main.js), which hands this
 *   field over to upstream.
 */

import { getCookie, setCookie } from '../util/cookie';
import { makeSortable } from '../util/sortable';
import { openLightbox, LightboxItem } from '../util/lightbox';
import { legacyLoaded } from '../legacy';
import { uploadAllowed } from './upload';
import { initFileTags } from './file';

type Focus = { top: number; left: number; zoom: number };
type Settings = { size: number; listSize: number; mode: string };
type FieldState = { abort: AbortController; unsort: (() => void) | null; list: HTMLElement };

const fields = new Map<HTMLElement, FieldState>();
const ACTIVE = 'InputfieldImageListToggle--active';
let sliding = false;
let focusModule: Promise<typeof import('./image-focus')> | null = null;
const focus = (): Promise<typeof import('./image-focus')> => focusModule || (focusModule = import('./image-focus'));

export const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function pw(): { config: Record<string, unknown> } {
	return ((window as unknown as { ProcessWire?: { config: Record<string, unknown> } }).ProcessWire) || { config: {} };
}

export function labels(): Record<string, string> {
	return ((pw().config.InputfieldImage as { labels?: Record<string, string> }) || {}).labels || {};
}

/* settings cookie ********************************************************************************/

function fieldKey(inputfield: HTMLElement): string {
	return (inputfield.id || '').replace('wrap_Inputfield_', '') || 'na';
}

export function settings(inputfield: HTMLElement): Settings {
	const all = (getCookie<Record<string, Partial<Settings>>>('InputfieldImage') || {}) as Record<string, Partial<Settings>>;
	const own = (typeof all === 'object' && all[fieldKey(inputfield)]) || {};
	const grid = inputfield.querySelector<HTMLElement>('.gridImages');
	return {
		size: own.size || parseInt((grid && (grid.getAttribute('data-size') || grid.getAttribute('data-gridsize'))) || '', 10) || 130,
		listSize: own.listSize || 23,
		mode: own.mode || (grid && grid.getAttribute('data-gridmode')) || 'list',
	};
}

function saveSetting(inputfield: HTMLElement, key: keyof Settings, value: number | string): void {
	if (!inputfield.id) return;
	let all = getCookie<Record<string, Partial<Settings>>>('InputfieldImage') as Record<string, Partial<Settings>> | string | null;
	if (!all || typeof all !== 'object') all = {};
	const name = fieldKey(inputfield);
	const own = all[name] || (all[name] = {});
	if (own[key] === value) return;
	(own as Record<string, unknown>)[key] = value;
	setCookie('InputfieldImage', all, { secure: location.protocol === 'https:' });
}

/* sizing *****************************************************************************************/

function focusOf(img: HTMLImageElement): Focus {
	const a = (img.getAttribute('data-focus') || '50.0 50.0 0').split(' ');
	return { top: parseFloat(a[0]) || 0, left: parseFloat(a[1]) || 0, zoom: parseInt(a[2], 10) || 0 };
}

// Horst's square grid crop (upstream getFocusZoomPosition4GridviewSquare)
function zoomPosition(focusPercent: number, sourcePX: number, gridPX: number, scale: number): number {
	sourcePX *= scale;
	const gridPercent = gridPX / sourcePX * 100;
	let pos = focusPercent - gridPercent / 2;
	const max = 100 - gridPercent;
	if (pos <= 0) pos = 0;
	if (pos >= max) pos = max;
	return -1 * Math.floor(sourcePX / 100 * pos / scale);
}

/** Size one thumbnail for grid (cropped around its focus) or left (whole, ragged) mode */
export function setGridSizeItem(overflow: HTMLElement, gridSize: number, ragged: boolean, given?: Focus): void {
	const img = overflow.querySelector<HTMLImageElement>(':scope > img');
	if (!img) return;
	const s = img.style;
	if (!gridSize) {
		img.removeAttribute('width');
		img.removeAttribute('height');
		overflow.style.width = overflow.style.height = 'auto';
		return;
	}
	const w = parseInt(img.getAttribute('data-w') || '', 10) || img.naturalWidth || gridSize;
	const h = parseInt(img.getAttribute('data-h') || '', 10) || img.naturalHeight || gridSize;
	const f = given || focusOf(img);
	const zoom = ragged ? 0 : f.zoom;
	s.transformOrigin = '';
	if (ragged) {
		img.setAttribute('height', String(gridSize));
		img.removeAttribute('width');
		Object.assign(s, { maxHeight: '100%', maxWidth: 'none', top: '50%', left: '50%', transform: 'translate3d(-50%, -50%, 0)' });
	} else if (zoom > 0 && overflow.closest('.InputfieldImageFocusZoom') && !sliding) {
		const wide = w >= h;
		const sw = wide ? gridSize / h * w : gridSize;
		const sh = wide ? gridSize : gridSize / w * h;
		const scale = 1 + ((zoom / 100) * 2);
		const left = zoomPosition(f.left, sw, gridSize, scale);
		const top = zoomPosition(f.top, sh, gridSize, scale);
		Object.assign(s, { left: '0px', top: '0px', transformOrigin: '0px 0px', transform: `scale(${scale}) translate3d(${left}px, ${top}px, 0)`,
			maxWidth: wide ? 'none' : '100%', maxHeight: wide ? '100%' : 'none' });
	} else if (w >= h) {
		img.setAttribute('height', String(gridSize));
		img.removeAttribute('width');
		const left = f.left < 1 ? 0.001 : f.left;
		Object.assign(s, { maxHeight: '100%', maxWidth: 'none', top: '50%', left: left + '%', transform: `translate3d(-${left}%, -50%, 0)` });
	} else {
		img.setAttribute('width', String(gridSize));
		img.removeAttribute('height');
		const top = f.top < 1 ? 0.001 : f.top;
		Object.assign(s, { maxHeight: 'none', maxWidth: '100%', top: top + '%', left: '50%', transform: `translate3d(-50%, -${top}%, 0)` });
	}
	overflow.style.width = (ragged ? Math.round(gridSize / h * w) : gridSize) + 'px';
	overflow.style.height = gridSize + 'px';
}

export function setGridSize(inputfield: HTMLElement, gridSize: number, ragged?: boolean): void {
	if (!gridSize) return;
	const grid = inputfield.querySelector<HTMLElement>('.gridImages');
	if (!grid) return;
	if (ragged === undefined) ragged = grid.hasAttribute('data-ragged');
	if (ragged) grid.setAttribute('data-ragged', '1');
	else grid.removeAttribute('data-ragged');
	grid.querySelectorAll<HTMLElement>('.gridImage__overflow').forEach(o => setGridSizeItem(o, gridSize, !!ragged));
	grid.querySelectorAll<HTMLElement>('.gridImage__edit, .gridImage__resize').forEach(el => { el.style.lineHeight = gridSize + 'px'; });
	grid.setAttribute('data-size', String(gridSize));
	saveSetting(inputfield, 'size', gridSize);
}

export function setListSize(inputfield: HTMLElement, pct: number): void {
	pct = Math.floor(pct);
	inputfield.querySelectorAll<HTMLElement>('.gridImage__overflow').forEach(o => {
		o.style.width = pct + '%';
		const data = o.parentElement ? o.parentElement.querySelector<HTMLElement>(':scope > .ImageData') : null;
		if (data) data.style.width = (100 - pct) + '%';
		const img = o.querySelector<HTMLElement>('img');
		if (img) Object.assign(img.style, { top: '0', left: '0', transform: 'none' });
	});
	saveSetting(inputfield, 'listSize', pct);
}

function layout(inputfield: HTMLElement): void {
	const set = settings(inputfield);
	if (!inputfield.classList.contains('InputfieldRenderValueMode') && (inputfield.classList.contains('InputfieldImageEditAll') || set.mode === 'list')) {
		setListSize(inputfield, set.listSize);
	} else {
		setGridSize(inputfield, set.size, set.mode === 'left');
	}
}

function widthClasses(inputfield: HTMLElement): void {
	const width = inputfield.clientWidth;
	if (width < 1) return;
	inputfield.classList.toggle('InputfieldImageNarrow', width <= 500);
	inputfield.classList.toggle('InputfieldImageMedium', width > 500 && width <= 900);
	inputfield.classList.toggle('InputfieldImageWide', width > 900);
}

/* edit panel *************************************************************************************/

export function panelOf(grid: Element): HTMLElement | null {
	return grid.querySelector<HTMLElement>(':scope > .InputfieldImageEdit');
}

function gallery(grid: Element, current?: Element): { items: LightboxItem[]; index: number } {
	const imgs = Array.from(grid.querySelectorAll<HTMLImageElement>('.gridImage:not(.gridImagePlaceholder) .gridImage__overflow > img'));
	const items = imgs.map(img => ({ src: img.getAttribute('data-original') || img.src, title: img.alt }));
	return { items, index: current ? Math.max(0, imgs.findIndex(img => img.closest('.gridImage') === current)) : 0 };
}

function moveEdit(item: HTMLElement, panel: HTMLElement): void {
	const grid = item.parentElement;
	if (!grid) return;
	const children = Array.from(grid.children).filter(c => !c.classList.contains('InputfieldImageEdit')) as HTMLElement[];
	let found = false;
	let lastTop = 0;
	let before: HTMLElement | null = null;
	for (const child of children) {
		const top = child.offsetTop;
		if (found && top !== lastTop) { before = child; break; }
		if (child === item) found = true;
		lastTop = top;
	}
	if (before) grid.insertBefore(panel, before);
	else grid.appendChild(panel);
	const arrow = panel.querySelector<HTMLElement>('.InputfieldImageEdit__arrow');
	if (arrow) arrow.style.left = (item.offsetLeft + item.offsetWidth / 2) + 'px';
}

function setupEdit(item: HTMLElement, panel: HTMLElement): void {
	if (item.closest('.InputfieldImageEditAll')) return;
	const img = panel.querySelector<HTMLImageElement>('.InputfieldImageEdit__image');
	const thumb = item.querySelector<HTMLImageElement>('img');
	if (img && thumb) {
		img.src = thumb.getAttribute('data-original') || thumb.src;
		img.setAttribute('data-original', thumb.getAttribute('data-original') || '');
		img.alt = thumb.alt;
	}
	panel.id = 'edit-' + item.id;
	const edit = panel.querySelector<HTMLElement>('.InputfieldImageEdit__edit');
	const data = item.querySelector<HTMLElement>('.ImageData');
	if (!edit || !data) return;
	edit.setAttribute('data-current', item.id);
	Array.from(data.children).forEach(c => { if (!c.classList.contains('InputfieldFileSort')) edit.appendChild(c); });
	edit.querySelectorAll('.Inputfield').forEach(li => li.dispatchEvent(new CustomEvent('image-edit', { bubbles: true })));
}

function tearDownEdit(panel: HTMLElement): void {
	void stopFocusIn(panel);
	const edit = panel.querySelector<HTMLElement>('.InputfieldImageEdit__edit');
	if (!edit || !edit.children.length) return;
	const item = document.getElementById(edit.getAttribute('data-current') || '');
	const data = item ? item.querySelector('.ImageData') : null;
	if (data) Array.from(edit.children).forEach(c => data.appendChild(c));
}

export function closeEdit(scope: ParentNode | null, except: Element | null): void {
	const root = scope || document;
	root.querySelectorAll<HTMLElement>('.InputfieldImageEdit--active').forEach(panel => {
		if (except && except.contains(panel)) return;
		tearDownEdit(panel);
		panel.classList.remove('InputfieldImageEdit--active');
		panel.removeAttribute('id');
		const item = document.getElementById(panel.getAttribute('data-for') || '');
		if (item) item.classList.remove('gridImageEditing');
	});
	document.querySelectorAll('.InputfieldImageEdit__replace').forEach(el => el.classList.remove('InputfieldImageEdit__replace'));
}

export function openEdit(item: HTMLElement): void {
	const grid = item.closest('.gridImages');
	const panel = grid ? panelOf(grid) : null;
	if (!grid || !panel) return;
	if (item.classList.contains('gridImageEditing')) {
		closeEdit(grid, null);
		return;
	}
	moveEdit(item, panel);
	tearDownEdit(panel);
	setupEdit(item, panel);
	panel.classList.add('InputfieldImageEdit--active');
	panel.setAttribute('data-for', item.id);
	grid.querySelectorAll('.gridImageEditing').forEach(el => el.classList.remove('gridImageEditing'));
	item.classList.add('gridImageEditing');
}

export function updateGrid(scope?: ParentNode): void {
	(scope || document).querySelectorAll<HTMLElement>('.gridImages').forEach(grid => {
		const panel = grid.querySelector<HTMLElement>('.InputfieldImageEdit--active');
		if (!panel) return;
		const edit = panel.querySelector<HTMLElement>('.InputfieldImageEdit__edit');
		const item = edit ? document.getElementById(edit.getAttribute('data-current') || '') : null;
		if (item) moveEdit(item, panel);
	});
}

async function stopFocusIn(container: HTMLElement): Promise<void> {
	if (!container.querySelector('.focusCircle')) return;
	(await focus()).stopFocus(container);
}

/* header: view modes and size slider *************************************************************/

function setMode(inputfield: HTMLElement, mode: string, from?: string): void {
	const set = settings(inputfield);
	void stopFocusIn(inputfield);
	if (mode === 'list') {
		if (!inputfield.classList.contains('InputfieldImageEditAll')) {
			closeEdit(inputfield, null);
			inputfield.classList.add('InputfieldImageEditAll');
		}
		setListSize(inputfield, set.listSize);
	} else {
		inputfield.classList.remove('InputfieldImageEditAll');
		setGridSize(inputfield, set.size, mode === 'left');
		if (mode === 'left') updateGrid();
		if (mode === 'grid' && from === 'left') window.setTimeout(() => setGridSize(inputfield, set.size, false), 100);
	}
	saveSetting(inputfield, 'mode', mode);
}

function setupHeader(inputfield: HTMLElement, signal: AbortSignal): void {
	const header = inputfield.querySelector<HTMLElement>(':scope > .InputfieldHeader');
	if (!header || header.querySelector('.InputfieldImageListToggle')) return;
	const set = settings(inputfield);
	const toggles: HTMLAnchorElement[] = [];
	for (const [mode, icon] of [['list', 'fa-th-list'], ['left', 'fa-tasks'], ['grid', 'fa-th']]) {
		const a = document.createElement('a');
		a.className = 'InputfieldImageListToggle';
		a.href = mode;
		a.innerHTML = `<i class='fa ${icon}'></i>`;
		a.addEventListener('click', e => {
			e.preventDefault();
			if (legacyLoaded()) return;
			const prev = toggles.find(t => t.classList.contains(ACTIVE));
			toggles.forEach(t => t.classList.toggle(ACTIVE, t === a));
			setMode(inputfield, mode, prev ? prev.getAttribute('href') || '' : '');
			a.blur();
		}, { signal });
		toggles.push(a);
		header.appendChild(a);
	}
	const current = toggles.find(t => t.getAttribute('href') === set.mode) || toggles[2];
	current.classList.add(ACTIVE);
	if (set.mode === 'list') setMode(inputfield, 'list');
	else if (set.mode === 'left') setMode(inputfield, 'left');

	const grid = inputfield.querySelector<HTMLElement>('.gridImages');
	const gridSize = parseInt((grid && grid.getAttribute('data-gridsize')) || '130', 10) || 130;
	const slider = document.createElement('input');
	slider.type = 'range';
	slider.className = 'InputfieldImageSizeSlider';
	slider.min = String(gridSize / 2);
	slider.max = String(gridSize * 2);
	slider.value = String(set.size);
	slider.setAttribute('aria-label', 'Thumbnail size');
	const fill = (): void => {
		const min = parseFloat(slider.min);
		slider.style.setProperty('--pw-range-fill', ((parseFloat(slider.value) - min) / (parseFloat(slider.max) - min) * 100) + '%');
	};
	const slide = (): void => {
		fill();
		const value = parseInt(slider.value, 10);
		const min = gridSize / 2;
		const listSize = Math.floor(15 + ((value - min) / Math.floor(gridSize / 15)));
		if (inputfield.classList.contains('InputfieldImageEditAll')) {
			saveSetting(inputfield, 'size', value);
			setListSize(inputfield, listSize);
		} else {
			saveSetting(inputfield, 'listSize', listSize);
			setGridSize(inputfield, value);
		}
	};
	slider.addEventListener('pointerdown', () => {
		sliding = true;
		closeEdit(inputfield, null);
	}, { signal });
	slider.addEventListener('input', slide, { signal });
	slider.addEventListener('change', () => {
		sliding = false;
		slide();
		updateGrid(inputfield);
	}, { signal });
	header.appendChild(slider);
	fill();
}

/* document events ********************************************************************************/

let documentReady = false;

function setupDocument(): void {
	if (documentReady) return;
	documentReady = true;
	const on = (type: string, fn: (e: Event) => void): void => document.addEventListener(type, e => { if (!legacyLoaded()) fn(e); });

	on('click', e => {
		const t = e.target as HTMLElement;
		const trash = t.closest('.gridImage__trash');
		if (trash) {
			const box = trash.querySelector<HTMLInputElement>('input');
			if (box) {
				e.preventDefault();
				box.checked = !box.checked;
				box.dispatchEvent(new Event('change', { bubbles: true }));
			}
			return;
		}
		const edit = t.closest('.gridImage__edit');
		if (edit) {
			const item = edit.closest<HTMLElement>('.gridImage');
			if (!item || item.closest('.InputfieldImageEditAll')) return;
			e.preventDefault();
			openEdit(item);
			return;
		}
		if (t.closest('.InputfieldImageEdit__close')) {
			closeEdit(t.closest('.gridImages'), null);
			return;
		}
		const big = t.closest<HTMLImageElement>('.InputfieldImageEdit__image');
		if (big) {
			const grid = big.closest('.gridImages');
			const panel = big.closest('.InputfieldImageEdit');
			if (grid && panel) {
				const g = gallery(grid, document.getElementById(panel.getAttribute('data-for') || '') || undefined);
				openLightbox(g.items, g.index);
			}
			return;
		}
		const listImg = t.closest<HTMLImageElement>('.InputfieldImageEditAll .gridImage__overflow img, .InputfieldImageMax1 .gridImage__overflow img, .InputfieldRenderValueMode .gridImages img');
		if (listImg) {
			e.preventDefault();
			const grid = listImg.closest('.gridImages');
			if (listImg.closest('.InputfieldRenderValueMode') && grid) {
				const g = gallery(grid, listImg.closest('.gridImage') || undefined);
				openLightbox(g.items, g.index);
			} else {
				openLightbox([{ src: listImg.getAttribute('data-original') || listImg.src, title: listImg.alt }]);
			}
			return;
		}
		const focusButton = t.closest<HTMLElement>('.InputfieldImageButtonFocus');
		if (focusButton) {
			const container = focusButton.closest<HTMLElement>('.InputfieldImageEdit, .gridImage');
			if (container) void focus().then(m => m.toggleFocus(container, focusButton));
			return;
		}
		const name = t.closest<HTMLElement>('.InputfieldImageEdit__name');
		if (name) {
			rename(name);
			return;
		}
		// upstream: a click outside the panel and its images closes it
		if (t.closest('.InputfieldImageEdit')) { closeEdit(null, t.closest('.gridImages')); return; }
		if (t.closest('.gridImage__inner')) { closeEdit(null, t.closest('.gridImages')); return; }
		if (t.closest('.pw-lightbox, dialog, .ui-dialog, a.remove, .selectize-dropdown')) return;
		closeEdit(null, null);
	});

	on('dblclick', e => {
		const trash = (e.target as HTMLElement).closest('.gridImage__trash');
		if (!trash) return;
		e.preventDefault();
		const own = trash.querySelector<HTMLInputElement>('input');
		const grid = trash.closest('.gridImages');
		if (!own || !grid) return;
		// as upstream's 'click dblclick' handler: the double click toggles its own box once more first
		own.checked = !own.checked;
		grid.querySelectorAll<HTMLInputElement>('.gridImage__deletebox').forEach(box => {
			box.checked = own.checked;
			box.dispatchEvent(new Event('change', { bubbles: true }));
		});
	});

	on('change', e => {
		const t = e.target as HTMLElement;
		if (t.matches('.gridImage__deletebox')) {
			const outer = t.closest('.ImageOuter');
			if (outer) outer.classList.toggle('gridImage--delete', (t as HTMLInputElement).checked);
		}
		if (t.matches('.InputfieldFileActionSelect')) {
			const note = t.nextElementSibling as HTMLElement | null;
			if (note && note.classList.contains('InputfieldFileActionNote')) note.style.display = (t as HTMLSelectElement).value ? 'inline' : 'none';
		}
		// upstream: once the field changed, Crop warns first (a crop reloads the field)
		const inputfield = t.closest('.InputfieldImage');
		if (inputfield) inputfield.querySelectorAll('.InputfieldImageButtonCrop:not(.pw-modal-dblclick)').forEach(b => b.classList.add('pw-modal-dblclick', 'ui-state-disabled'));
	});

	// Crop after changes warns first. Otherwise Crop and Variations open in the native dialog (the
	// delegated .pw-modal handler): their window, ProcessPageEditImageSelect, is native since
	// milestone 3.9 and answers an opener without jQuery
	document.addEventListener('click', e => {
		if (legacyLoaded()) return;
		const button = (e.target as HTMLElement).closest<HTMLElement>('.InputfieldImage .pw-modal[data-buttons]');
		if (!button) return;
		if (button.classList.contains('InputfieldImageButtonCrop') && button.classList.contains('ui-state-disabled')) {
			e.preventDefault();
			e.stopImmediatePropagation();
			const grid = button.closest('.gridImages');
			if (grid && !grid.classList.contains('gridImagesAlerted')) {
				const msg = labels().changes || '';
				const p = (window as unknown as { ProcessWire?: { alert?: (m: string) => void } }).ProcessWire;
				if (p && p.alert) p.alert(msg); else window.alert(msg);
				grid.classList.add('gridImagesAlerted');
			}
			return;
		}
	}, true);

	let resizeTimer = 0;
	window.addEventListener('resize', () => {
		if (legacyLoaded()) return;
		window.clearTimeout(resizeTimer);
		resizeTimer = window.setTimeout(() => {
			document.querySelectorAll<HTMLElement>('.focusArea.focusActive').forEach(a => {
				const c = a.closest<HTMLElement>('.InputfieldImageEdit, .gridImage');
				if (c) void stopFocusIn(c);
			});
			updateGrid();
		}, 200);
	});

	document.addEventListener('pw-legacy-handover', () => {
		fields.forEach((state, inputfield) => {
			closeEdit(inputfield, null);
			state.abort.abort();
			if (state.unsort) state.unsort();
			inputfield.querySelectorAll('.InputfieldImageListToggle, .InputfieldImageSizeSlider').forEach(el => el.remove());
			inputfield.classList.remove('InputfieldImageInit');
			inputfield.querySelectorAll('.InputfieldImageInitUpload, .InputfieldImageDropzoneInit, .gridImagesInitDropInPlace').forEach(el =>
				el.classList.remove('InputfieldImageInitUpload', 'InputfieldImageDropzoneInit', 'gridImagesInitDropInPlace'));
			state.list.removeAttribute('data-pw-image');
		});
		fields.clear();
	});
}

function rename(name: HTMLElement): void {
	const span = name.querySelector<HTMLElement>(':scope > span');
	const holder = name.closest('.gridImage, .InputfieldImageEdit');
	const input = holder ? holder.querySelector<HTMLInputElement>('.InputfieldFileRename') : null;
	if (!span || !input || span.getAttribute('contenteditable') !== 'true' || span.hasAttribute('data-pw-renaming')) return;
	span.setAttribute('data-pw-renaming', '');
	input.value = span.textContent || '';
	['autocomplete', 'autocorrect', 'autocapitalize'].forEach(a => span.setAttribute(a, 'off'));
	span.setAttribute('spellcheck', 'false');
	const key = (e: KeyboardEvent): void => {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		span.blur();
	};
	span.addEventListener('keydown', key);
	span.addEventListener('blur', () => {
		span.removeEventListener('keydown', key);
		span.removeAttribute('data-pw-renaming');
		const value = span.textContent || '';
		if (!value.trim().length) {
			span.textContent = input.value;
		} else if (value !== input.value) {
			input.value = value;
			input.dispatchEvent(new Event('change', { bubbles: true }));
			const inputfield = name.closest('.Inputfield');
			if (inputfield) inputfield.dispatchEvent(new Event('change', { bubbles: true }));
		}
	}, { once: true });
	span.focus();
}

/* init *******************************************************************************************/

export function init(inputfield: HTMLElement): void {
	if (legacyLoaded()) return;
	setupDocument();
	const content = inputfield.querySelector<HTMLElement>(':scope > .InputfieldContent');
	const grid = content ? content.querySelector<HTMLElement>('.gridImages') : null;
	if (!content || !grid) return;
	initFileTags(inputfield, inputfield);
	layout(inputfield);
	if (grid.hasAttribute('data-pw-image')) return;
	grid.setAttribute('data-pw-image', '');
	// fields an in-place save replaced
	fields.forEach((st, f) => { if (!f.isConnected) { st.abort.abort(); if (st.unsort) st.unsort(); fields.delete(f); } });
	const old = fields.get(inputfield);
	if (old) { old.abort.abort(); if (old.unsort) old.unsort(); }
	const state: FieldState = { abort: new AbortController(), unsort: null, list: grid };
	fields.set(inputfield, state);
	const signal = state.abort.signal;
	const renderValue = inputfield.classList.contains('InputfieldRenderValueMode');
	const max = content.querySelector<HTMLInputElement>('.InputfieldImageMaxFiles');
	const maxFiles = max ? parseInt(max.value, 10) || 0 : 0;
	inputfield.classList.add('InputfieldImageInit');
	if (!renderValue) {
		if (maxFiles === 1) {
			inputfield.classList.add('InputfieldImageMax1');
		} else {
			state.unsort = makeSortable(grid, {
				items: '.gridImage',
				axis: 'xy',
				threshold: 4,
				// upstream's cancel list: the thumbnail's Edit link (over the whole image) does start a drag
				cancel: '.InputfieldImageEdit, .focusArea, input, textarea, button, select, option, [contenteditable]',
				controls: '',
				enabled: () => !legacyLoaded(),
				start: () => { closeEdit(grid, null); grid.classList.add('InputfieldImageSorting'); },
				stop: item => {
					Array.from(grid.querySelectorAll<HTMLElement>(':scope > li.gridImage')).forEach((li, n) => {
						const sort = li.querySelector<HTMLInputElement>('.InputfieldFileSort');
						if (sort && sort.value !== String(n)) {
							sort.value = String(n);
							sort.dispatchEvent(new Event('change', { bubbles: true }));
						}
					});
					grid.classList.remove('InputfieldImageSorting');
					item.querySelectorAll('.Inputfield').forEach(li => li.dispatchEvent(new CustomEvent('sort-stop', { bubbles: true })));
				},
				update: item => grid.dispatchEvent(new CustomEvent('sorted', { bubbles: true, detail: { item } })),
			});
		}
		setupHeader(inputfield, signal);
	}
	widthClasses(inputfield);
	if (window.ResizeObserver) {
		const ro = new ResizeObserver(() => widthClasses(inputfield));
		ro.observe(inputfield);
		signal.addEventListener('abort', () => ro.disconnect());
	}
	// upload: its own chunk, loaded where uploads are possible
	if (!renderValue && uploadAllowed()) void import('./image-upload').then(m => { if (!signal.aborted) m.setupUpload(inputfield, content, grid, signal); });
}

/**
 * Image focus point without jQuery UI (milestone 3.2): upstream InputfieldImage.js startFocus() /
 * stopFocus() (core 3.0.274), loaded by fields/image.ts when Focus is clicked. Over the image a
 * .focusArea (dimmed, .focusActive) holds a draggable .focusCircle; the image's parent becomes
 * .focusWrap. The point is written to input.InputfieldImageFocus as "top left zoom" (percent) and to
 * the thumbnail's data-focus, and the grid thumbnail follows it. With .InputfieldImageFocusZoom a
 * zoom range (input.focusZoomSlider, 0..50) and a .focusZoomBox preview the crop.
 */

import { settings, setGridSizeItem } from './image';

type Focus = { top: number; left: number; zoom: number };

const bound = new WeakMap<HTMLElement, AbortController>();

function zoomPosition(focusPercent: number, source: number, crop: number): number {
	const max = Math.floor(source - crop);
	let pos = Math.floor(Math.floor(source * focusPercent / 100) - crop / 2);
	if (pos < 0) pos = 0;
	if (pos > max) pos = max;
	return pos;
}

export function startFocus(edit: HTMLElement): void {
	const inputfield = edit.closest<HTMLElement>('.Inputfield');
	if (!inputfield || edit.querySelector('.focusCircle')) return;
	const set = settings(inputfield);
	const useZoom = inputfield.classList.contains('InputfieldImageFocusZoom');
	const listItem = edit.classList.contains('gridImage');
	const item = listItem ? edit : document.getElementById(edit.getAttribute('data-for') || '');
	const img = listItem ? edit.querySelector<HTMLImageElement>('.gridImage__overflow img') : edit.querySelector<HTMLImageElement>('.InputfieldImageEdit__image');
	const thumb = item ? item.querySelector<HTMLImageElement>('.gridImage__overflow img') : null;
	const input = edit.querySelector<HTMLInputElement>('.InputfieldImageFocus');
	if (!img || !input) return;
	const ac = new AbortController();
	bound.set(edit, ac);

	const parse = (str: string): Focus => {
		const a = str.split(' ');
		const top = a[0] === undefined ? 50 : parseFloat(a[0]);
		const left = a[1] === undefined ? 50 : parseFloat(a[1]);
		const zoom = a[2] === undefined ? 0 : parseInt(a[2], 10);
		return { top: top > 100 ? 100 : top || 0, left: left > 100 ? 100 : left || 0, zoom: zoom > 100 ? 0 : zoom || 0 };
	};
	let focus = parse(input.value || '50 50 0');

	const preview = (): void => {
		if (set.mode === 'grid' && thumb && thumb.parentElement) setGridSizeItem(thumb.parentElement, set.size, false, focus);
	};
	const save = (): void => {
		const str = focus.top + ' ' + focus.left + ' ' + focus.zoom;
		if (thumb) thumb.setAttribute('data-focus', str);
		if (str !== input.value) {
			input.value = str;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		}
	};

	let area = img.nextElementSibling as HTMLElement | null;
	if (!area || !area.classList.contains('focusArea')) {
		area = document.createElement('div');
		area.className = 'focusArea';
		img.insertAdjacentElement('afterend', area);
	}
	const focusArea = area;
	focusArea.style.height = img.offsetHeight + 'px';
	focusArea.style.width = img.offsetWidth + 'px';
	focusArea.style.backgroundColor = useZoom ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)';
	focusArea.classList.add('focusActive');
	const circle = document.createElement('div');
	circle.className = 'focusCircle';
	circle.style.position = 'absolute'; // jQuery UI draggable gave it position:relative upstream
	focusArea.appendChild(circle);
	if (img.parentElement) img.parentElement.classList.add('focusWrap');

	const place = (): void => {
		const w = focusArea.clientWidth;
		const h = focusArea.clientHeight;
		circle.style.left = Math.min(w, Math.max(0, Math.round(focus.left / 100 * w))) + 'px';
		circle.style.top = Math.min(h, Math.max(0, Math.round(focus.top / 100 * h))) + 'px';
	};
	place();

	let zoomBox: HTMLElement | null = null;
	let slider: HTMLInputElement | null = null;
	const zoomSlide = (pct: number): void => {
		if (!zoomBox) return;
		const w = focusArea.clientWidth;
		const h = focusArea.clientHeight;
		let size: number;
		if (w > h) {
			zoomBox.style.height = (100 - pct) + '%';
			size = zoomBox.offsetHeight;
			zoomBox.style.width = size + 'px';
		} else {
			zoomBox.style.width = (100 - pct) + '%';
			size = zoomBox.offsetWidth;
			zoomBox.style.height = size + 'px';
		}
		// upstream getFocusZoomCropDimensions(), square preview
		const max = size / w * 100 >= size / h * 100 ? w : h;
		const crop = max - (max * pct / 100);
		const left = zoomPosition(focus.left, w, crop);
		const top = zoomPosition(focus.top, h, crop);
		Object.assign(zoomBox.style, { top: top + 'px', left: left + 'px', backgroundPosition: `-${left}px -${top}px`, backgroundSize: `${w}px ${h}px` });
		focus.zoom = pct;
		save();
		preview();
	};
	if (useZoom) {
		zoomBox = document.createElement('div');
		zoomBox.className = 'focusZoomBox';
		Object.assign(zoomBox.style, { position: 'absolute', background: 'transparent', backgroundImage: `url(${img.src})` });
		focusArea.insertBefore(zoomBox, focusArea.firstChild);
		slider = document.createElement('input');
		slider.type = 'range';
		slider.className = 'focusZoomSlider';
		slider.min = '0';
		slider.max = '50';
		slider.value = String(focus.zoom);
		slider.style.marginTop = '5px';
		img.insertAdjacentElement('afterend', slider);
		if (thumb) thumb.src = img.src;
		const s = slider;
		const fill = (): void => s.style.setProperty('--pw-range-fill', (parseInt(s.value, 10) / 50 * 100) + '%');
		s.addEventListener('input', () => { fill(); zoomSlide(parseInt(s.value, 10) || 0); }, { signal: ac.signal });
		fill();
		zoomSlide(focus.zoom);
	}

	let dx = 0;
	let dy = 0;
	circle.addEventListener('pointerdown', e => {
		e.preventDefault();
		e.stopPropagation();
		const c = circle.getBoundingClientRect();
		dx = e.clientX - (c.left + c.width / 2);
		dy = e.clientY - (c.top + c.height / 2);
		circle.setPointerCapture(e.pointerId);
	}, { signal: ac.signal });
	circle.addEventListener('pointermove', e => {
		if (!circle.hasPointerCapture(e.pointerId)) return;
		const r = focusArea.getBoundingClientRect();
		const x = Math.min(r.width, Math.max(0, e.clientX - dx - r.left));
		const y = Math.min(r.height, Math.max(0, e.clientY - dy - r.top));
		circle.style.left = x + 'px';
		circle.style.top = y + 'px';
		focus = { top: r.height ? y / r.height * 100 : 0, left: r.width ? x / r.width * 100 : 0, zoom: focus.zoom };
		save();
		if (useZoom) zoomSlide(focus.zoom);
		else preview();
	}, { signal: ac.signal });
	circle.addEventListener('pointerup', e => {
		if (circle.hasPointerCapture(e.pointerId)) circle.releasePointerCapture(e.pointerId);
	}, { signal: ac.signal });
}

export function stopFocus(edit: HTMLElement): void {
	const circle = edit.querySelector<HTMLElement>('.focusCircle');
	if (!circle) return;
	const ac = bound.get(edit);
	if (ac) ac.abort();
	bound.delete(edit);
	const wrap = circle.closest('.focusWrap');
	if (wrap) {
		wrap.querySelectorAll('.focusZoomSlider, .focusZoomBox').forEach(el => el.remove());
		wrap.classList.remove('focusWrap');
	}
	if (circle.parentElement) circle.parentElement.classList.remove('focusActive');
	circle.remove();
	const icon = edit.querySelector<HTMLElement>('.InputfieldImageButtonFocus i');
	if (icon) {
		icon.classList.remove('focusIconActive');
		(icon.getAttribute('data-toggle') || '').split(/\s+/).filter(Boolean).forEach(c => icon.classList.toggle(c));
	}
}

/** The Focus button: start, or stop when running */
export function toggleFocus(edit: HTMLElement, button: HTMLElement): void {
	if (edit.querySelector('.focusCircle')) {
		stopFocus(edit);
		return;
	}
	startFocus(edit);
	const icon = button.querySelector<HTMLElement>('i');
	if (icon) {
		icon.classList.add('focusIconActive');
		(icon.getAttribute('data-toggle') || '').split(/\s+/).filter(Boolean).forEach(c => icon.classList.toggle(c));
	}
}

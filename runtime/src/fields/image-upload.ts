/**
 * Image upload for the native image field (milestone 3.2), split from fields/image.ts and loaded
 * where uploads are possible: the file input, a drop on the field, a drop between images (placed
 * there), a drop on the edit panel's image (replaces it, X-REPLACENAME and input.InputfieldFileReplace),
 * optional resizing in the browser (upstream PWImageResizer and piexif, plain scripts loaded on
 * demand), progress items, the server's markup placed as upstream places it (single, replace,
 * overwrite, before the drop point, in order), errors in ul.InputfieldImageErrors.
 */

import { uploadTarget, rejectReason, send, toElement, initItem, filesOf, UploadResult, UploadTarget } from './upload';
import { initFileTags, updateCount } from './file';
import { legacyLoaded } from '../legacy';
import { settings, labels, setGridSize, setListSize, panelOf, closeEdit, openEdit, updateGrid, esc, pw } from './image';

type Replace = { file: string; item: HTMLElement | null; panel: HTMLElement | null };
const replace: Replace = { file: '', item: null, panel: null };

function resizeSettings(inputfield: HTMLElement): { maxWidth: number; maxHeight: number; maxSize: number; quality: number; autoRotate: boolean; debug: unknown } {
	const s = { maxWidth: 0, maxHeight: 0, maxSize: 0, quality: 1.0, autoRotate: true, debug: pw().config.debug };
	const data = (inputfield.getAttribute('data-resize') || '').split(';');
	if (data.length >= 4) {
		s.maxWidth = parseInt(data[0], 10) || 0;
		s.maxHeight = parseInt(data[1], 10) || 0;
		s.maxSize = parseFloat(data[2]) || 0;
		s.quality = parseFloat(data[3]) || 1.0;
	}
	return s;
}

let resizerLoading: Promise<void> | null = null;

/** upstream's PWImageResizer and piexif: plain scripts in the deferred stack list, loaded alone */
function loadResizer(): Promise<void> {
	if ((window as unknown as { PWImageResizer?: unknown }).PWImageResizer) return Promise.resolve();
	if (resizerLoading) return resizerLoading;
	const cfg = (pw().config.AdminThemeBridge || {}) as { legacyScripts?: string[] };
	const urls = (cfg.legacyScripts || []).filter(u => /\/InputfieldImage\/(piexif|PWImageResizer)(\.min)?\.js/.test(u));
	resizerLoading = urls.reduce((p, url) => p.then(() => new Promise<void>((resolve, reject) => {
		const s = document.createElement('script');
		s.src = url;
		s.onload = () => resolve();
		s.onerror = () => reject(new Error('failed to load ' + url));
		document.head.appendChild(s);
	})), Promise.resolve());
	return resizerLoading;
}

function progressItem(file: File, url: string, inputfield: HTMLElement): { li: HTMLElement; progress: HTMLProgressElement; spinner: HTMLElement } {
	const l = labels();
	const set = settings(inputfield);
	const size = Math.floor(file.size / 1024) + '&nbsp;kB';
	const li = document.createElement('li');
	li.className = 'gridImage gridImageUploading';
	li.innerHTML = '<div class="gridImage__tooltip"><table><tbody>' +
		`<tr><th>${l.dimensions || ''}</th><td class="dimensions">${l.na || ''}</td></tr>` +
		`<tr><th>${l.filesize || ''}</th><td>${size}</td></tr><tr><th>${l.variations || ''}</th><td>0</td></tr></tbody></table></div>` +
		`<div class="gridImage__overflow"><img height="${set.size}" alt="" src="${url}" data-original="${url}"></div>` +
		`<div class='gridImage__hover'><div class='gridImage__inner'><a class="gridImage__edit" title="${esc(file.name)}"><span>&nbsp;</span></a>` +
		'<div class="gridImage__resize" style="display:none"><i class="fa fa-spinner fa-spin fa-2x fa-fw"></i></div>' +
		"<progress class='gridImage__progress' min='-1' max='100' value='0'></progress></div></div>" +
		`<div class="ImageData"><h2 class="InputfieldImageEdit__name">${esc(file.name)}</h2><span class="InputfieldImageEdit__info">${size}</span></div>`;
	const overflow = li.querySelector<HTMLElement>('.gridImage__overflow') as HTMLElement;
	const data = li.querySelector<HTMLElement>('.ImageData') as HTMLElement;
	if (inputfield.classList.contains('InputfieldImageEditAll')) {
		overflow.style.width = set.listSize + '%';
		data.style.width = (100 - set.listSize) + '%';
	} else {
		overflow.style.width = overflow.style.height = set.size + 'px';
	}
	const probe = new Image();
	probe.onload = () => {
		const dims = li.querySelector('.dimensions');
		if (dims) dims.innerHTML = probe.width + '&nbsp;&times;&nbsp;' + probe.height;
		const img = overflow.querySelector('img') as HTMLImageElement;
		const factor = Math.min(probe.width, probe.height) / set.size;
		img.width = probe.width / factor;
		img.height = probe.height / factor;
	};
	probe.src = url;
	return { li, progress: li.querySelector('progress') as HTMLProgressElement, spinner: li.querySelector('.gridImage__resize') as HTMLElement };
}

export function setupUpload(inputfield: HTMLElement, content: HTMLElement, grid: HTMLElement, signal: AbortSignal): void {
	const upload = content.querySelector<HTMLElement>('.InputfieldImageUpload');
	const input = content.querySelector<HTMLInputElement>('input[type=file]');
	if (!upload || !input || upload.classList.contains('InputfieldImageInitUpload')) return;
	upload.classList.add('InputfieldImageInitUpload');
	const target: UploadTarget = uploadTarget(upload);
	const errors = content.querySelector<HTMLElement>('.InputfieldImageErrors');
	const resize = resizeSettings(inputfield);
	const useResize = resize.maxWidth > 0 || resize.maxHeight > 0 || resize.maxSize > 0;
	let before: HTMLElement | null = null;
	let doneTimer = 0;
	Array.from(grid.children).forEach(li => li.classList.add('InputfieldFileItemExisting'));

	const error = (message: string, name?: string): void => {
		if (!errors) return;
		errors.insertAdjacentHTML('beforeend', `<li><i class='fa fa-fw fa-warning'></i> ${name ? '<b>' + esc(name) + ':</b> ' : ''}${esc(message)}</li>`);
	};

	const place = (results: UploadResult[], row: HTMLElement): void => {
		const set = settings(inputfield);
		const listMode = inputfield.classList.contains('InputfieldImageEditAll');
		results.forEach((r, n) => {
			if (r.error) {
				error(r.message || '');
				if (n === results.length - 1) row.style.display = 'none';
				return;
			}
			const markup = toElement(r.markup || '');
			if (!markup) return;
			let item: HTMLElement | null = null;
			if (r.overwrite && markup.id) item = grid.querySelector<HTMLElement>(':scope > #' + CSS.escape(markup.id));
			if (target.maxFiles === 1 || r.replace) item = grid.querySelector<HTMLElement>(':scope > .gridImage');
			else if (replace.item && results.length === 1) item = replace.item;
			if (item && item.parentNode) item.replaceWith(markup);
			else if (before && before.parentNode) { before.insertAdjacentElement('beforebegin', markup); before = markup; }
			else if (n === 0 && row.parentNode) row.replaceWith(markup);
			else grid.insertBefore(markup, panelOf(grid));
			markup.classList.add('InputfieldFileItemExisting');
			const overflow = markup.querySelector<HTMLElement>('.gridImage__overflow');
			if (overflow && listMode) overflow.style.width = set.listSize + '%';
			if (listMode) setListSize(inputfield, set.listSize);
			else setGridSize(inputfield, set.size);
			window.setTimeout(() => { initItem(markup, 'InputfieldImageUpload'); initFileTags(markup, inputfield); }, 250);
			if (row.parentNode) row.remove();
			if (replace.item && target.maxFiles !== 1) {
				const replaceInput = markup.querySelector<HTMLInputElement>('.InputfieldFileReplace');
				if (replaceInput) replaceInput.value = replace.file;
				const name = markup.querySelector('.InputfieldImageEdit__name');
				const newName = name ? name.textContent || '' : '';
				const oldName = replace.file.split('?')[0];
				const ext = (s: string): string => s.substring(s.lastIndexOf('.') + 1).toLowerCase();
				const span = name ? name.querySelector('span') : null;
				if (span && ext(newName) === ext(oldName)) {
					span.textContent = oldName.substring(0, oldName.lastIndexOf('.'));
					span.removeAttribute('contenteditable');
				}
				openEdit(markup);
			}
			replace.file = '';
			replace.item = null;
			replace.panel = null;
		});
		window.clearTimeout(doneTimer);
		before = null;
		doneTimer = window.setTimeout(() => grid.dispatchEvent(new CustomEvent('AjaxUploadDone', { bubbles: true })), 500);
		inputfield.dispatchEvent(new Event('change', { bubbles: true }));
		inputfield.classList.remove('InputfieldFileEmpty');
		updateCount(inputfield);
	};

	const uploadFile = (file: File): void => {
		const url = URL.createObjectURL(file);
		const { li: row, progress, spinner } = progressItem(file, url, inputfield);
		if (replace.panel || grid.querySelector('.InputfieldImageEdit--active')) closeEdit(grid, null);
		if (replace.item) { replace.item.replaceWith(row); replace.item = row; }
		else if (before && before.parentNode) before.insertAdjacentElement('beforebegin', row);
		else grid.insertBefore(row, panelOf(grid));
		spinner.style.display = 'block';
		const replaceName = replace.item ? replace.file : '';
		const go = (body?: Blob | ArrayBuffer | string | null): void => {
			send(file, target, { body, replaceName, onProgress: pct => { progress.value = pct; } })
				.then(results => place(results, row))
				.catch(err => { error(String(err && err.message || err), file.name); row.remove(); });
			updateGrid();
			inputfield.dispatchEvent(new Event('change', { bubbles: true }));
			inputfield.classList.add('InputfieldStateChanged');
			updateCount(inputfield);
		};
		const ext = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
		if (useResize && ['jpg', 'jpeg', 'png', 'gif'].indexOf(ext) > -1) {
			spinner.classList.add('pw-resizing');
			loadResizer().then(() => {
				const Resizer = (window as unknown as { PWImageResizer: new (s: unknown) => { resize(f: File, cb: (data: Blob | false) => void): void } }).PWImageResizer;
				new Resizer(resize).resize(file, data => { spinner.classList.remove('pw-resizing'); go(data || null); });
			}).catch(() => { spinner.classList.remove('pw-resizing'); go(); });
		} else {
			go();
		}
	};

	const traverse = (files: File[]): void => {
		for (const f of files) {
			const reason = rejectReason(f, target, useResize);
			if (reason) error(reason, f.name);
			else uploadFile(f);
			if (target.maxFiles === 1) break;
		}
	};

	input.addEventListener('change', e => {
		if (legacyLoaded()) return;
		e.preventDefault();
		e.stopPropagation();
		traverse(filesOf(input.files));
		input.value = '';
	}, { signal });

	// a drop anywhere on the field
	const hover = (on: boolean): void => {
		content.classList.toggle('ui-state-hover', on);
		inputfield.classList.toggle('pw-drag-in-file', on);
	};
	content.classList.add('InputfieldImageDropzoneInit');
	content.addEventListener('dragenter', e => { e.preventDefault(); hover(true); }, { signal });
	content.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); hover(true); }, { signal });
	content.addEventListener('dragleave', () => hover(false), { signal });
	content.addEventListener('drop', e => {
		e.preventDefault();
		e.stopPropagation();
		hover(false);
		if (e.dataTransfer) traverse(filesOf(e.dataTransfer.files));
	}, { signal });

	// a drop between images: a placeholder follows the pointer and marks the place
	if (target.maxFiles !== 1) {
		let placeholder: HTMLElement | null = null;
		let timer = 0;
		const blocked = (): boolean => !!grid.querySelector('.InputfieldImageEdit--active');
		const ensure = (): HTMLElement => {
			if (placeholder) return placeholder;
			const size = (grid.getAttribute('data-size') || '130') + 'px';
			placeholder = document.createElement('li');
			placeholder.className = 'ImageOuter gridImage gridImagePlaceholder';
			placeholder.innerHTML = '<div class="gridImage__overflow"></div>';
			const o = placeholder.firstElementChild as HTMLElement;
			o.style.width = grid.closest('.InputfieldImageEditAll') ? '100%' : size;
			o.style.height = size;
			grid.insertBefore(placeholder, panelOf(grid));
			return placeholder;
		};
		const follow = (e: DragEvent): void => {
			const p = ensure();
			const under = document.elementFromPoint(e.clientX, e.clientY);
			const other = under ? under.closest<HTMLElement>('.gridImage') : null;
			if (!other || other === p || other.parentElement !== grid) return;
			const r = other.getBoundingClientRect();
			grid.insertBefore(p, e.clientX < r.left + r.width / 2 ? other : other.nextSibling);
		};
		grid.classList.add('gridImagesInitDropInPlace');
		grid.addEventListener('dragenter', e => { if (blocked()) return; e.preventDefault(); window.clearTimeout(timer); follow(e); }, { signal });
		grid.addEventListener('dragover', e => { if (blocked()) return; e.preventDefault(); window.clearTimeout(timer); follow(e); }, { signal });
		grid.addEventListener('dragleave', () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(() => { if (placeholder) placeholder.remove(); placeholder = null; }, 1000);
		}, { signal });
		grid.addEventListener('drop', () => {
			if (!placeholder) return;
			window.clearTimeout(timer);
			let next = placeholder.nextElementSibling as HTMLElement | null;
			while (next && !next.classList.contains('gridImage')) next = next.nextElementSibling as HTMLElement | null;
			before = next;
			placeholder.remove();
			placeholder = null;
		}, { signal });
	}

	// a drop on the edit panel's image replaces that image
	if (target.maxFiles !== 1) {
		const panel = panelOf(grid);
		const big = panel ? panel.querySelector<HTMLImageElement>('.InputfieldImageEdit__imagewrapper img') : null;
		if (panel && big) {
			big.addEventListener('dragenter', () => {
				const src = big.getAttribute('src') || '';
				big.closest('.InputfieldImageEdit__imagewrapper')?.classList.add('InputfieldImageEdit__replace');
				replace.file = src.substring(src.lastIndexOf('/') + 1);
				replace.item = document.getElementById(panel.getAttribute('data-for') || '');
				replace.panel = panel;
			}, { signal });
			big.addEventListener('dragleave', () => {
				big.closest('.InputfieldImageEdit__imagewrapper')?.classList.remove('InputfieldImageEdit__replace');
				replace.file = '';
				replace.item = null;
				replace.panel = null;
			}, { signal });
		}
	}
}

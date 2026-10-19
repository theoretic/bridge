/**
 * AJAX file upload shared by the native File and Image fields (milestone 3.2, ADR 0016), on the
 * contract of upstream InputfieldFile.js / InputfieldImage.js (core 3.0.274):
 *
 * - POST of the raw file to the form action (or the upload element's data-posturl, or the
 *   repeater item's data-editUrl) + `InputfieldFileAjax=1` (+ `eid` from #Inputfield_id), headers
 *   X-FILENAME (URI-encoded), X-FIELDNAME (without a trailing []), X-REPLACENAME when replacing,
 *   X-<CSRF token name>, X-REQUESTED-WITH, Content-Type application/octet-stream;
 * - the JSON answer: one item or a list (a ZIP), each { error, message, markup, replace,
 *   overwrite }; CKEditor's upload wraps it in `ajaxResponse`;
 * - body.pw-uploading while uploads run (the page editor asks before a submit then), removed
 *   500 ms after the last one, as upstream does.
 */

export type UploadResult = { error?: boolean | number; message?: string; markup?: string; replace?: boolean; overwrite?: boolean; file?: string };

export type UploadTarget = {
	url: string;
	fieldName: string;
	tokenName: string;
	tokenValue: string;
	extensions: string;
	maxFilesize: number;
	maxFiles: number;
};

type Labels = Record<string, string>;

function pwConfig<T>(key: string): T | undefined {
	const pw = (window as unknown as { ProcessWire?: { config?: Record<string, unknown> } }).ProcessWire;
	return pw && pw.config ? pw.config[key] as T : undefined;
}

/** Upstream allows AJAX upload in the page editor (#PageIDIndicator) or where a form asks for it */
export function uploadAllowed(): boolean {
	if (typeof pwConfig('demo') !== 'undefined') return false;
	if (!window.File || !window.FileList || !window.FileReader) return false;
	return !!document.getElementById('PageIDIndicator') || !!document.querySelector('.InputfieldAllowAjaxUpload');
}

/** Where and how a field's uploads go; `upload` is .InputfieldFileUpload / .InputfieldImageUpload */
export function uploadTarget(upload: HTMLElement): UploadTarget {
	const form = upload.closest('form');
	const repeaterItem = upload.closest('.InputfieldRepeaterItem');
	let url = repeaterItem && repeaterItem.getAttribute('data-editUrl')
		|| upload.getAttribute('data-posturl')
		|| (form ? form.getAttribute('action') || '' : '');
	url += (url.indexOf('?') > -1 ? '&' : '?') + 'InputfieldFileAjax=1';
	const eid = document.getElementById('Inputfield_id') as HTMLInputElement | null;
	if (eid) url += '&eid=' + eid.value;
	const token = form ? form.querySelector<HTMLInputElement>('input._post_token') : null;
	let fieldName = upload.getAttribute('data-fieldname') || '';
	if (fieldName.indexOf('[') > -1) fieldName = fieldName.slice(0, -2);
	const content = upload.closest('.InputfieldContent') || upload.parentElement;
	const max = content ? content.querySelector<HTMLInputElement>('.InputfieldFileMaxFiles, .InputfieldImageMaxFiles') : null;
	return {
		url,
		fieldName,
		tokenName: token ? token.name : '',
		tokenValue: token ? token.value : '',
		extensions: (upload.getAttribute('data-extensions') || '').toLowerCase(),
		maxFilesize: parseInt(upload.getAttribute('data-maxfilesize') || '0', 10) || 0,
		maxFiles: max ? parseInt(max.value, 10) || 0 : 0,
	};
}

/**
 * Why a file may not be uploaded, as upstream words it, or '' when it may. The size is checked
 * only from 2 MB up (upstream's caution about PHP's reported limit) and not when the image will be
 * resized in the browser first.
 */
export function rejectReason(file: File, target: UploadTarget, resized = false): string {
	const labels = (pwConfig<{ labels?: Labels }>('InputfieldFile') || {}).labels || {};
	const ext = (file.name.split('.').pop() || '').toLowerCase();
	if (target.extensions.split(/\s+/).indexOf(ext) < 0) {
		return labels['bad-ext'] ? labels['bad-ext'].replace('EXTENSIONS', target.extensions)
			: ext + ' is a invalid file extension, please use one of: ' + target.extensions;
	}
	if (!resized && file.size > target.maxFilesize && target.maxFilesize > 2000000) {
		const maxKB = Math.floor(target.maxFilesize / 1024);
		return labels['too-big'] ? labels['too-big'].replace('MAX_KB', String(maxKB))
			: 'Filesize ' + Math.floor(file.size / 1024) + ' kb is too big. Maximum allowed is ' + maxKB + ' kb';
	}
	return '';
}

let running = 0;
let doneTimer = 0;

function busy(on: boolean): void {
	if (on) {
		running++;
		window.clearTimeout(doneTimer);
		document.body.classList.add('pw-uploading');
		return;
	}
	running = Math.max(0, running - 1);
	if (running) return;
	window.clearTimeout(doneTimer);
	doneTimer = window.setTimeout(() => document.body.classList.remove('pw-uploading'), 500);
}

/**
 * Upload one file (or its resized data); resolves with the list of results, rejects on a network
 * or parse failure. onProgress gets 0..100.
 */
export function send(file: File, target: UploadTarget, options: { body?: Blob | ArrayBuffer | string | null; replaceName?: string; onProgress?: (pct: number) => void } = {}): Promise<UploadResult[]> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		busy(true);
		xhr.upload.addEventListener('progress', e => {
			if (e.lengthComputable && options.onProgress) options.onProgress(Math.floor((e.loaded / e.total) * 100));
		});
		xhr.addEventListener('load', () => {
			busy(false);
			try {
				let data = JSON.parse(xhr.responseText) as unknown;
				if (data && typeof data === 'object' && 'ajaxResponse' in (data as object)) data = (data as { ajaxResponse: unknown }).ajaxResponse;
				resolve(Array.isArray(data) ? data as UploadResult[] : [data as UploadResult]);
			} catch (err) {
				reject(err);
			}
		});
		xhr.addEventListener('error', () => { busy(false); reject(new Error('upload failed')); });
		xhr.addEventListener('abort', () => { busy(false); reject(new Error('upload aborted')); });
		xhr.open('POST', target.url, true);
		xhr.setRequestHeader('X-FILENAME', encodeURIComponent(file.name));
		xhr.setRequestHeader('X-FIELDNAME', target.fieldName);
		if (options.replaceName) xhr.setRequestHeader('X-REPLACENAME', options.replaceName);
		xhr.setRequestHeader('Content-Type', 'application/octet-stream');
		if (target.tokenName) xhr.setRequestHeader('X-' + target.tokenName, target.tokenValue);
		xhr.setRequestHeader('X-REQUESTED-WITH', 'XMLHttpRequest');
		xhr.send(options.body || file);
		if (options.onProgress) options.onProgress(0);
	});
}

/** Parse server markup for a new item into an element */
export function toElement(markup: string): HTMLElement | null {
	const tpl = document.createElement('template');
	tpl.innerHTML = markup.trim();
	return tpl.content.firstElementChild as HTMLElement | null;
}

/**
 * Initialise what a new item holds (its own Inputfields: custom image fields) and tell upstream
 * listeners, as upstream does 250-500 ms after inserting the markup
 */
export function initItem(item: HTMLElement, source: string): void {
	const bridge = (window as unknown as { Bridge?: { Inputfields?: { init(root: ParentNode): void } } }).Bridge;
	if (bridge && bridge.Inputfields) bridge.Inputfields.init(item);
	item.querySelectorAll('.Inputfield').forEach(li => li.dispatchEvent(new CustomEvent('reloaded', { bubbles: true, detail: { source } })));
}

/** Files from a drop or a file input, as an array */
export function filesOf(list: FileList | null | undefined): File[] {
	return list ? Array.from(list) : [];
}

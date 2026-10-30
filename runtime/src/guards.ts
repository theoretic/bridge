/**
 * Risky action warnings (0.15.0, ADR 0019): a chunk of its own, loaded by the runtime entry while
 * the theme's "Warn before risky actions" setting is on.
 *
 * One capture listener on window per event type runs before every other handler, the runtime's
 * (on the field, the tree, the form) and upstream's (jQuery, on a page with the legacy stack), so
 * the same rule covers both. A rule that matches stops the event, asks (util/ask.ts, through
 * util/danger.ts guard()), and on OK plays the gesture again past itself:
 * - drop: a new drop event with the same files, on the same element;
 * - change of a file input: a new change event (the files are still on the input);
 * - click: el.click();
 * - submit: form.requestSubmit(submitter), so the in-place save and the save wait see the button;
 * - change of a select: the value already moved, so Cancel puts the one before back.
 *
 * Cases (the ADR has the sweep they come from):
 * - a file or image for a single-file field that holds one: deleted at save, or at once with the
 *   field's overwrite setting;
 * - an upload into an overwrite field whose name is already there: overwritten at once;
 * - a drop on the big image of the image field's edit panel: that image is deleted at save;
 * - the image editor's Save and Replace; Delete Checked in the variations window;
 * - B&W, Sepia and Reduce 50% in an image's actions;
 * - a comment's status set to Delete;
 * - Uninstall (or Remove from the database) in a module's settings;
 * - a save that changes a published page's name while PagePathHistory is not installed;
 * - Trash in a page tree item's extras.
 * The runtime's own gestures ask inline: images moved into a file field (fields/files-move.ts), a
 * drop on the tree's Trash (fields/pagelist-move.ts), a new repeater item removed (fields/repeater.ts).
 */

import { guard, fill } from './util/danger';
import { label } from './util/labels';
import { pwConfig } from './util/pw';
import type { AskOptions } from './util/ask';

const FIELD = '.Inputfield:is(.InputfieldFile, .InputfieldImage):not(.InputfieldRenderValueMode)';
const ITEM = 'li.InputfieldFileItem, li.gridImage:not(.gridImagePlaceholder):not(.gridImageUploading)';

// events and elements a replay sends past the rules once
const skip = new WeakSet<object>();
const passes = (o: object): boolean => (skip.has(o) ? (skip.delete(o), true) : false);

const text = (el: Element | null): string => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
const headerOf = (field: Element): string => text(field.querySelector(':scope > .InputfieldHeader'));

function basename(li: Element): string {
	const link = li.querySelector('a.InputfieldFileName');
	const img = li.querySelector('.gridImage__overflow img');
	const url = (link && link.getAttribute('href')) || (img && (img.getAttribute('data-original') || img.getAttribute('src'))) || '';
	const last = url.split('?')[0].split('/').pop() || '';
	try { return decodeURIComponent(last); } catch (err) { return last; }
}

const marked = (li: Element): boolean => !!li.querySelector('.InputfieldFileDelete input:checked, input.gridImage__deletebox:checked');

// close to WireUpload::validateFilename(): lowercase, accents dropped, other characters to _, dots in
// the name to _; a miss only means no warning
function uploadName(name: string): string {
	const s = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9._-]+/g, '_');
	const dot = s.lastIndexOf('.');
	return dot < 0 ? s : s.slice(0, dot).replace(/\./g, '_').replace(/^_+|_+$/g, '') + s.slice(dot);
}

/** What a set of files about to be uploaded to the field puts at risk */
function fileRisk(field: Element, files: File[], target: Element): AskOptions | null {
	const content = field.querySelector(':scope > .InputfieldContent');
	if (!content || !files.length) return null;
	const max = content.querySelector<HTMLInputElement>('.InputfieldFileMaxFiles, .InputfieldImageMaxFiles');
	const maxFiles = max ? parseInt(max.value, 10) || 0 : 0;
	const list = content.querySelector('ul.InputfieldFileList, ul.gridImages');
	const items = list ? Array.from(list.children).filter(c => c.matches(ITEM)) : [];
	const overwrite = !!list && list.classList.contains('InputfieldFileOverwrite');
	const name = headerOf(field) || label('warnThisField', 'This field');
	if (maxFiles === 1) {
		const current = items.filter(li => !marked(li))[0];
		if (!current) return null;
		const old = basename(current);
		return {
			title: fill('warnReplaceTitle', 'Replace %s?', old),
			message: overwrite
				? fill('warnReplaceNow', '%s holds one file. The new file takes the place of %s, which is deleted right away. This can’t be undone.', name, old)
				: fill('warnReplace', '%s holds one file. The new file takes the place of %s, which is deleted when you save the page.', name, old),
			items: [files[0].name],
			ok: label('warnVerbReplace', 'Replace'),
		};
	}
	const wrapper = target.closest('.InputfieldImageEdit__imagewrapper');
	const panel = wrapper ? wrapper.closest('.InputfieldImageEdit') : null;
	if (panel) {
		const item = document.getElementById(panel.getAttribute('data-for') || '');
		const old = item ? basename(item) : '';
		if (old) return {
			title: fill('warnReplaceTitle', 'Replace %s?', old),
			message: fill('warnReplaceImage', 'The image you dropped takes the place of %s, which is deleted when you save the page.', old),
			items: [files[0].name],
			ok: label('warnVerbReplace', 'Replace'),
		};
	}
	if (overwrite) {
		const have = new Set(items.map(li => basename(li).toLowerCase()));
		const hits = files.map(f => uploadName(f.name)).filter(n => have.has(n));
		if (hits.length) return {
			title: fill('warnOverwriteTitle', 'Overwrite files in %s?', name),
			message: label('warnOverwrite', 'Files of these names are already in the field. The upload overwrites them right away, and the sized copies of an image go too. This can’t be undone.'),
			items: hits,
			ok: label('warnVerbOverwrite', 'Overwrite'),
		};
	}
	return null;
}

const HOVER = ['ui-state-hover', 'pw-drag-in-file', 'InputfieldImageEdit__replace'];

function onDrop(e: DragEvent): void {
	if (passes(e) || !e.dataTransfer || !e.dataTransfer.files.length) return;
	const t = e.target as Element;
	const field = t.closest ? t.closest(FIELD) : null;
	if (!field) return;
	const files = Array.from(e.dataTransfer.files);
	const risk = fileRisk(field, files, t);
	if (!risk) return;
	e.preventDefault();
	e.stopImmediatePropagation();
	// what the field's own drop handler would have cleared
	field.querySelectorAll('.' + HOVER.join(', .')).forEach(el => el.classList.remove(...HOVER));
	field.classList.remove(...HOVER);
	void guard(risk).then(ok => {
		if (!ok || !t.isConnected) return;
		const dt = new DataTransfer();
		files.forEach(f => dt.items.add(f));
		const again = new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: e.clientX, clientY: e.clientY });
		skip.add(again);
		t.dispatchEvent(again);
	});
}

// the value a select had before this change, for Cancel
const before = new WeakMap<HTMLSelectElement, string>();
const remember = (e: Event): void => {
	const s = e.target as HTMLSelectElement;
	if (s && s.tagName === 'SELECT') before.set(s, s.value);
};

const ACTIONS = ['bw', 'sep', 'x50'];

function onChange(e: Event): void {
	if (passes(e)) return;
	const t = e.target as HTMLInputElement | HTMLSelectElement;
	if (!t || !t.closest) return;
	if (t instanceof HTMLInputElement && t.type === 'file') {
		const field = t.closest(FIELD);
		const files = t.files ? Array.from(t.files) : [];
		const risk = field ? fileRisk(field, files, t) : null;
		if (!risk) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		void guard(risk).then(ok => {
			if (!ok) { t.value = ''; return; }
			const again = new Event('change', { bubbles: true });
			skip.add(again);
			t.dispatchEvent(again);
		});
		return;
	}
	if (!(t instanceof HTMLSelectElement)) return;
	let risk: AskOptions | null = null;
	if (t.closest('.InputfieldCommentsAdmin') && /^delete\d+$/.test(t.value)) {
		risk = {
			title: label('warnCommentTitle', 'Delete this comment?'),
			message: label('warnComment', 'The comment is deleted for good when you save the page. This can’t be undone.'),
			ok: label('warnVerbDelete', 'Delete'),
		};
	} else if (t.matches('.InputfieldFileActionSelect') && ACTIONS.indexOf(t.value) > -1) {
		const item = t.closest(ITEM) || document.getElementById((t.closest('.InputfieldImageEdit') || t).getAttribute('data-for') || '');
		risk = {
			title: fill('warnActionTitle', '%s: change the original image?', text(t.options[t.selectedIndex])),
			message: label('warnAction', 'The action is applied when you save the page and replaces the original pixels. This can’t be undone.'),
			items: item ? [basename(item)] : [],
			ok: label('warnVerbApply', 'Apply'),
		};
	}
	if (!risk) return;
	e.stopImmediatePropagation();
	const value = t.value;
	const previous = before.has(t) ? before.get(t) as string : '';
	void guard(risk).then(ok => {
		if (!ok) { t.value = previous; return; }
		t.value = value;
		before.set(t, value);
		const again = new Event('change', { bubbles: true });
		skip.add(again);
		t.dispatchEvent(again);
	});
}

function onClick(e: MouseEvent): void {
	const t = e.target as Element;
	if (!t || !t.closest || e.button !== 0) return;
	const el = t.closest<HTMLElement>('button.submit_save_replace, a.PageListActionTrash');
	if (!el || passes(el)) return;
	let risk: AskOptions;
	if (el.matches('button')) {
		risk = {
			title: label('warnSaveReplaceTitle', 'Replace the original image?'),
			message: label('warnSaveReplace', 'The original file is overwritten with this version and its sized copies are made again. This can’t be undone.'),
			ok: label('warnVerbReplace', 'Replace'),
		};
	} else {
		const li = el.closest('.PageListItem');
		if (!li) return;
		const kids = parseInt(text(li.querySelector('.PageListNumChildren')), 10) || 0;
		risk = {
			title: fill('warnTrashTitle', 'Move %s to the trash?', text(li.querySelector('.label_title') || li.querySelector('a.PageListPage'))),
			message: kids
				? fill('warnTrashKids', 'It leaves the site right away, with its %d subpages. You can restore it from the trash.', kids)
				: label('warnTrash', 'It leaves the site right away. You can restore it from the trash.'),
			ok: label('warnVerbTrash', 'Move to trash'),
		};
	}
	e.preventDefault();
	e.stopImmediatePropagation();
	void guard(risk).then(ok => {
		if (!ok || !el.isConnected) return;
		skip.add(el);
		el.click();
	});
}

// a page name as last saved: the markup's, then what an in-place save stored
const savedName = new WeakMap<HTMLInputElement, string>();
// by id: InputfieldPageName posts as _pw_pg_name<language id> (core 3.0.274 :177), its id stays
const nameInputs = (form: Element): HTMLInputElement[] => Array.from(form.querySelectorAll<HTMLInputElement>('input[id^="Inputfield__pw_page_name"]'));
function onSaved(): void {
	const form = document.getElementById('ProcessPageEdit');
	if (form) nameInputs(form).forEach(i => savedName.set(i, i.value));
}

function submitRisk(form: HTMLFormElement, submitter: HTMLElement | null): AskOptions | null {
	// the attribute: the page editor's input named "id" shadows form.id
	const id = form.getAttribute('id') || '';
	if (id === 'ImageVariations') {
		const n = form.querySelectorAll('input[name="delete[]"]:checked').length;
		return n ? {
			title: n === 1 ? label('warnVariationTitle', 'Delete this sized copy?') : fill('warnVariationsTitle', 'Delete %d sized copies?', n),
			message: label('warnVariations', 'They are deleted right away. Rich text that shows one of them loses the image.'),
			ok: label('warnVerbDelete', 'Delete'),
		} : null;
	}
	const uninstall = form.querySelector<HTMLInputElement>('input#uninstall:checked:not(:disabled)');
	if (uninstall) return {
		title: fill('warnUninstallTitle', 'Uninstall %s?', uninstall.value),
		message: label('warnUninstall', 'The module’s uninstall step runs when you submit. It may remove its database tables, fields, templates or pages along with its settings. This can’t be undone.'),
		ok: label('warnVerbUninstall', 'Uninstall'),
	};
	const removeDb = form.querySelector<HTMLInputElement>('input[name="remove_db"]:checked');
	if (removeDb) return {
		title: fill('warnRemoveDbTitle', 'Remove %s from the database?', removeDb.value),
		message: label('warnRemoveDb', 'Its settings are removed. This can’t be undone.'),
		ok: label('warnVerbRemove', 'Remove'),
	};
	// a published page (no Publish button) renamed, with no path history to redirect the old URL
	if (id !== 'ProcessPageEdit' || pwConfig<{ pathHistory?: boolean }>('AdminThemeBridge').pathHistory) return null;
	if (form.querySelector('#submit_publish') || (submitter && /^submit_(delete|publish)$/.test(submitter.id))) return null;
	const changed = nameInputs(form).filter(i => i.value !== (savedName.has(i) ? savedName.get(i) : i.defaultValue));
	if (!changed.length) return null;
	const main = changed[0];
	return {
		title: label('warnRenameTitle', 'Change this page’s address?'),
		message: fill('warnRename', 'Its address goes from …/%s/ to …/%s/, and those of its subpages change too. Links and bookmarks to the old address stop working.',
			savedName.has(main) ? savedName.get(main) as string : main.defaultValue, main.value),
		ok: label('warnVerbSave', 'Save'),
	};
}

function onSubmit(e: SubmitEvent): void {
	const form = e.target as HTMLFormElement;
	if (!form || form.tagName !== 'FORM' || passes(form)) return;
	const submitter = e.submitter as HTMLElement | null;
	const risk = submitRisk(form, submitter);
	if (!risk) return;
	e.preventDefault();
	e.stopImmediatePropagation();
	void guard(risk).then(ok => {
		if (!ok || !form.isConnected) return;
		skip.add(form);
		const own = submitter && (submitter as HTMLButtonElement).form === form ? submitter : undefined;
		if (form.requestSubmit) form.requestSubmit(own);
		else if (submitter) submitter.click();
		else form.submit();
	});
}

let started = false;

export function start(): void {
	if (started) return;
	started = true;
	window.addEventListener('drop', onDrop, true);
	window.addEventListener('change', onChange, true);
	window.addEventListener('focusin', remember, true);
	window.addEventListener('pointerdown', remember, true);
	window.addEventListener('click', onClick, true);
	window.addEventListener('submit', onSubmit, true);
	document.addEventListener('pw-page-saved', onSaved);
}

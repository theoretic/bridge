/**
 * AdminThemeBridge: save without a page reload (ADR 0013; other edit forms since milestone 3.8)
 *
 * Progressive enhancement of the upstream ProcessPageEdit form; no server markup changes.
 * A plain Save / Publish / "Save + Keep Unpublished" is POSTed with fetch exactly as the browser
 * would post it (without X-Requested-With, which would route to ProcessPageEdit::ajaxSave, a
 * custom-fields-only path). ProcessPageEdit saves and redirects to edit?id=N&s=1&c=<changes>; fetch
 * follows the redirect and receives the freshly rendered editor, whose form, content head and
 * notices replace the current ones. The editor's own initialisation is then re-run.
 *
 * Pages with a site module's script added for the screen (legacy reason Script:..., such as
 * VersionControl or BatchChildEditor, milestone 3.9 audit) always save the classic way: such
 * scripts bind at document ready and would leave the swapped form without their UI.
 *
 * Everything else takes the classic submit: Save + Exit/View/Add/Next (after-submit action),
 * Delete, a changed template, uploads in progress (a save waits for them first, main.js saveWait;
 * only "save now" while they run gets here), Shift+click on a save button, the single-field
 * editor and modal windows (this script is not loaded there). Any unexpected response falls back
 * to the classic path; a failure after the server has saved navigates to the saved page.
 *
 * Events on document: 'pw-page-save' (cancelable; cancelling falls back to the classic submit,
 * detail {form, submitter}) and 'pw-page-saved' (detail {url, changes, errors}).
 *
 * Other edit forms (milestone 3.8), on pages without the legacy stack (upstream's scripts for them
 * bind once at load), by the form's id in RULES: the field, template and module editors and the
 * profile; user, role and permission editors are ProcessPageEdit forms. Their save is posted the
 * same way. A redirect back to the same screen (path, and its id or name) swaps the content body,
 * head and notices, runs the screen's inline scripts and set-up again (scripts/setup.js,
 * scripts/screens.js) and puts back the tab, open fields, scroll and focus. A redirect elsewhere is
 * followed; a response without one is shown as it came (never posted again: it may have saved).
 * Classic for: Save + Exit (button value "exit"), a checked Delete, Uninstall or Remove, Shift+click.
 * Events: 'pw-form-save' (cancelable, detail {form, submitter}) and 'pw-form-saved' (detail
 * {form, url, errors}).
 */
(function() {
	'use strict';

	var cfg = (window.ProcessWire && ProcessWire.config && ProcessWire.config.AdminThemeBridge) || {};
	if(!cfg.pageSave || typeof window.fetch !== 'function' || typeof window.DOMParser === 'undefined') return;

	var SUBMITTERS = ['submit_save', 'submit_publish', 'submit_save_unpublished'];
	// other edit forms by id: their save buttons (by name), the URL parameter naming what is edited,
	// what makes a submit classic
	var RULES = {
		ProcessFieldEdit: { submitters: ['submit_save_field'], key: 'id', block: '#delete:checked' },
		ProcessTemplateEdit: { submitters: ['submit'], key: 'id', block: '#delete:checked' },
		ModuleEditForm: { submitters: ['submit_save_module'], key: 'name', block: 'input[name=uninstall]:checked, input[name=remove_db]:checked' },
		ProcessProfile: { submitters: ['submit_save_profile'], key: '' }
	};
	var shiftUntil = 0;
	var bypass = false;
	var busy = false;

	// Shift+click on a save button (or its head copy, which clicks the original without the
	// modifier) asks for the classic save
	document.addEventListener('click', function(e) {
		if(e.shiftKey && e.target.closest && e.target.closest('button, input[type=submit]')) shiftUntil = Date.now() + 800;
	}, true);

	// capture on document: runs before upstream's submit handlers on the form
	document.addEventListener('submit', function(e) {
		var form = e.target;
		var id = form && form.getAttribute ? form.getAttribute('id') : '';
		if(id !== 'ProcessPageEdit' && !RULES[id]) return;
		if(bypass) { bypass = false; return; }
		// Enter in a text field (implicit submission: the submitter is the default button, the
		// focus stays in the field) is upstream's and the runtime's Enter guard to block in a form
		// with several buttons; this listener runs first (capture, <head>), so it steps aside (B5)
		if(implicitSubmit(form, e.submitter)) return;
		var rule = RULES[id] || null;
		var isSave = e.submitter && (rule ? rule.submitters.indexOf(e.submitter.name) > -1 : SUBMITTERS.indexOf(e.submitter.id) > -1);
		if(isSave && Date.now() < shiftUntil) {
			// Shift+click: a classic save in this tab (the browser's own Shift+submit opens a new window)
			e.preventDefault();
			e.stopImmediatePropagation();
			shiftUntil = 0;
			return classic(form, e.submitter);
		}
		if(rule ? !eligibleForm(form, e.submitter, rule) : !eligible(form, e.submitter)) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		if(busy) return;
		save(form, e.submitter, rule);
	}, true);

	var NOT_ENTRY = ['submit', 'button', 'image', 'reset', 'hidden', 'checkbox', 'radio', 'file'];
	function implicitSubmit(form, submitter) {
		var active = document.activeElement;
		if(!active || active === submitter || !form.contains(active) || !active.matches('input, select')) return false;
		if(active.tagName === 'INPUT' && NOT_ENTRY.indexOf(active.type) > -1) return false;
		return form.querySelectorAll('button[type=submit], input[type=submit]').length > 1;
	}

	function eligibleForm(form, submitter, rule) {
		if(!submitter || rule.submitters.indexOf(submitter.name) < 0 || submitter.value === 'exit') return false;
		// upstream's scripts for these screens bind once at load; with the stack, reload as before
		if(window.jQuery) return false;
		if(document.body.classList.contains('modal') || document.body.classList.contains('pw-uploading')) return false;
		if(rule.block && form.querySelector(rule.block)) return false;
		if(moduleScripts()) return false;
		return true;
	}

	// a site module's script added for this screen (legacy reason Script:<dir>/<file>, such as
	// VersionControl's or BatchChildEditor's) binds at document ready and would not set up the
	// swapped form: such a page saves the classic way
	function moduleScripts() {
		var reasons = cfg.legacyReasons || {};
		return Object.keys(reasons).some(function(k) { return k.indexOf('Script:') === 0; });
	}

	function eligible(form, submitter) {
		if(!submitter || SUBMITTERS.indexOf(submitter.id) < 0) return false;
		if(moduleScripts()) return false;
		if(document.body.classList.contains('modal') || document.body.classList.contains('pw-uploading')) return false;
		if(form.classList.contains('ProcessPageEditSingleField')) return false;
		var action = document.getElementById('after-submit-action');
		if(action && action.value) return false;
		if(form.querySelector('input[name=submit_delete]')) return false;
		var template = form.querySelector('select[name=template]');
		if(template && template.selectedIndex > -1 && !template.options[template.selectedIndex].defaultSelected) return false;
		return true;
	}

	// next tick: requestSubmit() is ignored while the form is still firing its submit event
	function classic(form, submitter) {
		setTimeout(function() {
			bypass = true;
			if(form.requestSubmit) form.requestSubmit(submitter);
			else submitter.click();
		}, 0);
	}

	function formData(form, submitter) {
		try {
			return new FormData(form, submitter);
		} catch(e) {
			var data = new FormData(form);
			if(submitter.name) data.append(submitter.name, submitter.value);
			return data;
		}
	}

	function save(form, submitter, rule) {
		var ev = new CustomEvent(rule ? 'pw-form-save' : 'pw-page-save', { cancelable: true, detail: { form: form, submitter: submitter } });
		if(!document.dispatchEvent(ev)) return classic(form, submitter);
		var $ = window.jQuery;
		// editors write their content into the form (TinyMCE, inline CKEditor, any listener)
		if($) $(form).find('.Inputfield').trigger('saveReady');
		if(window.CKEDITOR) eachEditorIn(form, function(editor) { editor.updateElement(); });
		var data = formData(form, submitter);
		busy = true;
		setBusy(form, submitter, true);
		// the submit listener above stops the event before inputfields/forms.ts marks the form: a
		// redirect elsewhere after the save would otherwise ask about unsaved changes
		var confirmForm = form.classList.contains('InputfieldFormConfirm');
		if(confirmForm) form.classList.add('InputfieldFormSubmitted');
		fetch(form.getAttribute('action') || location.href, { method: 'POST', body: data, credentials: 'same-origin' })
			.then(function(res) { return res.text().then(function(html) { return { res: res, html: html }; }); })
			.then(function(r) { if(rule) doneForm(form, submitter, rule, r.res, r.html); else done(form, submitter, r.res, r.html); })
			.catch(function(err) {
				// no answer: the request may still have reached the server (a connection lost after
				// the save), so posting again could save twice. Say so and let the user save again
				if(window.console) console.error('Bridge page save:', err);
				busy = false;
				setBusy(form, submitter, false);
				if(confirmForm) form.classList.remove('InputfieldFormSubmitted');
				var msg = ((ProcessWire.config.AdminThemeBridge || {}).labels || {}).saveNoAnswer || 'The save got no answer from the server. Check the page and save again if needed.';
				if(window.ProcessWire && typeof ProcessWire.alert === 'function') ProcessWire.alert(msg); else window.alert(msg);
			});
	}

	function done(form, submitter, res, html) {
		busy = false;
		if(!res.redirected) {
			// no redirect: not saved (CSRF or form landmark failed), a server error, or a hook that
			// answered itself. Show the answer as it came, as doneForm() does: posting the form again
			// the classic way repeated a save that had happened (a 500 after the save, a hook's 200)
			document.open();
			document.write(html);
			document.close();
			return;
		}
		var url = new URL(res.url, location.href);
		var here = new URL(location.href);
		var idInput = form.querySelector('input[name=id]');
		var id = here.searchParams.get('id') || (idInput ? idInput.value : '');
		if(!res.ok || url.pathname !== here.pathname || url.searchParams.get('id') !== id || url.searchParams.get('s') !== '1') {
			// saved, but the editor sent us elsewhere: follow it
			return location.assign(res.url);
		}
		try {
			swap(form, html, url, submitter);
			document.body.classList.remove('pw-saving'); // the swapped-in buttons are fresh and enabled
		} catch(err) {
			if(window.console) console.error('Bridge page save, swap failed:', err);
			location.assign(res.url);
		}
	}

	function samePath(a, b) {
		return a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, '');
	}

	function doneForm(form, submitter, rule, res, html) {
		busy = false;
		var url = new URL(res.url, location.href);
		var here = new URL(location.href);
		var formId = form.getAttribute('id');
		var doc = new DOMParser().parseFromString(html, 'text/html');
		var same = res.ok && samePath(url, here) && (!rule.key || url.searchParams.get(rule.key) === here.searchParams.get(rule.key));
		if(res.redirected && !same) return location.assign(res.url);
		if(!res.ok || !doc.getElementById(formId) || !doc.getElementById('pw-content-body')) {
			// not the screen we posted from (an error page, a confirmation): show it as it came
			document.open();
			document.write(html);
			document.close();
			return;
		}
		try {
			swapForm(form, doc, url, submitter);
			document.body.classList.remove('pw-saving');
		} catch(err) {
			if(window.console) console.error('Bridge form save, swap failed:', err);
			location.assign(res.redirected ? res.url : location.href);
		}
	}

	function swapHeadAndNotices(doc) {
		var head = document.getElementById('pw-content-head');
		var newHead = doc.getElementById('pw-content-head');
		if(head && newHead) head.parentNode.replaceChild(newHead, head);
		var notices = document.getElementById('notices');
		var newNotices = doc.getElementById('notices');
		if(notices) notices.parentNode.removeChild(notices);
		var masthead = document.getElementById('pw-masthead');
		if(newNotices && masthead) masthead.insertAdjacentElement('afterend', newNotices);
		if(doc.title) document.title = doc.title;
		// Debug Mode Tools (scripts/debug-tools.js): the saved page's request, wherever the panel is
		var debug = document.getElementById('debug');
		var newDebug = doc.getElementById('debug');
		if(debug && newDebug) debug.innerHTML = newDebug.innerHTML;
	}

	function swapForm(form, doc, url, submitter) {
		var formId = form.getAttribute('id');
		var body = document.getElementById('pw-content-body');
		var newBody = doc.getElementById('pw-content-body');
		var state = captureState(form, submitter);
		// menus the theme moved to <body> for this screen's buttons
		Array.prototype.forEach.call(document.querySelectorAll('body > ul.pw-button-dropdown'), function(ul) { ul.parentNode.removeChild(ul); });
		while(body.firstChild) body.removeChild(body.firstChild);
		Array.prototype.slice.call(newBody.childNodes).forEach(function(n) { body.appendChild(document.adoptNode(n)); });
		swapHeadAndNotices(doc);
		runScripts(body);
		var theme = window.ProcessWireAdminTheme;
		if(theme && theme.setupHeadButtons) theme.setupHeadButtons();
		// the screen's own set-up (tabs, sliders, field list), as at load
		if(theme && theme.setup && theme.setup.init) theme.setup.init();
		if(theme && theme.screens && theme.screens.init) theme.screens.init();
		var newForm = document.getElementById(formId);
		restoreState(newForm, state);
		document.dispatchEvent(new CustomEvent('pw-form-saved', { detail: {
			form: newForm,
			url: url.href,
			errors: newForm.querySelectorAll('.InputfieldStateError').length
		} }));
	}

	function swap(form, html, url, submitter) {
		var doc = new DOMParser().parseFromString(html, 'text/html');
		var newForm = doc.getElementById('ProcessPageEdit');
		var newBody = doc.getElementById('pw-content-body');
		var body = document.getElementById('pw-content-body');
		if(!newForm || !newBody || !body) throw new Error('no page editor in the response');
		var state = captureState(form, submitter);
		teardown(form);

		// the form element stays (handlers bound to .InputfieldForm survive); attributes and children are new
		for(var i = form.attributes.length - 1; i >= 0; i--) form.removeAttribute(form.attributes[i].name);
		for(i = 0; i < newForm.attributes.length; i++) form.setAttribute(newForm.attributes[i].name, newForm.attributes[i].value);
		while(form.firstChild) form.removeChild(form.firstChild);
		while(newForm.firstChild) form.appendChild(newForm.firstChild);
		// the rest of the content body in the new order: inline scripts, dropdown templates, page id
		var nodes = Array.prototype.slice.call(newBody.childNodes);
		Array.prototype.slice.call(body.childNodes).forEach(function(n) { if(n !== form) body.removeChild(n); });
		nodes.forEach(function(n) { body.appendChild(n === newForm ? form : n); });

		swapHeadAndNotices(doc);

		runScripts(body);
		var $ = window.jQuery;
		var theme = window.ProcessWireAdminTheme;
		// head-button copies before upstream binds the dropdown toggles (the 'reloaded' below)
		if(theme && theme.setupHeadButtons) theme.setupHeadButtons();
		if(theme && theme.legacy) theme.legacy.initElement(form);
		// user, role and permission editors: their screen's set-up (scripts/setup.js) again
		if(theme && theme.setup && theme.setup.init && !window.jQuery) theme.setup.init();
		if(window.ProcessWireAdmin && ProcessWireAdmin.setupNotices && $) ProcessWireAdmin.setupNotices();

		form.classList.remove('InputfieldFormSubmitted');
		Array.prototype.forEach.call(form.querySelectorAll('.InputfieldStateChanged'), function(el) { el.classList.remove('InputfieldStateChanged'); });
		restoreState(form, state);

		document.dispatchEvent(new CustomEvent('pw-page-saved', { detail: {
			url: url.href,
			changes: parseInt(url.searchParams.get('c') || '0', 10),
			errors: form.querySelectorAll('.InputfieldStateError').length
		} }));
	}

	// scripts parsed by DOMParser never run: the theme's shared runner makes live copies, in order
	// (synchronous: no legacy wait, the editor's own stack state does not change on a save). Inline
	// ones only: they carry the per-render set-up; a src one ran with the page, again would bind twice
	function runScripts(root) {
		var $ = window.jQuery;
		var before = $ ? submitConfirmHandlers() : [];
		window.ProcessWireAdminTheme.runScripts(Array.prototype.slice.call(root.querySelectorAll('script:not([src])')));
		// initPageEditForm() binds a document-delegated upload confirm on every run: keep the first
		if($ && before.length) submitConfirmHandlers().forEach(function(h) {
			if(before.indexOf(h) < 0) jQuery(document).off('click', 'button[type=submit]', h.handler);
		});
	}

	function submitConfirmHandlers() {
		var events = jQuery._data(document, 'events') || {};
		return (events.click || []).filter(function(h) { return h.selector === 'button[type=submit]' && !h.namespace; });
	}

	function eachEditorIn(root, fn) {
		if(!window.CKEDITOR) return;
		Object.keys(CKEDITOR.instances).forEach(function(name) {
			var editor = CKEDITOR.instances[name];
			var el = editor && editor.element && editor.element.$;
			if(el && root.contains(el)) fn(editor);
		});
	}

	function teardown(form) {
		var $ = window.jQuery;
		eachEditorIn(form, function(editor) { try { editor.destroy(true); } catch(e) {} });
		if($) $(form).find('.InputfieldTinyMCE').trigger('reload');
		// menus upstream moved to <body> for this form (button dropdowns, the View menu)
		Array.prototype.forEach.call(document.querySelectorAll('body > ul.pw-button-dropdown, body > #_ProcessPageEditViewDropdown'), function(ul) {
			ul.parentNode.removeChild(ul);
		});
	}

	function captureState(form, submitter) {
		var tab = form.querySelector('#PageEditTabs a.on') || form.querySelector('#PageEditTabs li.pw-active > a')
			|| document.querySelector('#pw-content-body ul.WireTabs a.on');
		var open = [];
		Array.prototype.forEach.call(form.querySelectorAll('.Inputfield[id]:not(.InputfieldStateCollapsed)'), function(el) { open.push(el.id); });
		var active = document.activeElement;
		return {
			tab: tab ? tab.id : '',
			scroll: window.scrollY,
			anchor: scrollAnchor(form, submitter),
			open: open,
			focus: active && active.id && form.contains(active) ? active.id : ''
		};
	}

	// the save button that was clicked (the one at the bottom, or its copy in the head when that is
	// the one on screen) and where it is in the window: the scroll is put back by it, not by
	// scrollY, so what changes above it in the new screen (notices, fields that set themselves up
	// later) does not move it
	function scrollAnchor(form, submitter) {
		if(!submitter) return null;
		var formId = form.getAttribute('id');
		var shown = function(el) {
			var r = el && el.getBoundingClientRect();
			return r && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
		};
		var copy = submitter.id ? document.getElementById(submitter.id + '_copy') : null;
		var el = !shown(submitter) && shown(copy) ? copy : submitter;
		if(!el.getBoundingClientRect().height) return null;
		var id = el.id;
		var name = el.getAttribute('name');
		return {
			top: el.getBoundingClientRect().top,
			find: function() {
				if(id) return document.getElementById(id);
				return name && formId ? document.querySelector('#' + formId + ' [name="' + name + '"]') : null;
			}
		};
	}

	// scroll by the anchor; true when it was found
	function toAnchor(anchor) {
		var el = anchor.find();
		if(!el || !el.getBoundingClientRect().height) return false;
		var delta = el.getBoundingClientRect().top - anchor.top;
		if(Math.abs(delta) >= 1) window.scrollBy(0, delta);
		return true;
	}

	// fields that set themselves up after the swap (legacy Inputfields, editors, images) change the
	// height above the button for a while: keep it in place for a second, until the user scrolls
	function holdAnchor(anchor) {
		var until = Date.now() + 1000;
		var stop = function() {
			until = 0;
			['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function(t) { window.removeEventListener(t, stop, true); });
		};
		['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function(t) { window.addEventListener(t, stop, true); });
		var step = function() {
			if(Date.now() > until || !toAnchor(anchor)) return stop();
			requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	}

	function restoreState(form, state) {
		var $ = window.jQuery;
		// a native click reaches upstream's jQuery tab handlers and the native WireTabs alike
		if(state.tab) {
			var link = document.getElementById(state.tab);
			if(link) link.click();
		}
		if(window.Inputfields) state.open.forEach(function(id) {
			var el = document.getElementById(id);
			if(!el || !form.contains(el) || !el.classList.contains('InputfieldStateCollapsed')) return;
			if(Inputfields.native) Inputfields.open(el);
			else if($ && Inputfields.toggle) Inputfields.toggle($(el), true, 0);
		});
		// at the top the notices show in their place; scrolled down, they are fixed below the
		// masthead (scripts/main.js floatNotices) and the clicked button stays where it was
		var theme = window.ProcessWireAdminTheme;
		window.scrollTo(0, state.scroll);
		if(state.scroll > 0 && state.anchor && toAnchor(state.anchor)) {
			if(theme && theme.floatNotices) theme.floatNotices();
			toAnchor(state.anchor);
			holdAnchor(state.anchor);
		}
		if(state.focus) {
			var f = document.getElementById(state.focus);
			if(f && f.focus) try { f.focus({ preventScroll: true }); } catch(e) {}
		}
	}

	function setBusy(form, submitter, on) {
		document.body.classList.toggle('pw-saving', on);
		var buttons = Array.prototype.slice.call(form.querySelectorAll('button[type=submit], input[type=submit]'))
			.concat(Array.prototype.slice.call(document.querySelectorAll('.pw-head-button-copy')));
		buttons.forEach(function(b) { b.disabled = on; });
		[submitter, document.getElementById(submitter.id + '_copy')].forEach(function(b) {
			if(!b) return;
			var spin = b.querySelector('.pw-save-spinner');
			if(on && !spin) {
				spin = document.createElement('i');
				spin.className = 'fa fa-fw fa-spin fa-spinner pw-save-spinner';
				(b.querySelector('.ui-button-text') || b).appendChild(spin);
			} else if(!on && spin) {
				spin.parentNode.removeChild(spin);
			}
		});
	}
})();

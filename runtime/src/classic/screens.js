/**
 * AdminThemeBridge: native page-add, profile and log screens (ADR 0016, milestone 3.7)
 *
 * Stand-in for upstream ProcessPageAdd.js, ProcessProfile.js and ProcessLogger.js (checked
 * against core 3.0.274) on pages without the legacy stack; printed after scripts/wire-tabs.js by
 * nativeProcessScripts() for those exact classes. Each part runs on its Process's body class.
 *
 * - Add page: the parent select submits itself; a changed predefined parent reloads with it;
 *   one submit only; Publish buttons follow the template's data-publish; the name is checked
 *   against its siblings (./exists, 250 ms after typing) with the form's data-dup-note; a
 *   template with data-nolang hides the language tabs; a language name checks its "active" box.
 * - Profile: remembered passwords are cleared from autocomplete=off inputs; a submit that changes
 *   a field needing the current password, without it, opens and focuses that input instead
 *   (upstream asked in a vex dialog; the password never goes through a prompt).
 * - Logs: the global ProcessLogger keeps upstream's API (init, submitFilters, setupLogEntries,
 *   paginationClick, filterChange); entries refresh every 5 s, filters reload them, pager links
 *   load by AJAX, new rows flash.
 */
(function(theme) {
	'use strict';
	if(!theme || theme.screens) return;
	// listeners end when upstream's own script for this screen takes over (main.js handover)
	var handover = (theme && theme.handover) || { over: false, bind: function(o) { return o; } };

	function $(sel, root) { return (root || document).querySelector(sel); }
	function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
	function on(el, type, fn) { if(el) el.addEventListener(type, fn, handover.bind()); }
	function show(el, yes) { if(el) el.style.display = yes ? '' : 'none'; }
	function flash(el) {
		if(!el || !el.animate) return;
		var color = getComputedStyle(document.documentElement).getPropertyValue('--pw-primary-bg').trim() || '#ffffaa';
		el.animate([{ backgroundColor: color }, { backgroundColor: 'transparent' }], { duration: 1000 });
	}
	function getJSON(url) {
		return fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
			.then(function(res) { return res.json(); });
	}

	/* Add page ---------------------------------------------------------------------------- */

	function hideLanguageTabs() {
		$$('.InputfieldContent').forEach(function(content) {
			var n = 0;
			Array.prototype.forEach.call(content.children, function(child) {
				if(!child.classList.contains('LanguageSupport')) return;
				if(++n === 1) {
					var li = child.closest('.Inputfield');
					if(li) li.classList.add('hadLanguageSupport');
					return;
				}
				child.classList.add('langTabsHidden');
			});
		});
		// the first language's tab is the one left
		var first = $('.langTabs li a');
		var cfg = (window.ProcessWire && ProcessWire.config && ProcessWire.config.LanguageTabs) || {};
		var li = first ? first.closest('li') : null;
		if(first && cfg.liActiveClass && li && !li.classList.contains(cfg.liActiveClass)) first.click();
		$$('.langTabsToggle, .LanguageSupportLabel, .langTabs > ul').forEach(function(el) {
			if(!el.classList.contains('LanguageSupportLabel') || el.offsetParent !== null) el.classList.add('langTabsHidden');
		});
		$$('.hasLangTabs').forEach(function(el) { el.classList.remove('hasLangTabs'); el.classList.add('hadLangTabs'); });
	}
	function unhideLanguageTabs() {
		$$('.langTabsHidden').forEach(function(el) { el.classList.remove('langTabsHidden'); });
		$$('.hadLangTabs').forEach(function(el) { el.classList.remove('hadLangTabs'); el.classList.add('hasLangTabs'); });
		$$('.hadLanguageSupport').forEach(function(el) { el.classList.remove('hadLanguageSupport'); });
	}

	function pageAdd() {
		var parentSubmit = $('#select_parent_submit');
		show(parentSubmit, false);
		on($('#select_parent_id'), 'change', function() {
			if(this.value > 0 && parentSubmit) parentSubmit.click();
		});
		var parent = $('#Inputfield_parent_id');
		on(parent, 'change', function() {
			if(!(this.value > 0)) return;
			var url = './?parent_id=' + encodeURIComponent(this.value);
			var modal = $('input[name=modal]');
			if(modal && modal.value) url += '&modal=1';
			window.location.href = url;
		});
		var submitted = false;
		on($('#ProcessPageAdd'), 'submit', function(e) {
			if(submitted) { e.preventDefault(); return; }
			submitted = true;
		});

		var template = $('#template');
		var publishButtons = function() {
			if(!template) return;
			var publish;
			if(template.tagName === 'SELECT') {
				var option = template.querySelector('option[value="' + template.value + '"]');
				publish = !!option && option.getAttribute('data-publish') === '1';
			} else {
				publish = template.getAttribute('data-publish') === '1';
			}
			['#submit_publish', '#submit_publish_add'].forEach(function(sel) {
				var btn = $(sel);
				var li = btn ? btn.closest('.Inputfield') : null;
				show(li, publish);
			});
		};
		on(template, 'change', publishButtons);
		publishButtons();

		// is the name taken among the parent's children?
		var nameInput = $('#Inputfield__pw_page_name');
		var nameWrap = $('#wrap_Inputfield__pw_page_name');
		var form = nameInput ? nameInput.closest('form') : null;
		if(nameInput && nameWrap && form) {
			var ajaxURL = form.getAttribute('data-ajax-url') || './';
			var dupNote = document.createElement('p');
			dupNote.className = 'notes';
			dupNote.innerHTML = form.getAttribute('data-dup-note') || '';
			dupNote.style.display = 'none';
			nameInput.insertAdjacentElement('afterend', dupNote);
			var status = document.createElement('span');
			status.id = 'ProcessPageAddStatus';
			status.style.display = 'none';
			var header = $(':scope > .InputfieldHeader', nameWrap);
			if(header) header.appendChild(status);
			var timer = null, last = '';
			var checkExists = function() {
				var parentId = parent ? parent.value : '';
				var name = nameInput.value;
				if(name === last || !parentId || !name.length) return;
				last = name;
				fetch(ajaxURL + 'exists?parent_id=' + encodeURIComponent(parentId) + '&name=' + encodeURIComponent(name), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
					.then(function(res) { return res.text(); })
					.then(function(html) {
						status.innerHTML = ' ' + html;
						status.style.display = 'inline';
						var taken = !!status.querySelector('.taken');
						nameInput.classList.toggle('ui-state-error-text', taken);
						dupNote.style.display = taken ? '' : 'none';
					}).catch(function() {});
			};
			$$('#Inputfield_title, #Inputfield__pw_page_name').forEach(function(input) {
				input.addEventListener('keyup', function() {
					if(timer) clearTimeout(timer);
					timer = setTimeout(checkExists, 250);
				}, handover.bind());
			});
		}

		// templates without languages hide the language tabs
		if(template && $('.langTabs')) {
			var langs = function() {
				var option = template.querySelector('option[value="' + template.value + '"]');
				if(option && parseInt(option.getAttribute('data-nolang'), 10) > 0) hideLanguageTabs(); else unhideLanguageTabs();
			};
			if(template.tagName === 'SELECT') { template.addEventListener('change', langs, handover.bind()); langs(); }
			if(parseInt(template.getAttribute('data-nolang'), 10) > 0) hideLanguageTabs();
		}
		$$('.InputfieldPageName .LanguageSupport input[type=text]').forEach(function(input) {
			input.addEventListener('blur', function() {
				if(!input.value.length) return;
				var label = input.nextElementSibling;
				var box = label && label.tagName === 'LABEL' ? $(':scope > input', label) : null;
				if(box && !box.checked) box.checked = true;
			}, handover.bind());
		});
	}

	/* Profile ----------------------------------------------------------------------------- */

	function profile() {
		if($(".FieldtypePassword[autocomplete='off']")) {
			// browsers fill remembered passwords late: clear them after a second
			setTimeout(function() {
				$$(".FieldtypePassword[autocomplete='off']").forEach(function(input) {
					input.value = '';
					input.setAttribute('value', '');
					var li = input.closest('.Inputfield');
					if(li) li.classList.remove('InputfieldStateChanged');
				});
			}, 1000);
		}
		on($('form#ProcessProfile'), 'submit', function(e) {
			var pass = missingOldPass();
			if(!pass) return;
			e.preventDefault();
			var wrap = pass.closest('.InputfieldPassword') || pass.closest('.Inputfield');
			if(wrap && window.Inputfields && Inputfields.open) Inputfields.open('#' + wrap.id);
			setTimeout(function() { pass.focus(); }, 400);
		});
		// scripts/page-save.js posts the profile in place from a capture listener on document, so the
		// submit never reaches the form: cancelling its pw-form-save hands it back as a classic
		// submit, which the listener above stops. Bound once (init runs again after each save)
		if(!profileSaveGuard) {
			profileSaveGuard = true;
			document.addEventListener('pw-form-save', function(e) {
				// getAttribute: the form's input named "id" shadows form.id
				var form = e.detail && e.detail.form;
				if(form && form.getAttribute('id') === 'ProcessProfile' && missingOldPass()) e.preventDefault();
			}, handover.bind());
		}
	}

	var profileSaveGuard = false;

	// a field that needs the current password changed, and the current password is empty
	function missingOldPass() {
		if(!$('.InputfieldStateChanged.InputfieldPassRequired')) return null;
		var pass = $('#_old_pass');
		return pass && !pass.value.length ? pass : null;
	}

	/* Logs -------------------------------------------------------------------------------- */

	var ProcessLogger = {
		timer: null,
		pageNum: 1,
		submitFilters: function(updateOnlyNew) {
			updateOnlyNew = !!updateOnlyNew;
			var val = function(id) { var el = document.getElementById(id); return el ? el.value : ''; };
			var page = $('#ProcessLogPage');
			var params = new URLSearchParams({
				q: val('Inputfield_q'),
				date_from: val('Inputfield_date_from'),
				date_to: val('Inputfield_date_to'),
				time: updateOnlyNew && page ? page.getAttribute('data-time') || 0 : 0
			});
			ProcessLogger.startSpinner(!updateOnlyNew);
			getJSON('./?' + params.toString()).then(function(data) {
				var entries = $('#ProcessLogEntries');
				if(entries && (!updateOnlyNew || (data.qty > -1 && ProcessLogger.pageNum === 1))) {
					entries.innerHTML = data.out;
					if(!updateOnlyNew) flash(entries);
				}
				if(data.note && data.note.length) {
					if(window.Notifications && Notifications.message) Notifications.message(data.note, '', 'tree');
					var notes = $('#ProcessLogHeadline .notes');
					if(notes) notes.innerHTML = '+ ' + data.note;
				}
				ProcessLogger.setupLogEntries();
				ProcessLogger.stopSpinner(!updateOnlyNew);
				var p = $('#ProcessLogPage');
				if(p) p.setAttribute('data-time', data.time);
			}).catch(function() {
				ProcessLogger.stopSpinner(!updateOnlyNew);
				// one failed request must not end the polling for good (audit B14)
				if(updateOnlyNew) ProcessLogger.poll();
			});
		},
		// the next check for new entries in 5 s; while the tab is hidden it only re-arms
		poll: function() {
			if(ProcessLogger.timer) clearTimeout(ProcessLogger.timer);
			if(handover.over) return; // upstream's ProcessLogger polls from here
			ProcessLogger.timer = setTimeout(function() {
				if(document.hidden) return ProcessLogger.poll();
				ProcessLogger.submitFilters(true);
			}, 5000);
		},
		setupLogEntries: function() {
			var page = $('#ProcessLogPage');
			ProcessLogger.pageNum = page ? parseInt(page.getAttribute('data-page'), 10) || 1 : 1;
			ProcessLogger.poll();
			if(ProcessLogger.pageNum !== 1) return;
			$$('.ProcessLogNew').forEach(function(el) {
				var tr = el.closest('tr');
				if(tr && tr.animate) tr.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400 }).onfinish = function() { flash(tr); };
				el.classList.remove('ProcessLogNew');
			});
		},
		paginationClick: function(e) {
			var a = this && this.getAttribute ? this : (e && e.target && e.target.closest ? e.target.closest('a') : null);
			if(e && e.preventDefault) e.preventDefault();
			if(!a) return false;
			clearTimeout(ProcessLogger.timer);
			ProcessLogger.startSpinner(true);
			getJSON(a.getAttribute('href')).then(function(data) {
				var entries = $('#ProcessLogEntries');
				if(entries) entries.innerHTML = data.out;
				ProcessLogger.setupLogEntries();
				ProcessLogger.stopSpinner(true);
			}).catch(function() { ProcessLogger.stopSpinner(true); });
			return false;
		},
		startSpinner: function(tree) {
			if(tree === undefined || tree) {
				var s = $('#ProcessLogSpinner');
				if(s) { s.classList.add('fa-spin', 'fa-spinner'); s.classList.remove('fa-tree'); }
			} else {
				$$('#FieldsetTools i.fa-sun-o').forEach(function(i) { i.classList.add('fa-spin'); });
			}
		},
		stopSpinner: function(tree) {
			if(tree === undefined || tree) {
				var s = $('#ProcessLogSpinner');
				if(s) { s.classList.remove('fa-spin', 'fa-spinner'); s.classList.add('fa-tree'); }
			} else {
				$$('#FieldsetTools i.fa-sun-o').forEach(function(i) { i.classList.remove('fa-spin'); });
			}
		},
		filterChange: function() {
			clearTimeout(ProcessLogger.timer);
			ProcessLogger.timer = setTimeout(function() { ProcessLogger.submitFilters(false); }, 500);
		},
		init: function() {
			on($('#Inputfield_q'), 'keyup', ProcessLogger.filterChange);
			$$('#Inputfield_date_to, #Inputfield_date_from').forEach(function(el) { el.addEventListener('change', ProcessLogger.filterChange, handover.bind()); });
			document.addEventListener('click', function(e) {
				var a = e.target.closest ? e.target.closest('.MarkupPagerNav a') : null;
				if(a && $('#ProcessLogEntries') && $('#ProcessLogEntries').contains(a)) ProcessLogger.paginationClick.call(a, e);
			}, handover.bind());
			ProcessLogger.setupLogEntries();
		}
	};

	/* ------------------------------------------------------------------------------------- */

	theme.screens = {
		init: function() {
			var body = document.body.classList;
			if(body.contains('ProcessPageAdd')) pageAdd();
			if(body.contains('ProcessProfile')) profile();
			// only on a log's view (its entries); the list of logs has none
			if(body.contains('ProcessLogger') && $('#ProcessLogEntries') && !window.ProcessLogger) {
				window.ProcessLogger = ProcessLogger;
				ProcessLogger.native = true;
				ProcessLogger.init();
			}
		}
	};
	window.hideLanguageTabs = window.hideLanguageTabs || hideLanguageTabs;
	window.unhideLanguageTabs = window.unhideLanguageTabs || unhideLanguageTabs;

	if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', theme.screens.init);
	else theme.screens.init();
})(window.ProcessWireAdminTheme);

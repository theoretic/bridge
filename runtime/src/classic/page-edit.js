/**
 * AdminThemeBridge: native page editor (ADR 0016, milestone 3.1)
 *
 * Stand-in for upstream ProcessPageEdit.js (initPageEditForm(), checked against core 3.0.274) on
 * pages without the legacy stack; printed after scripts/wire-tabs.js by nativeProcessScripts().
 * Upstream's inline `initPageEditForm()` at the end of the editor is rewritten by the theme
 * (hookPageEditExecute) to call ProcessWireAdminTheme.pageEdit.init() when the upstream function
 * is not there. It runs again after an in-place save (scripts/page-save.js runs the new inline
 * scripts), so everything bound to the swapped markup is bound again and document-level
 * handlers only once.
 *
 * Same behaviour as upstream:
 * - WireTabs over the editor's top-level wrappers (#PageEditTabs), Delete never remembered;
 * - Delete posts only with its confirm box checked (else the box's label flashes);
 * - a submit while an upload runs (body.pw-uploading) asks first (the form's data-uploading),
 *   unless the save waits for it (main.js saveWait): then only a second click asks;
 * - Save and Publish get the after-save dropdown (InputfieldSubmitDropdown, the theme's native
 *   stand-in on these pages; the head copies get a copy of the menu), switched off while the
 *   template select is changed;
 * - the View link runs the chosen view action (panel or modal) from its menu;
 * - the Delete tab hides the other submit buttons;
 * - the content head title follows the title field (or the name field) as it is typed.
 */
(function(theme) {
	'use strict';
	if(!theme || theme.pageEdit) return;
	// listeners end when upstream's own script for this screen takes over (main.js handover)
	var handover = (theme && theme.handover) || { over: false, bind: function(o) { return o; } };

	function each(list, fn) {
		Array.prototype.forEach.call(list, fn);
	}

	function flash(el) {
		if(!el || !el.animate) return;
		var color = getComputedStyle(document.documentElement).getPropertyValue('--pw-primary-bg').trim() || '#ffffaa';
		el.animate([{ backgroundColor: color }, { backgroundColor: 'transparent' }], { duration: 500 });
	}

	theme.pageEdit = {
		bound: false,

		init: function() {
			var form = document.getElementById('ProcessPageEdit');
			if(!form) return;
			this.bindDocument();
			if(!form.classList.contains('ProcessPageEditSingleField') && theme.WireTabs) {
				var root = form.querySelector(':scope > .Inputfields');
				var items = root ? Array.prototype.filter.call(root.children, function(el) {
					return el.classList.contains('InputfieldWrapper');
				}) : [];
				theme.WireTabs(form, { items: items, id: 'PageEditTabs', skipRememberTabIDs: ['ProcessPageEditDelete'] });
			}
			this.setupDelete(form);
			this.setupDropdowns();
			this.setupView();
			this.setupTemplate();
			this.setupTitle();
		},

		// once per page: these listen on document and outlive an in-place save
		bindDocument: function() {
			if(this.bound) return;
			this.bound = true;
			var confirmed = null;
			document.addEventListener('click', function(e) {
				var button = e.target.closest ? e.target.closest('button[type=submit]') : null;
				if(!button || !document.body.classList.contains('pw-uploading')) return;
				if(button === confirmed) { confirmed = null; return; }
				// a save that will wait for the upload (main.js saveWait) does not ask
				if(theme.saveWait && theme.saveWait.claims(button)) return;
				var form = document.getElementById('ProcessPageEdit');
				e.preventDefault();
				e.stopImmediatePropagation();
				// the runtime's dialog (ADR 0019); OK clicks the button again, past this listener
				theme.confirm({ title: form ? form.getAttribute('data-uploading') || '' : '', danger: true }, function() {
					if(!button.isConnected) return;
					confirmed = button;
					button.click();
				});
			}, handover.bind(true));
			document.addEventListener('pw-wiretabs-change', function(e) {
				var tab = e.detail.tab;
				var previous = e.detail.previous;
				if(tab && tab.id === 'ProcessPageEditDelete') {
					each(document.querySelectorAll('.InputfieldSubmit:not(#wrap_submit_delete)'), function(el) {
						if(el.offsetParent === null) return; // upstream's :visible
						el.classList.add('pw-hidden-tmp');
						el.style.display = 'none';
					});
				} else if(previous && previous.id === 'ProcessPageEditDelete') {
					each(document.querySelectorAll('.InputfieldSubmit.pw-hidden-tmp'), function(el) {
						el.classList.remove('pw-hidden-tmp');
						el.style.display = '';
					});
				}
			}, handover.bind());
		},

		setupDelete: function(form) {
			var button = document.getElementById('submit_delete');
			if(!button) return;
			button.addEventListener('click', function(e) {
				e.preventDefault();
				var confirm = document.getElementById('delete_page');
				if(!confirm || !confirm.checked) {
					flash(document.querySelector('#wrap_delete_page label'));
					return;
				}
				var input = document.createElement('input');
				input.type = 'hidden';
				input.name = 'submit_delete';
				input.value = button.value;
				button.parentNode.insertBefore(input, button);
				// as upstream's jQuery trigger('submit'): submit listeners run, browser validation does not
				var ev = new Event('submit', { bubbles: true, cancelable: true });
				if(form.dispatchEvent(ev)) form.submit();
			}, handover.bind());
		},

		setupDropdowns: function() {
			var dropdown = window.InputfieldSubmitDropdown;
			if(!dropdown) return;
			var template = document.querySelector('ul.pw-button-dropdown:not(.pw-button-dropdown-init)');
			if(!template) return;
			each(document.querySelectorAll('button[type=submit]'), function(button) {
				var name = button.getAttribute('name') || '';
				if(button.classList.contains('pw-no-dropdown')) return;
				if(name.indexOf('submit') === -1 || name.indexOf('_draft') > -1) return;
				if(name.indexOf('_save') === -1 && name.indexOf('_publish') === -1) return;
				dropdown.init(button, template);
			});
		},

		setupView: function() {
			var link = document.getElementById('_ProcessPageEditView');
			var menu = document.getElementById('_ProcessPageEditViewDropdown');
			var toggle = document.getElementById('_ProcessPageEditViewDropdownToggle');
			if(!link) return;
			// printed open after the form; main.js opens it under the tab (data-pw-dropdown)
			if(menu && !menu.style.display) menu.style.display = 'none';
			if(toggle) toggle.style.color = getComputedStyle(link).color;
			link.addEventListener('click', function(e) {
				if(toggle && toggle.contains(e.target)) return;
				var action = link.getAttribute('data-action') || '';
				if(action === 'this' || action === 'new' || !action.length || !menu) return;
				var item = menu.querySelector('.page-view-action-' + action + ' > a');
				if(!item) return;
				e.preventDefault();
				item.click();
			}, handover.bind());
		},

		// the template select arrives by AJAX (a hidden #template stands in until its field opens), so
		// the change is caught on document; the template the page has is read now
		setupTemplate: function() {
			var current = document.getElementById('template');
			this.template = current ? current.value : null;
			if(this.templateBound) return;
			this.templateBound = true;
			var self = this;
			document.addEventListener('change', function(e) {
				if(!e.target || e.target.id !== 'template' || self.template === null) return;
				var on = e.target.value === self.template;
				each(document.querySelectorAll('.pw-button-dropdown-toggle'), function(toggle) {
					toggle.style.display = on ? '' : 'none';
				});
			}, handover.bind());
		},

		setupTitle: function() {
			var title = document.getElementById('pw-content-title');
			if(!title) return;
			var input = null;
			var ls = (window.ProcessWire && ProcessWire.config && ProcessWire.config.LanguageSupport) || null;
			if(ls && ls.language) input = document.getElementById('Inputfield_title__' + ls.language.id);
			if(!input || !input.value.length) input = document.getElementById('Inputfield_title');
			if(!input || !input.value.length) input = document.getElementById('Inputfield__pw_page_name');
			if(!input || !input.value.length) return;
			var original = input.value;
			input.addEventListener('input', function() {
				title.textContent = input.value.length ? input.value : original;
			}, handover.bind());
		}
	};
})(window.ProcessWireAdminTheme);

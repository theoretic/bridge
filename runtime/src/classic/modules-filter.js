/**
 * AdminThemeBridge: a live filter on the Modules list (1.3.0, owner's request)
 *
 * Printed (deferred) on ProcessModule's list screen, with the legacy stack or without it
 * (AdminThemeBridgeLegacy::processAddonScripts()). Each list with a section select
 * (select.modules_section_select: the Site, Core, Configurable and Install tabs) gets a search
 * field beside its select, in the select's own <p>.
 *
 * From three characters typed (the input event: no submit, no reload), a row stays when its module
 * name, title or class contains the text, in any case; the other rows are hidden, and so is every
 * section left without a row. While it filters, a list shows all its sections whatever its select
 * says (the select is set aside, not changed, and applies again once the field is cleared); a line
 * says when nothing matches. A cross beside the field (also from three characters) and Escape clear
 * it and show every module again. The fields share their text, so a filter follows to another tab.
 *
 * Hidden by classes only (pw-filter-out, pw-modules-filtering; theme.css 41-process), never by
 * style.display, which the section select (scripts/setup.js or upstream's ProcessModule.js) owns.
 */
(function() {
	'use strict';
	var MIN = 3;
	var selects = document.querySelectorAll('select.modules_section_select');
	if(!selects.length || document.querySelector('.pw-modules-filter')) return;
	var pw = window.ProcessWire;
	var config = pw && pw.config ? pw.config.AdminThemeBridge : null;
	var labels = (config && config.labels) || {};
	var lists = [];

	Array.prototype.forEach.call(selects, function(select) {
		var p = select.closest('p');
		var list = p ? p.parentElement : null;
		if(!list) return;
		var wrap = document.createElement('span');
		wrap.className = 'pw-modules-filter';
		var input = document.createElement('input');
		input.type = 'search';
		input.className = 'pw-input';
		input.autocomplete = 'off';
		input.spellcheck = false;
		input.placeholder = labels.filterModules || 'Filter modules';
		input.setAttribute('aria-label', input.placeholder);
		var clear = document.createElement('button');
		clear.type = 'button';
		clear.className = 'pw-modules-filter-clear';
		clear.hidden = true;
		clear.setAttribute('aria-label', labels.clearFilter || 'Clear');
		clear.title = clear.getAttribute('aria-label');
		var icon = document.createElement('i');
		icon.className = 'fa fa-times';
		icon.setAttribute('aria-hidden', 'true');
		clear.appendChild(icon);
		wrap.appendChild(input);
		wrap.appendChild(clear);
		select.insertAdjacentElement('afterend', wrap);
		var none = document.createElement('p');
		none.className = 'pw-modules-filter-none description';
		none.setAttribute('role', 'status');
		p.insertAdjacentElement('afterend', none);
		lists.push({ list: list, input: input, clear: clear, none: none });

		input.addEventListener('input', function() { apply(input.value); });
		input.addEventListener('keydown', function(e) {
			// Escape clears; Enter must not submit the modules form (its first button installs)
			if(e.key === 'Escape' && input.value) { e.preventDefault(); apply(''); }
			else if(e.key === 'Enter') e.preventDefault();
		});
		clear.addEventListener('click', function() { apply(''); input.focus(); });
	});

	/** the text a row matches on: the first cell (title, class) and the module's name */
	function haystack(tr) {
		var cell = tr.cells[0];
		var named = cell ? cell.querySelector('[title], [data-name]') : null;
		var name = named ? (named.getAttribute('data-name') || named.getAttribute('title') || '') : '';
		return ((cell ? cell.textContent : '') + ' ' + name).toLowerCase();
	}

	function apply(value) {
		var term = value.trim().toLowerCase();
		var on = term.length >= MIN;
		lists.forEach(function(l) {
			if(l.input.value !== value) l.input.value = value;
			l.clear.hidden = !on;
			l.list.classList.toggle('pw-modules-filtering', on);
			var shown = 0;
			Array.prototype.forEach.call(l.list.querySelectorAll(':scope > .modules_section'), function(section) {
				var left = 0;
				Array.prototype.forEach.call(section.querySelectorAll('tr'), function(tr) {
					if(!tr.cells.length || tr.cells[0].tagName !== 'TD') return;
					var keep = !on || haystack(tr).indexOf(term) > -1;
					tr.classList.toggle('pw-filter-out', !keep);
					if(keep) left++;
				});
				section.classList.toggle('pw-filter-out', on && !left);
				shown += left;
			});
			l.none.textContent = on && !shown ? (labels.noModulesMatch || 'No modules match') : '';
		});
	}
})();

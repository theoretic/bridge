/**
 * AdminThemeBridge: a live filter on the setup lists: Modules, Fields, Templates (1.3.0, owner's
 * request)
 *
 * Printed (deferred) on those three list screens, with the legacy stack or without it
 * (AdminThemeBridgeLegacy::processAddonScripts()). One engine; a screen is an adapter in SCREENS:
 *
 *   lists()   the lists on the page, each { list, anchor }: the element whose rows it filters and
 *             the element the field goes beside
 *   place()   puts the field (a span) at the anchor and returns where the "nothing matches" line goes
 *   groups    selector of a list's groups (Modules: its sections, Fields and Templates: the tag
 *             boxes); a group left without a row is hidden while the field filters
 *   text(tr)  the text a row matches on (lower case is done here)
 *   words     the runtime labels of the placeholder and the "nothing matches" line
 *
 *   - Modules: a field beside each section select (Site, Core, Configurable, Install); matches the
 *     module's name, title and class.
 *   - Fields, Templates: one field in the header of the Filters box, right of its label; matches
 *     the name and the label.
 *
 * A list gets its field only when it shows ten rows or more (MIN_ROWS; the server prints the
 * script only where that can be, processAddonScripts()); a Modules tab with fewer has none.
 *
 * From three characters typed (the input event: no submit, no reload) a row stays when its text
 * contains the field's text, in any case. Fewer characters filter nothing. A cross beside the field
 * (also from three characters) and Escape empty it; Enter submits nothing. While it filters, a list
 * shows every group, also those its section select or its collapsed state hides (the select and the
 * collapsed state apply again once the field is empty). The fields of one page share their text.
 *
 * Hidden by classes only (pw-filter-out, pw-list-filtering; theme.css 41-process), never by
 * style.display, which the section select (scripts/setup.js or upstream's ProcessModule.js) owns.
 */
(function() {
	'use strict';
	var MIN = 3;
	var MIN_ROWS = 10; // keep in step with AdminThemeBridge::listFilterMinRows
	var pw = window.ProcessWire;
	var config = pw && pw.config ? pw.config.AdminThemeBridge : null;
	var labels = (config && config.labels) || {};

	function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
	/** a list's rows: the table rows with data cells (not a header row) */
	function rowsOf(list) { return all('tr', list).filter(function(tr) { return tr.cells.length && tr.cells[0].tagName === 'TD'; }); }
	function cellText(tr, i) { return tr.cells[i] ? tr.cells[i].textContent : ''; }
	/** the header of the first box of a list's Filters form, the field goes right of its label */
	function filtersHeader(form) { return form ? form.querySelector('.InputfieldHeader') : null; }
	/** Fields and Templates: one list (its tag boxes, or one table), the field in the Filters header */
	function boxList(listSel, formSel) {
		return function() {
			var list = document.querySelector(listSel);
			return list ? [{ list: list, anchor: filtersHeader(document.querySelector(formSel)) || list }] : [];
		};
	}
	function placeInHeader(anchor, wrap, list) {
		if(anchor === list) list.insertAdjacentElement('beforebegin', wrap);
		else anchor.appendChild(wrap);
		return { where: 'afterbegin', el: list };
	}

	var SCREENS = [
		{
			lists: function() {
				return all('select.modules_section_select').map(function(select) {
					var p = select.closest('p');
					return p && p.parentElement ? { list: p.parentElement, anchor: select } : null;
				}).filter(Boolean);
			},
			place: function(select, wrap) {
				select.insertAdjacentElement('afterend', wrap);
				return { where: 'afterend', el: select.closest('p') };
			},
			groups: ':scope > .modules_section',
			text: function(tr) {
				var named = tr.cells[0] ? tr.cells[0].querySelector('[title], [data-name]') : null;
				return cellText(tr, 0) + ' ' + (named ? (named.getAttribute('data-name') || named.getAttribute('title') || '') : '');
			},
			words: ['filterModules', 'Filter modules', 'noModulesMatch', 'No modules match'],
		},
		{
			lists: boxList('#ProcessFieldList', '#field_filter_form'),
			place: placeInHeader,
			groups: '.InputfieldMarkup',
			text: function(tr) { return cellText(tr, 0) + ' ' + cellText(tr, 1); }, // name, label
			words: ['filterFields', 'Filter fields', 'noFieldsMatch', 'No fields match'],
		},
		{
			lists: boxList('#ProcessTemplateList', 'form#filters'),
			place: placeInHeader,
			groups: '.InputfieldMarkup',
			// name, and the label where the table has a Label column (six columns, ProcessTemplate::getListTable())
			text: function(tr) {
				var table = tr.closest('table');
				var labelled = table && table.tHead && table.tHead.rows[0] && table.tHead.rows[0].cells.length >= 6;
				return cellText(tr, 0) + ' ' + (labelled ? cellText(tr, 1) : '');
			},
			words: ['filterTemplates', 'Filter templates', 'noTemplatesMatch', 'No templates match'],
		},
	];

	var lists = [];
	if(document.querySelector('.pw-list-filter')) return;
	SCREENS.forEach(function(screen) {
		screen.lists().forEach(function(found) {
			if(rowsOf(found.list).length >= MIN_ROWS) add(screen, found.list, found.anchor);
		});
	});
	if(!lists.length) return;

	function add(screen, list, anchor) {
		var wrap = document.createElement('span');
		wrap.className = 'pw-list-filter';
		var input = document.createElement('input');
		input.type = 'search';
		input.className = 'pw-input';
		input.autocomplete = 'off';
		input.spellcheck = false;
		input.placeholder = labels[screen.words[0]] || screen.words[1];
		input.setAttribute('aria-label', input.placeholder);
		var clear = document.createElement('button');
		clear.type = 'button';
		clear.className = 'pw-list-filter-clear';
		clear.hidden = true;
		clear.setAttribute('aria-label', labels.clearFilter || 'Clear');
		clear.title = clear.getAttribute('aria-label');
		var icon = document.createElement('i');
		icon.className = 'fa fa-times';
		icon.setAttribute('aria-hidden', 'true');
		clear.appendChild(icon);
		wrap.appendChild(input);
		wrap.appendChild(clear);
		var at = screen.place(anchor, wrap, list);
		var none = document.createElement('p');
		none.className = 'pw-list-filter-none description';
		none.setAttribute('role', 'status');
		if(at.el) at.el.insertAdjacentElement(at.where, none);
		lists.push({ screen: screen, list: list, input: input, clear: clear, none: none, noneText: labels[screen.words[2]] || screen.words[3] });

		// in a box's header a click or a key must not open or close the box (the native header
		// handler skips inputs; upstream's inputfields.js listens on the document)
		['click', 'keydown', 'keyup'].forEach(function(type) {
			wrap.addEventListener(type, function(e) { e.stopPropagation(); });
		});
		input.addEventListener('input', function() { apply(input.value); });
		input.addEventListener('keydown', function(e) {
			// Escape clears; Enter must not submit the form around the field
			if(e.key === 'Escape' && input.value) { e.preventDefault(); apply(''); }
			else if(e.key === 'Enter') e.preventDefault();
		});
		clear.addEventListener('click', function() { apply(''); input.focus(); });
	}

	function apply(value) {
		var term = value.trim().toLowerCase();
		var on = term.length >= MIN;
		lists.forEach(function(l) {
			if(l.input.value !== value) l.input.value = value;
			l.clear.hidden = !on;
			l.list.classList.toggle('pw-list-filtering', on);
			var shown = 0;
			var groups = all(l.screen.groups, l.list);
			var left = groups.map(function() { return 0; });
			rowsOf(l.list).forEach(function(tr) {
				var keep = !on || l.screen.text(tr).toLowerCase().indexOf(term) > -1;
				tr.classList.toggle('pw-filter-out', !keep);
				if(!keep) return;
				shown++;
				for(var i = 0; i < groups.length; i++) if(groups[i].contains(tr)) left[i]++;
			});
			groups.forEach(function(g, i) { g.classList.toggle('pw-filter-out', on && !left[i]); });
			l.none.textContent = on && !shown ? l.noneText : '';
		});
	}
})();

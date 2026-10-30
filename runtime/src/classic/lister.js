/**
 * AdminThemeBridge: native Lister (ADR 0016, milestone 3.5)
 *
 * Stand-in for upstream ProcessPageLister.js (checked against core 3.0.274) on pages without the
 * legacy stack; printed after scripts/wire-tabs.js by nativeProcessScripts() for the exact class
 * ProcessPageLister (ListerPro and other subclasses keep upstream's script). The global
 * `ProcessLister` keeps upstream's API: init(), submit(url), refreshRow(id, message),
 * refreshRows(ids), refreshAll(), getPageID(el), and the properties other code sets
 * (resetTotal, clickAfterRefresh, refreshRowPageIDs, extraSubmitData).
 *
 * - #ProcessLister gets WireTabs over its .WireTab parts; the Refresh and Reset tabs are icons that
 *   refresh the results or reset the Lister.
 * - Results (#ProcessListerResults) load by POST to ./ (render_results, filters, columns[], sort,
 *   reset_total, row_page_id and extraSubmitData), 250 ms after the last change of the filters
 *   (#ProcessListerFilters, the native selector) or the columns (#lister_columns); pager links load
 *   their page; a header click sorts by that column (again: reversed); unsaved edits in an editable
 *   results form ask first.
 * - After a load: header labels as upstream (u, arrow span, the field name in b), Inputfields
 *   initialised and `reloaded` (ProcessPageLister), `loaded` on the results, rows marked .open
 *   opened, AdminDataTable (runtime fields/datatable.ts), a.lister-lightbox in the lightbox,
 *   the ProcessListerScript part and inline scripts run, window `resize`.
 * - A row title (a.actions_toggle) shows its actions; extras behind PageExtras; AJAX actions are
 *   posted with the form's CSRF token, then that row (or, for a copy or trash, the whole list)
 *   reloads with the answer's message for a second.
 */
(function(theme) {
	'use strict';
	if(window.ProcessLister) return;
	// listeners end when upstream's own script for this screen takes over (main.js handover)
	var handover = (theme && theme.handover) || { over: false, bind: function(o) { return o; } };

	function $(sel, root) { return (root || document).querySelector(sel); }
	function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
	function flash(el) {
		if(!el || !el.animate) return;
		var color = getComputedStyle(document.documentElement).getPropertyValue('--pw-primary-bg').trim() || '#ffffaa';
		el.animate([{ backgroundColor: color }, { backgroundColor: 'transparent' }], { duration: 400 });
	}
	function runScript(code) {
		var s = document.createElement('script');
		s.text = code;
		window.ProcessWireAdminTheme.runScripts([s]);
	}
	function bridge() { return window.Bridge || null; }

	/**
	 * The results' ProcessListerScript part: what core's ProcessPageLister::renderExternalAssets()
	 * (3.0.274) prints for scripts, styles and config the session has not had yet, as jQuery code:
	 * `$.getScript('url', function(){ ... })` chains, `$('<link ... href="url">').appendTo('head')`
	 * and `var configAdd={...}; $.extend(config, configAdd);`. It is empty unless something reset
	 * the session's record of loaded files (a Lister reset in another tab). With the legacy stack on
	 * the page that code runs as upstream; without jQuery it would throw, so the same is done here:
	 * config merged, styles appended, scripts kept for a later stack load (they are legacy scripts).
	 */
	function runListerScript(js) {
		js = (js || '').trim();
		if(!js) return;
		if(window.jQuery) return runScript(js);
		var config = (window.ProcessWire && window.ProcessWire.config) || null;
		var m = js.match(/var configAdd=(\{[\s\S]*?\});\s*\$\.extend\(config, configAdd\);/);
		if(m && config) {
			try {
				var add = JSON.parse(m[1]);
				// shallow, as $.extend(config, configAdd); the theme's own key describes this page
				Object.keys(add).forEach(function(key) { if(key !== 'AdminThemeBridge') config[key] = add[key]; });
			} catch(e) {
				if(window.console) console.warn('Bridge Lister: config from the results not read', e);
			}
		}
		var linked = $$('link[rel=stylesheet]').map(function(l) { return l.getAttribute('href'); });
		js.replace(/\$\('<link rel="stylesheet" type="text\/css" href="([^"]+)">'\)/g, function(all, href) {
			if(linked.indexOf(href) > -1) return all;
			var link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = href;
			var theme = $('link[data-pw-theme]');
			if(theme) theme.parentNode.insertBefore(link, theme); else document.head.appendChild(link);
			linked.push(href);
			return all;
		});
		var bridgeConfig = config && config.AdminThemeBridge;
		if(bridgeConfig) {
			var list = bridgeConfig.legacyScripts = bridgeConfig.legacyScripts || [];
			var loadedScripts = $$('script[src]').map(function(s) { return s.getAttribute('src'); });
			js.replace(/\$\.getScript\('([^']+)'/g, function(all, src) {
				if(list.indexOf(src) < 0 && loadedScripts.indexOf(src) < 0) list.push(src);
				return all;
			});
		}
	}

	var ProcessLister = window.ProcessLister = {
		native: true,
		inInit: true,
		inTimeout: false,
		inAjax: false,
		numSubmits: 0,
		results: null,
		filters: null,
		lister: null,
		initialized: false,
		resetTotal: false,
		clickAfterRefresh: '',
		refreshRowPageIDs: [],
		extraSubmitData: {},

		init: function() {
			if(ProcessLister.initialized) return;
			ProcessLister.initialized = true;
			var lister = $('#ProcessLister');
			if(!lister) return;
			ProcessLister.lister = lister;
			ProcessLister.filters = $('#ProcessListerFilters');
			ProcessLister.results = $('#ProcessListerResults');
			if(ProcessLister.filters) ProcessLister.filters.addEventListener('change', function() { ProcessLister.submit(); }, handover.bind());
			var columns = $('#lister_columns');
			if(columns) columns.addEventListener('change', function() { ProcessLister.submit(); }, handover.bind());

			if(ProcessLister.results) ProcessLister.results.addEventListener('click', function(e) {
				var th = e.target.closest('.ProcessListerTable > thead th');
				if(th) { ProcessLister.columnSort(th); return; }
				var pager = e.target.closest('.MarkupPagerNav a');
				if(pager) { e.preventDefault(); ProcessLister.submit(pager.getAttribute('href')); }
			}, handover.bind());
			document.addEventListener('click', function(e) {
				var toggle = e.target.closest('a.actions_toggle');
				if(toggle && ProcessLister.results && ProcessLister.results.contains(toggle)) { e.preventDefault(); ProcessLister.pageClick(toggle); return; }
				var ajax = e.target.closest('.actions a.ajax');
				if(ajax && ProcessLister.results && ProcessLister.results.contains(ajax)) { e.preventDefault(); ProcessLister.actionClickAjax(ajax); }
			}, handover.bind());
			var open = $('#actions_items_open');
			if(open) { open.disabled = true; if(open.closest('label')) open.closest('label').classList.add('ui-state-disabled'); }
			var refresh = $('#submit_refresh');
			if(refresh) refresh.addEventListener('click', function(e) {
				e.preventDefault();
				ProcessLister.resetTotal = true;
				ProcessLister.submit();
				refresh.classList.remove('ui-state-active');
			}, handover.bind());
			$$('#ProcessListerActionsForm script').forEach(function(s) { s.remove(); });
			if(theme && theme.WireTabs) theme.WireTabs(lister, { items: $$('.WireTab', lister) });

			// the Refresh and Reset tabs are actions, not tabs: capture their clicks before WireTabs
			var refreshTab = $('#_ProcessListerRefreshTab');
			var resetTab = $('#_ProcessListerResetTab');
			if(refreshTab) refreshTab.innerHTML = "<i class='fa fa-fw fa-refresh ui-priority-secondary'></i>";
			if(resetTab) resetTab.innerHTML = "<i class='fa fa-fw fa-rotate-left ui-priority-secondary'></i>";
			document.addEventListener('click', function(e) {
				var a = e.target.closest('#_ProcessListerRefreshTab, #_ProcessListerResetTab');
				if(!a) return;
				e.preventDefault();
				e.stopImmediatePropagation();
				if(a.id === '_ProcessListerResetTab') {
					window.location.href = './?reset=1';
				} else {
					ProcessLister.resetTotal = true;
					ProcessLister.submit();
				}
			}, handover.bind(true));

			ProcessLister.inInit = false;
			if(ProcessLister.numSubmits === 0) ProcessLister.submit();
		},

		columnSort: function(th) {
			if(th.classList.contains('not_sortable')) return false;
			$$(':scope > span', th).forEach(function(s) { s.remove(); });
			var b = th.querySelector('b');
			var name = b ? b.textContent : '';
			var input = $('#lister_sort');
			var val = input ? input.value : '';
			if(val === name) name = '-' + name;
			if(name.length < 1) name = val;
			if(input) input.value = name;
			ProcessLister.submit();
		},

		submit: function(url) {
			if(ProcessLister.inTimeout) clearTimeout(ProcessLister.inTimeout);
			ProcessLister.inTimeout = setTimeout(function() { ProcessLister._submit(url); }, 250);
		},

		spin: function(on) {
			var icon = $('#_ProcessListerRefreshTab i');
			if(!icon) return;
			icon.classList.toggle('fa-refresh', !on);
			icon.classList.toggle('fa-spin', on);
			icon.classList.toggle('fa-spinner', on);
		},

		_submit: function(url, confirmed) {
			var refreshAll = true;
			var rowIDs = ProcessLister.refreshRowPageIDs.filter(function(id) { return id; });
			var results = ProcessLister.results;
			if(!results) return false;
			if(!rowIDs.length) {
				var form = results.querySelector('.InputfieldFormConfirm');
				if(!confirmed && form && form.querySelector('.InputfieldStateChanged')) {
					var msg = (window.ProcessWire && ProcessWire.config && ProcessWire.config.InputfieldForm && ProcessWire.config.InputfieldForm.labels && ProcessWire.config.InputfieldForm.labels.unsaved) || 'Leave without saving changes?';
					// the runtime's dialog (ADR 0019): OK submits again
					theme.confirm({ title: msg, danger: true }, function() { ProcessLister._submit(url, true); });
					return false;
				}
				var headline = results.querySelector('.lister_headline');
				if(headline && !headline.querySelector('i.fa-spin')) headline.insertAdjacentHTML('beforeend', "<i class='fa fa-spin fa-spinner'></i>");
			} else {
				refreshAll = false;
			}
			ProcessLister.numSubmits++;
			if(typeof url === 'undefined') url = './';
			var data = new URLSearchParams();
			data.append('render_results', '1');
			data.append('filters', refreshAll ? (ProcessLister.filters ? ProcessLister.filters.value : '') : 'ignore');
			var columns = $('#lister_columns');
			// minimal mode (?minimal=1) renders it as a hidden input with value 'ignore'
			if(columns && columns.tagName === 'SELECT') Array.prototype.forEach.call(columns.selectedOptions, function(o) { data.append('columns[]', o.value); });
			else if(columns) data.append('columns', columns.value);
			var sort = $('#lister_sort');
			data.append('sort', sort ? sort.value : '');
			// arrays as key[]=a&key[]=b, as jQuery's $.param sends them
			for(var key in ProcessLister.extraSubmitData) {
				var extra = ProcessLister.extraSubmitData[key];
				if(Array.isArray(extra)) extra.forEach(function(v) { data.append(key + '[]', v); });
				else data.append(key, extra);
			}
			ProcessLister.extraSubmitData = {};
			if(ProcessLister.resetTotal) { data.append('reset_total', '1'); ProcessLister.resetTotal = false; }
			if(rowIDs.length) { data.append('row_page_id', rowIDs.join(',')); ProcessLister.resetTotal = false; }
			ProcessLister.inAjax = true;
			ProcessLister.spin(true);
			fetch(url, { method: 'POST', body: data, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
				// an error page is never put in the results (nor are its scripts run)
				.then(function(res) { if(!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
				.then(function(html) { ProcessLister._submitSuccess(html); })
				.catch(function(err) {
					ProcessLister.inAjax = false;
					ProcessLister.spin(false);
					results.innerHTML = '<p>Error retrieving results: ' + err + '</p>';
				});
		},

		_submitSuccess: function(data) {
			var results = ProcessLister.results;
			var refreshAll = true;
			ProcessLister.inAjax = false;
			ProcessLister.spin(false);
			var ids = ProcessLister.refreshRowPageIDs.filter(function(id) { return id; });
			if(ids.length) {
				refreshAll = false;
				var doc = new DOMParser().parseFromString('<div>' + data + '</div>', 'text/html');
				ids.forEach(function(pageID) {
					var oldToggle = document.getElementById('page' + pageID);
					var oldRow = oldToggle ? oldToggle.closest('tr') : null;
					var newToggle = doc.getElementById('page' + pageID);
					var newRow = newToggle ? document.importNode(newToggle.closest('tr'), true) : null;
					var message = oldToggle ? oldToggle.getAttribute('data-message') : '';
					if(oldRow && newRow) {
						oldRow.replaceWith(newRow);
						newRow.classList.add('row_refreshed_' + pageID);
						flash(newRow);
						if(message) {
							var toggle = newRow.querySelector('.actions_toggle');
							var note = document.createElement('span');
							note.className = 'row_message notes';
							note.innerHTML = message;
							toggle.classList.add('row_message_on');
							(toggle.closest('.col_preview, td') || toggle.parentNode).appendChild(note);
							setTimeout(function() {
								note.remove();
								toggle.classList.remove('row_message_on');
								toggle.click();
							}, 1000);
						}
						if(newRow.querySelector('.Inputfield') && bridge()) bridge().Inputfields.init(newRow);
					} else if(oldRow && !newRow) {
						oldRow.remove();
					}
				});
				ProcessLister.refreshRowPageIDs = [];
			} else {
				var sort = $('#lister_sort') ? $('#lister_sort').value : '';
				results.style.opacity = '0';
				results.innerHTML = data;
				$$('table.ProcessListerTable > thead th', results).forEach(function(th) {
					var b = th.querySelector('b');
					var txt = b ? b.textContent : '';
					if(b) b.remove();
					$$(':scope > span', th).forEach(function(s) { s.remove(); });
					var icon = th.querySelector('i');
					if(icon) icon.remove();
					var label = th.innerHTML;
					if(txt === sort) th.innerHTML = '<u>' + label + '</u><span>&nbsp;&darr;</span><b>' + txt + '</b>';
					else if(sort === '-' + txt) th.innerHTML = '<u>' + label + '</u><span>&nbsp;&uarr;</span><b>' + txt + '</b>';
					else th.innerHTML = label + '<b>' + txt + '</b>';
					if(icon) th.insertBefore(icon, th.firstChild);
				});
				if(bridge()) bridge().Inputfields.init(results);
			}

			if(ProcessLister.clickAfterRefresh.length) {
				var sel = ProcessLister.clickAfterRefresh;
				if(sel.indexOf('#') < 0 && sel.indexOf('.') < 0) sel = '#' + sel;
				$$(sel).forEach(function(a) {
					a.click();
					var tr = a.closest('tr');
					if(tr && tr.animate) tr.animate([{ opacity: .1 }, { opacity: 1 }], { duration: 350 });
				});
				ProcessLister.clickAfterRefresh = '';
			}

			setTimeout(function() {
				results.dispatchEvent(new CustomEvent('loaded', { bubbles: true }));
				$$('.Inputfield:not(.reloaded)', results).forEach(function(li) {
					li.classList.add('reloaded');
					li.dispatchEvent(new CustomEvent('reloaded', { bubbles: true, detail: { source: 'ProcessPageLister' } }));
				});
				$$('a.actions_toggle.open').forEach(function(a) { a.click(); a.classList.remove('open'); });
				if(window.AdminDataTable && window.AdminDataTable.init) window.AdminDataTable.init();
				if(refreshAll) results.style.opacity = '';
				window.dispatchEvent(new Event('resize'));
			}, 250);

			// found by its id, never by a character offset: upstream's offset assumes id='...' in
			// quotes, and an output filter that drops them made it run ".getScript(..."
			var parsed = new DOMParser().parseFromString('<div>' + data + '</div>', 'text/html');
			var part = parsed.getElementById('ProcessListerScript');
			if(part) runListerScript(part.textContent);
			// inline scripts run as with upstream's .html(data): every one in fresh results (column
			// and extension markup too), the field scripts of refreshed rows
			var theme = window.ProcessWireAdminTheme;
			if(refreshAll) theme.runScripts(results, { legacy: !!results.querySelector('[data-bridge-legacy]') });
			else theme.runScripts($$('.Inputfield script', parsed));
		},

		_refreshRow: function(pageID, message) {
			if(typeof pageID === 'string' && pageID.indexOf('page') > -1) pageID = parseInt(pageID.substring(4), 10);
			if(!(pageID > 0)) return false;
			if(typeof message !== 'undefined') {
				var toggle = document.getElementById('page' + pageID);
				if(toggle) toggle.setAttribute('data-message', message);
			}
			ProcessLister.refreshRowPageIDs[pageID] = pageID;
			return true;
		},

		refreshRow: function(pageID, message) {
			if(ProcessLister._refreshRow(parseInt(pageID, 10), message)) ProcessLister.submit();
		},

		refreshRows: function(pageIDs) {
			var cnt = 0;
			for(var n in pageIDs) if(ProcessLister._refreshRow(parseInt(pageIDs[n], 10), '')) cnt++;
			if(cnt) ProcessLister.submit();
		},

		refreshAll: function() {
			var a = ProcessLister.results ? ProcessLister.results.querySelector('.MarkupPagerNavOn a') : null;
			if(!a) a = $('#submit_refresh') || $('#_ProcessListerRefreshTab');
			if(a) a.click();
		},

		pageClick: function(toggle) {
			if(toggle.classList.contains('row_message_on')) return false;
			var tr = toggle.closest('tr');
			var actions = toggle.nextElementSibling;
			if(!tr || !actions || !actions.classList.contains('actions')) return false;
			var extra = $$('.PageExtra', actions);
			var trigger = actions.querySelector('.PageExtras');
			var defaults = $$('a:not(.PageExtra):not(.PageExtras)', actions);
			if(tr.classList.contains('open')) {
				actions.style.display = 'none';
				tr.classList.remove('open');
				return false;
			}
			actions.style.display = 'inline-block';
			tr.classList.add('open');
			if(trigger && trigger.classList.contains('extras-open')) {
				var icon = trigger.querySelector('i');
				if(icon) icon.classList.toggle('fa-flip-horizontal');
				trigger.classList.remove('extras-open');
			}
			extra.forEach(function(a) { a.style.display = 'none'; });
			defaults.forEach(function(a) { a.style.display = ''; });
			if(trigger && !trigger.pwBound) {
				trigger.pwBound = true;
				trigger.addEventListener('click', function(e) {
					e.preventDefault();
					var open = trigger.classList.contains('extras-open');
					$$('.PageExtra', actions).forEach(function(a) { a.style.display = open ? 'none' : ''; });
					$$('a:not(.PageExtra):not(.PageExtras)', actions).forEach(function(a) { a.style.display = open ? '' : 'none'; });
					trigger.classList.toggle('extras-open', !open);
					var icon = trigger.querySelector('i');
					if(icon) icon.classList.toggle('fa-flip-horizontal');
				}, handover.bind());
			}
			return false;
		},

		getPageID: function(el) {
			var tr = el && el.closest ? el.closest('tr') : null;
			return tr ? parseInt(tr.getAttribute('data-pid'), 10) || 0 : 0;
		},

		actionClickAjax: function(a) {
			var td = a.closest('td');
			var toggle = td ? td.querySelector('.actions_toggle') : null;
			var pageID = toggle ? parseInt(toggle.id.replace('page', ''), 10) : 0;
			var actions = a.closest('.actions');
			var href = a.getAttribute('href') || '';
			var match = href.match(/\?action=([-_a-zA-Z0-9]+)/);
			var token = document.querySelector('input._post_token');
			var data = new URLSearchParams();
			data.append('action', match ? match[1] : '');
			data.append('id', String(pageID));
			data.append('ProcessPageLister', '1');
			if(token) data.append(token.name, token.value);
			if(actions) {
				actions.insertAdjacentHTML('afterend', "<i class='fa fa-spin fa-spinner ui-priority-secondary'></i>");
				actions.style.display = 'none';
			}
			ProcessLister.inAjax = true;
			fetch(href, { method: 'POST', body: data, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
				.then(function(res) { return res.json(); })
				.then(function(json) {
					if(typeof json.page !== 'undefined' || json.action === 'trash') {
						ProcessLister.clickAfterRefresh = '#page' + json.page;
						ProcessLister.resetTotal = true;
						ProcessLister.inAjax = false;
					} else {
						ProcessLister.refreshRowPageIDs[pageID] = pageID;
					}
					if(json.message && toggle) toggle.setAttribute('data-message', json.message);
					ProcessLister.submit();
				})
				.catch(function() { ProcessLister.inAjax = false; ProcessLister.submit(); });
			return false;
		}
	};

	// the lightbox for image columns (Magnific Popup upstream)
	document.addEventListener('click', function(e) {
		var a = e.target.closest ? e.target.closest('a.lister-lightbox') : null;
		if(!a || window.jQuery || !bridge() || !bridge().lightbox) return;
		e.preventDefault();
		bridge().lightbox([{ src: a.getAttribute('href'), title: a.getAttribute('title') || '' }], 0);
	}, handover.bind());

	if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { ProcessLister.init(); });
	else ProcessLister.init();
})(window.ProcessWireAdminTheme);

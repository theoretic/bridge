/**
 * AdminThemeBridge: native setup and access screens (ADR 0016, milestone 3.6)
 *
 * Stand-in for the scripts of upstream ProcessModule, ProcessField, ProcessTemplate (with
 * ProcessTemplateFieldCreator), ProcessUser, ProcessRole and ProcessPageType (checked against
 * core 3.0.274) on pages without the legacy stack; printed after scripts/wire-tabs.js by
 * nativeProcessScripts() for those exact classes. Each part runs only when its markup is there.
 *
 * - Modules: not-installed links point at their install button (or what they require), the
 *   settings button, WireTabs over #modules_form (remembered), the section select (with its
 *   cookie), "Check for new modules" opens the New tab, the "new" period submits.
 * - Fields: the list filters submit, export ids follow the checkboxes; the editor gets WireTabs
 *   (FieldEditTabs), column width as a range slider, the asmSelect status template for the
 *   template editor's dialog (#asmListItemStatus), the context select, import/export toggles,
 *   view/edit role rules, select-all on the overrides tab, which reloads after a dialog closes.
 * - Templates: the list filters submit; the editor gets WireTabs (TemplateEditTabs), the access
 *   tab's dependent parts, import/export, and on the field list (asmSelect, runtime
 *   fields/asmselect.ts): rows of column widths (rowItem, rowStart, rowStop, rowError), widths
 *   changed by dragging the percentage (saved by ./saveProperty; a double press opens the field at
 *   its width setting), a sort saved at once, a new field created in a dialog ("Close and Add").
 *   The global ProcessTemplateInitFields() stays (upstream calls it inline).
 * - Users: the guest user's fields, roles the user may not assign.
 * - Roles: the permission tree (children follow their parent) and the template permissions.
 * - Page types (ProcessPageType lists): the template filter submits.
 */
(function(theme) {
	'use strict';
	if(!theme || theme.setup) return;

	function $(sel, root) { return (root || document).querySelector(sel); }
	function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
	function on(el, type, fn) { if(el) el.addEventListener(type, fn); }
	// document listeners bind once: init() runs again after a save without reload (milestone 3.8)
	var docBound = {};
	function onDocument(key, type, fn) {
		if(docBound[key]) return;
		docBound[key] = true;
		document.addEventListener(type, fn);
	}
	function show(el, yes) { if(el) el.style.display = yes ? '' : 'none'; }
	function shown(el) { return !!el && el.style.display !== 'none'; }
	function flash(el) {
		if(!el || !el.animate) return;
		var color = getComputedStyle(document.documentElement).getPropertyValue('--pw-primary-bg').trim() || '#ffffaa';
		el.animate([{ backgroundColor: color }, { backgroundColor: 'transparent' }], { duration: 1000 });
	}
	function submitForm(form) {
		if(!form) return;
		if(form.requestSubmit) form.requestSubmit(); else form.submit();
	}
	function post(url, data) {
		var body = new URLSearchParams();
		Object.keys(data).forEach(function(key) {
			var v = data[key];
			if(Array.isArray(v)) v.forEach(function(x) { body.append(key + '[]', x); });
			else body.append(key, v);
		});
		var csrf = $('input._post_token');
		if(csrf) body.append(csrf.name, csrf.value);
		return fetch(url, { method: 'POST', body: body, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
			.then(function(res) { return res.json(); });
	}
	function tabs(target, options) {
		if(target && theme.WireTabs) theme.WireTabs(target, options);
	}
	/** upstream's export/import screens (fields and templates) */
	function importExport() {
		on($('#export_data'), 'click', function() { this.select(); });
		$$('.import_toggle input[type=radio]').forEach(function(radio) {
			var apply = function() {
				if(!radio.checked) return;
				var p = radio.closest('p.import_toggle');
				var table = p ? p.nextElementSibling : null;
				var fieldset = radio.closest('.InputfieldFieldset');
				var off = radio.value == 0;
				if(table && table.tagName === 'TABLE') show(table, !off);
				if(fieldset) fieldset.classList.toggle('ui-priority-secondary', off);
			};
			radio.addEventListener('change', apply);
			apply();
		});
	}

	/* Modules ---------------------------------------------------------------------------- */

	function modules() {
		$$('.not_installed').forEach(function(span) {
			var a = span.parentElement;
			if(!a || a.tagName !== 'A') return;
			a.style.opacity = 0.6;
			a.addEventListener('click', function(e) {
				e.preventDefault();
				var name = span.getAttribute('data-name');
				var btn = $$('.install_' + name).filter(function(b) { return b.offsetParent !== null; })[0];
				if(btn) {
					flash(btn);
				} else {
					var tr = a.closest('tr');
					$$('.requires', tr || undefined).forEach(function(r) {
						r.setAttribute('data-color', getComputedStyle(a).color);
						r.style.color = getComputedStyle(a).color;
						flash(r);
					});
				}
			});
		});
		$$('button.ProcessModuleSettings').forEach(function(btn) {
			btn.addEventListener('click', function() {
				var tr = btn.closest('tr');
				var cm = tr ? $('.ConfigurableModule', tr) : null;
				var a = cm ? cm.closest('a') : null;
				if(a) window.location.href = a.getAttribute('href') + '&collapse_info=1';
			});
		});
		var form = $('#modules_form');
		if(form) tabs(form, { items: $$('.Inputfields li.WireTab'), rememberTabs: true });
		$$('select.modules_section_select').forEach(function(select) {
			var apply = function() {
				var section = select.value;
				var p = select.closest('p');
				var sections = p && p.parentElement ? $$(':scope > .modules_section', p.parentElement) : [];
				sections.forEach(function(s) { show(s, section === '' || s.classList.contains('modules_' + section)); });
				document.cookie = select.getAttribute('name') + '=' + section;
			};
			select.addEventListener('change', apply);
			apply();
		});
		onDocument('modules-check', 'click', function(e) {
			// "Check for new modules" leads to the New tab
			if(e.target.closest && e.target.closest('#head_button a')) document.cookie = 'WireTabs=tab_new_modules';
		});
		on($('#Inputfield_new_seconds'), 'change', function() {
			var btn = $('#submit_check');
			if(btn) { btn.hidden = false; btn.removeAttribute('hidden'); btn.click(); }
			else submitForm(this.closest('form'));
		});
		var upload = $('#wrap_upload_module');
		if(upload) upload.classList.remove('InputfieldItemList');
	}

	/* Fields ---------------------------------------------------------------------------- */

	function fields() {
		var filter = $('#field_filter_form');
		if(filter) ['#templates_id', '#fieldtype'].forEach(function(sel) {
			on($(sel), 'change', function() { submitForm(filter); });
		});
		$$('#wrap_show_system input').forEach(function(input) {
			input.addEventListener('click', function() { submitForm($('#field_filter_form')); });
		});

		var status = $('#asmListItemStatus');
		var columnWidth = $('#columnWidth');
		var setStatus = function() {
			var tpl = status ? status.getAttribute('data-tpl') : '';
			if(!tpl) return;
			var showIf = $('#Inputfield_showIf');
			var required = $('#Inputfield_required');
			if(showIf && showIf.value.length) tpl = "<i class='fa fa-question-circle'></i>" + tpl;
			if(required && required.checked) tpl = "<i class='fa fa-asterisk'></i>" + tpl;
			var w = columnWidth ? parseInt(columnWidth.value, 10) : 100;
			if(!(w >= 1 && w <= 100)) w = 100;
			status.value = tpl.replace('%', w + '%');
		};
		on($('#Inputfield_showIf'), 'change', setStatus);
		on($('#Inputfield_required'), 'change', setStatus);
		setStatus();

		// column width: a range slider after the text input (jQuery UI slider upstream)
		$$('.columnWidthInput').forEach(function(input) {
			if(input.hasAttribute('data-pw-slider')) return;
			input.setAttribute('data-pw-slider', '');
			var range = document.createElement('input');
			range.type = 'range';
			range.min = 10;
			range.max = 100;
			range.className = 'InputfieldColumnWidthSlider';
			range.setAttribute('aria-label', window.Inputfields && Inputfields.label ? Inputfields.label(input) || 'Column width' : 'Column width');
			var val = parseInt(input.value, 10) || 100;
			input.value = val + '%';
			range.value = val;
			input.insertAdjacentElement('afterend', range);
			range.addEventListener('input', function() {
				input.value = range.value + '%';
				input.dispatchEvent(new Event('change', { bubbles: true }));
				if(input.id === 'columnWidth') setStatus();
			});
			input.addEventListener('change', function() {
				var v = parseInt(input.value, 10);
				if(isNaN(v)) v = 100;
				if(v > 100) v = 100;
				if(v < 10) v = 10;
				input.value = v + '%';
				range.value = v;
			});
		});

		var edit = $('#ProcessFieldEdit');
		if(edit && $$('li.WireTab').length > 1) {
			tabs(edit, { items: $$('.Inputfields li.WireTab'), id: 'FieldEditTabs', skipRememberTabIDs: ['delete'] });
		}

		on($('#fieldgroupContextSelect'), 'change', function() {
			var id = $('#Inputfield_id');
			var href = './edit?id=' + (id ? id.value : '');
			if(this.value > 0) href += '&fieldgroup_id=' + this.value;
			window.location = href;
		});
		$$('a.fieldFlag').forEach(function(a) {
			a.addEventListener('click', function(e) { if(a.getAttribute('href') === '#') e.preventDefault(); });
		});
		importExport();
		$$('#wrap_Inputfield_send_templates :is(input, select, textarea)').forEach(function(el) {
			el.addEventListener('change', function() {
				var changed = $('#_send_templates_changed');
				if(changed) changed.value = 'changed';
			});
		});

		// access tab: guest view means everyone views; edit implies view
		var guestView = $('#viewRoles_37');
		on(guestView, 'click', function() {
			if(guestView.checked) $$('input.viewRoles').forEach(function(c) { c.checked = true; });
		});
		$$('input.viewRoles:not(#viewRoles_37)').forEach(function(c) {
			c.addEventListener('click', function(e) { if(guestView && guestView.checked) e.preventDefault(); });
		});
		$$('input.editRoles:not(:disabled)').forEach(function(c) {
			c.addEventListener('click', function() {
				if(!c.checked) return;
				var tr = c.closest('tr');
				$$('input.viewRoles', tr || undefined).forEach(function(v) { v.checked = true; });
			});
		});

		$$('.override-select-all').forEach(function(a) {
			a.addEventListener('click', function(e) {
				e.preventDefault();
				var table = a.closest('table');
				var check = !a.classList.contains('override-checked');
				$$('input[type=checkbox]', table || undefined).forEach(function(c) { c.checked = check; });
				a.classList.toggle('override-checked', check);
			});
		});
		onDocument('fields-overrides', 'pw-modal-closed', function(e) {
			if(!e.target || !e.target.closest || !e.target.closest('a')) return;
			var tab = $('#tab-overrides');
			if(!tab || tab.offsetParent === null) return;
			if(window.Inputfields && Inputfields.reload) Inputfields.reload('#Inputfield_overrides_table');
		});

		var exportBtn = $('#export_button');
		var exportLink = exportBtn ? exportBtn.closest('a') : null;
		if(exportLink) {
			var importBtn = $('#import_button');
			var importLink = importBtn ? importBtn.closest('a') : null;
			var exportHref = exportLink.getAttribute('href');
			var importHref = importLink ? importLink.getAttribute('href') : '';
			onDocument('fields-export', 'input', function(e) {
				if(!e.target.classList || !e.target.classList.contains('checkbox-ids')) return;
				var ids = $$('.checkbox-ids:checked').map(function(c) { return c.value; }).join(',');
				var checked = $('#checked_ids');
				if(checked) checked.value = ids;
				exportLink.setAttribute('href', exportHref + '?ids=' + ids);
				if(importLink) importLink.setAttribute('href', importHref + '?ids=' + ids);
			});
		}
	}

	/* Templates ------------------------------------------------------------------------- */

	function templateAccess() {
		var guest = $('#roles_37');
		var redirectURL = $('#wrap_redirectLoginURL');
		var redirectLoginClick = function() {
			show(redirectURL, !!$('#redirectLogin_-1:checked'));
		};
		var adjust = function() {
			var items = [$('#wrap_redirectLogin'), $('#wrap_guestSearchable')];
			if(guest && guest.checked) {
				show(redirectURL, false);
				items.forEach(function(item) { show(item, false); });
				$$('input.viewRoles').forEach(function(c) { c.checked = true; });
			} else {
				items.forEach(function(item) {
					if(!item || shown(item)) return;
					show(item, true);
					if(item.classList.contains('InputfieldStateCollapsed')) {
						var toggle = $('.InputfieldStateToggle', item);
						if(toggle) toggle.click();
					}
				});
				redirectLoginClick();
			}
		};
		$$('#wrap_useRoles input').forEach(function(input) {
			input.addEventListener('click', function() {
				if($('#useRoles_1:checked')) {
					show($('#wrap_redirectLogin'), false);
					show($('#wrap_guestSearchable'), false);
					var yes = $('#useRolesYes');
					if(yes) { show(yes, true); yes.style.overflow = 'visible'; }
					$$('input.viewRoles').forEach(function(c) { c.checked = true; });
				} else {
					show($('#useRolesYes'), false);
					show($('#accessOverrides'), false);
				}
			});
		});
		if($('#useRoles_0:checked')) {
			show($('#useRolesYes'), false);
			show($('#accessOverrides'), false);
		}
		on(guest, 'click', adjust);
		$$('input.viewRoles:not(#roles_37)').forEach(function(c) {
			c.addEventListener('click', function(e) { if(guest && guest.checked) e.preventDefault(); });
		});
		var editRolesClick = function() {
			var num = 0;
			var editRoles = $$('#roles_editor input.editRoles');
			for(var i = 0; i < editRoles.length; i++) {
				var c = editRoles[i];
				if(c.disabled) break;
				var create = $('input.createRoles[value="' + c.value + '"]');
				if(c.checked) {
					num++;
					if(create) create.disabled = false;
				} else if(create) {
					create.checked = false;
					create.disabled = true;
				}
			}
			show($('#accessOverrides'), num > 0);
		};
		var editOrAddClick = function() {
			var num = $$('#roles_editor input.editRoles, #roles_editor input.addRoles').filter(function(c) {
				return !c.disabled && c.checked;
			}).length;
			show($('#wrap_noInherit'), num > 0);
		};
		$$('#roles_editor input.editRoles').forEach(function(c) { c.addEventListener('click', editRolesClick); });
		$$('#roles_editor input.editRoles, #roles_editor input.addRoles').forEach(function(c) { c.addEventListener('click', editOrAddClick); });
		editRolesClick();
		editOrAddClick();
		$$('#wrap_redirectLogin input').forEach(function(c) { c.addEventListener('click', redirectLoginClick); });
		adjust();
		redirectLoginClick();
	}

	/**
	 * The field list: rows of column widths. rowItem: in a row under 100%; rowStart / rowStop: its
	 * first / last item; rowError: a row that does not add up to 100%.
	 */
	function setupRows() {
		var items = $$('#wrap_fieldgroup_fields .asmListItem');
		var last = null, lastWidth = 0, total = 0, rows = 0;
		items.forEach(function(item) {
			item.classList.remove('rowItem', 'rowStart', 'rowStop', 'rowError');
			var cw = $('.columnWidth', item);
			var w = cw ? parseInt(cw.textContent, 10) : 100;
			if(isNaN(w)) w = 100;
			if(w === 100) {
				if(total > 0 && total < 100 && lastWidth > 0 && lastWidth < 100) {
					last.classList.add('rowError');
					if(!last.classList.contains('rowStart')) last.classList.add('rowStop');
				}
				total = 0;
			} else {
				if(!total) { item.classList.add('rowStart'); rows++; }
				item.classList.add('rowItem');
				if(total + w > 100) {
					if(last && lastWidth < 100) {
						if(last.classList.contains('rowStart')) last.classList.add('rowError');
						else last.classList.add('rowStop', 'rowError');
					}
					item.classList.add('rowStart');
					rows++;
					total = w;
				} else if(total + w === 100) {
					item.classList.add('rowStop');
					total = 0;
				} else {
					total += w;
				}
			}
			last = item;
			lastWidth = w;
		});
		if(last && lastWidth < 100) {
			last.classList.add('rowStop');
			last.classList.toggle('rowError', total > 0 && total < 100);
		}
		return rows;
	}

	/** 5% steps (and 33, 34, 66), as upstream's "rails" */
	function railWidth(width) {
		if(width >= 96) return 100;
		if(width <= 10) return 10;
		if(width === 33 || width === 34 || width === 66) return width;
		var w1 = Math.floor(width / 10), w2 = width % 10;
		if(w2 >= 7) { w1++; w2 = 0; } else if(w2 >= 4) { w2 = 5; } else { w2 = 0; }
		return w1 * 10 + w2;
	}

	function templateFields() {
		var wrap = $('#wrap_fieldgroup_fields');
		var select = $('#fieldgroup_fields');
		if(!wrap || !select) return;
		var useRails = true;
		var ready = function() {
			setupRows();
			// rails only when every width already sits on one
			useRails = $$('.columnWidth', wrap).every(function(c) {
				var w = parseInt(c.textContent, 10);
				return w === 66 || w === 33 || w === 34 || w % 5 === 0;
			});
		};
		wrap.addEventListener('asm-ready', ready);
		select.addEventListener('init', ready);
		if($('.asmListItem', wrap)) ready();
		wrap.addEventListener('asmItemUpdated', setupRows);

		select.addEventListener('change', function(e) {
			var changed = $('#_fieldgroup_fields_changed');
			if(changed) changed.value = 'changed';
			var type = e.detail && e.detail.type;
			if(!type) return;
			if(type === 'add') wrap.classList.add('field-added');
			if(type !== 'sort') return;
			setupRows();
			var values = Array.prototype.filter.call(select.options, function(o) { return o.selected; }).map(function(o) { return o.value; });
			var id = $('#Inputfield_id');
			post('./saveProperty', {
				id: id ? id.value : '',
				property: 'fieldgroup_fields',
				fieldgroup_fields: values,
				_fieldgroup_fields_changed: 'changed'
			}).catch(function() {});
		});

		// a column width changes by dragging its percentage sideways (or up/down)
		var setWidth = function(item, width) {
			if(useRails) width = railWidth(width);
			var pct = width + '%';
			var cw = $('.columnWidth', item);
			if(cw) cw.textContent = pct;
			var bar = $('.columnWidthBar', item);
			if(bar) {
				bar.style.transition = 'width 0.1s';
				bar.style.width = pct;
				var barPct = $('.columnWidthBarPct', bar);
				if(barPct) barPct.textContent = width > 95 ? '' : pct;
			}
		};
		var lastPress = 0;
		wrap.addEventListener('pointerdown', function(e) {
			var cw = e.target.closest ? e.target.closest('.asmListItem .columnWidth') : null;
			if(!cw || e.button !== 0) return;
			// the list's drag sorting never sees this press
			e.stopPropagation();
			e.preventDefault();
			var item = cw.closest('.asmListItem');
			var now = Date.now();
			if(now - lastPress < 500) {
				// a double press: the field's settings, at its width
				lastPress = 0;
				var edit = $('.asmListItemEdit a', item);
				if(edit) {
					var href = edit.getAttribute('href');
					edit.setAttribute('href', href + '#find-columnWidth');
					setTimeout(function() { edit.setAttribute('href', href); }, 1000);
					edit.click();
				}
				return;
			}
			lastPress = now;
			if(cw.classList.contains('columnWidthOff')) return;
			var current = parseInt(cw.textContent, 10) || 100;
			var lastX = e.pageX, lastY = e.pageY;
			cw.classList.add('columnWidthActive');
			document.body.classList.add('columnWidthActive');
			$$('.fieldType, .fieldInfo', cw.parentElement || undefined).forEach(function(s) { s.style.opacity = 0.3; });
			var old = $('.columnWidthBar', item);
			if(old) old.remove();
			var bar = document.createElement('div');
			bar.className = 'columnWidthBar';
			bar.innerHTML = "<span class='columnWidthBarPct'></span>";
			bar.firstChild.textContent = current + '%';
			bar.style.width = current + '%';
			item.appendChild(bar);
			var move = function(ev) {
				var dx = (ev.pageX - lastX) / 3;
				var dy = ev.pageY - lastY;
				var diff = Math.abs(dx) >= Math.abs(dy) ? dx : -dy;
				lastX = ev.pageX;
				lastY = ev.pageY;
				if(diff === 0) return;
				var pct = current, d = Math.abs(diff);
				if(useRails && d >= 10) {
					if(diff > 0 && pct < 100) pct += 5;
					if(diff < 0 && pct > 10) pct -= 5;
				} else if(d >= 1) {
					if(diff > 0 && pct < 100) pct++;
					if(diff < 0 && pct > 10) pct--;
				}
				pct = Math.max(10, Math.min(100, pct));
				if(pct !== current) {
					setWidth(item, pct);
					current = parseInt(cw.textContent, 10) || pct;
				}
			};
			var up = function() {
				document.removeEventListener('pointermove', move);
				document.removeEventListener('pointerup', up);
				document.removeEventListener('pointercancel', up);
				bar.remove();
				cw.classList.remove('columnWidthActive');
				document.body.classList.remove('columnWidthActive');
				$$('.fieldType, .fieldInfo', cw.parentElement || undefined).forEach(function(s) { s.style.opacity = ''; });
				setupRows();
				var width = parseInt(cw.textContent, 10);
				var id = $('#Inputfield_id');
				post('./saveProperty', {
					id: id ? id.value : '',
					property: 'columnWidth',
					columnWidth: width,
					field: parseInt(cw.getAttribute('data-field'), 10)
				}).then(function(result) {
					if(result && result.success && result.value != width) { setWidth(item, parseInt(result.value, 10)); setupRows(); }
				}).catch(function() {});
			};
			document.addEventListener('pointermove', move);
			document.addEventListener('pointerup', up);
			document.addEventListener('pointercancel', up);
		}, true);
	}

	/**
	 * "Add field" in the field list's description: create a field in a dialog; once saved,
	 * "Close and Add" puts it on the list (and the closing _END field of a new fieldset)
	 */
	function fieldCreator() {
		var link = $('#wrap_fieldgroup_fields p.description a');
		if(!link) return;
		link.addEventListener('click', function(e) {
			var bridge = window.Bridge;
			if(!bridge || !bridge.dialog) return;
			e.preventDefault();
			var saved = false;
			bridge.dialog.open(link.getAttribute('href'), 'large', {
				source: link,
				buttons: '#content form button.ui-button[type=submit]',
				onLoad: function(doc) {
					$$('#breadcrumbs ul.nav, #Inputfield_submit_save_field_copy', doc).forEach(function(el) { el.style.display = 'none'; });
				},
				onButton: function() { saved = true; },
				moreButtons: function(doc) {
					if(!saved) return [];
					var select = $('#fieldgroup_fields');
					return [{
						html: (select && select.getAttribute('data-closeAddLabel')) || 'Close and Add',
						click: function() { addField(doc); }
					}];
				}
			});
		});
	}

	function addField(doc) {
		var select = $('#fieldgroup_fields');
		var ids = $$('#Inputfield_id', doc);
		var idInput = ids[ids.length - 1];
		var nameInput = $('#Inputfield_name', doc);
		if(!select || !idInput || !nameInput || !idInput.value) { window.Bridge.dialog.close(); return; }
		var type = $('#Inputfield_type', doc);
		var typeOption = type && type.selectedIndex > -1 ? type.options[type.selectedIndex] : null;
		var label = $('#field_label', doc);
		var add = function(value, text, desc, status) {
			if(select.querySelector('option[value="' + value + '"]')) return;
			var o = document.createElement('option');
			o.value = value;
			o.textContent = text;
			o.setAttribute('data-desc', desc);
			o.setAttribute('data-status', status);
			o.selected = true;
			select.appendChild(o);
		};
		add(idInput.value, nameInput.value, label ? label.value : '', typeOption ? typeOption.textContent : '');
		if(type && (type.value === 'FieldtypeFieldsetOpen' || type.value === 'FieldtypeFieldsetTabOpen')) {
			// upstream's assumption: the closing field was created right after, with the next id
			add(String(parseInt(idInput.value, 10) + 1), nameInput.value + '_END', '', '');
		}
		window.Bridge.dialog.close();
		var wrap = $('#wrap_fieldgroup_fields');
		if(wrap) wrap.classList.add('field-added');
		// a change from outside rebuilds the native asmSelect from the select
		select.dispatchEvent(new Event('change', { bubbles: true }));
		select.dispatchEvent(new CustomEvent('rebuild'));
		setTimeout(setupRows, 0);
	}

	function templates() {
		$$('#wrap_filter_system input').forEach(function(input) {
			input.addEventListener('click', function() { submitForm(input.closest('form')); });
		});
		on($('#filter_field'), 'change', function() { submitForm(this.closest('form')); });
		templateAccess();
		var edit = $('#ProcessTemplateEdit');
		if(edit) tabs(edit, { items: $$('.Inputfields li.WireTab'), id: 'TemplateEditTabs', skipRememberTabIDs: ['WireTabDelete'] });
		importExport();
		$$('#import_form table td:not(:first-child)').forEach(function(td) {
			var html = td.innerHTML;
			if(html.charAt(0) === '{') td.innerHTML = '<pre>' + html.replace(/<br>/g, '') + '</pre>';
		});
		templateFields();
		fieldCreator();
	}

	/* Users, roles, page types ---------------------------------------------------------- */

	function users() {
		var id = $('#Inputfield_id');
		if(id && id.value == 40) {
			// the guest user
			show($('#wrap_Inputfield_pass'), false);
			show($('#wrap_Inputfield_email'), false);
			$$('#wrap_Inputfield_roles input').forEach(function(c) { c.disabled = true; });
		}
		var guestRole = $('#Inputfield_roles_37');
		if(guestRole && !guestRole.checked) guestRole.checked = true;
		var cfg = (window.ProcessWire && ProcessWire.config && ProcessWire.config.ProcessUser) || null;
		if(!cfg || !cfg.editableRoles) return;
		$$('#wrap_Inputfield_roles input[type=checkbox]').forEach(function(c) {
			if(cfg.editableRoles.indexOf(parseInt(c.value, 10)) > -1) return;
			var label = c.closest('label');
			if(!label) return;
			label.classList.add('ui-priority-secondary');
			label.addEventListener('click', function(e) {
				e.preventDefault();
				var alert = $('.ui-state-error-text', label);
				if(alert) { alert.remove(); return; }
				alert = document.createElement('span');
				alert.className = 'ui-state-error-text';
				alert.innerHTML = '&nbsp;(' + cfg.notEditableAlert + ')';
				label.appendChild(alert);
				setTimeout(function() { alert.remove(); }, 2000);
			});
		});
	}

	function toggleTemplatePermissions(tr) {
		var toggle = tr ? $('.toggle-template-permissions', tr) : null;
		var div = tr ? $('.template-permissions', tr) : null;
		if(!toggle || !div) return;
		var open = div.classList.contains('template-permissions-open');
		div.style.display = open ? 'none' : 'block';
		div.classList.toggle('template-permissions-open', !open);
		var icon = $('i', toggle);
		if(icon && icon.getAttribute('data-toggle')) {
			icon.getAttribute('data-toggle').split(/\s+/).forEach(function(c) { if(c) icon.classList.toggle(c); });
		}
	}

	function updatePermissions(init, checkboxes) {
		var wrap = $('#wrap_Inputfield_permissions');
		if(!wrap) return;
		checkboxes = checkboxes || $$('input.global-permission', wrap);
		if(init) checkboxes.forEach(function(input) {
			var label = input.closest('label');
			var tr = input.closest('tr');
			if(label && tr && label.className) label.className.split(/\s+/).forEach(function(c) { if(c) tr.classList.add(c); });
		});
		checkboxes.forEach(function(input) {
			var label = input.closest('label');
			var tr = input.closest('tr');
			if(!label || !tr) return;
			var level = parseInt(label.getAttribute('data-level'), 10) || 0;
			if(label.id) tr.classList.add(label.id);
			var children = [];
			for(var next = tr.nextElementSibling; next; next = next.nextElementSibling) {
				if(label.id && next.classList.contains('parent-' + label.id)) children.push(next);
			}
			if(input.checked) {
				children.filter(function(r) { return r.classList.contains('level' + (level + 1)); }).forEach(function(r) { r.style.display = ''; });
				tr.classList.add('permission-checked');
				if(tr.classList.contains('permission-page-edit') && !$('.template-permissions-open', tr)) toggleTemplatePermissions(tr);
			} else {
				children.forEach(function(r) {
					$$('input.global-permission:not(:disabled)', r).forEach(function(c) { c.checked = false; });
					r.style.display = 'none';
				});
				tr.classList.remove('permission-checked');
				if(tr.classList.contains('permission-page-edit') && $('.template-permissions-open', tr)) toggleTemplatePermissions(tr);
			}
		});
	}

	function roles() {
		var wrap = $('#wrap_Inputfield_permissions');
		if(!wrap) return;
		window.ProcessRoleUpdatePermissions = function(init, checkbox) {
			updatePermissions(init, checkbox ? (checkbox.nodeType ? [checkbox] : Array.prototype.slice.call(checkbox)) : null);
		};
		var pageView = $('#Inputfield_permissions_36');
		if(pageView && !pageView.checked) pageView.checked = true;
		updatePermissions(true, null);
		wrap.addEventListener('click', function(e) {
			var el = e.target.closest ? e.target.closest('input.global-permission, label.checkbox-disabled') : null;
			if(!el) return;
			var label = el.tagName === 'LABEL' ? el : el.parentElement;
			var checkbox = el.tagName === 'LABEL' ? $(':scope > input', el) : el;
			var alertText = label ? label.getAttribute('data-alert') : '';
			var confirmText = label ? label.getAttribute('data-confirm') : '';
			if(alertText) {
				e.preventDefault();
				if(window.ProcessWire && ProcessWire.alert) ProcessWire.alert(alertText); else window.alert(alertText);
				return;
			}
			if(confirmText && checkbox && checkbox.checked && !window.confirm(confirmText)) {
				e.preventDefault();
				return;
			}
			if(el.tagName === 'INPUT') setTimeout(function() { updatePermissions(false, [el]); }, 100);
		});
		$$('.toggle-template-permissions').forEach(function(a) {
			a.addEventListener('click', function(e) { e.preventDefault(); toggleTemplatePermissions(a.closest('tr')); });
		});
		$$('.template-permissions-click').forEach(function(el) {
			toggleTemplatePermissions(el.closest('tr'));
			el.classList.remove('template-permissions-click');
		});
		$$('.permission-title').forEach(function(el) {
			el.addEventListener('click', function() { toggleTemplatePermissions(el.closest('tr')); });
		});
		// template permission checkboxes get the global ones' classes (uk-checkbox and the like)
		var first = $('input.global-permission');
		if(first) {
			var classes = first.className.split(/\s+/).filter(function(c) {
				return c && ['permission', 'permission-checked', 'global-permission'].indexOf(c) < 0;
			});
			$$('input.template-permission').forEach(function(c) { classes.forEach(function(cls) { c.classList.add(cls); }); });
		}
	}

	function pageTypes() {
		var form = $('#template_filter_form');
		on(form ? $('#templates_id', form) : null, 'change', function() { submitForm(form); });
	}

	/* --------------------------------------------------------------------------------------- */

	theme.setup = {
		setupRows: setupRows,
		init: function() {
			var body = document.body.classList;
			if(body.contains('ProcessModule')) modules();
			if(body.contains('ProcessField')) fields();
			if(body.contains('ProcessTemplate')) templates();
			if(body.contains('ProcessUser')) users();
			if(body.contains('ProcessRole')) roles();
			pageTypes();
		}
	};

	/** a same-origin iframe as tall as its page (iframe-resizer upstream, for the template's Lister) */
	theme.iframeHeight = function(frame) {
		if(!frame) return;
		var fit = function() {
			try {
				var doc = frame.contentDocument;
				if(doc && doc.documentElement) frame.style.height = doc.documentElement.scrollHeight + 'px';
			} catch(e) { /* another origin: leave it */ }
		};
		frame.addEventListener('load', function() {
			fit();
			try {
				if(window.ResizeObserver && frame.contentDocument && frame.contentDocument.body) new ResizeObserver(fit).observe(frame.contentDocument.body);
			} catch(e) { /* another origin */ }
		});
		fit();
	};

	// upstream calls it inline when the template editor's field list is rendered
	window.ProcessTemplateInitFields = function() {
		var wrap = $('#wrap_fieldgroup_fields');
		if(wrap) wrap.dispatchEvent(new CustomEvent('asm-ready'));
	};

	if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', theme.setup.init);
	else theme.setup.init();
})(window.ProcessWireAdminTheme);

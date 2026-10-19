/**
 * AdminThemeBridge: native link editor (ADR 0016, milestone 3.7)
 *
 * Stand-in for upstream ProcessPageEditLink.js (checked against core 3.0.274) on pages without the
 * legacy stack: the window the rich text editors' link buttons open (CKEditor and TinyMCE pwlink
 * plugins read it from the parent through $iframe.contents(), so the window itself needs no
 * jQuery). Printed after scripts/wire-tabs.js by nativeProcessScripts().
 *
 * - The page pickers (#link_page_id, #child_page_id under the edited page) are the runtime's
 *   native PageListSelect (fields/pagelistselect.ts), marked here with upstream's options; a
 *   chosen page fills the URL (relative as cfg.urlType asks), loads its files into
 *   #link_page_file and closes its field.
 * - File and anchor selects fill the URL; the URL gets a scheme for a bare domain, mailto: for
 *   an address, its header icon (external, email, anchor) and, for external hosts, the
 *   configured class, rel and target.
 * - #link_markup previews the link as it will be inserted.
 * - WireTabs over #ProcessPageEditLinkForm (PageEditLinkTabs).
 */
(function(theme) {
	'use strict';
	var pw = window.ProcessWire;
	if(!theme || theme.link || !pw || !pw.config || !pw.config.ProcessPageEditLink) return;

	function $(sel, root) { return (root || document).querySelector(sel); }
	function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
	function fire(el, type) { if(el) el.dispatchEvent(new Event(type, { bubbles: true })); }
	function flash(el) {
		if(!el || !el.animate) return;
		var color = getComputedStyle(document.documentElement).getPropertyValue('--pw-primary-bg').trim() || '#ffffaa';
		el.animate([{ backgroundColor: color }, { backgroundColor: 'transparent' }], { duration: 500 });
	}

	var cfg = pw.config.ProcessPageEditLink;

	function slashesToRelative(url) {
		return url.replace(/\//g, '../').replace(/[^.\/]/g, '');
	}

	/** upstream's absoluteToRelativePath(): cfg.urlType 0 absolute, 1 relative in branch, 2 relative for all */
	function relative(path) {
		if(cfg.urlType == 0) return path;
		var url;
		if(path === cfg.pageUrl) {
			path = './';
			if(!cfg.slashUrls) path += cfg.pageName;
		} else if(path.indexOf(cfg.pageUrl) === 0) {
			path = path.substring(cfg.pageUrl.length);
			if(!cfg.slashUrls) path = cfg.pageName + path;
		} else if(cfg.pageUrl.indexOf(path) === 0) {
			url = cfg.pageUrl.substring(path.length);
			path = url.indexOf('/') !== -1 ? slashesToRelative(url) : './';
		} else if(path.indexOf(cfg.rootParentUrl) === 0) {
			url = path.substring(cfg.rootParentUrl.length);
			path = slashesToRelative(url) + url;
		} else if(cfg.urlType == 2) {
			url = slashesToRelative(cfg.pageUrl.substring(pw.config.urls.root.length));
			path = url + path.substring(pw.config.urls.root.length);
		}
		return path;
	}

	function init() {
		var fileSelect = $('#link_page_file');
		var anchorSelect = $('#link_page_anchor');
		var urlInput = $('#link_page_url_input');
		var linkText = $('#link_text');
		var hiddenUrl = $('#link_page_url');
		if(!urlInput) return;
		if(hiddenUrl) urlInput.value = hiddenUrl.value;

		var populateFiles = function(page) {
			var wrap = $('#wrap_link_page_file');
			if(!fileSelect) return;
			fetch('./files?id=' + page.id, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
				.then(function(res) { return res.json(); })
				.then(function(data) {
					fileSelect.innerHTML = '<option></option>';
					Object.keys(data || {}).forEach(function(key) {
						var o = document.createElement('option');
						o.value = key;
						o.innerHTML = data[key];
						fileSelect.appendChild(o);
					});
					var strong = wrap ? $('p.notes strong', wrap) : null;
					if(strong) strong.textContent = page.url;
					if(fileSelect.offsetParent !== null && wrap) flash(wrap);
				}).catch(function() {});
		};

		// the page pickers: the runtime's PageListSelect on upstream's options
		var pickers = [['#link_page_id', 0], ['#child_page_id', cfg.pageID]];
		pickers.forEach(function(p) {
			var input = $(p[0]);
			if(!input) return;
			input.classList.add('InputfieldPageListSelectData');
			input.setAttribute('data-start', cfg.selectStartLabel || 'Choose');
			input.setAttribute('data-select', cfg.selectStartLabel || 'Select');
			if(p[1]) input.setAttribute('data-root', p[1]);
			input.addEventListener('pageSelected', function(e) {
				var data = e.detail || {};
				if(data.url && data.url.length) {
					var url = relative(pw.config.urls.root + data.url.substring(1));
					urlInput.value = url;
					fire(urlInput, 'change');
					populateFiles({ id: data.id, url: url });
				}
				// close its field; its header shows again for another pick
				var li = input.closest('.InputfieldInteger');
				if(li && window.Inputfields && Inputfields.close) Inputfields.close('#' + li.id);
				var header = li ? $('.PageListSelectHeader', li) : null;
				if(header) { header.classList.remove('hidden'); header.style.display = ''; }
			});
		});
		var initPickers = function() {
			pickers.forEach(function(p) {
				var input = $(p[0]);
				if(input && window.Bridge && Bridge.Inputfields) Bridge.Inputfields.init(input.closest('.Inputfield') || input.parentNode);
			});
		};
		if(window.Bridge && document.body.classList.contains('pw-runtime-ready')) initPickers();
		else document.addEventListener('pw-runtime-ready', initPickers, { once: true });

		// opening a picker's field opens its tree at once (its own header is extra here)
		$$('.InputfieldInteger > .InputfieldHeader').forEach(function(h) {
			h.addEventListener('click', function() {
				var li = h.parentElement;
				var toggle = $('.PageListSelectActionToggle', li);
				var header = toggle ? toggle.closest('.PageListSelectHeader') : null;
				if(!header || header.classList.contains('hidden')) return;
				header.classList.add('hidden');
				header.style.display = 'none';
				setTimeout(function() { toggle.click(); }, 250);
			});
		});

		if(fileSelect) fileSelect.addEventListener('change', function() {
			if(fileSelect.value.length) { urlInput.value = fileSelect.value; fire(urlInput, 'change'); }
		});
		if(anchorSelect) {
			var anchorPrevious = anchorSelect.value;
			anchorSelect.addEventListener('change', function() {
				var val = anchorSelect.value;
				if(val.length) {
					urlInput.value = val;
					anchorPrevious = val;
				} else if(urlInput.value == anchorPrevious) {
					urlInput.value = '';
				}
				fire(urlInput, 'change');
			});
		}

		var preview = function() {
			var out = $('#link_markup');
			if(!out) return;
			if(!urlInput.value.length) { out.textContent = ''; return; }
			var a = document.createElement('a');
			a.setAttribute('href', urlInput.value);
			var title = $('#link_title');
			if(title && title.value.length) a.setAttribute('title', title.value);
			if(!cfg.noLinkTextEdit && linkText && linkText.value.length) a.textContent = linkText.value;
			var rel = $('#link_rel');
			if(rel && rel.value && rel.value.length) a.setAttribute('rel', rel.value);
			var target = $('#link_target');
			if(target && target.value.length) a.setAttribute('target', target.value);
			$$('#wrap_link_class input:checked').forEach(function(c) {
				c.value.split(/\s+/).forEach(function(cls) { if(cls) a.classList.add(cls); });
			});
			out.textContent = a.outerHTML;
		};

		var ICONS = ['fa-external-link-square', 'fa-external-link', 'fa-envelope-o', 'fa-flag-o'];
		var setIcon = function(cls) {
			var li = urlInput.closest('.Inputfield');
			var icon = li ? $(':scope > .InputfieldHeader > i', li) : null;
			if(!icon || icon.classList.contains(cls)) return;
			ICONS.forEach(function(c) { icon.classList.remove(c); });
			icon.classList.add(cls);
		};
		var extClasses = function() {
			var c = cfg.extLinkClass || '';
			return { all: c.replace(' ', '_'), list: c.length ? c.split(' ') : [] };
		};
		var checkClass = function(name, on) { var box = document.getElementById('link_class_' + name); if(box) box.checked = on; };

		var urlChanged = function() {
			var val = (pw.trim ? pw.trim(urlInput.value) : urlInput.value.trim());
			var dotpos = val.indexOf('.');
			var slashespos = val.indexOf('//');
			var hasScheme = slashespos > -1 && slashespos < dotpos;
			var slashpos = slashespos > -1 ? val.indexOf('/', slashespos + 2) : val.indexOf('/');
			if(dotpos > -1 && val.indexOf('..') === -1 && val.indexOf('./') === -1 && (
				(slashpos > dotpos && !hasScheme) ||
				(slashpos === -1 && dotpos > 1 && /^[a-z][-a-z.0-9]+\.[a-z]{2,}($|\/)/i.test(val)))) {
				// a bare domain: add the scheme once (not again after the user removed it)
				var domain = val.substring(0, slashpos > 0 ? slashpos : val.length);
				hasScheme = true;
				if(urlInput.getAttribute('data-ignore') !== domain) {
					urlInput.value = 'http://' + val;
					var notes = urlInput.closest('.InputfieldContent') ? $('.notes', urlInput.closest('.InputfieldContent')) : null;
					if(notes) notes.textContent = 'http://' + val;
					urlInput.setAttribute('data-ignore', domain);
				}
			} else if(dotpos > 0 && val.indexOf('@') > 0 && val.indexOf(':') === -1 && /^[^@]+@[-.a-z0-9]{2,}\.[a-z]{2,}$/i.test(val)) {
				urlInput.value = 'mailto:' + val;
				urlInput.classList.add('email');
			} else if(val.indexOf('@') === -1) {
				urlInput.classList.remove('email');
			}
			urlInput.classList.toggle('anchor', val.charAt(0) === '#');
			if(hasScheme) {
				if(slashpos === -1) slashpos = val.length;
				urlInput.setAttribute('data-httphost', slashespos > -1 ? val.substring(slashespos + 2, slashpos) : val.substring(0, slashpos));
			} else {
				urlInput.removeAttribute('data-httphost');
			}
			var host = urlInput.getAttribute('data-httphost');
			// as upstream behaves: its own-host loop (`n < httpHosts`, an array) never runs, so
			// every link with a host counts as external
			var external = !!(host && host.length);
			var ext = extClasses();
			if(external) {
				if(!urlInput.classList.contains('external-link')) {
					setIcon('fa-external-link');
					urlInput.classList.add('external-link');
					if(cfg.extLinkTarget && $('#link_target')) $('#link_target').value = cfg.extLinkTarget;
					if(cfg.extLinkRel && $('#link_rel')) $('#link_rel').value = cfg.extLinkRel;
					if(ext.list.length > 1) checkClass(ext.all, true);
					ext.list.forEach(function(c) { checkClass(c, true); });
				}
			} else {
				if(urlInput.classList.contains('external-link')) {
					urlInput.classList.remove('external-link');
					if(cfg.extLinkRel && $('#link_rel')) $('#link_rel').value = '';
					if(cfg.extLinkTarget && $('#link_target')) $('#link_target').value = '';
					checkClass(ext.all, false);
					ext.list.forEach(function(c) { checkClass(c, false); });
				}
				if(urlInput.classList.contains('email')) setIcon('fa-envelope-o');
				else if(urlInput.classList.contains('anchor')) setIcon('fa-flag-o');
				else setIcon('fa-external-link-square');
			}
			preview();
		};

		var timer = null;
		urlInput.addEventListener('keydown', function() {
			if(timer) clearTimeout(timer);
			timer = setTimeout(urlChanged, 500);
		});
		urlInput.addEventListener('change', function() {
			var val = urlInput.value;
			if(anchorSelect) {
				if(val.charAt(0) === '#') {
					var found = Array.prototype.some.call(anchorSelect.options, function(o) { return o.value === val; });
					anchorSelect.value = found ? val : '';
				} else if(anchorSelect.value.length) {
					anchorSelect.value = '';
				}
			}
			if(hiddenUrl) hiddenUrl.value = val;
			urlChanged();
		});
		document.addEventListener('change', preview);
		if($('#link_title')) $('#link_title').addEventListener('keydown', preview);
		if(linkText) linkText.addEventListener('keyup', preview);

		setTimeout(function() {
			fire(urlInput, 'change');
			fire(linkText, 'change');
			urlInput.focus();
		}, 250);

		var form = $('#ProcessPageEditLinkForm');
		if(form && theme.WireTabs) theme.WireTabs(form, { items: $$('.WireTab'), id: 'PageEditLinkTabs' });
	}

	theme.link = { init: init, relative: relative };
	if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
	else init();
})(window.ProcessWireAdminTheme);

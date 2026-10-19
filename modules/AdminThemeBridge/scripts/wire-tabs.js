/**
 * AdminThemeBridge: native WireTabs (ADR 0016, milestone 3.1)
 *
 * Stand-in for upstream JqueryWireTabs.js ($.fn.WireTabs, checked against core 3.0.274) on pages
 * without the legacy stack; printed after the theme script by nativeProcessScripts(). Same
 * contract:
 * - the tab list ul.WireTabs (or the existing list with the given id, as JqueryWireTabs'
 *   renderTabList() prints it), each link a#_<content id> with href #<content id>, the active
 *   link with class `on` (aActiveClass), optional liActiveClass on its li;
 * - tab contents are the given items, the inactive ones hidden with display:none; an item's
 *   title attribute is its label (and is removed), data-tooltip / .WireTabTip add the tooltip
 *   attributes from ProcessWire.config.JqueryWireTabs.tooltipAttr;
 * - the target gets the active link's id as a class;
 * - the first tab shown is ?WireTab=<id>, then #<id> (the hash is then cleared), then the one
 *   remembered in the WireTabs cookie (`<requestID>-<link id>`; rememberTabs 0: set on submit
 *   and used once, 1: always, -1: never), else the first;
 * - a link whose href is not a #hash is a plain link (the View tab).
 *
 * Events: on every change, `wiretabclick` through jQuery when it is on the page (upstream's
 * arguments: new and old content as jQuery objects), and always the native
 * `pw-wiretabs-change` on document, detail {target, tab, previous} (content elements or null).
 *
 * API: ProcessWireAdminTheme.WireTabs(target, options) -> {list, show(contentId)} or null.
 */
(function(theme) {
	'use strict';
	if(!theme || theme.WireTabs) return;

	var KEYS = ['rememberTabs', 'requestID', 'cookieName', 'liActiveClass', 'aActiveClass', 'ulClass', 'ulAttrs'];

	function config() {
		var pw = window.ProcessWire || {};
		return (pw.config && pw.config.JqueryWireTabs) || {};
	}

	function toArray(items) {
		if(!items) return [];
		if(typeof items === 'string') return Array.prototype.slice.call(document.querySelectorAll(items));
		if(items.nodeType === 1) return [items];
		return Array.prototype.slice.call(items);
	}

	// jquery.cookie's format: encodeURIComponent, no path (the browser's default for this URL)
	function getCookie(name) {
		var parts = document.cookie ? document.cookie.split('; ') : [];
		for(var i = 0; i < parts.length; i++) {
			var eq = parts[i].indexOf('=');
			if(parts[i].substring(0, eq) !== name) continue;
			try { return decodeURIComponent(parts[i].substring(eq + 1)); } catch(e) { return ''; }
		}
		return '';
	}

	function setCookie(name, value) {
		document.cookie = name + '=' + encodeURIComponent(value);
	}

	function contentFor(link) {
		var href = link ? link.getAttribute('href') : '';
		return href && href.indexOf('#') === 0 && href.length > 1 ? document.getElementById(href.substring(1)) : null;
	}

	theme.WireTabs = function(target, customOptions) {
		var cfg = config();
		var o = {
			rememberTabs: 0,
			requestID: '',
			cookieName: 'WireTabs',
			items: null,
			skipRememberTabIDs: [],
			ulClass: 'WireTabs nav',
			ulAttrs: '',
			liActiveClass: '',
			aActiveClass: 'on',
			id: ''
		};
		var k;
		for(k = 0; k < KEYS.length; k++) if(typeof cfg[KEYS[k]] !== 'undefined') o[KEYS[k]] = cfg[KEYS[k]];
		for(k in customOptions || {}) o[k] = customOptions[k];
		o.rememberTabs = parseInt(o.rememberTabs, 10) || 0;

		var items = toArray(o.items);
		if(!target || !items.length) return null;

		var list = o.id ? document.getElementById(o.id) : null;
		var generate = !list;
		if(!list) {
			var tmp = document.createElement('div');
			tmp.innerHTML = '<ul' + (o.ulAttrs ? ' ' + o.ulAttrs : '') + '></ul>';
			list = tmp.firstChild;
			String(o.ulClass).split(/\s+/).forEach(function(c) { if(c) list.classList.add(c); });
			if(o.id) list.id = o.id;
		}

		// state lives on the target: a re-init (in-place save swaps the form's children) reuses it
		var state = target.pwWireTabs || (target.pwWireTabs = { lastTabID: '', submitBound: false });
		state.options = o;
		state.list = list;

		items.forEach(function(item, n) {
			if(!item.id) item.id = 'WireTab' + (n + 1);
			var title = item.getAttribute('title') || item.id;
			item.removeAttribute('title');
			var link = document.getElementById('_' + item.id);
			if(!link) {
				link = document.createElement('a');
				link.href = '#' + item.id;
				link.id = '_' + item.id;
				link.innerHTML = title;
				var li = document.createElement('li');
				li.appendChild(link);
				list.appendChild(li);
			}
			var tip = item.getAttribute('data-tooltip');
			if(item.classList.contains('WireTabTip') || tip) {
				if(!tip) tip = title;
				var attrs = cfg.tooltipAttr || {};
				for(var key in attrs) {
					var val = String(attrs[key]).replace('{tip}', tip);
					if(key === 'class') link.classList.add(val);
					else link.setAttribute(key, val);
				}
			}
			if(!link.pwWireTab) {
				link.pwWireTab = true;
				link.addEventListener('click', onClick);
			}
			item.style.display = 'none';
		});
		if(generate) target.insertBefore(list, target.firstChild);

		function onClick(e) {
			var link = e.currentTarget;
			var active = o.aActiveClass;
			var old = list.querySelector('a.' + active) || list.querySelector('a');
			var newContent = contentFor(link);
			if(!newContent) return; // a plain link (the View tab): follow it
			e.preventDefault();
			var oldContent = old && old !== link ? contentFor(old) : null;
			if(old) old.classList.remove(active);
			link.classList.add(active);
			if(o.liActiveClass) {
				var on = list.querySelector('li.' + o.liActiveClass);
				if(on) on.classList.remove(o.liActiveClass);
				if(link.parentNode && link.parentNode.tagName === 'LI') link.parentNode.classList.add(o.liActiveClass);
			}
			if(oldContent) oldContent.style.display = 'none';
			newContent.style.display = '';
			if(old && old !== link && old.id) target.classList.remove(old.id);
			if(link.id) target.classList.add(link.id);
			if(o.rememberTabs > -1) {
				var id = o.skipRememberTabIDs.indexOf(link.id) > -1 ? '' : link.id;
				if(o.rememberTabs === 1) setCookie(o.cookieName, o.requestID + '-' + id);
				state.lastTabID = id;
			}
			if(window.jQuery) jQuery(document).trigger('wiretabclick', [jQuery(newContent), jQuery(oldContent || [])]);
			document.dispatchEvent(new CustomEvent('pw-wiretabs-change', { detail: { target: target, tab: newContent, previous: oldContent } }));
		}

		if(o.rememberTabs === 0 && !state.submitBound) {
			state.submitBound = true;
			target.addEventListener('submit', function() {
				var so = state.options;
				setCookie(so.cookieName, so.requestID + '-' + state.lastTabID);
			});
		}

		var remember = null;
		var match = window.location.href.match(/[&;?]WireTab=([-_a-z0-9]+)/i);
		if(match) remember = document.getElementById('_' + match[1]);
		if(!remember && document.location.hash.length > 1) {
			remember = document.getElementById('_' + document.location.hash.substring(1));
			if(remember) document.location.hash = '';
		}
		var cookie = getCookie(o.cookieName);
		var prefix = o.requestID + '-';
		if(!remember && o.rememberTabs > -1 && cookie.indexOf(prefix) === 0 && cookie.length > prefix.length) {
			remember = document.getElementById(cookie.substring(prefix.length));
		}
		// only tabs with content: a plain link (the View tab) is never clicked for the user
		if(remember && list.contains(remember) && contentFor(remember)) {
			remember.click();
			if(o.rememberTabs === 0) setCookie(o.cookieName, '');
		} else {
			var links = list.querySelectorAll('li > a');
			for(var i = 0; i < links.length; i++) {
				if(!contentFor(links[i])) continue;
				links[i].click();
				break;
			}
		}

		return {
			list: list,
			show: function(contentId) {
				var link = document.getElementById('_' + contentId);
				if(link && list.contains(link)) link.click();
			}
		};
	};
})(window.ProcessWireAdminTheme);

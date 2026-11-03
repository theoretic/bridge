/**
 * AdminThemeBridge: the page tree and history drawers beside the logo (0.25.0)
 *
 * Printed (deferred) on every admin page whose masthead has a drawer button
 * (AdminThemeBridgeDrawers::renderDrawerButtons()). A button[data-pw-drawer] opens its
 * dialog#pw-drawer-<name> with showModal(); the close button, Escape and a click on the backdrop
 * close it, the focus goes back to the button. One drawer is open at a time.
 *
 * Events on the dialog (bubbling): pw-drawer-open (detail: { name, first }: first is true on the
 * first open on this page) and pw-drawer-close (detail: { name }).
 * API: ProcessWireAdminTheme.drawer.open(name), .close(name), .isOpen(name), .refreshTree().
 *
 * The page tree drawer clones its <template> (a div[data-pw-tree] with the tree's own options)
 * into its body on the first open and hands it to Bridge.pageTree(). refreshTree()
 * builds it again with the branches open now (its cookie, options.cookieName), unless a drag is on.
 *
 * The history drawer fetches its table on the first open (the screen's URL plus bridgeHistory=1,
 * AdminThemeBridgeHistory), and again on a later open while no table came yet (a failed fetch is
 * retried); aria-busy on its body while a fetch runs. On pw-tab-focus (the user is back in this tab) both drawers that were
 * built once refresh in the background: the history table, and the tree with its open branches.
 * A keyboard focus inside a body that is refreshed goes back to the same link (the same href, the
 * same page's row), else the link at its place, else the drawer's close button (0.26.0).
 */
(function(theme) {
	'use strict';
	if(!theme || theme.drawer) return;

	var opened = {};

	function dialogOf(name) { return document.getElementById('pw-drawer-' + name); }
	function buttonOf(name) { return document.querySelector('[data-pw-drawer="' + name + '"]'); }

	function isOpen(name) {
		var d = dialogOf(name);
		return !!(d && d.open);
	}

	function close(name) {
		var d = dialogOf(name);
		if(d && d.open) d.close();
	}

	function open(name) {
		var d = dialogOf(name);
		if(!d || d.open) return;
		Array.prototype.forEach.call(document.querySelectorAll('dialog.pw-drawer[open]'), function(o) { o.close(); });
		d.showModal();
		var b = buttonOf(name);
		if(b) b.setAttribute('aria-expanded', 'true');
		var first = !opened[name];
		opened[name] = true;
		d.dispatchEvent(new CustomEvent('pw-drawer-open', { bubbles: true, detail: { name: name, first: first } }));
	}

	function cookieOpen(name) {
		var m = null;
		document.cookie.split(';').forEach(function(c) {
			c = c.trim();
			if(!m && c.indexOf(name + '=') === 0) m = [c, c.substring(name.length + 1)];
		});
		if(!m) return [];
		// fields/pagelist.ts writes "id-start,id-start"
		return decodeURIComponent(m[1]).split(',').filter(function(s) { return /^\d+(-\d+)?$/.test(s); });
	}

	// a tree from the drawer's template; withCookie: the branches open now instead of at page load
	function buildTree(withCookie) {
		var d = dialogOf('tree');
		var tpl = d && d.querySelector('template.pw-drawer-template');
		var body = d && d.querySelector('.pw-drawer-body');
		if(!tpl || !body) return false;
		var tree = tpl.content.firstElementChild ? tpl.content.firstElementChild.cloneNode(true) : null;
		if(!tree) return false;
		if(withCookie) {
			try {
				var o = JSON.parse(tree.getAttribute('data-pw-tree') || '{}');
				o.openPageIDs = cookieOpen(o.cookieName || 'pagelist_open');
				tree.setAttribute('data-pw-tree', JSON.stringify(o));
			} catch(err) { /* keep the page's options */ }
		}
		body.appendChild(tree);
		// the runtime's tree (fields/pagelist.ts); the Bridge stand-in replays the call until it is there
		if(window.Bridge && window.Bridge.pageTree) window.Bridge.pageTree(tree);
		return true;
	}

	function refreshTree() {
		var d = dialogOf('tree');
		var old = d && d.querySelector('.pw-drawer-body [data-pw-tree]');
		if(!old || old.querySelector('.PageListSorting, .PageListSortSaving')) return false;
		var body = old.parentNode, top = body.scrollTop, a = document.activeElement;
		var had = old.contains(a), m = had && ((a.closest('.PageListItem') || {}).className || '').match(/PageListID(\d+)/);
		old.remove();
		buildTree(true);
		body.scrollTop = top;
		if(had) refocusTree(d, body, m ? '.PageListID' + m[1] + ' > a.PageListPage' : 'a.PageListPage', Date.now());
		return true;
	}

	// the new tree draws its rows after Bridge.pageTree() resolves: wait for the row, up to 2 s
	function refocusTree(d, body, sel, t0) {
		var a = document.activeElement;
		if(a && a !== document.body && a !== d) return; // the focus went somewhere meanwhile
		var t = body.querySelector(sel);
		if(!t && Date.now() - t0 > 2000) t = body.querySelector('a.PageListPage') || d.querySelector('.pw-drawer-close');
		if(t) t.focus();
		else requestAnimationFrame(function() { refocusTree(d, body, sel, t0); });
	}

	var history = { loaded: false, busy: false };

	function loadHistory() {
		var d = dialogOf('history');
		var body = d && d.querySelector('.pw-drawer-body');
		if(!body || history.busy) return;
		history.busy = true;
		body.setAttribute('aria-busy', 'true');
		var url = new URL(window.location.href);
		url.hash = '';
		url.searchParams.set('bridgeHistory', '1');
		fetch(url.href, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }).then(function(r) {
			if(!r.ok) throw new Error('HTTP ' + r.status);
			return r.text();
		}).then(function(html) {
			var top = body.scrollTop, a = document.activeElement, had = body.contains(a);
			var i = Array.prototype.indexOf.call(body.querySelectorAll('a'), a), href = had && a.getAttribute('href');
			body.innerHTML = theme.trusted.html(html);
			body.scrollTop = top;
			history.loaded = true;
			if(!had) return;
			var links = Array.prototype.slice.call(body.querySelectorAll('a'));
			var t = links.filter(function(l) { return l.getAttribute('href') === href; })[0] || links[i] || d.querySelector('.pw-drawer-close');
			t.focus();
		}).catch(function() {
			// the last table stays; with none yet, say what happened
			if(history.loaded) return;
			var p = document.createElement('p');
			p.className = 'pw-history-empty';
			p.setAttribute('role', 'alert');
			p.textContent = (((window.ProcessWire && ProcessWire.config.AdminThemeBridge) || {}).labels || {}).requestFailed || 'Request failed';
			body.replaceChildren(p);
		}).then(function() {
			history.busy = false;
			body.removeAttribute('aria-busy');
		});
	}

	document.addEventListener('pw-drawer-open', function(e) {
		if(!e.detail) return;
		if(e.detail.name === 'tree' && e.detail.first) buildTree(false);
		// no table yet: the first open, or a reopen after a failed fetch
		if(e.detail.name === 'history' && (e.detail.first || !history.loaded)) loadHistory();
	});

	// back in this tab: what other tabs changed (main.js setupTabFocus)
	document.addEventListener('pw-tab-focus', function() {
		if(history.loaded) loadHistory();
		refreshTree();
	});

	document.addEventListener('click', function(e) {
		var t = e.target;
		var b = t.closest && t.closest('[data-pw-drawer]');
		if(b) {
			var name = b.getAttribute('data-pw-drawer');
			if(isOpen(name)) close(name);
			else open(name);
			return;
		}
		var d = t.closest && t.closest('dialog.pw-drawer');
		if(!d) return;
		if(t.closest('.pw-drawer-close')) { d.close(); return; }
		// the backdrop: a click on the dialog element outside its box, not on its padding
		if(t !== d) return;
		var r = d.getBoundingClientRect();
		if(e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
	});

	// 'close' does not bubble: listen on each drawer
	Array.prototype.forEach.call(document.querySelectorAll('dialog.pw-drawer'), function(d) {
		d.addEventListener('close', function() {
			var name = d.getAttribute('data-pw-drawer-name');
			var b = buttonOf(name);
			if(b) b.setAttribute('aria-expanded', 'false');
			// back to the button, unless another drawer took over
			if(b && !document.querySelector('dialog.pw-drawer[open]')) b.focus();
			d.dispatchEvent(new CustomEvent('pw-drawer-close', { bubbles: true, detail: { name: name } }));
		});
	});

	theme.drawer = { open: open, close: close, isOpen: isOpen, refreshTree: refreshTree, refreshHistory: loadHistory };
})(window.ProcessWireAdminTheme);

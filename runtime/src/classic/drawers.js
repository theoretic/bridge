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
 * builds it again with the branches open now (the pagelist_open cookie), unless a drag is on.
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

	function cookieOpen() {
		var m = document.cookie.match(/(?:^|;\s*)pagelist_open=([^;]*)/);
		if(!m) return [];
		// the runtime writes "id-start,id-start" (fields/pagelist.ts)
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
				o.openPageIDs = cookieOpen();
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
		var body = old.parentNode, top = body.scrollTop;
		old.remove();
		buildTree(true);
		body.scrollTop = top;
		return true;
	}

	document.addEventListener('pw-drawer-open', function(e) {
		if(e.detail && e.detail.name === 'tree' && e.detail.first) buildTree(false);
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

	theme.drawer = { open: open, close: close, isOpen: isOpen, refreshTree: refreshTree };
})(window.ProcessWireAdminTheme);

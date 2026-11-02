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
 * API: ProcessWireAdminTheme.drawer.open(name), .close(name), .isOpen(name).
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

	theme.drawer = { open: open, close: close, isOpen: isOpen };
})(window.ProcessWireAdminTheme);

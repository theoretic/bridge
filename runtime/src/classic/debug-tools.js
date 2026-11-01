/**
 * AdminThemeBridge: the core's Debug Mode Tools (wire/templates-admin/debug.inc, superusers in
 * debug mode), printed by _footer.php after the panel.
 *
 * Upstream's own script is a jQuery $(document).ready() that makes the sections a jQuery UI
 * accordion and the link a slide-in panel (JqueryUI/panel.js). Without the legacy stack it threw
 * and left the whole panel open below the footer; with the stack it slid open inline, as the
 * stack loads no panel.js. _footer.php leaves that script out (#debug.pw-debug) and this one does
 * the same on every page, jQuery or not:
 * - the link (a.pw-panel with data-panel-id, panel.js's in-page panel) opens the panel in a
 *   dialog (34-dialog.css) titled with its tab text; when a module has loaded panel.js itself
 *   (window.pwPanels), panel.js opens it;
 * - the sections fold as the accordion did: all closed at first, one open at a time.
 */
(function() {
	'use strict';
	var dialog;

	function open(link) {
		var panel = document.getElementById(link.getAttribute('data-panel-id'));
		if(!panel) return;
		if(!dialog) {
			dialog = document.createElement('dialog');
			dialog.className = 'pw-dialog pw-dialog-large';
			dialog.innerHTML = window.ProcessWireAdminTheme.trusted.html("<div class='pw-dialog-bar'><span></span><button type='button' class='pw-dialog-close'>×</button></div><div class='pw-dialog-content'></div>");
			dialog.firstChild.firstChild.textContent = link.getAttribute('data-tab-text');
			// named by its title (audit UX1)
			dialog.firstChild.firstChild.id = 'pw-debug-title';
			dialog.setAttribute('aria-labelledby', 'pw-debug-title');
			// translated by the theme (audit U4)
			dialog.firstChild.lastChild.setAttribute('aria-label', ((ProcessWire.config.AdminThemeBridge || {}).labels || {}).close || 'Close');
			// the close button and the backdrop
			dialog.addEventListener('click', function(e) {
				var r = dialog.getBoundingClientRect();
				var outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
				if((e.target === dialog && outside) || e.target.className === 'pw-dialog-close') dialog.close();
			});
			// the accordion's headings open from the keyboard too (audit UX1)
			Array.prototype.forEach.call(panel.querySelectorAll('.container > h3'), function(h) {
				h.tabIndex = 0;
				h.setAttribute('role', 'button');
				h.setAttribute('aria-expanded', 'false');
				h.addEventListener('keydown', function(e) {
					if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); h.click(); }
				});
			});
			dialog.lastChild.appendChild(panel);
			document.body.appendChild(dialog);
		}
		dialog.showModal();
	}

	document.addEventListener('click', function(e) {
		var t = e.target;
		var link = t.closest && t.closest('.pw-panel[data-panel-id]');
		var head = t.closest && t.closest('#debug.pw-debug .container > h3');
		if(link && !window.pwPanels) {
			e.preventDefault();
			open(link);
		} else if(head) {
			e.preventDefault();
			var box = head.parentNode;
			var on = !box.classList.contains('pw-debug-open');
			Array.prototype.forEach.call(document.querySelectorAll('#debug .pw-debug-open'), function(other) {
				other.classList.remove('pw-debug-open');
				var h = other.querySelector(':scope > h3');
				if(h) h.setAttribute('aria-expanded', 'false');
			});
			box.classList.toggle('pw-debug-open', on);
			head.setAttribute('aria-expanded', on ? 'true' : 'false');
		}
	});
})();

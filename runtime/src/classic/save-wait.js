/**
 * AdminThemeBridge: a save waits for the page's own requests (ProcessWireAdminTheme.saveWait)
 *
 * A save clicked in an edit form while an upload or another request to this screen is on its way
 * (a repeater item, an AJAX-loaded field, a page table refresh) is held until they are all done,
 * then clicked again, so what they add to the form is saved with it (in place, scripts/page-save.js,
 * or the classic way). Counted: XMLHttpRequest and fetch() to this screen's path (upstream's raw
 * upload XHRs and jQuery's included; other endpoints, such as polling, are not), body.pw-uploading
 * (upstream's and the runtime's, with their 500 ms tail) and images still being resized before
 * their upload (.gridImageUploading); then 400 ms without any, for the markup an answer brings.
 *
 * While it waits, the button and its head copy show a spinner and a status says so. Another
 * click on a save button saves at once, with the upload confirm as before (upstream's, or
 * scripts/page-edit.js's, which leaves the first click to this); a cancelled confirm goes back to
 * waiting. Escape stops waiting. Delete (submit_delete) never waits. Printed for the Processes of
 * saveInPlaceProcess(), whatever the in-place setting, modal windows included.
 */
(function(w, theme) {
	if(!theme || theme.saveWait) return;

	var FORMS = ['ProcessPageEdit', 'ProcessFieldEdit', 'ProcessTemplateEdit', 'ModuleEditForm', 'ProcessProfile'];
	var active = 0;
	var waiting = null;
	var now = false;
	var submitted = false;

	function ours(url) {
		try {
			var u = new URL(String(url), location.href);
			return u.origin === location.origin && u.pathname === location.pathname;
		} catch(e) {
			return false;
		}
	}
	function end() { active = Math.max(0, active - 1); }

	var proto = w.XMLHttpRequest && w.XMLHttpRequest.prototype;
	if(proto) {
		var open = proto.open;
		var send = proto.send;
		proto.open = function(method, url) {
			this.pwOurs = ours(url);
			return open.apply(this, arguments);
		};
		proto.send = function() {
			var xhr = this;
			var done = function() { if(xhr.pwOn) { xhr.pwOn = false; end(); } };
			if(xhr.pwOurs && !xhr.pwOn) {
				xhr.pwOn = true;
				active++;
				if(!xhr.pwBound) { xhr.pwBound = true; xhr.addEventListener('loadend', done); }
			}
			try { return send.apply(xhr, arguments); } catch(e) { done(); throw e; }
		};
	}
	var fetch = w.fetch;
	if(typeof fetch === 'function') w.fetch = function(input) {
		var p = fetch.apply(w, arguments);
		if(ours(input && input.url ? input.url : input)) {
			active++;
			// settles with the headers: the caller reads the body and inserts it in the quiet time
			p.then(end, end);
		}
		return p;
	};

	function busy(form) {
		return active > 0 || document.body.classList.contains('pw-uploading') || !!form.querySelector('.gridImageUploading');
	}

	function saving() {
		return document.body.classList.contains('pw-saving');
	}

	// a save button of an edit form, or its original for a head copy (outside the form)
	function saveButton(el) {
		var b = el && el.closest ? el.closest('button[type=submit], input[type=submit]') : null;
		if(b && b.classList.contains('pw-head-button-copy')) b = document.getElementById(b.getAttribute('data-from-id')) || b.pwHeadSource;
		return b && b.form && FORMS.indexOf(b.form.getAttribute('id')) > -1 && b.name !== 'submit_delete' ? b : null;
	}

	function mark(button, on) {
		if(!document.getElementById('pw-save-wait')) document.body.insertAdjacentHTML('beforeend', "<span id='pw-save-wait' class='pw-sr-only' role='status'></span>");
		document.getElementById('pw-save-wait').textContent = on ? ((theme.config().labels || {}).saveWaiting || '') : '';
		document.body.classList.toggle('pw-save-waiting', on);
		[button, button.id ? document.getElementById(button.id + '_copy') : null].forEach(function(b) {
			if(!b) return;
			var spin = b.querySelector('.pw-save-spinner');
			if(on && !spin) {
				(b.querySelector('.ui-button-text') || b).insertAdjacentHTML('beforeend', "<i class='fa fa-fw fa-spin fa-spinner pw-save-spinner'></i>");
			} else if(!on && spin) {
				spin.remove();
			}
		});
	}

	// a second click this soon is the same double click
	function held() {
		return Date.now() - waiting.since < 600;
	}

	function stop() {
		if(!waiting) return;
		clearInterval(waiting.timer);
		mark(waiting.button, false);
		waiting = null;
	}

	function wait(form, button) {
		var quiet = 0;
		waiting = { button: button, since: Date.now() };
		mark(button, true);
		waiting.timer = setInterval(function() {
			if(busy(form)) { quiet = 0; return; }
			if(!quiet) quiet = Date.now();
			if(Date.now() - quiet < 400) return;
			stop();
			// a click on a disabled or removed button does nothing; busy again by now, it waits again
			button.click();
		}, 100);
	}

	// capture on document: before upstream's upload confirm (bubbling on document) and the submit
	document.addEventListener('click', function(e) {
		var button = now || saving() ? null : saveButton(e.target);
		if(!button) return;
		var form = button.form;
		// another click saves now (a double click is one click), the original of a head copy too;
		// when a confirm after this cancels it, wait again
		if(waiting && !held()) {
			var first = waiting.button;
			stop();
			now = true;
			submitted = false;
			setTimeout(function() {
				now = false;
				if(!submitted && !waiting && busy(form)) wait(form, first);
			}, 0);
			return;
		}
		if(!waiting && !busy(form)) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		if(!waiting) wait(form, button);
	}, true);

	// on window: before the in-place save's listener stops it
	w.addEventListener('submit', function() { submitted = true; }, true);

	document.addEventListener('keydown', function(e) {
		if(e.key === 'Escape') stop();
	});

	theme.saveWait = {
		/** Does this take a click on this button now? (scripts/page-edit.js leaves its confirm to this) */
		claims: function(button) {
			var b = saveButton(button);
			return !saving() && b && (now || (waiting ? held() : busy(b.form)));
		}
	};
})(window, window.ProcessWireAdminTheme);

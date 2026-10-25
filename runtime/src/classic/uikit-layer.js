/**
 * The UIkit layer on the client (ADR 0017). Printed in <head> before every module script.
 *
 * - AdminThemeUikit's scheme classes: <body> carries light-theme or dark-theme, in step with
 *   html[data-pw-scheme] (modules written for that theme style against them).
 * - Where the server did not print UIkit (ProcessWire.config.AdminThemeBridge.uikit.loaded false):
 *   - window.UIkit is a stand-in. Using it loads the layer (the UIkit stylesheet built for the
 *     theme, core's uikit.min.js and uikit-icons.min.js) and replays the call there. A call
 *     returns a stand-in for its result: chain on it (UIkit.modal('#x').show()) or await it.
 *   - Content added later (AJAX, dialogs) with a UIkit attribute (uk-grid, data-uk-modal) or a
 *     uk-* class the theme's compat rules do not cover (uikit-covered.json) loads the layer too.
 *   - Tooltips are no reason: uk-tooltip's text becomes the element's title (the browser's own).
 *
 * API: ProcessWireAdminTheme.uikit.load() -> Promise, .loaded, .scan(element), .tooltips(element).
 * Event: 'pw-uikit-loaded' on document.
 */
(function() {
	var cfg = (ProcessWire.config.AdminThemeBridge || {}).uikit || {};
	var doc = document;

	// AdminThemeUikit's scheme classes on <body> (called once it exists)
	var schemeClass = function() {
		var dark = doc.documentElement.getAttribute('data-pw-scheme') === 'dark';
		doc.body.classList.toggle('dark-theme', dark);
		doc.body.classList.toggle('light-theme', !dark);
	};
	// the theme script dispatches pw-scheme-change whenever the effective scheme changes
	doc.addEventListener('pw-scheme-change', schemeClass);
	// not while parsing: output echoed before <!DOCTYPE> makes the parser open <body> early, and a
	// class set on it then keeps the server's <body class> (AdminThemeBridge ...) from being merged
	if(doc.readyState !== 'loading') schemeClass();
	else doc.addEventListener('DOMContentLoaded', schemeClass, { once: true });

	var api = {
		// printed by the server (this script runs before any other that could bring it)
		loaded: !!cfg.loaded,
		promise: null,
		covered: null,

		/**
		 * Load the layer (once): its stylesheet, then the scripts in order
		 * @returns {Promise}
		 */
		load: function() {
			var self = this;
			if(self.loaded && window.UIkit && !window.UIkit.pwStandIn) return Promise.resolve(window.UIkit);
			if(self.promise) return self.promise;
			var standIn = window.UIkit && window.UIkit.pwStandIn ? window.UIkit : null;
			// the real UIkit assigns window.UIkit; the stand-in steps aside first
			if(standIn) window.UIkit = undefined;
			var style = new Promise(function(resolve) {
				if(!cfg.css || doc.querySelector('link[data-pw-uikit]')) return resolve();
				var link = doc.createElement('link');
				link.rel = 'stylesheet';
				link.href = cfg.css;
				link.setAttribute('data-pw-uikit', '');
				link.onload = link.onerror = resolve;
				// a cascade layer: its place among the sheets does not matter
				doc.head.appendChild(link);
			});
			var scripts = (cfg.scripts || []).map(function(url) {
				return new Promise(function(resolve, reject) {
					var s = doc.createElement('script');
					s.src = url;
					s.async = false;
					s.onload = resolve;
					s.onerror = function() { reject(new Error('Bridge: no ' + url)); };
					doc.head.appendChild(s);
				});
			});
			self.promise = Promise.all([style].concat(scripts)).then(function() {
				if(!window.UIkit) throw new Error('Bridge: no UIkit');
				self.loaded = true;
				doc.dispatchEvent(new CustomEvent('pw-uikit-loaded'));
				return window.UIkit;
			});
			self.promise.catch(function(err) {
				self.promise = null;
				if(standIn && !window.UIkit) window.UIkit = standIn;
				console.error(err);
			});
			return self.promise;
		},

		/**
		 * Load the layer if this element (or anything in it) uses UIkit (an element node)
		 * @param {Element} el
		 */
		scan: function(el) {
			if(this.loaded || this.promise) return;
			var self = this;
			var nodes = [el].concat([].slice.call(el.querySelectorAll('*')));
			var classes = [];
			for(var i = 0; i < nodes.length; i++) {
				var attrs = nodes[i].attributes;
				for(var j = 0; j < attrs.length; j++) {
					// a tooltip alone is no reason: tooltips() gives it the browser's own (as the server decides)
					if(!/^(data-)?uk-[a-z]/.test(attrs[j].name) || /^(data-)?uk-tooltip$/.test(attrs[j].name)) continue;
					return void self.load();
				}
				var cls = typeof nodes[i].className === 'string' ? nodes[i].className : '';
				if(cls.indexOf('uk-') > -1) classes = classes.concat(cls.match(/(^|\s)uk-[\w@-]+/g).map(function(c) { return c.trim(); }));
			}
			if(!classes.length) return;
			self.coveredList().then(function(covered) {
				if(classes.some(function(c) { return !covered[c]; })) self.load();
			});
		},

		/**
		 * UIkit tooltips without UIkit: the tooltip text (uk-tooltip="Text" or "title: Text; ...")
		 * becomes the element's title, unless it has one (core's module list: data-uk-tooltip="delay:1000")
		 * @param {Element} el
		 */
		tooltips: function(el) {
			if(!el || el.nodeType !== 1 || (window.UIkit && !window.UIkit.pwStandIn)) return;
			var sel = '[uk-tooltip]:not([title]), [data-uk-tooltip]:not([title])';
			var list = [].slice.call(el.querySelectorAll(sel));
			if(el.matches(sel)) list.push(el);
			list.forEach(function(item) {
				var value = item.getAttribute('uk-tooltip') || item.getAttribute('data-uk-tooltip') || '';
				var m = /(?:^|;)\s*title\s*:\s*([^;]*)/.exec(value);
				var text = m ? m[1] : (/^\s*[\w-]+\s*:/.test(value) ? '' : value);
				if(text.trim()) item.setAttribute('title', text.trim());
			});
		},

		coveredList: function() {
			if(this.covered) return this.covered;
			this.covered = (cfg.covered ? fetch(cfg.covered).then(function(r) { return r.json(); }) : Promise.resolve([]))
				.then(function(list) { var map = {}; list.forEach(function(c) { map[c] = true; }); return map; }, function() { return {}; });
			return this.covered;
		}
	};

	/**
	 * A stand-in for a value UIkit will give: property reads and calls are recorded on promises
	 * and run once it is there; `then` makes it awaitable
	 */
	var deferred = function(value, owner) {
		return new Proxy(function() {}, {
			get: function(target, key) {
				if(key === 'then') return function(a, b) { return value.then(a, b); };
				if(key === 'catch') return function(b) { return value.catch(b); };
				if(key === 'pwStandIn') return true;
				if(typeof key === 'symbol') return undefined;
				return deferred(value.then(function(v) { return v[key]; }), value);
			},
			apply: function(target, self, args) {
				return deferred(Promise.all([value, owner]).then(function(r) { return r[0].apply(r[1], args); }));
			}
		});
	};

	if(!api.loaded && cfg.mode !== 'never' && typeof window.UIkit === 'undefined' && window.Proxy) {
		var standIn = new Proxy(function() {}, {
			get: function(target, key) {
				if(key === 'pwStandIn') return true;
				// not a promise: `await UIkit` or a library's thenable check must not load it
				if(key === 'then' || typeof key === 'symbol') return undefined;
				var real = api.load();
				return deferred(real.then(function(U) { return U[key]; }), real);
			},
			apply: function(target, self, args) {
				return deferred(api.load().then(function(U) { return U.apply(self, args); }));
			}
		});
		window.UIkit = standIn;
	}

	// content added later, through the theme script's one body observer
	var hook = function() {
		var theme = window.ProcessWireAdminTheme;
		if(!theme) return;
		theme.uikit = api;
		if(api.loaded || !theme.observe) return;
		api.tooltips(doc.body);
		var stop = theme.observe(function(records) {
			if(api.loaded) { if(stop) stop(); return; }
			for(var i = 0; i < records.length; i++) {
				var added = records[i].addedNodes;
				for(var j = 0; j < added.length; j++) {
					if(added[j].nodeType !== 1) continue;
					api.tooltips(added[j]);
					if(cfg.mode !== 'never') api.scan(added[j]);
				}
			}
		});
	};
	if(doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', hook, { once: true });
	else hook();
})();

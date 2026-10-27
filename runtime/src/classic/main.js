/**
 * AdminThemeBridge: theme script (classic script, no dependencies)
 *
 * - When the legacy stack is on the page, defers to upstream ProcessWireAdmin for dropdowns,
 *   tooltips and notices, exactly as upstream themes do.
 * - When it is not, provides native handlers for the shell's own widgets (dropdowns, notice
 *   close, head buttons) and watches the DOM: the first legacy Inputfield that appears
 *   (AJAX-loaded field, modal content) triggers loading of the legacy stack in upstream order,
 *   then Inputfields.init() and the upstream 'reloaded' event on that element, so legacy
 *   scripts see exactly what they expect.
 *
 * Public API (also for components): ProcessWireAdminTheme.legacy.load() -> Promise,
 * ProcessWireAdminTheme.legacy.loaded, ProcessWireAdminTheme.legacy.initElement(el),
 * ProcessWireAdminTheme.runScripts(rootOrScripts, {legacy}) -> Promise,
 * ProcessWireAdminTheme.observe(fn) -> unregister, ProcessWireAdminTheme.upstream().
 */

var ProcessWireAdminTheme = {

	/**
	 * Run the inline scripts of markup that arrived after page load, as upstream's jQuery html()
	 * does: each script becomes a live copy with all its attributes, in document order (one in the
	 * page is replaced, one in a parsed document is appended to the body). Data scripts
	 * (application/json, text/x-template, ld+json...) stay inert; a src already on the page is not
	 * loaded twice. With {legacy: true} they run once the legacy stack is there: content the theme
	 * marked data-bridge-legacy expects jQuery. The one runner for the theme's classic scripts and
	 * the runtime (util/scripts.ts), replacing four that differed (audit B22).
	 *
	 * @param {Element|Element[]} rootOrScripts A container (its scripts run) or a list of scripts
	 * @param {{legacy?: boolean}} [options]
	 * @returns {Promise}
	 */
	runScripts: function(rootOrScripts, options) {
		var self = this;
		var scripts;
		if(Array.isArray(rootOrScripts)) scripts = rootOrScripts;
		else if(rootOrScripts && rootOrScripts.tagName === 'SCRIPT') scripts = [rootOrScripts];
		else scripts = rootOrScripts ? Array.prototype.slice.call(rootOrScripts.querySelectorAll('script')) : [];
		var run = function() {
			var loaded = Array.prototype.map.call(document.querySelectorAll('script[src]'), function(s) { return s.getAttribute('src'); });
			var i = 0;
			// in order, and an external script loads before the ones after it run (upstream's
			// jQuery evaluated it synchronously); up to the first one this runs synchronously
			var next = function() {
				while(i < scripts.length) {
					var old = scripts[i++];
					var type = (old.getAttribute('type') || '').trim().toLowerCase();
					if(type && !/^(text|application)\/(java|ecma)script$|^module$/.test(type)) continue;
					// in this page (replaced where it is) or detached / in a parsed document (appended)
					var here = old.isConnected && old.ownerDocument === document;
					var src = old.getAttribute('src');
					if(src && loaded.filter(function(u) { return u === src; }).length > (here ? 1 : 0)) continue;
					var live = document.createElement('script');
					Array.prototype.forEach.call(old.attributes, function(a) { live.setAttribute(a.name, a.value); });
					var wait = null;
					if(src) {
						live.async = false;
						wait = new Promise(function(resolve) { live.onload = live.onerror = function() { resolve(); }; });
					} else {
						live.text = old.text || old.textContent || '';
					}
					if(here) old.parentNode.replaceChild(live, old);
					else document.body.appendChild(live);
					if(wait) return wait.then(next);
				}
			};
			return Promise.resolve(next());
		};
		if(!scripts.length) return Promise.resolve();
		if(options && options.legacy && !self.legacy.loaded) {
			return self.legacy.load().then(run, function(err) {
				if(window.console) console.error('Bridge: inline scripts not run, the legacy stack did not load', err);
			});
		}
		return run();
	},

	/**
	 * Does upstream own the shell? Once the legacy stack is on the page and initialised
	 * (printed by the server, or loaded late), upstream main.js and inputfields.js handle
	 * dropdowns, collapse, dependencies and dialogs. A jQuery that a site module brought along
	 * by itself does not count: without upstream's scripts nobody else would (audit B11).
	 *
	 * @returns {boolean}
	 */
	upstream: function() {
		return this.legacy.loaded || typeof window.ProcessWireAdmin !== 'undefined';
	},

	/**
	 * One MutationObserver on <body> for the theme and the runtime: fn(records) is called for
	 * every batch of DOM changes in the body (subtree, childList), in registration order; a throw
	 * in one does not stop the others. Returns a function that unregisters fn (audit B18).
	 *
	 * @param {Function} fn
	 * @returns {Function}
	 */
	observe: function(fn) {
		var self = this;
		if(!self.watchers) self.watchers = [];
		self.watchers.push(fn);
		if(!self.bodyObserver && window.MutationObserver) {
			self.bodyObserver = new MutationObserver(function(records) {
				self.watchers.slice().forEach(function(watch) {
					try { watch(records); } catch(e) { if(window.console) console.error('Bridge: content observer failed', e); }
				});
			});
			self.bodyObserver.observe(document.body, { childList: true, subtree: true });
		}
		return function() {
			var i = self.watchers.indexOf(fn);
			if(i > -1) self.watchers.splice(i, 1);
		};
	},

	/**
	 * The end of the theme's screen scripts (lister.js, page-edit.js, setup.js, screens.js): when
	 * the legacy stack loads late, upstream's script for the screen (ProcessPageLister.js,
	 * ProcessPageEdit.js, ...) arrives with it and binds the same controls, so every click would be
	 * handled twice (two Lister POSTs). Their listeners take bind(options), which adds a signal
	 * aborted at 'pw-legacy-handover'; over is true from then on (audit N1).
	 */
	handover: (function() {
		var ctl = window.AbortController ? new AbortController() : null;
		var state = { over: false };
		document.addEventListener('pw-legacy-handover', function() {
			state.over = true;
			if(ctl) ctl.abort();
		});
		state.bind = function(options) {
			if(!ctl) return options;
			var o = {};
			if(options === true || options === false) o.capture = options;
			else if(options) for(var k in options) o[k] = options[k];
			o.signal = ctl.signal;
			return o;
		};
		return state;
	})(),

	init: function() {
		var cfg = this.config();
		this.legacy.loaded = !!cfg.legacy;
		// head buttons are copied before upstream init, as AdminThemeUikit does: upstream
		// setupDropdown() then binds each toggle copy to itself (a copy made afterwards inherits
		// the original's hide timer, which watches the original and closes the menu after 1s)
		this.setupHeadButtons();
		if(this.legacy.loaded && typeof ProcessWireAdmin !== 'undefined') {
			this.prepareUpstreamNav();
			ProcessWireAdmin.init();
			this.setupDropdownPointers();
		}
		this.setupNative();
		this.setupNotices();
		this.setupNoticeFloat();
		this.setupNavFit();
		this.setupNoticeTimeout();
		this.setupStyleOrder();
		this.setupRangeFill();
		this.setupTreeFit();
		this.setupSearch();
		this.scheme.init();
		this.scale.init();
		this.editors.init();
		this.legacy.observe();
		this.loadRuntime();
		document.body.classList.remove('pw-init');
		document.body.classList.add('pw-ready');
	},

	/**
	 * A length token in px: tokens are built in rem (vite.config.ts), so the scale applies to them
	 *
	 * @param {string} name Custom property, e.g. '--pw-masthead-h'
	 * @param {number} fallback
	 * @returns {number}
	 */
	cssLength: function(name, fallback) {
		var root = getComputedStyle(document.documentElement);
		var value = root.getPropertyValue(name).trim();
		var n = parseFloat(value);
		if(/rem$/.test(value)) n *= parseFloat(root.fontSize) || 16;
		return n || fallback;
	},

	/**
	 * The user's display settings in this browser: colour scheme and scale. localStorage, under
	 * a key the server derives from the user (ProcessWire.config.AdminThemeBridge.prefsKey), so
	 * two users of one browser keep their own; each user's devices keep theirs. The last one
	 * written is also kept as pwPrefs.last, for the login screen (no user yet). The inline snippet
	 * in _head.php applies both before first paint with the same rules; a change in another tab
	 * or in a dialog's window arrives here as a storage event.
	 */
	prefs: {
		key: function() {
			return ProcessWireAdminTheme.config().prefsKey || 'pwPrefs.last';
		},
		read: function() {
			var o = null;
			try { o = JSON.parse(window.localStorage.getItem(this.key()) || 'null'); } catch(e) {}
			if(!o || typeof o !== 'object') {
				o = {};
				// 0.10.x and earlier: one scheme for the whole browser
				try { var old = window.localStorage.getItem('pwScheme'); if(old) o.scheme = old; } catch(e) {}
			}
			return o;
		},
		set: function(name, value) {
			var o = this.read();
			o[name] = value;
			try {
				var s = JSON.stringify(o);
				window.localStorage.setItem(this.key(), s);
				window.localStorage.setItem('pwPrefs.last', s);
				window.localStorage.removeItem('pwScheme');
			} catch(e) {}
		}
	},

	/**
	 * Interface scale: the root font size, in steps; everything the theme sizes in rem follows.
	 * Buttons [data-pw-scale="-1"] and [data-pw-scale="1"] beside the user menu.
	 */
	scale: {
		steps: [0.75, 0.875, 1, 1.125, 1.25, 1.375, 1.5],

		get: function() {
			var v = parseFloat(ProcessWireAdminTheme.prefs.read().scale);
			return this.steps.indexOf(v) > -1 ? v : 1;
		},

		apply: function() {
			var v = this.get();
			var root = document.documentElement;
			var before = root.style.fontSize;
			root.style.fontSize = v === 1 ? '' : (v * 100) + '%';
			var buttons = document.querySelectorAll('[data-pw-scale]');
			for(var i = 0; i < buttons.length; i++) {
				var dir = parseInt(buttons[i].getAttribute('data-pw-scale'), 10);
				var end = dir < 0 ? v <= this.steps[0] : v >= this.steps[this.steps.length - 1];
				buttons[i].disabled = end;
			}
			if(before !== root.style.fontSize) {
				// what measured the layout measures again (nav fit, notices, page tree, tables)
				window.dispatchEvent(new Event('resize'));
				document.dispatchEvent(new CustomEvent('pw-scale-change', { detail: { scale: v } }));
			}
		},

		step: function(dir) {
			var n = this.steps.indexOf(this.get()) + dir;
			if(n < 0 || n >= this.steps.length) return;
			ProcessWireAdminTheme.prefs.set('scale', this.steps[n]);
			this.apply();
		},

		init: function() {
			var self = this;
			this.apply();
			document.addEventListener('click', function(e) {
				var button = e.target.closest && e.target.closest('[data-pw-scale]');
				if(!button) return;
				e.preventDefault();
				self.step(parseInt(button.getAttribute('data-pw-scale'), 10) || 0);
			});
			window.addEventListener('storage', function(e) {
				if(e.key !== ProcessWireAdminTheme.prefs.key()) return;
				self.apply();
				ProcessWireAdminTheme.scheme.apply('toggle');
			});
		}
	},

	/**
	 * Colour scheme. The effective choice is the user's (prefs.scheme: auto, light, dark) or else
	 * the theme setting (ProcessWire.config.AdminThemeBridge.colorScheme); auto follows
	 * prefers-color-scheme. The inline snippet in _head.php applies it before first paint; this
	 * keeps it in sync and drives the toggle beside the user menu ([data-pw-scheme-toggle]).
	 */
	scheme: {
		order: ['auto', 'light', 'dark'],
		icons: { auto: 'adjust', light: 'sun-o', dark: 'moon-o' },
		media: null,

		setting: function() {
			var stored = ProcessWireAdminTheme.prefs.read().scheme;
			if(this.order.indexOf(stored) > -1) return stored;
			var cfg = ProcessWireAdminTheme.config().colorScheme;
			return this.order.indexOf(cfg) > -1 ? cfg : 'auto';
		},

		effective: function(setting) {
			if(setting !== 'auto') return setting;
			return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		},

		/**
		 * @param {string} [source] what changed it: 'toggle' (the user menu), 'system' (the OS
		 * scheme under auto); passed on as pw-scheme-change detail.source
		 */
		apply: function(source) {
			var setting = this.setting();
			var root = document.documentElement;
			var before = root.getAttribute('data-pw-scheme');
			var scheme = this.effective(setting);
			root.setAttribute('data-pw-scheme', scheme);
			if(before && before !== scheme) {
				document.dispatchEvent(new CustomEvent('pw-scheme-change', { detail: { scheme: scheme, source: source || 'toggle' } }));
			}
			var links = document.querySelectorAll('[data-pw-scheme-toggle]');
			for(var i = 0; i < links.length; i++) {
				var icon = links[i].querySelector('.fa');
				if(icon) icon.className = 'fa fa-fw fa-' + this.icons[setting];
				var text = links[i].getAttribute('data-label-' + setting) || setting;
				var label = links[i].querySelector('.pw-scheme-label');
				if(label) label.textContent = text;
				// an icon-only button: its name and tooltip say the scheme
				links[i].setAttribute('aria-label', text);
				links[i].title = text;
			}
		},

		cycle: function() {
			var next = this.order[(this.order.indexOf(this.setting()) + 1) % this.order.length];
			ProcessWireAdminTheme.prefs.set('scheme', next);
			this.apply('toggle');
		},

		init: function() {
			var self = this;
			this.apply();
			if(window.matchMedia) {
				this.media = window.matchMedia('(prefers-color-scheme: dark)');
				var onChange = function() { if(self.setting() === 'auto') self.apply('system'); };
				if(this.media.addEventListener) this.media.addEventListener('change', onChange);
			}
			document.addEventListener('click', function(e) {
				var toggle = e.target.closest('[data-pw-scheme-toggle]');
				if(!toggle) return;
				e.preventDefault();
				e.stopPropagation();
				self.cycle();
			}, true);
		}
	},

	/**
	 * Keep the theme sheets last. Field scripts that add a stylesheet at runtime (jsoneditor, the
	 * CKEditor and TinyMCE skins, InputfieldToggle's colours) append it to <head>, after theme.css
	 * and fields.css, where it would win every tie; move it in front of link[data-pw-theme], where
	 * the server prints module styles (docs/contract.md, ADR 0014). Arrival order is kept (each
	 * goes right before the theme sheet): CKEditor hides its editors with a <style> and reveals
	 * them with the skin stylesheet that follows it. The theme's own inline styles carry
	 * data-pw-keep and stay after it.
	 */
	setupStyleOrder: function() {
		var theme = document.querySelector('link[data-pw-theme]');
		if(!theme) return;
		var place = function(node) {
			if(node.parentNode !== document.head) return;
			var sheet = node.tagName === 'STYLE' || (node.tagName === 'LINK' && /(^|\s)stylesheet(\s|$)/i.test(node.rel));
			if(!sheet || node.hasAttribute('data-pw-theme') || node.hasAttribute('data-pw-fields') || node.hasAttribute('data-pw-keep')) return;
			if(theme.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) document.head.insertBefore(node, theme);
		};
		// added while the page was parsing (field scripts in the body run before this)
		Array.prototype.slice.call(document.head.children).forEach(place);
		if(!window.MutationObserver) return;
		new MutationObserver(function(records) {
			for(var i = 0; i < records.length; i++) {
				var added = records[i].addedNodes;
				for(var j = 0; j < added.length; j++) place(added[j]);
			}
		}).observe(document.head, { childList: true });
		// a stylesheet that arrives in the body (AJAX field markup, renderExtraMarkup('body')) would
		// win ties over the theme sheets by coming later: it goes to the same place (audit C37)
		// one copy each: content that comes again (a Lister refresh) brings its sheet again
		var same = function(a, b) {
			return a.tagName === b.tagName && (a.tagName === 'LINK' ? a.href === b.href : a.textContent === b.textContent);
		};
		var lift = function(node) {
			if(node.hasAttribute('data-pw-keep') || node.closest('svg, template, iframe')) return;
			var kept = Array.prototype.some.call(document.head.querySelectorAll('style, link[rel~="stylesheet"]'), function(h) { return same(h, node); });
			if(kept) node.parentNode.removeChild(node);
			else document.head.insertBefore(node, theme);
		};
		this.observe(function(records) {
			for(var i = 0; i < records.length; i++) {
				var added = records[i].addedNodes;
				for(var j = 0; j < added.length; j++) {
					var node = added[j];
					if(node.nodeType !== 1 || !node.isConnected || node.parentNode === document.head) continue;
					var sheets = node.matches('style, link[rel~="stylesheet"]') ? [node] : Array.prototype.slice.call(node.querySelectorAll('style, link[rel~="stylesheet"]'));
					sheets.forEach(lift);
				}
			}
		});
	},

	/**
	 * Range sliders: --pw-range-fill on each input[type=range] holds the filled share of the track
	 * (value between min and max, in %), which fields.css paints in the primary colour. WebKit has
	 * no ::-moz-range-progress, hence the script. Field scripts may set .value without an event
	 * (InputfieldFloatRange does from its value box), so any edit in the field updates its sliders,
	 * after the field's own handlers ran.
	 */
	setupRangeFill: function() {
		var fill = function(range) {
			var min = parseFloat(range.min), max = parseFloat(range.max), val = parseFloat(range.value);
			if(isNaN(min)) min = 0;
			if(isNaN(max)) max = 100;
			var share = max > min && !isNaN(val) ? Math.min(100, Math.max(0, (val - min) / (max - min) * 100)) : 0;
			range.style.setProperty('--pw-range-fill', share + '%');
		};
		var fillIn = function(root) {
			if(!root || !root.querySelectorAll) return;
			var ranges = root.querySelectorAll('input[type=range]');
			for(var i = 0; i < ranges.length; i++) fill(ranges[i]);
		};
		var onEdit = function(e) {
			var field = e.target && e.target.closest ? e.target.closest('.Inputfield') : null;
			if(!field || !field.querySelector('input[type=range]')) return;
			setTimeout(function() { fillIn(field); }, 0);
		};
		['input', 'change', 'focusout'].forEach(function(type) { document.addEventListener(type, onEdit); });
		fillIn(document);
		// fields loaded later (AJAX fields, repeater items, an in-place save)
		document.addEventListener('pw-page-saved', function() { fillIn(document); });
		var bindReloaded = function() {
			if(!window.jQuery || bindReloaded.done) return;
			bindReloaded.done = true;
			jQuery(document).on('reloaded', '.Inputfield', function() { fillIn(this); });
		};
		bindReloaded();
		document.addEventListener('pw-legacy-loaded', bindReloaded);
	},

	/**
	 * Page tree: the deepest open branch scrolls instead of running past the bottom of the screen
	 * (30-pagelist.css). --pw-branch-max fits it to the space below its top, measured from the
	 * opened item (the branch itself is still hidden while it loads), whenever branches open or
	 * close and on resize: at least about six rows, at most the screen below the masthead. A branch
	 * that then overflows gets .pw-branch-scrolls (scrollbar on its left, as a separator); a
	 * ResizeObserver catches the end of the slide-in, which adds no nodes.
	 */
	setupTreeFit: function() {
		if(!window.MutationObserver) return;
		var pending = false;
		var resized = window.ResizeObserver ? new ResizeObserver(function() { schedule(); }) : null;
		var fit = function() {
			pending = false;
			var lists = document.querySelectorAll('.PageListRoot .PageList');
			var masthead = ProcessWireAdminTheme.cssLength('--pw-masthead-h', 56);
			var vh = window.innerHeight;
			// reads, then writes, then reads, then writes: two layouts per fit, not two per branch
			// (audit P4)
			var deepest = [], tops = [], i;
			for(i = 0; i < lists.length; i++) {
				if(lists[i].querySelector('.PageList')) {
					// not the deepest: no cap (CSS), no scrollbar
					lists[i].classList.remove('pw-branch-scrolls');
					continue;
				}
				var item = lists[i].previousElementSibling;
				deepest.push(lists[i]);
				tops.push(item && item.classList.contains('PageListItem') ? item.getBoundingClientRect().bottom : lists[i].getBoundingClientRect().top);
			}
			for(i = 0; i < deepest.length; i++) {
				var room = vh - Math.max(tops[i], masthead) - 16;
				deepest[i].style.setProperty('--pw-branch-max', Math.round(Math.max(180, Math.min(room, vh - masthead - 40))) + 'px');
			}
			var scrolls = deepest.map(function(list) { return list.scrollHeight > list.clientHeight + 1; });
			for(i = 0; i < deepest.length; i++) {
				var list = deepest[i];
				list.classList.toggle('pw-branch-scrolls', scrolls[i]);
				if(resized && !list.pwFitObserved) {
					list.pwFitObserved = true;
					resized.observe(list);
				}
			}
		};
		var schedule = function() {
			if(pending) return;
			pending = true;
			window.requestAnimationFrame(fit);
		};
		var inTree = function(nodes) {
			for(var i = 0; i < nodes.length; i++) {
				var n = nodes[i];
				if(n.nodeType === 1 && (n.classList.contains('PageList') || n.classList.contains('PageListItem'))) return true;
			}
			return false;
		};
		this.observe(function(records) {
			for(var i = 0; i < records.length; i++) {
				if(inTree(records[i].addedNodes) || inTree(records[i].removedNodes)) return schedule();
			}
		});
		window.addEventListener('resize', schedule);
		schedule();
	},

	/**
	 * Rich-text editors paint their content in iframes, out of reach of the page CSS (fields.css
	 * styles their chrome). Each gets the scheme's colours as a small stylesheet built from the
	 * tokens resolved on <html>: CKEditor 4 has it written into its editing and panel iframes
	 * (live, on every scheme change); TinyMCE 6 gets it as content_style together with the
	 * shipped oxide-dark skin when it initialises, and its editors are re-created on a change.
	 */
	editors: {

		init: function() {
			var self = this;
			this.ckeditor();
			this.tinymce();
			// editors whose scripts arrive with the legacy stack (loaded on demand)
			document.addEventListener('pw-legacy-loaded', function() { self.ckeditor(); self.tinymce(); });
			document.addEventListener('pw-scheme-change', function(e) { self.refresh(e.detail && e.detail.source); });
		},

		dark: function() {
			return document.documentElement.getAttribute('data-pw-scheme') === 'dark';
		},

		token: function(name) {
			return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		},

		/** editing area: the content on a card */
		css: function() {
			// one computed style for all tokens of the sheet (P4: one per token before)
			var root = getComputedStyle(document.documentElement);
			var t = function(name) { return root.getPropertyValue(name).trim(); };
			return 'html{color-scheme:' + (this.dark() ? 'dark' : 'light') + '}' +
				'html body{background:' + t('--card') + ';color:' + t('--foreground') + '}' +
				'body :is(h1,h2,h3,h4,h5,h6,strong,b){color:' + t('--foreground') + '}' +
				'body a{color:' + t('--primary') + '}' +
				'body :is(table,td,th,hr){border-color:' + t('--border') + '}' +
				'body blockquote{border-left-color:' + t('--border') + ';color:' + t('--muted-foreground') + '}' +
				'body :is(pre,code){background:' + t('--muted') + ';color:' + t('--foreground') + '}' +
				'body figcaption{color:' + t('--muted-foreground') + '}';
		},

		/** CKEditor dropdown panels (Format, Styles): a popover */
		panelCss: function() {
			var t = this.token.bind(this);
			return 'html{color-scheme:' + (this.dark() ? 'dark' : 'light') + '}' +
				'html body{background:' + t('--popover') + ';color:' + t('--popover-foreground') + '}' +
				'.cke_panel_grouptitle{background:' + t('--muted') + ';border-color:' + t('--border') + ';color:' + t('--foreground') + '}' +
				'.cke_panel_listItem a,.cke_panel_listItem a *{color:' + t('--popover-foreground') + '}' +
				'.cke_panel_listItem.cke_selected a,.cke_panel_listItem a:hover,.cke_panel_listItem a:focus,.cke_panel_listItem a:active{background:' + t('--accent') + ';border-color:' + t('--border') + '}';
		},

		write: function(doc, css) {
			if(!doc || !doc.head) return;
			var el = doc.getElementById('pw-scheme');
			if(!el) {
				el = doc.createElement('style');
				el.id = 'pw-scheme';
				doc.head.appendChild(el);
			}
			if(el.textContent !== css) el.textContent = css;
			if(el !== doc.head.lastElementChild) doc.head.appendChild(el);
		},

		ckeditor: function() {
			var self = this;
			var CK = window.CKEDITOR;
			if(!CK || CK.pwScheme) return;
			CK.pwScheme = true;
			var hook = function(editor) {
				var apply = function() { self.ckApply(editor); };
				editor.on('contentDom', apply);
				editor.on('mode', apply);
				editor.on('panelShow', function() {
					self.ckPanels();
					setTimeout(function() { self.ckPanels(); }, 50);
				});
				apply();
			};
			CK.on('instanceReady', function(e) { hook(e.editor); });
			for(var name in CK.instances) {
				if(CK.instances[name].status === 'ready') hook(CK.instances[name]);
			}
		},

		ckApply: function(editor) {
			// inline editors edit in the page itself (fields.css)
			if(editor.elementMode === window.CKEDITOR.ELEMENT_MODE_INLINE) return;
			if(editor.mode !== 'wysiwyg' || !editor.document) return;
			this.write(editor.document.$, this.css());
		},

		ckPanels: function() {
			var frames = document.querySelectorAll('iframe.cke_panel_frame');
			for(var i = 0; i < frames.length; i++) {
				try { this.write(frames[i].contentDocument, this.panelCss()); } catch(e) {}
			}
		},

		tinymce: function() {
			var self = this;
			var MCE = window.InputfieldTinyMCE;
			if(!MCE || MCE.pwScheme || typeof MCE.onConfig !== 'function') return;
			MCE.pwScheme = true;
			MCE.onConfig(function(settings) {
				if(settings.inline) return; // edits in the page itself (fields.css)
				// the two shipped skins that have a dark twin; a custom skin_url is left alone
				if(!settings.skin_url) {
					var skin = String(settings.skin || 'oxide').replace(/-dark$/, '');
					if(skin === 'oxide' || skin === 'tinymce-5') settings.skin = self.dark() ? skin + '-dark' : skin;
				}
				settings.content_style = (settings.content_style || '') + self.css();
			});
		},

		/**
		 * @param {string} [source] pw-scheme-change detail.source
		 */
		refresh: function(source) {
			var self = this;
			var CK = window.CKEDITOR;
			if(CK && CK.pwScheme) {
				for(var name in CK.instances) this.ckApply(CK.instances[name]);
				this.ckPanels();
			}
			var MCE = window.InputfieldTinyMCE;
			if(!MCE || !MCE.pwScheme || !window.jQuery || !window.tinymce) return;
			// re-creating a TinyMCE editor loses its caret, undo history and resized height: on the
			// user's toggle at once, on an OS switch under auto (sunset) only once no editor has focus
			var active = window.tinymce.activeEditor;
			if(source === 'system' && active && active.hasFocus && active.hasFocus()) {
				if(this.mcePending) return;
				this.mcePending = true;
				active.once('blur', function() {
					self.mcePending = false;
					setTimeout(function() { self.refresh('system'); }, 0);
				});
				return;
			}
			// re-create the classic editors: the skin is chosen at init
			var $editors = jQuery('.' + MCE.cls.loaded).not('.' + MCE.cls.inline);
			$editors.each(function() {
				var editor = window.tinymce.get(this.id);
				if(editor) editor.save();
			});
			if($editors.length) MCE.resetEditors($editors);
		}
	},

	/**
	 * The component runtime (assets/dist/runtime.js, ES module): custom elements and the
	 * jQuery-free Inputfield behaviours. Loaded on every page; it stays passive when the
	 * legacy stack owns the page. A classic loader because admin themes print only classic
	 * <script> tags for module assets.
	 */
	loadRuntime: function() {
		var url = this.config().runtimeUrl;
		if(!url) return;
		import(url).catch(function(err) {
			console.error('Bridge: runtime failed to load', err);
		});
	},

	config: function() {
		var pw = window.ProcessWire || {};
		var cfg = pw.config || {};
		return cfg.AdminThemeBridge || {};
	},

	/**
	 * Remove #notices with a short fade (none under prefers-reduced-motion).
	 */
	removeNotices: function(notices) {
		if(!notices || !notices.parentNode) return;
		if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return notices.remove();
		notices.style.transition = 'opacity 150ms';
		notices.style.opacity = '0';
		setTimeout(function() { notices.remove(); }, 160);
	},

	/**
	 * Notices from a page save go away after 10 s: an in-place save (pw-page-saved) or a classic
	 * one (the editor reloaded with ?s=1). The countdown pauses while the pointer is over the
	 * notices or focus is inside them, and resumes with the time that was left. Notices that
	 * include an error stay until closed. Other screens keep their notices.
	 */
	setupNoticeTimeout: function() {
		var self = this;
		var delay = 10000;
		var arm = function() {
			var notices = document.getElementById('notices');
			if(!notices || !notices.querySelector('li') || notices.querySelector('.NoticeError, .pw-notice-error')) return;
			var left = delay, started = 0, timer = null, hover = false, focus = false;
			var run = function() {
				if(timer || hover || focus) return;
				started = Date.now();
				timer = setTimeout(function() { self.removeNotices(notices); }, left);
			};
			var pause = function() {
				if(!timer) return;
				clearTimeout(timer);
				timer = null;
				left = Math.max(0, left - (Date.now() - started));
			};
			notices.addEventListener('mouseenter', function() { hover = true; pause(); });
			notices.addEventListener('mouseleave', function() { hover = false; run(); });
			notices.addEventListener('focusin', function() { focus = true; pause(); });
			notices.addEventListener('focusout', function(e) {
				if(e.relatedTarget && notices.contains(e.relatedTarget)) return;
				focus = false;
				run();
			});
			run();
		};
		document.addEventListener('pw-page-saved', arm);
		if(document.getElementById('ProcessPageEdit') && /[?&]s=1(&|$)/.test(location.search)) arm();
	},

	/**
	 * Notices laid over the band (14-notices.css) must fit its one row: a message that wraps (a
	 * narrow screen, a long text, debug prefixes) would cover the breadcrumbs, the title and the
	 * head buttons (the copied Save). Measured whenever the list changes size or is replaced;
	 * body.pw-notices-static puts it into the flow (audit C1).
	 */
	setupNotices: function() {
		var body = document.body;
		var watched = null;
		var resize = window.ResizeObserver ? new ResizeObserver(function() { check(); }) : null;
		var row = function() {
			return ProcessWireAdminTheme.cssLength('--pw-notice-row', 42);
		};
		var check = function() {
			var notices = document.getElementById('notices');
			if(notices !== watched) {
				if(resize && watched) resize.unobserve(watched);
				watched = notices;
				if(resize && notices) resize.observe(notices);
			}
			var tall = false;
			if(notices && !body.classList.contains('modal')) {
				var items = notices.querySelectorAll(':scope > li');
				var max = row() + 1; // one style read per check, not one per notice (P4)
				for(var i = 0; i < items.length; i++) {
					if(items[i].offsetHeight > max) { tall = true; break; }
				}
			}
			body.classList.toggle('pw-notices-static', tall);
		};
		check();
		// a new list (an in-place save swaps it, a close removes it); size changes come by resize
		this.observe(function() {
			if(document.getElementById('notices') !== watched) check();
		});
		var frame = 0;
		window.addEventListener('resize', function() {
			if(frame) return;
			frame = window.requestAnimationFrame(function() { frame = 0; check(); });
		});
	},

	/**
	 * Notices that arrive while their place at the top is scrolled out of view (a Save at the
	 * bottom of a long editor, saved in place; a client-side warning) would go unseen: the list is
	 * fixed just below the sticky masthead (#notices.pw-notices-fixed, 14-notices.css) until it is
	 * closed or removed, or the page is scrolled back to the top, where it goes back to its place.
	 * Checked when a list appears or gets another item, never on scroll alone; scripts/page-save.js
	 * calls floatNotices() at once after a swap, before it puts the scroll back.
	 */
	floatNotices: function() {},

	setupNoticeFloat: function() {
		var body = document.body;
		if(body.classList.contains('modal') || body.classList.contains('ProcessLogin')) return;
		var watched = null;
		var count = 0;
		var unfix = function() {
			if(window.scrollY > 0) return;
			window.removeEventListener('scroll', unfix);
			if(watched) watched.classList.remove('pw-notices-fixed');
		};
		var check = function() {
			var notices = document.getElementById('notices');
			var items = notices ? notices.querySelectorAll(':scope > li').length : 0;
			var fresh = notices !== watched || items > count;
			watched = notices;
			count = items;
			if(!fresh || !notices || !items || notices.classList.contains('pw-notices-fixed')) return;
			var masthead = document.getElementById('pw-masthead');
			var top = masthead ? masthead.getBoundingClientRect().bottom : 0;
			if(notices.getBoundingClientRect().top >= top) return;
			notices.classList.add('pw-notices-fixed');
			window.addEventListener('scroll', unfix, { passive: true });
		};
		check();
		this.floatNotices = check;
		this.observe(check);
	},

	/**
	 * The top bar switches to the drawer (as below 960px) when its items do not fit: seven or eight
	 * sections, long translated labels, 200 % zoom. Measured with the bar laid out (the class off)
	 * on load and on resize; body.pw-nav-overflow (90-responsive.css; audit C4).
	 */
	setupNavFit: function() {
		var body = document.body;
		var nav = document.getElementById('pw-nav');
		var list = nav ? nav.querySelector('.pw-primary-nav') : null;
		if(!list) return;
		var pending = false;
		var fit = function() {
			pending = false;
			if(window.matchMedia && window.matchMedia('(max-width: 959px)').matches) {
				body.classList.remove('pw-nav-overflow');
				return;
			}
			body.classList.remove('pw-nav-overflow');
			var over = list.scrollWidth > nav.clientWidth + 1;
			body.classList.toggle('pw-nav-overflow', over);
		};
		var schedule = function() {
			if(pending) return;
			pending = true;
			window.requestAnimationFrame(fit);
		};
		fit();
		window.addEventListener('resize', schedule);
		// web fonts change the labels' widths once they arrive
		if(document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
	},

	/**
	 * Upstream's dropdowns on legacy pages: below 960px the primary nav is the drawer, whose
	 * sections are lists, not menus; upstream would take each section's menu out to <body> as a
	 * floating jQuery UI menu. Its toggles lose pw-dropdown-toggle before ProcessWireAdmin.init().
	 * Open menus close on scroll: upstream places them once, in document coordinates, while the
	 * masthead stays (audit C6).
	 */
	prepareUpstreamNav: function() {
		var narrow = window.matchMedia && window.matchMedia('(max-width: 959px)').matches;
		if(narrow || document.body.classList.contains('pw-nav-overflow')) {
			var toggles = document.querySelectorAll('.pw-primary-nav > li > a.pw-dropdown-toggle');
			for(var i = 0; i < toggles.length; i++) toggles[i].classList.remove('pw-dropdown-toggle');
		}
		if(this.upstreamScrollClose) return;
		this.upstreamScrollClose = true;
		// a menu closes once the page has scrolled 40px since it opened (not on the small scroll
		// adjustments a save or a focus makes)
		var timer = null;
		window.addEventListener('scroll', function() {
			if(timer) return;
			timer = setTimeout(function() {
				timer = null;
				if(!window.jQuery) return;
				jQuery('body > ul.pw-dropdown-menu:visible, body > .pw-dropdown-menu.prnav:visible').each(function() {
					if(this.pwScrollY === undefined) this.pwScrollY = window.scrollY;
					if(Math.abs(window.scrollY - this.pwScrollY) < 40) return;
					this.pwScrollY = undefined;
					jQuery(this).hide();
					jQuery('.pw-dropdown-toggle.hover, .pw-dropdown-toggle-open').removeClass('hover pw-dropdown-toggle-open');
				});
			}, 50);
		}, { passive: true });
		if(window.jQuery) jQuery(document).on('pw-show-dropdown', '.pw-dropdown-menu', function() { this.pwScrollY = window.scrollY; });
	},

	/**
	 * A flyout (submenu) gets the height left below its own top and opens to the left when there
	 * is no room on the right (12-dropdowns.css --pw-flyout-max, .pw-flyout-left; audit C5).
	 * A flyout inside a flyout is position: fixed (its parent scrolls and would clip it), so it
	 * gets its coordinates here, measured against its containing block (the masthead's
	 * backdrop-filter makes that the masthead, not the viewport).
	 *
	 * @param {HTMLElement} li the item whose <ul> opens
	 */
	fitFlyout: function(li) {
		var ul = li.querySelector(':scope > ul');
		if(!ul) return;
		var r = li.getBoundingClientRect();
		var w = ul.offsetWidth || 200;
		var left = r.right + w + 8 > window.innerWidth && r.left - w - 8 > 0;
		ul.style.setProperty('--pw-flyout-max', Math.max(160, Math.round(window.innerHeight - r.top - 16)) + 'px');
		ul.classList.toggle('pw-flyout-left', left);
		var cs = getComputedStyle(ul);
		if(cs.position !== 'fixed') return;
		ul.style.left = '0px';
		ul.style.top = '0px';
		var o = ul.getBoundingClientRect(); // the containing block's origin plus the margins
		var x = left ? r.left - parseFloat(cs.marginRight) - w : r.right + parseFloat(cs.marginLeft);
		ul.style.left = Math.round(x - o.left) + 'px';
		ul.style.top = Math.round(r.top - o.top + parseFloat(cs.marginTop)) + 'px';
	},

	/**
	 * Native handlers for the shell's widgets. Dropdowns and notice groups step aside as soon as
	 * upstream owns the page (upstream()), because upstream main.js then owns .pw-dropdown-toggle
	 * and .pw-notice-group-toggle; closing notices and the mobile nav are always the theme's.
	 */
	setupNative: function() {
		var self = this;
		// close all notices: theme-owned on every page (core main.js only toggles notice groups;
		// closing is each admin theme's job, AdminThemeUikit binds a.notice-remove itself)
		document.addEventListener('click', function(e) {
			var remove = e.target.closest('#notices .pw-notice-remove, #notices .notice-remove');
			if(!remove) return;
			e.preventDefault();
			self.removeNotices(remove.closest('#notices'));
		});
		// mobile nav toggle: theme-owned, works with and without jQuery
		document.addEventListener('click', function(e) {
			var navToggle = e.target.closest('.pw-nav-toggle');
			if(navToggle) {
				e.preventDefault();
				var open = document.body.classList.toggle('pw-nav-open');
				navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
			} else if(document.body.classList.contains('pw-nav-open') && !e.target.closest('.pw-nav')) {
				document.body.classList.remove('pw-nav-open');
			}
		});
		// dropdowns (native pages only: with the stack, upstream main.js owns .pw-dropdown-toggle).
		// Hover opens like upstream; click toggles; .pw-dropdown-toggle-click is click-only. On touch
		// the browser fires a compatibility mouseover before the click: it is ignored, so the first
		// tap opens the menu and a second one follows the link (upstream main.js does the same with
		// its touch-device class; audit C3)
		var hoverTimer = null;
		var touchUntil = 0;
		var hovered = null; // a menu the pointer opened: the click that follows keeps it open
		document.addEventListener('pointerdown', function(e) {
			touchUntil = e.pointerType === 'touch' || e.pointerType === 'pen' ? Date.now() + 1000 : 0;
		}, true);
		document.addEventListener('mouseover', function(e) {
			if(self.upstream() || Date.now() < touchUntil) return;
			var toggle = e.target.closest('.pw-dropdown-toggle:not(.pw-dropdown-toggle-click)');
			if(toggle) {
				clearTimeout(hoverTimer);
				var menu = self.dropdownMenu(toggle);
				if(menu && menu.style.display === 'none') { self.openDropdown(toggle, menu); hovered = menu; }
				return;
			}
			var item = e.target.closest('.pw-dropdown-menu li');
			if(item && item.querySelector(':scope > ul')) self.fitFlyout(item);
			var ajax = e.target.closest('.pw-dropdown-menu a.pw-has-ajax-items');
			if(ajax) self.loadNavJSON(ajax);
			if(e.target.closest('.pw-dropdown-menu, .pw-dropdown-toggle')) clearTimeout(hoverTimer);
		});
		// keyboard: Arrow Down on a toggle opens its menu at the first item; focus inside a menu keeps
		// a flyout open (12-dropdowns.css :focus-within)
		document.addEventListener('keydown', function(e) {
			if(self.upstream() || e.key !== 'ArrowDown') return;
			var toggle = e.target.closest && e.target.closest('.pw-dropdown-toggle');
			if(!toggle) return;
			var menu = self.dropdownMenu(toggle);
			if(!menu) return;
			e.preventDefault();
			self.openDropdown(toggle, menu);
			var first = menu.querySelector('a[href], a[data-pw-dropdown-value]');
			if(first) first.focus();
		});
		document.addEventListener('focusin', function(e) {
			if(self.upstream()) return;
			var item = e.target.closest && e.target.closest('.pw-dropdown-menu li');
			if(item && item.querySelector(':scope > ul')) self.fitFlyout(item);
			if(item && item.querySelector('a.pw-has-ajax-items')) self.loadNavJSON(item.querySelector('a.pw-has-ajax-items'));
		});
		// a flyout that scrolls takes its open fixed flyouts along
		document.addEventListener('scroll', function(e) {
			if(self.upstream() || !e.target.closest || !e.target.closest('.pw-dropdown-menu')) return;
			var open = e.target.querySelectorAll('li:hover, li:focus-within');
			for(var i = 0; i < open.length; i++) self.fitFlyout(open[i]);
		}, true);
		document.addEventListener('mouseout', function(e) {
			if(self.upstream()) return;
			if(!e.target.closest('.pw-dropdown-menu, .pw-dropdown-toggle')) return;
			var to = e.relatedTarget;
			if(to && to.closest && to.closest('.pw-dropdown-menu, .pw-dropdown-toggle')) return;
			clearTimeout(hoverTimer);
			hoverTimer = setTimeout(function() { self.closeDropdowns(); }, 400);
		});
		document.addEventListener('click', function(e) {
			if(self.upstream()) return;
			var toggle = e.target.closest('.pw-dropdown-toggle');
			if(toggle) {
				var menu = self.dropdownMenu(toggle);
				// a hover already opened it: follow the link on click, as upstream does
				if(menu && menu.style.display !== 'none' && toggle.tagName === 'A' && !toggle.classList.contains('pw-dropdown-toggle-click')) return;
				e.preventDefault();
				var open = menu && menu.style.display !== 'none';
				if(open && hovered === menu) { hovered = null; return; }
				hovered = null;
				self.closeDropdowns();
				if(menu && !open) self.openDropdown(toggle, menu);
				return;
			}
			if(!e.target.closest('.pw-dropdown-menu')) self.closeDropdowns();
			var group = e.target.closest('.pw-notice-group-toggle');
			if(group) {
				e.preventDefault();
				var parent = group.closest('.pw-notice-group-parent');
				var opened = parent.classList.toggle('pw-notice-group-open');
				for(var n = parent.nextElementSibling; n && !n.classList.contains('pw-notice-group-parent'); n = n.nextElementSibling) {
					n.style.display = opened ? 'block' : 'none';
				}
				var icons = parent.querySelectorAll('i[data-toggle]');
				for(var k = 0; k < icons.length; k++) {
					var el = icons[k];
					el.getAttribute('data-toggle').split(' ').forEach(function(c) { el.classList.toggle(c); });
				}
			}
		});
		document.addEventListener('keydown', function(e) {
			if(self.upstream()) return;
			var menu = e.target.closest && e.target.closest('.pw-dropdown-menu:not(.pw-search-results)');
			if(e.key === 'Escape') {
				// from inside a menu, back to its toggle (audit U3)
				var toggle = self.openToggle;
				self.closeDropdowns();
				if(menu && toggle) toggle.focus();
				return;
			}
			// arrows move between the items of the menu level that has the focus
			if(!menu || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
			var ul = e.target.closest('ul');
			var links = Array.prototype.filter.call(ul.querySelectorAll(':scope > li > a'), function(a) { return a.offsetParent !== null; });
			var next = links[(links.indexOf(e.target.closest('a')) + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length];
			if(next) { e.preventDefault(); next.focus(); }
		});
		// the focus leaving a menu and its toggle closes it (Tab past the last item)
		document.addEventListener('focusout', function(e) {
			if(self.upstream() || !self.openToggle) return;
			var sel = '.pw-dropdown-menu, .pw-dropdown-toggle';
			var to = e.relatedTarget;
			if(to && to.closest && to.closest(sel)) return;
			if(e.target.closest && e.target.closest(sel)) self.closeDropdowns();
		});
	},

	/**
	 * Native counterpart of upstream's AJAX submenus: fill the empty <ul> after an
	 * a.pw-has-ajax-items[data-json] from the Process's navJSON endpoint, once
	 */
	loadNavJSON: function(a) {
		var self = this;
		if(a.classList.contains('pw-ajax-items-loaded')) return;
		a.classList.add('pw-ajax-items-loaded');
		var ul = a.nextElementSibling;
		if(!ul || ul.tagName !== 'UL') return;
		var esc = function(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
		var icon = function(name) { return name ? '<i class="fa fa-fw fa-' + esc(name) + ' ui-priority-secondary"></i>' : ''; };
		fetch(a.getAttribute('data-json'), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
			.then(function(r) { return r.json(); })
			.then(function(data) {
				if(!data || !data.list) return;
				var html = '';
				if(data.add) {
					var addUrl = data.add.url.indexOf('/') === 0 ? data.add.url : data.url + data.add.url;
					html += '<li class="add"><a href="' + esc(addUrl) + '">' + icon(data.add.icon) + data.add.label + '</a></li>';
				}
				data.list.forEach(function(item) {
					var url = item.url === 'navJSON' ? '' : (item.url.indexOf('/') === 0 ? item.url : (item.url ? data.url + item.url : ''));
					var href = url ? ' href="' + esc(url) + '"' : '';
					var label = icon(item.icon) + item.label; // server markup, entity-encoded upstream (Process::executeNavJSON)
					if(item.navJSON) {
						html += '<li><a class="pw-has-items pw-has-ajax-items" data-json="' + esc(item.navJSON) + '"' + href + '>' + label + '</a><ul></ul></li>';
					} else {
						html += '<li' + (item.className ? ' class="' + esc(item.className) + '"' : '') + '><a' + href + '>' + label + '</a></li>';
					}
				});
				ul.innerHTML = html;
				ul.classList.add('navJSON');
				// placed while still empty: place it again now that it has its size
				if(a.parentNode.matches(':hover, :focus-within')) self.fitFlyout(a.parentNode);
			})
			.catch(function() { a.classList.remove('pw-ajax-items-loaded'); });
	},

	dropdownMenu: function(toggle) {
		// data-pw-dropdown names the menu by a selector (the page editor's View tab: its menu is
		// printed after the form, hidden by scripts/page-edit.js)
		var target = toggle.getAttribute('data-pw-dropdown');
		if(target) {
			try { return document.querySelector(target); } catch(e) { return null; }
		}
		var next = toggle.nextElementSibling;
		if(next && next.classList.contains('pw-dropdown-menu')) return next;
		var wrap = toggle.closest('.pw-dropdown');
		return wrap ? wrap.querySelector('.pw-dropdown-menu') : null;
	},

	/**
	 * Open a toggle's menu, the others closed. A menu away from its toggle (data-pw-dropdown) is
	 * put under the toggle's link, its left edge with the link's and kept inside the window; it
	 * stays absolute, so it scrolls with the page (the same arithmetic as fitFlyout())
	 */
	openDropdown: function(toggle, menu) {
		this.closeDropdowns();
		menu.style.display = 'block';
		toggle.setAttribute('aria-expanded', 'true');
		this.openToggle = toggle;
		var wrap = toggle.closest('.pw-dropdown');
		if(menu === toggle.nextElementSibling || (wrap && wrap.contains(menu))) return;
		var r = (toggle.closest('a, button') || toggle).getBoundingClientRect();
		var cs = getComputedStyle(menu);
		menu.style.left = '0px';
		menu.style.top = '0px';
		var o = menu.getBoundingClientRect();
		var x = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8));
		menu.style.left = Math.round(x - o.left) + 'px';
		menu.style.top = Math.round(r.bottom - o.top + parseFloat(cs.marginTop)) + 'px';
	},

	closeDropdowns: function() {
		var menus = document.querySelectorAll('.pw-dropdown-menu:not(.pw-search-results)');
		for(var i = 0; i < menus.length; i++) menus[i].style.display = 'none';
		var open = document.querySelectorAll('.pw-dropdown-toggle[aria-expanded="true"]');
		for(var j = 0; j < open.length; j++) open[j].setAttribute('aria-expanded', 'false');
		this.openToggle = null;
	},

	/**
	 * Live search in the masthead, framework-free (AdminThemeUikit does this with a jQuery UI
	 * autocomplete in its own main.js, so upstream markup alone has none): the ProcessPageSearch
	 * form's data-action answers JSON {matches: [{type, title, editUrl, template_label, tip, icon,
	 * unpublished, hidden}]}. Results group by type; arrows move, Enter opens, Escape closes; Enter
	 * with nothing selected submits the form to the full search page as before.
	 */
	setupSearch: function() {
		var form = document.getElementById('ProcessPageSearchForm');
		var input = document.getElementById('ProcessPageSearchQuery');
		if(!form || !input || !form.getAttribute('data-action')) return;
		input.setAttribute('autocomplete', 'off');
		var menu = document.createElement('ul');
		menu.className = 'pw-dropdown-menu pw-search-results';
		menu.style.display = 'none';
		menu.setAttribute('role', 'listbox');
		form.appendChild(menu);
		var timer = null, seq = 0, active = -1;

		function links() { return menu.querySelectorAll('a'); }
		function close() { menu.style.display = 'none'; active = -1; }
		function mark(i) {
			var a = links();
			if(!a.length) return;
			if(active > -1 && a[active]) a[active].classList.remove('pw-active');
			active = (i + a.length) % a.length;
			a[active].classList.add('pw-active');
			a[active].scrollIntoView({ block: 'nearest' });
		}
		function render(matches) {
			menu.textContent = '';
			active = -1;
			var type = null;
			if(!matches.length) {
				var none = document.createElement('li');
				none.className = 'pw-search-none';
				none.textContent = '\u2014';
				menu.appendChild(none);
			}
			matches.forEach(function(m) {
				if(m.type !== type) {
					type = m.type;
					var h = document.createElement('li');
					h.className = 'pw-search-type';
					h.textContent = type;
					menu.appendChild(h);
				}
				var li = document.createElement('li');
				var a = document.createElement('a');
				if(m.editUrl && m.editUrl !== '#') a.href = m.editUrl;
				if(m.tip) a.title = m.tip;
				var label = document.createElement('span');
				if(m.unpublished) label.className = 'pw-search-unpublished';
				else if(m.hidden) label.className = 'pw-search-hidden';
				if(m.icon) {
					var i = document.createElement('i');
					i.className = 'fa fa-fw fa-' + String(m.icon).replace(/[^a-z0-9-]/gi, '');
					a.appendChild(i);
				}
				label.textContent = m.title;
				a.appendChild(label);
				if(m.template_label && m.template_label !== m.title) {
					var small = document.createElement('small');
					small.textContent = m.template_label;
					a.appendChild(small);
				}
				li.appendChild(a);
				menu.appendChild(li);
			});
			menu.style.display = 'block';
		}
		function search() {
			var term = input.value.trim();
			if(term.length < 2) { close(); return; }
			var mine = ++seq;
			form.classList.add('pw-searching');
			fetch(form.getAttribute('data-action') + '?q=' + encodeURIComponent(term), {
				headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' },
				credentials: 'same-origin'
			}).then(function(r) { return r.json(); }).then(function(data) {
				if(mine !== seq) return;
				form.classList.remove('pw-searching');
				if(document.activeElement !== input) return;
				render(data && data.matches ? data.matches : []);
			}).catch(function() {
				if(mine === seq) form.classList.remove('pw-searching');
			});
		}
		input.addEventListener('input', function() {
			clearTimeout(timer);
			timer = setTimeout(search, 250);
		});
		input.addEventListener('focus', function() {
			if(menu.children.length && input.value.trim().length > 1) menu.style.display = 'block';
		});
		input.addEventListener('keydown', function(e) {
			var open = menu.style.display !== 'none';
			if(e.key === 'ArrowDown' && open) { e.preventDefault(); mark(active + 1); }
			else if(e.key === 'ArrowUp' && open) { e.preventDefault(); mark(active - 1); }
			else if(e.key === 'Escape') { close(); }
			else if(e.key === 'Enter' && open && active > -1) {
				var a = links()[active];
				e.preventDefault();
				if(a && a.href) window.location.href = a.href;
			}
		});
		// close when focus leaves the form (a click on a result lands before the blur timer)
		input.addEventListener('blur', function() { setTimeout(function() {
			if(!form.contains(document.activeElement)) close();
		}, 200); });
		menu.addEventListener('mousedown', function(e) { e.preventDefault(); });
	},

	/**
	 * Upstream main.js hides a hover menu the instant the pointer leaves it (ul mouseleave), even
	 * when the pointer goes back onto the menu's own toggle; the toggle's mouseenter then reopens
	 * it, so the menu blinks, and with Firefox's late hover updates it can stay closed. Replace that
	 * one handler (only upstream's un-namespaced mouseleave on hover menus, never jQuery UI's) with
	 * a short grace period that keeps the menu while the pointer is on the menu or its toggle.
	 * Click toggles (pw-dropdown-toggle-click) keep upstream's own 1 s logic.
	 *
	 * @param {HTMLElement} ul
	 * @param {HTMLElement} toggle
	 */
	patchHoverLeave: function(ul, toggle) {
		if(ul.__pwHoverPatched || toggle.classList.contains('pw-dropdown-toggle-click')) return;
		ul.__pwHoverPatched = true;
		var $ = window.jQuery, $ul = $(ul);
		var events = $._data(ul, 'events') || {};
		// jQuery files mouseleave handlers under 'mouseout' (special event) with origType 'mouseleave'
		(events.mouseout || []).filter(function(h) { return h.origType === 'mouseleave' && !h.namespace; }).forEach(function(h) {
			$ul.off('mouseleave', h.handler);
		});
		var timer = null;
		var hovered = function() { return ul.matches(':hover') || toggle.matches(':hover'); };
		$ul.on('mouseleave.pwbridge', function() {
			clearTimeout(timer);
			timer = setTimeout(function() {
				if(hovered()) return;
				$ul.find('ul').hide();
				$ul.hide();
				$(toggle).removeClass('hover');
			}, 200);
		}).on('mouseenter.pwbridge', function() { clearTimeout(timer); });
	},

	/**
	 * Click menus (pw-dropdown-toggle-click: button dropdowns such as Save) can be shared by two
	 * toggles, the form button and its head copy. Upstream gives each toggle a 1 s leave timer that
	 * only checks its own toggle and the menu, then fades the menu out: a timer left running by the
	 * other toggle (the pointer passed the bottom Save, e.g. while scrolling) closes a menu just
	 * opened from the head copy. Such timers can be armed before anything here runs, so guard the
	 * fade itself, which upstream main.js uses only there: a dropdown menu does not fade out while
	 * it, or any toggle that opens it, is hovered.
	 */
	patchClickLeave: function() {
		var $ = window.jQuery;
		if(!$ || this.clickLeavePatched) return;
		this.clickLeavePatched = true;
		var fadeOut = $.fn.fadeOut;
		var held = function(ul) {
			if(ul.matches(':hover')) return true;
			return $('.pw-dropdown-toggle-click.pw-dropdown-init').filter(function() {
				var d = $(this).data('pw-dropdown-ul');
				return d && d[0] === ul && this.matches(':hover');
			}).length > 0;
		};
		$.fn.fadeOut = function() {
			var keep = this.filter(function() { return this.matches && this.matches('ul.pw-dropdown-menu') && held(this); });
			return fadeOut.apply(keep.length ? this.not(keep) : this, arguments);
		};
	},

	/**
	 * Upstream's delegated toggle mouseleave arms a 50 ms timer that hides the menu unless the menu
	 * itself is hovered, and never cancels it: a path that grazes a toggle, leaves and comes back
	 * within 50 ms (Firefox reports these quickly) gets the menu it just opened hidden under a
	 * resting pointer. Replace it with one that is cancelled on re-entry and re-checks both the
	 * toggle and its menu when it fires.
	 */
	patchToggleLeave: function() {
		var $ = window.jQuery;
		if(!$ || this.toggleLeavePatched) return;
		this.toggleLeavePatched = true;
		var sel = '.pw-dropdown-toggle:not(.pw-dropdown-toggle-click)';
		var events = $._data(document, 'events') || {};
		(events.mouseout || []).filter(function(h) {
			return h.origType === 'mouseleave' && h.selector === sel && !h.namespace;
		}).forEach(function(h) { $(document).off('mouseleave', sel, h.handler); });
		$(document).on('mouseleave.pwbridge', sel, function() {
			var a = this, $a = $(a), $ul = $a.data('pw-dropdown-ul');
			var opening = $a.data('pw-dropdown-timeout');
			if(opening) clearTimeout(opening);
			clearTimeout(a.pwLeaveTimer);
			a.pwLeaveTimer = setTimeout(function() {
				if(!$ul || !$ul.length) return;
				if(a.matches(':hover') || $ul[0].matches(':hover')) return;
				$ul.find('ul').hide();
				$ul.hide();
				$a.removeClass('hover');
			}, 120);
			if(document.body.classList.contains('touch-device')) $a.attr('data-touchCnt', 0);
		}).on('mouseenter.pwbridge', sel, function() {
			clearTimeout(this.pwLeaveTimer);
		});
	},

	setupDropdownPointers: function() {
		// upstream positions a legacy menu with jQuery UI (right- or left-aligned, flipped above the
		// toggle when there is no room below) and fires pw-show-dropdown: point the pointer at the
		// toggle, or drop it when the menu sits above
		if(!window.jQuery) return;
		var self = this;
		this.patchToggleLeave();
		this.patchClickLeave();
		jQuery(document).on('pw-show-dropdown', '.pw-dropdown-menu', function() {
			var ul = this;
			var toggle = null;
			jQuery('.pw-dropdown-toggle.hover, .pw-dropdown-toggle-open').each(function() {
				var data = jQuery(this).data('pw-dropdown-ul');
				if(data && data[0] === ul) toggle = this;
			});
			if(!toggle) return;
			self.patchHoverLeave(ul, toggle);
			var t = toggle.getBoundingClientRect();
			var m = ul.getBoundingClientRect();
			// below or above (collision flip) the toggle; anything else is a placement upstream
			// chose on purpose (the View tab menu overlays its tab: data-at="left top-9"), kept
			// as is and drawn without pointer
			var below = m.top >= t.bottom - 2;
			var above = !below && m.bottom <= t.top + 2;
			if(below || above) {
				// jQuery UI places the menu flush: keep the 4px popover offset either way
				var want = above ? t.top - 4 - m.height : t.bottom + 4;
				var top = parseFloat(getComputedStyle(ul).top) || 0;
				if(Math.abs(want - m.top) > .5) ul.style.top = (top + want - m.top) + 'px';
			}
			ul.classList.toggle('pw-dropdown-above', !below);
		});
	},

	/**
	 * Mirror form buttons flagged .pw-head-button into the content head, as AdminThemeUikit does:
	 * a main button and its dropdown toggle (pw-button-dropdown-main / -toggle) go into one
	 * span.pw-button-dropdown-wrap so they read as a single button group. With jQuery the copies
	 * keep the originals' handlers and dropdown data (clone(true)), so the toggle's menu works.
	 */
	setupHeadButtons: function() {
		if(document.body.classList.contains('modal')) return;
		var head = document.getElementById('pw-content-head-buttons');
		if(!head) return;
		var buttons = document.querySelectorAll('button.pw-head-button, button.head_button_clone');
		if(!buttons.length) return;
		// upstream's dropdown data travels with clone(true); without upstream the menus are copied
		var jq = this.upstream() && window.jQuery ? window.jQuery : null;
		var toggles = {};
		var mains = {};
		var copies = [];
		for(var i = 0; i < buttons.length; i++) {
			var source = buttons[i];
			// a button inside a link (Add New on the Templates, Fields and Users lists, no id): the
			// link is copied with it, as AdminThemeUikit does, and the copy navigates like the original
			var link = source.parentElement && source.parentElement.tagName === 'A' ? source.parentElement : null;
			if(link) {
				var linkCopy = jq ? jq(link).clone(true)[0] : link.cloneNode(true);
				if(linkCopy.id) linkCopy.id += '_copy';
				var inner = linkCopy.querySelector('button');
				inner.removeAttribute('id');
				inner.classList.add('pw-head-button', 'pw-head-button-copy');
				copies.push(linkCopy);
				continue;
			}
			var copy = jq ? jq(source).clone(true)[0] : source.cloneNode(true);
			copy.setAttribute('data-from-id', source.id);
			copy.id = source.id ? source.id + '_copy' : '';
			copy.classList.add('pw-head-button', 'pw-head-button-copy');
			if(copy.classList.contains('pw-button-dropdown-toggle')) {
				toggles[source.id.replace('pw-dropdown-toggle-', '')] = copy;
				continue;
			}
			// by id, so an original that an in-place save replaced is found; an original without
			// an id is clicked by reference
			copy.pwHeadSource = source;
			copy.addEventListener('click', function(e) {
				e.preventDefault();
				e.stopImmediatePropagation();
				var from = this.getAttribute('data-from-id');
				var original = from ? document.getElementById(from) : this.pwHeadSource;
				if(original) original.click();
			});
			if(copy.classList.contains('pw-button-dropdown-main')) {
				var wrap = document.createElement('span');
				wrap.className = 'pw-button-dropdown-wrap';
				wrap.appendChild(copy);
				mains[source.id] = wrap;
				copies.push(wrap);
			} else {
				copies.push(copy);
			}
		}
		for(var id in toggles) {
			if(!mains[id]) continue;
			mains[id].appendChild(toggles[id]);
			if(!jq) this.copyButtonMenu(mains[id], toggles[id], document.getElementById('pw-dropdown-toggle-' + id));
		}
		copies.reverse().forEach(function(el) { head.insertBefore(el, head.firstChild); });
	},

	/**
	 * Without jQuery a head copy's toggle has no menu (clone(true) carries upstream's data only
	 * with jQuery): give it a copy of the original's menu whose items click the original items, so
	 * the native stand-in (InputfieldSubmitDropdown) sets the action and submits as usual
	 */
	copyButtonMenu: function(wrap, toggle, original) {
		var menu = original ? this.dropdownMenu(original) : null;
		if(!menu) return;
		var copy = menu.cloneNode(true);
		copy.removeAttribute('id');
		copy.style.display = 'none';
		wrap.classList.add('pw-dropdown');
		toggle.insertAdjacentElement('afterend', copy);
		copy.addEventListener('click', function(e) {
			var a = e.target.closest('a');
			if(!a) return;
			var index = Array.prototype.indexOf.call(copy.querySelectorAll('a'), a);
			var target = menu.querySelectorAll('a')[index];
			if(!target) return;
			e.preventDefault();
			copy.style.display = 'none';
			target.click();
		});
	},

	legacy: {

		loaded: false,
		promise: null,
		unobserve: null,

		urls: function() {
			var cfg = ProcessWireAdminTheme.config();
			return cfg.legacyScripts || [];
		},

		/**
		 * Load the legacy stack (once), in the order the server would have printed it
		 * @returns {Promise}
		 */
		load: function() {
			var self = this;
			if(self.loaded) return Promise.resolve();
			if(self.promise) return self.promise;
			var urls = self.urls();
			var styles = ProcessWireAdminTheme.config().legacyStyles || [];
			document.body.classList.add('pw-legacy-loading');
			self.promise = Promise.all(styles.map(function(url) { return self.loadStyle(url); })).then(function() {
				// all at once: async=false keeps the execution order, and each script's load event
				// fires right after it ran, before the next one runs, so holdReady() still patches
				// jQuery.fn.ready before any later script registers a handler. A script that fails
				// to load is skipped (as a missing file would be with the stack printed upstream)
				return Promise.all(urls.map(function(url) {
					return self.loadScript(url).then(function() { self.holdReady(); self.guardNative(); }, function(err) {
						if(window.console) console.warn(err.message);
					});
				}));
			}).then(function() {
				if(!window.jQuery) {
					// without jQuery nothing upstream can run: undo, and let a later call try again
					self.promise = null;
					document.body.classList.remove('pw-legacy-loading');
					throw new Error('Bridge: the legacy stack did not load (no jQuery)');
				}
				self.loaded = true;
				document.body.classList.remove('pw-legacy-loading');
				document.body.classList.add('pw-legacy-loaded');
				// native widgets that upstream takes over from here step aside first (the File and
				// Image fields restore their markup), then upstream's ready handlers run
				document.dispatchEvent(new CustomEvent('pw-legacy-handover'));
				self.releaseReady();
				if(typeof ProcessWireAdmin !== 'undefined') {
					// a throw here must not keep pw-legacy-loaded from firing: later() callers wait on it
					try {
						ProcessWireAdminTheme.prepareUpstreamNav();
						ProcessWireAdmin.init();
						ProcessWireAdminTheme.setupDropdownPointers();
					} catch(e) {
						if(window.console) console.error('Bridge: ProcessWireAdmin.init failed', e);
					}
				}
				document.dispatchEvent(new CustomEvent('pw-legacy-loaded'));
			});
			return self.promise;
		},

		/**
		 * Insert a legacy stylesheet before the theme stylesheet (link[data-pw-theme]), so the
		 * theme keeps winning ties exactly as when the server prints the stack
		 */
		loadStyle: function(url) {
			return new Promise(function(resolve) {
				var link = document.createElement('link');
				link.rel = 'stylesheet';
				link.href = url;
				link.onload = function() { resolve(url); };
				link.onerror = function() { resolve(url); };
				var theme = document.querySelector('link[data-pw-theme]');
				if(theme) theme.parentNode.insertBefore(link, theme);
				else document.head.appendChild(link);
			});
		},

		loadScript: function(url) {
			return new Promise(function(resolve, reject) {
				var s = document.createElement('script');
				s.src = url;
				s.async = false;
				s.onload = function() { resolve(url); };
				s.onerror = function() { reject(new Error('Bridge: failed to load ' + url)); };
				document.head.appendChild(s);
			});
		},

		/**
		 * Hold jQuery ready handlers while the stack loads late. Printed by the server, every
		 * script is parsed before any ready handler runs; loaded late, the document is already
		 * ready and jQuery 1.12 runs a handler at once, before the rest of its own file (upstream
		 * ProcessPageList.js calls its plugin in a ready handler above the plugin's definition).
		 * Called after each script: patches jQuery.fn.ready once jQuery is there.
		 */
		holdReady: function() {
			var $ = window.jQuery;
			if(!$ || !$.fn || !$.fn.ready || $.fn.ready.pwHeld) return;
			var queue = this.readyQueue = [];
			var original = $.fn.ready;
			$.fn.ready = function(fn) { queue.push(fn); return this; };
			$.fn.ready.pwHeld = true;
			$.fn.ready.pwOriginal = original;
		},

		/**
		 * Restore jQuery.fn.ready and run the held handlers in the order they were registered
		 */
		releaseReady: function() {
			var $ = window.jQuery;
			if(!$ || !$.fn.ready || !$.fn.ready.pwHeld) return;
			$.fn.ready = $.fn.ready.pwOriginal;
			var queue = this.readyQueue || [];
			this.readyQueue = [];
			queue.forEach(function(fn) {
				try { $(document).ready(fn); } catch(e) { console.error('Bridge: legacy ready handler failed', e); }
			});
		},

		/**
		 * Run fn once the legacy stack is on the page (now, if it already is)
		 * @param {Function} fn
		 */
		later: function(fn) {
			if(this.loaded) fn();
			else document.addEventListener('pw-legacy-loaded', function() { fn(); }, { once: true });
		},

		/**
		 * Keep upstream widget plugins off fields the runtime already built (milestone 2.4): when
		 * the stack arrives late, upstream ready handlers run at once over the whole page. Called
		 * after each legacy script, so a plugin is wrapped before its init script uses it.
		 */
		guardNative: function() {
			var $ = window.jQuery;
			if(!$ || !$.fn) return;
			if($.fn.asmSelect && !$.fn.asmSelect.pwGuarded) {
				var asmSelect = $.fn.asmSelect;
				$.fn.asmSelect = function(options) {
					return asmSelect.call(this.filter(function() { return !this.hasAttribute('data-pw-asm'); }), options);
				};
				$.fn.asmSelect.pwGuarded = true;
			}
		},

		/**
		 * Initialise markup that arrived after page load, as upstream does after its own AJAX
		 * loads: with the stack, Inputfields.init() and upstream's 'reloaded' (['BridgeLegacyLoad',
		 * $el]) on each field; without it, the runtime's init and a native 'reloaded' per field
		 * (detail.source 'BridgeLegacyLoad'), which non-jQuery field scripts and components listen
		 * to (docs/contract.md 4.3; audit B7). The one place that does this for legacy content: the
		 * observer below and the in-place save call it, the runtime's loaders do not (audit B3).
		 *
		 * @param {Element} el
		 */
		initElement: function(el) {
			if(!el || el.nodeType !== 1) return;
			var fields = el.matches('.Inputfield') ? [el] : Array.prototype.slice.call(el.querySelectorAll('.Inputfield'));
			var I = window.Inputfields;
			if(this.loaded && window.jQuery && I && !I.native && !I.pwStub && typeof I.init === 'function') {
				var $el = jQuery(el);
				I.init($el);
				jQuery(fields).trigger('reloaded', ['BridgeLegacyLoad', $el]);
				return;
			}
			if(window.Bridge && Bridge.Inputfields) Bridge.Inputfields.init(el);
			fields.forEach(function(li) {
				li.dispatchEvent(new CustomEvent('reloaded', { bubbles: true, detail: { source: 'BridgeLegacyLoad' } }));
			});
		},

		/**
		 * Does a legacy field need the stack now? Not while it is an AJAX placeholder: the theme
		 * marks a collapsed-AJAX field data-bridge-legacy when it renders, but until it is opened
		 * nothing of it runs (audit B2); its content arriving is what counts.
		 *
		 * @param {Element} li .Inputfield[data-bridge-legacy]
		 * @returns {boolean}
		 */
		needsStack: function(li) {
			return !li.querySelector(':scope > .InputfieldContent > .renderInputfieldAjax, :scope > .renderInputfieldAjax');
		},

		hasLegacy: function(el) {
			if(el.nodeType !== 1) return false;
			var self = this;
			var sel = '.Inputfield[data-bridge-legacy]';
			if(el.matches(sel) && self.needsStack(el)) return true;
			return Array.prototype.some.call(el.querySelectorAll(sel), function(li) { return self.needsStack(li); });
		},

		/**
		 * The element to initialise for an inserted node, or null: the node itself when it is or
		 * holds legacy markup that needs the stack, else the legacy field it was inserted into (an
		 * AJAX-collapsed field's content arrives as bare nodes inside its already marked wrapper).
		 *
		 * @param {Node} node
		 * @returns {Element|null}
		 */
		legacyTarget: function(node) {
			if(this.hasLegacy(node)) return node;
			var parent = node.parentElement;
			var li = parent ? parent.closest('.Inputfield[data-bridge-legacy]') : null;
			return li && this.needsStack(li) ? li : null;
		},

		/**
		 * Watch for legacy markup inserted into the page (through the theme's one body observer);
		 * once the stack is there upstream initialises what it loads itself, and the watch ends
		 */
		observe: function() {
			var self = this;
			if(self.loaded) return;
			self.unobserve = ProcessWireAdminTheme.observe(function(records) {
				if(self.loaded) {
					if(self.unobserve) self.unobserve();
					return;
				}
				var targets = [];
				for(var i = 0; i < records.length; i++) {
					var added = records[i].addedNodes;
					for(var j = 0; j < added.length; j++) {
						var target = self.legacyTarget(added[j]);
						if(target && targets.indexOf(target) < 0) targets.push(target);
					}
				}
				// an element inside another target is initialised with it
				targets.filter(function(el) {
					return !targets.some(function(other) { return other !== el && other.contains(el); });
				}).forEach(function(el) {
					self.load().then(function() { self.initElement(el); }, function(err) {
						if(window.console) console.error(err.message);
					});
				});
			});
		}
	}
};

/**
 * Synchronous stand-ins for the runtime's globals on pages without jQuery: Inputfields (the
 * facade), Bridge and AdminDataTable arrive with the runtime, an import() that does not hold up
 * DOMContentLoaded, while inline code calls them at once or at DOMContentLoaded (the field
 * editor's ?focus= runs Inputfields.find(), tables print AdminDataTable.initTable()). Each stand-in
 * records calls along any property path (Bridge.Inputfields.init(el), Bridge.dialog.close()) and
 * returns undefined; the runtime replays them on the real object, in order, when it installs it
 * (runtime/src/util/stubs.ts). On a legacy page upstream defines Inputfields and AdminDataTable
 * itself, so only what is still undefined gets one (audit B4).
 */
(function(w) {
	var cfg = (w.ProcessWire && w.ProcessWire.config && w.ProcessWire.config.AdminThemeBridge) || {};
	if(cfg.legacy) return;
	var make = function(queue, path) {
		return new Proxy(function() {}, {
			get: function(target, key) {
				if(path.length === 0 && key === 'pwStub') return true;
				if(path.length === 0 && key === 'pwQueue') return queue;
				// never thenable, never converted: a stand-in is not a Promise or a primitive
				if(typeof key === 'symbol' || key === 'then' || key === 'toJSON') return undefined;
				return make(queue, path.concat(String(key)));
			},
			apply: function(target, thisArg, args) {
				queue.push({ path: path, args: Array.prototype.slice.call(args) });
				return undefined;
			}
		});
	};
	['Inputfields', 'Bridge', 'AdminDataTable'].forEach(function(name) {
		if(typeof w[name] === 'undefined') w[name] = make([], []);
	});
})(window);

/**
 * ProcessWire.alert / confirm / prompt on pages without the legacy stack: upstream defines them
 * in templates-admin/scripts/main.js (with vex dialogs), which is deferred there. Plain browser
 * dialogs until then; upstream's versions replace these when the stack loads.
 */
(function(pw) {
	if(!pw || ProcessWireAdminTheme.upstream()) return;
	var strip = function(s) { var d = document.createElement('div'); d.innerHTML = String(s); return d.textContent || ''; };
	if(!pw.alert) pw.alert = function(message, allowMarkup, expire, func) { window.alert(strip(message)); if(typeof func === 'function') func(); };
	if(!pw.confirm) pw.confirm = function(message, funcOk, funcCancel) {
		if(window.confirm(strip(message))) { if(typeof funcOk === 'function') funcOk(); }
		else if(typeof funcCancel === 'function') funcCancel();
	};
	if(!pw.prompt) pw.prompt = function(message, placeholder, func) {
		var value = window.prompt(strip(message), placeholder || '');
		if(value !== null && typeof func === 'function') func(value);
	};
})(window.ProcessWire);

/**
 * The page tree an AJAX tab loads (the page editor's Children) ends with an inline
 * `ProcessPageListInit()` from upstream ProcessPageList.js; without the legacy stack the runtime
 * builds that tree (fields/pagelist.ts) when the markup arrives, so the call has nothing to do.
 * ProcessPageList.js replaces this when the stack loads.
 */
if(!ProcessWireAdminTheme.upstream() && typeof window.ProcessPageListInit === 'undefined') {
	window.ProcessPageListInit = function() {};
}

/**
 * Native stand-in for upstream InputfieldSubmit/dropdown.js (jQuery) on pages without jQuery.
 * InputfieldSubmit prints `InputfieldSubmitDropdown.init('#id', null, required)` right after a
 * button with dropdown items; with the script deferred that call would throw. Same markup
 * contract: ul#<button id>_dropdown with a[data-pw-dropdown-value] items, the hidden input named
 * by data-pw-dropdown-input, data-pw-dropdown-submit copying the value to the button. The menu
 * becomes a native click dropdown (.pw-dropdown-toggle-click, opened by setupNative). If the
 * legacy stack loads later, upstream's dropdown.js replaces this object for new buttons.
 */
if(!ProcessWireAdminTheme.upstream() && !window.InputfieldSubmitDropdown) {
	window.InputfieldSubmitDropdown = {
		native: true,
		itemClicked: false,

		init: function(selector, template, required) {
			if(document.body && document.body.classList.contains('modal')) {
				var lists = document.querySelectorAll('ul.pw-button-dropdown');
				for(var i = 0; i < lists.length; i++) lists[i].style.display = 'none';
				return false;
			}
			var buttons = typeof selector === 'string' ? document.querySelectorAll(selector) : [].concat(selector || []);
			for(var b = 0; b < buttons.length; b++) {
				var button = buttons[b];
				var ul = template || document.getElementById(button.id + '_dropdown');
				if(ul) this.setup(template ? ul.cloneNode(true) : ul, button, !!required);
			}
			return true;
		},

		setup: function(ul, button, required) {
			var self = this;
			if(button.classList.contains('pw-button-dropdown-main')) return;
			var wrap = document.createElement('span');
			wrap.className = 'pw-dropdown pw-button-dropdown-wrap';
			button.parentNode.insertBefore(wrap, button);
			wrap.appendChild(button);
			var toggle = document.createElement('button');
			toggle.type = 'button';
			toggle.id = 'pw-dropdown-toggle-' + button.id;
			toggle.className = 'ui-button ui-widget ui-state-default ui-corner-all pw-dropdown-toggle-click pw-dropdown-toggle pw-button-dropdown-toggle';
			if(button.classList.contains('ui-priority-secondary')) toggle.classList.add('ui-priority-secondary');
			if(button.classList.contains('pw-head-button')) toggle.classList.add('pw-head-button');
			toggle.setAttribute('aria-haspopup', 'menu');
			toggle.innerHTML = "<span class='ui-button-text'><i class='fa fa-angle-down'></i></span>";
			wrap.appendChild(toggle);
			ul.classList.add('pw-dropdown-menu', 'pw-dropdown-menu-rounded', 'pw-button-dropdown-init');
			ul.style.display = 'none';
			ul.style.top = '100%';
			ul.style.left = '0';
			wrap.appendChild(ul);
			button.classList.add('pw-button-dropdown-main');
			ul.addEventListener('click', function(e) {
				var a = e.target.closest('a');
				if(!a) return;
				var value = a.getAttribute('data-pw-dropdown-value');
				if(!value && !a.classList.contains('pw-button-dropdown-default')) return; // a link: follow it
				e.preventDefault();
				var selector = ul.getAttribute('data-pw-dropdown-input');
				var input = selector ? document.querySelector(selector) : null;
				if(input && value) {
					input.value = value;
					if(parseInt(input.getAttribute('data-pw-dropdown-submit') || '0', 10) > 0) button.value = value;
				}
				ul.style.display = 'none';
				if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
				self.itemClicked = true;
				button.click();
				self.itemClicked = false;
			});
			if(required) {
				button.classList.add('pw-button-dropdown-required');
				button.addEventListener('click', function(e) {
					if(self.itemClicked) return;
					e.preventDefault();
					e.stopPropagation();
					toggle.click();
				});
			}
		}
	};
}

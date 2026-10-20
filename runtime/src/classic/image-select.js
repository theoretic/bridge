/**
 * AdminThemeBridge: native image select, crop and variations window (ADR 0016, milestone 3.9)
 *
 * Stand-in for upstream ProcessPageEditImageSelect.js (checked against core 3.0.274), printed by
 * nativeProcessScripts() for ProcessPageEditImageSelect. The window it runs in is opened by the
 * image field (Crop, Variations) and by the rich text editors' image buttons (pwimage plugins,
 * which read #selected_image and click the window's buttons through the parent's jQuery).
 *
 * Talking to the opener: upstream's globals enablePWImageDialogButtons(),
 * disablePWImageDialogButtons(), closePWImageDialog(), setupProcessSave(field, fileID, isNew),
 * setupProcessSaveReloaded(), refreshPageEditField(field) work with either parent: through its
 * jQuery and jQuery UI dialog when it has them, else through the native dialog (Bridge.dialog,
 * the pw-dialog footer) and Inputfields.reload(). On a window that loaded the legacy stack only
 * these globals are replaced, and only when the parent has no jQuery.
 *
 * Native window (no jQuery):
 * - the selected image: resize handles in jQuery UI resizable's markup (div.ui-wrapper,
 *   .ui-resizable-handle.ui-resizable-<dir>), aspect ratio kept, width and height attributes and
 *   #input_width / #input_height kept in step (what the editors insert); the inputs resize it too;
 * - crop: a crop box in Cropper's markup (.cropper-container, .cropper-crop-box, .cropper-face,
 *   .cropper-line, .cropper-point) so cropper.css styles it; data in the image's own pixels into
 *   #crop_x/y/w/h and back from them; data-crop presets it; Cancel restores the resize handles;
 * - alignment icons and the class select, caption preview, description toggle, min/max size,
 *   the HiDPI and link-to-larger checkboxes, fit to window (data-fit);
 * - variations: select all, preview links in the native lightbox, the count into #<varcnt> in the
 *   opener when it has one (as upstream; core 3.0.274 renders none);
 * - another page (#page_id): its picker reloads the window on that page;
 * - Enter never submits.
 */
(function() {
	'use strict';

	function $(sel, root) { return (root || document).querySelector(sel); }
	function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
	// as jQuery's show(): an element the stylesheet hides gets its tag's default display
	var INLINE = { A: 1, SPAN: 1, I: 1, B: 1, EM: 1, STRONG: 1, LABEL: 1, IMG: 1, SMALL: 1 };
	function show(el, yes) {
		if(!el) return;
		if(!yes) { el.style.display = 'none'; return; }
		el.style.display = '';
		if(getComputedStyle(el).display === 'none') el.style.display = el.tagName === 'BUTTON' ? 'inline-block' : (INLINE[el.tagName] ? 'inline' : 'block');
	}
	function visible(el) { return !!el && el.offsetParent !== null; }

	var opener = window.parent && window.parent !== window ? window.parent : null;
	function openerJquery() {
		try { return opener && opener.jQuery ? opener.jQuery : null; } catch(e) { return null; }
	}
	function openerDoc() {
		try { return opener ? opener.document : null; } catch(e) { return null; }
	}

	/* The opener --------------------------------------------------------------------------- */

	var api = {
		enableButtons: function() {
			var pj = openerJquery();
			if(pj && pj('.ui-dialog-buttonpane').length) { pj('.ui-dialog-buttonpane').find('button').button('enable'); return; }
			var d = openerDoc();
			if(d) $$('pw-dialog .pw-dialog-button', d).forEach(function(b) { b.disabled = false; });
		},
		disableButtons: function() {
			var pj = openerJquery();
			if(pj && pj('.ui-dialog-buttonpane').length) { pj('.ui-dialog-buttonpane').find('button').button('disable'); return; }
			var d = openerDoc();
			if(d) $$('pw-dialog .pw-dialog-button', d).forEach(function(b) { b.disabled = true; });
		},
		close: function() {
			var pj = openerJquery();
			if(pj && pj('iframe.ui-dialog-content').length) { pj('iframe.ui-dialog-content').dialog('close'); return; }
			try { if(opener && opener.Bridge && opener.Bridge.dialog) opener.Bridge.dialog.close(); } catch(e) { /* another origin */ }
		},
		reloadField: function(wrap) {
			var pj = openerJquery();
			if(pj) { pj(wrap).trigger('reload'); return; }
			try {
				var inputfields = opener.Inputfields;
				if(inputfields && inputfields.reload) inputfields.reload(wrap);
			} catch(e) { /* another origin */ }
		}
	};

	function setupProcessSaveReloaded(fileID, isNew) {
		var d = openerDoc();
		var item = d ? d.getElementById(fileID) : null;
		if(item) {
			if(isNew) {
				item.scrollIntoView({ block: 'center', behavior: 'smooth' });
				if(item.animate) item.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900 });
			} else {
				var img = $('img', item);
				if(img && img.animate) img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
				setTimeout(function() {
					var edit = $('.gridImage__edit', item);
					if(edit) edit.click();
				}, 500);
			}
		}
		api.close();
	}

	function setupProcessSave(fieldName, fileID, isNew) {
		var d = openerDoc();
		if(!d) return;
		var wrap = d.getElementById('wrap_Inputfield_' + fieldName);
		if(!wrap && fileID) {
			var item = d.getElementById(fileID);
			wrap = item ? item.closest('.InputfieldImage') : null;
		}
		if(!wrap) { api.close(); return; }
		var finished = false;
		var done = function() {
			if(finished) return;
			finished = true;
			if(fileID.length > 0) setTimeout(function() { setupProcessSaveReloaded(fileID, isNew); }, 250);
			else api.close();
		};
		var pj = openerJquery();
		if(pj) pj('.Inputfield').on('reloaded', done);
		else d.addEventListener('reloaded', done, { once: true });
		var selector = wrap.id ? '#' + wrap.id : wrap;
		api.reloadField(selector);
	}

	function install(nativeWindow) {
		// with jQuery in this window and in the opener, upstream's own versions stay
		if(!nativeWindow && openerJquery()) return;
		window.enablePWImageDialogButtons = api.enableButtons;
		window.disablePWImageDialogButtons = api.disableButtons;
		window.closePWImageDialog = api.close;
		window.setupProcessSave = setupProcessSave;
		window.setupProcessSaveReloaded = setupProcessSaveReloaded;
		window.refreshPageEditField = function(fieldName) { api.reloadField('#wrap_Inputfield_' + fieldName); };
	}

	// this runs before upstream's script on a legacy window only if printed earlier; it is
	// printed after it (the theme's scripts come last), so these assignments win
	install(!window.jQuery);
	if(window.jQuery) return;

	/* Native resize (jQuery UI resizable's markup) ----------------------------------------- */

	function makeResizable(img, opts) {
		var wrap = img.parentElement && img.parentElement.classList.contains('ui-wrapper') ? img.parentElement : null;
		if(!wrap) {
			wrap = document.createElement('div');
			wrap.className = 'ui-wrapper';
			wrap.style.position = 'relative';
			wrap.style.display = 'inline-block';
			img.parentNode.insertBefore(wrap, img);
			wrap.appendChild(img);
			['n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(function(dir) {
				var h = document.createElement('div');
				h.className = 'ui-resizable-handle ui-resizable-' + dir;
				h.setAttribute('data-dir', dir);
				h.style.position = 'absolute';
				h.style.touchAction = 'none';
				wrap.appendChild(h);
			});
		}
		wrap.style.width = img.offsetWidth + 'px';
		wrap.style.height = img.offsetHeight + 'px';
		img.classList.add('ui-resizable');
		var onDown = function(e) {
			var h = e.target.closest('.ui-resizable-handle');
			if(!h || e.button !== 0) return;
			e.preventDefault();
			var dir = h.getAttribute('data-dir');
			var startX = e.clientX, startY = e.clientY;
			var w0 = img.offsetWidth, h0 = img.offsetHeight;
			var ratio = w0 / h0;
			if(opts.start) opts.start();
			var move = function(ev) {
				var dx = ev.clientX - startX, dy = ev.clientY - startY;
				var w = w0, hh = h0;
				if(dir.indexOf('e') > -1) w = w0 + dx;
				if(dir.indexOf('w') > -1) w = w0 - dx;
				if(dir === 'n') hh = h0 - dy;
				if(dir === 's') hh = h0 + dy;
				// aspect ratio: the width leads unless only a vertical edge moves
				if(dir === 'n' || dir === 's') w = hh * ratio;
				hh = w / ratio;
				w = Math.max(10, Math.min(opts.maxWidth || 9999, w));
				hh = w / ratio;
				opts.setSize(Math.round(w), Math.round(hh));
				if(opts.resize) opts.resize();
			};
			var up = function() {
				document.removeEventListener('pointermove', move);
				document.removeEventListener('pointerup', up);
				document.removeEventListener('pointercancel', up);
				if(opts.stop) opts.stop();
			};
			document.addEventListener('pointermove', move);
			document.addEventListener('pointerup', up);
			document.addEventListener('pointercancel', up);
		};
		if(!wrap.hasAttribute('data-pw-resizable')) {
			wrap.setAttribute('data-pw-resizable', '');
			wrap.addEventListener('pointerdown', onDown);
		}
		return {
			wrap: wrap,
			destroy: function() {
				wrap.removeEventListener('pointerdown', onDown);
				wrap.removeAttribute('data-pw-resizable');
				$$('.ui-resizable-handle', wrap).forEach(function(h) { h.remove(); });
				if(wrap.parentNode) { wrap.parentNode.insertBefore(img, wrap); wrap.remove(); }
				img.classList.remove('ui-resizable');
			}
		};
	}

	/* Native crop box (Cropper's markup) ---------------------------------------------------- */

	function makeCropper(img, opts) {
		var natW = img.naturalWidth || parseInt(img.getAttribute('data-origwidth'), 10) || img.offsetWidth;
		var natH = img.naturalHeight || parseInt(img.getAttribute('data-origheight'), 10) || img.offsetHeight;
		var dispW = img.offsetWidth, dispH = img.offsetHeight;
		var scale = natW / dispW;
		var container = document.createElement('div');
		container.className = 'cropper-container';
		container.style.cssText = 'position:relative;width:' + dispW + 'px;height:' + dispH + 'px;touch-action:none;user-select:none';
		container.innerHTML =
			"<div class='cropper-canvas' style='position:absolute;inset:0'><img src='" + img.getAttribute('src') + "' style='width:100%;height:100%' alt=''></div>" +
			"<div class='cropper-modal' style='position:absolute;inset:0'></div>" +
			"<div class='cropper-crop-box' style='position:absolute'>" +
				"<span class='cropper-view-box' style='display:block;overflow:hidden;width:100%;height:100%'><img src='" + img.getAttribute('src') + "' style='position:absolute;max-width:none' alt=''></span>" +
				"<span class='cropper-dashed dashed-h'></span><span class='cropper-dashed dashed-v'></span>" +
				"<span class='cropper-face' data-drag='all'></span>" +
				['e', 'n', 'w', 's'].map(function(d) { return "<span class='cropper-line line-" + d + "' data-drag='" + d + "'></span>"; }).join('') +
				['e', 'n', 'w', 's', 'ne', 'nw', 'sw', 'se'].map(function(d) { return "<span class='cropper-point point-" + d + "' data-drag='" + d + "'></span>"; }).join('') +
			"</div>";
		img.style.display = 'none';
		img.parentNode.insertBefore(container, img.nextSibling);
		var box = $('.cropper-crop-box', container);
		var viewImg = $('.cropper-view-box img', container);
		viewImg.style.width = dispW + 'px';
		viewImg.style.height = dispH + 'px';
		// the box in display pixels
		var b = { x: 0, y: 0, w: 0, h: 0 };
		var render = function(emit) {
			box.style.left = b.x + 'px';
			box.style.top = b.y + 'px';
			box.style.width = b.w + 'px';
			box.style.height = b.h + 'px';
			viewImg.style.left = -b.x + 'px';
			viewImg.style.top = -b.y + 'px';
			if(emit !== false && opts.done) opts.done(getData());
		};
		var clamp = function() {
			b.w = Math.max(4, Math.min(b.w, dispW));
			b.h = Math.max(4, Math.min(b.h, dispH));
			b.x = Math.max(0, Math.min(b.x, dispW - b.w));
			b.y = Math.max(0, Math.min(b.y, dispH - b.h));
		};
		var getData = function() {
			return { x: b.x * scale, y: b.y * scale, width: b.w * scale, height: b.h * scale, rotate: 0 };
		};
		var setData = function(d) {
			b = { x: (parseFloat(d.x) || 0) / scale, y: (parseFloat(d.y) || 0) / scale, w: (parseFloat(d.width) || 0) / scale, h: (parseFloat(d.height) || 0) / scale };
			clamp();
			render();
		};
		if(opts.data) {
			setData(opts.data);
		} else {
			// autoCropArea 0.35, centred, as upstream's settings
			var area = Math.sqrt(0.35);
			b = { w: dispW * area, h: dispH * area, x: 0, y: 0 };
			b.x = (dispW - b.w) / 2;
			b.y = (dispH - b.h) / 2;
			render();
		}
		var onDown = function(e) {
			var t = e.target.closest('[data-drag]');
			var drag = t ? t.getAttribute('data-drag') : 'new';
			if(e.button !== 0) return;
			e.preventDefault();
			var rect = container.getBoundingClientRect();
			var sx = e.clientX, sy = e.clientY;
			var start = { x: b.x, y: b.y, w: b.w, h: b.h };
			if(drag === 'new') {
				start = { x: sx - rect.left, y: sy - rect.top, w: 0, h: 0 };
				drag = 'se';
			}
			var move = function(ev) {
				var dx = ev.clientX - sx, dy = ev.clientY - sy;
				var n = { x: start.x, y: start.y, w: start.w, h: start.h };
				if(drag === 'all') { n.x += dx; n.y += dy; }
				else {
					if(drag.indexOf('e') > -1) n.w = start.w + dx;
					if(drag.indexOf('s') > -1) n.h = start.h + dy;
					if(drag.indexOf('w') > -1) { n.x = start.x + dx; n.w = start.w - dx; }
					if(drag.indexOf('n') > -1) { n.y = start.y + dy; n.h = start.h - dy; }
					if(n.w < 0) { n.x += n.w; n.w = -n.w; }
					if(n.h < 0) { n.y += n.h; n.h = -n.h; }
				}
				b = n;
				clamp();
				render();
			};
			var up = function() {
				document.removeEventListener('pointermove', move);
				document.removeEventListener('pointerup', up);
				document.removeEventListener('pointercancel', up);
			};
			document.addEventListener('pointermove', move);
			document.addEventListener('pointerup', up);
			document.addEventListener('pointercancel', up);
		};
		container.addEventListener('pointerdown', onDown);
		return {
			setData: setData,
			getData: getData,
			destroy: function() {
				container.remove();
				img.style.display = '';
			}
		};
	}

	/* Variations, another page, Enter ------------------------------------------------------- */

	function setupVariations() {
		document.addEventListener('click', function(e) {
			var all = e.target.closest ? e.target.closest('input#delete_all') : null;
			if(!all) return;
			$$('input.delete').forEach(function(c) { c.checked = all.checked; });
			e.stopPropagation();
		});
		document.addEventListener('click', function(e) {
			var a = e.target.closest ? e.target.closest('a.preview') : null;
			if(!a || !window.Bridge || !Bridge.lightbox) return;
			e.preventDefault();
			Bridge.lightbox([{ src: a.getAttribute('href'), title: a.getAttribute('title') || '' }], 0);
		});
		// the opener's variation counter
		var cnt = $('#varcnt_id');
		var d = openerDoc();
		if(cnt && d) {
			var target = d.getElementById(cnt.value);
			if(target) target.textContent = cnt.getAttribute('data-cnt');
		}
	}

	/* The selected image -------------------------------------------------------------------- */

	function setupSelectedImage() {
		var form = $('#selected_image_settings');
		var container = $('#selected_image_container');
		var img = $('#selected_image');
		var hidpi = $('#selected_image_hidpi');
		if(!form || !container || !img) return;
		var croppingActive = false;
		var inputPixelsActive = false;
		var maxWidth = 9999, maxHeight = 9999;
		var originalWidth = img.offsetWidth;
		var fullWidth = parseInt(img.getAttribute('data-origwidth'), 10) || img.naturalWidth;
		var resizer = null;
		var cropper = null;
		var inputW = $('#input_width'), inputH = $('#input_height');

		var setSize = function(w, h) {
			img.style.width = w + 'px';
			img.style.height = h + 'px';
			img.setAttribute('width', w);
			img.setAttribute('height', h);
			container.style.width = w + 'px';
			container.style.height = h + 'px';
			if(resizer) { resizer.wrap.style.width = w + 'px'; resizer.wrap.style.height = h + 'px'; }
		};

		var updateHidpi = function(w) {
			if(!hidpi) return;
			var label = hidpi.closest('label');
			if(w < fullWidth - fullWidth * 0.2) {
				show(label, true);
				hidpi.disabled = false;
			} else {
				hidpi.disabled = true;
				show(label, false);
			}
		};

		var populate = function() {
			var w = Math.round(img.offsetWidth), h = Math.round(img.offsetHeight);
			var link = $('#wrap_link_original');
			if((h >= maxHeight || w >= maxWidth) && form.classList.contains('croppable')) {
				w = maxWidth; h = maxHeight;
				var l = $('#selected_image_link');
				if(l) l.checked = false;
				show(link, false);
			} else if(link && !visible(link)) {
				show(link, true);
				if(link.getAttribute('data-was-checked') == 1) link.checked = true;
			}
			if(inputW) inputW.value = w;
			if(inputH) inputH.value = h;
			img.setAttribute('width', w);
			img.setAttribute('height', h);
			updateHidpi(w);
			var latin = $('#latin');
			if(visible(latin)) latin.style.height = h + 'px';
			if(!form.classList.contains('rte')) {
				var useResize = $('#selected_image_resize');
				show(useResize, originalWidth > w);
			}
		};

		var setupResizable = function() {
			if(resizer || croppingActive) return;
			resizer = makeResizable(img, {
				maxWidth: maxWidth,
				setSize: setSize,
				start: function() { form.classList.add('resizing_active'); },
				resize: populate,
				stop: function() {
					img.setAttribute('width', img.offsetWidth);
					img.setAttribute('height', img.offsetHeight);
					if(originalWidth !== img.offsetWidth) {
						img.classList.add('resized');
						if(!form.classList.contains('rte')) {
							var yes = $('#selected_image_resize_yes'), no = $('#selected_image_resize_no');
							if(yes && !yes.checked) { yes.checked = true; if(no) no.checked = false; }
						}
					}
					form.classList.remove('resizing_active');
					var ra = $('#resize_action');
					if(ra && ra.classList.contains('on')) ra.click();
				}
			});
			img.classList.add('resizable_setup');
		};
		var destroyResizable = function() {
			if(!resizer) return;
			resizer.destroy();
			resizer = null;
			img.classList.remove('resizable_setup');
		};

		// crop
		$$('.show_when_crop').forEach(function(el) { show(el, false); });
		var startCrop = function(e) {
			var recrop = this.getAttribute('data-recrop');
			if(recrop && recrop.length) { window.location.assign(recrop); return; }
			if(!form.classList.contains('croppable') || croppingActive) { if(e) e.preventDefault(); return; }
			croppingActive = true;
			form.classList.add('cropping_active');
			$$('.hide_when_crop').forEach(function(el) { show(el, false); });
			$$('.show_when_crop').forEach(function(el) { show(el, true); });
			destroyResizable();
			var opts = {
				done: function(data) {
					var set = function(id, v) { var el = document.getElementById(id); if(el) el.value = Math.floor(v); };
					set('crop_x', data.x); set('crop_y', data.y); set('crop_w', data.width); set('crop_h', data.height);
				}
			};
			var preset = img.getAttribute('data-crop');
			if(preset) {
				var c = preset.split(',');
				opts.data = { x: c[0], y: c[1], width: c[2], height: c[3] };
				setTimeout(api.disableButtons, 1000);
			} else {
				api.disableButtons();
			}
			cropper = makeCropper(img, opts);
		};
		$$('#crop_action, .crop_trigger').forEach(function(el) { el.addEventListener('click', startCrop); });
		$$('#crop_coordinates input').forEach(function(input) {
			input.addEventListener('change', function() {
				if(!cropper) return;
				var v = function(id) { return parseInt(document.getElementById(id).value, 10) || 0; };
				cropper.setData({ x: v('crop_x'), y: v('crop_y'), width: v('crop_w'), height: v('crop_h') });
			});
		});
		var stopCrop = function() {
			if(cropper) { cropper.destroy(); cropper = null; }
			$$('.show_when_crop').forEach(function(el) { show(el, false); });
			$$('.hide_when_crop').forEach(function(el) { show(el, true); });
			croppingActive = false;
			form.classList.remove('cropping_active');
			setupResizable();
			api.enableButtons();
		};
		var cancel = $('#button_cancel_crop');
		if(cancel) cancel.addEventListener('click', function(e) { e.preventDefault(); stopCrop(); });
		var cropBtn = $('#button_crop');
		if(cropBtn) cropBtn.addEventListener('click', function(e) {
			if(form.classList.contains('processing')) { e.preventDefault(); return; }
			form.classList.add('processing');
		});

		// width / height inputs
		var inputPixelsChange = function() {
			if(inputPixelsActive || this.closest('#crop_coordinates')) return;
			inputPixelsActive = true;
			var oldW = parseInt(img.getAttribute('width'), 10) || img.offsetWidth;
			var oldH = parseInt(img.getAttribute('height'), 10) || img.offsetHeight;
			var origW = parseInt(img.getAttribute('data-origwidth'), 10);
			var origH = parseInt(img.getAttribute('data-origheight'), 10);
			var w, h, same;
			if(this.id === 'input_width') {
				w = parseInt(this.value, 10);
				h = origH / (origW / w);
				same = w === oldW;
			} else {
				h = parseInt(this.value, 10);
				w = origW / (origH / h);
				same = h === oldH;
			}
			if(!(w >= 1 && h >= 1) || same || w > maxWidth) {
				if(inputW) inputW.value = Math.round(oldW);
				if(inputH) inputH.value = Math.round(oldH);
				inputPixelsActive = false;
				return;
			}
			setupResizable();
			setSize(Math.round(w), Math.round(h));
			img.classList.add('resized');
			populate();
			inputPixelsActive = false;
		};
		$$('#selected_image_settings .input_pixels').forEach(function(i) { i.addEventListener('change', inputPixelsChange); });

		// alignment
		var classSelect = $('#selected_image_class');
		var alignClassChange = function() {
			var resized = img.classList.contains('resized');
			var keep = ['resizable_setup', 'ui-resizable'].filter(function(c) { return img.classList.contains(c); });
			img.className = classSelect.value;
			keep.forEach(function(c) { img.classList.add(c); });
			container.className = classSelect.value;
			if(resized) img.classList.add('resized');
			var f = getComputedStyle(container).cssFloat;
			var latin = $('#latin');
			if(f === 'left' || f === 'right') {
				if(latin && !visible(latin)) { latin.style.height = container.offsetHeight + 'px'; show(latin, true); }
			} else {
				show(latin, false);
			}
		};
		if(classSelect) classSelect.addEventListener('change', alignClassChange);

		$$('#align_left_action, #align_center_action, #align_right_action').forEach(function(icon) {
			icon.addEventListener('click', function() {
				var key = icon.getAttribute('data-label');
				Array.prototype.forEach.call(classSelect.options, function(o) { o.selected = false; o.removeAttribute('selected'); });
				if(icon.classList.contains('on')) {
					icon.classList.remove('on');
				} else {
					Array.prototype.forEach.call(icon.parentNode.children, function(s) { if(s !== icon) s.classList.remove('on'); });
					var o = classSelect.querySelector('option[data-label="' + key + '"]');
					if(o) { o.selected = true; o.setAttribute('selected', 'selected'); }
					icon.classList.add('on');
				}
				classSelect.dispatchEvent(new Event('change'));
			});
		});
		var current = classSelect ? classSelect.querySelector('option[selected]') : null;
		if(current && current.getAttribute('data-label')) {
			var onIcon = $('#action_icons span[data-label="' + current.getAttribute('data-label') + '"]');
			if(onIcon) onIcon.classList.add('on');
		}

		// min / max, resize tips, description
		var max = $('#max_action');
		if(max) max.addEventListener('click', function() {
			var w = Math.min(parseInt(img.getAttribute('data-origwidth'), 10), maxWidth);
			if(w > window.innerWidth) { var c = $('#content'); if(c) c.style.overflowX = 'auto'; }
			inputW.value = w;
			inputW.dispatchEvent(new Event('change'));
		});
		var min = $('#min_action');
		if(min) min.addEventListener('click', function() {
			var info = $('#wrap_info');
			var winW = window.innerWidth - 30;
			var winH = window.innerHeight - (info ? info.offsetHeight : 0) - 60;
			var updated = false;
			if(img.offsetHeight > winH) { inputH.value = winH; inputH.dispatchEvent(new Event('change')); updated = true; }
			if(img.offsetWidth > winW) { inputW.value = winW; inputW.dispatchEvent(new Event('change')); updated = true; }
			if(!updated) { inputW.value = Math.ceil(img.offsetWidth / 2); inputW.dispatchEvent(new Event('change')); }
		});
		var resizeAction = $('#resize_action');
		var tips = $('#resize_tips');
		var highlight = function(on) { [inputW, inputH].forEach(function(i) { if(i) i.classList.toggle('ui-state-highlight', on); }); };
		if(resizeAction) {
			resizeAction.addEventListener('mouseenter', function() { if(resizeAction.classList.contains('on')) return; show(tips, true); highlight(true); });
			resizeAction.addEventListener('mouseleave', function() { if(resizeAction.classList.contains('on')) return; show(tips, false); highlight(false); });
			resizeAction.addEventListener('click', function() {
				var on = !resizeAction.classList.contains('on');
				resizeAction.classList.toggle('on', on);
				highlight(on);
			});
		}
		var descAction = $('#description_action');
		if(descAction) descAction.addEventListener('click', function() {
			var on = !descAction.classList.contains('on');
			descAction.classList.toggle('on', on);
			show($('#wrap_description'), on);
		});

		// caption preview
		var caption = $('#selected_image_caption');
		var captionChange = function() {
			if(form.classList.contains('cropping_active')) return;
			show($('#caption_preview'), caption.checked);
		};
		if(caption) { caption.addEventListener('change', captionChange); captionChange(); }

		// start
		var loading = $('#loading_button');
		show(loading, false);
		if(img.getAttribute('data-fit')) {
			var info = $('#wrap_info');
			var winW = window.innerWidth - 30;
			var winH = window.innerHeight - ((info ? info.offsetHeight : 0) + 60);
			if(img.offsetWidth > winW) { img.style.width = winW + 'px'; img.style.height = 'auto'; img.removeAttribute('height'); }
			if(img.offsetHeight > winH) { img.removeAttribute('width'); img.style.width = 'auto'; img.style.height = winH + 'px'; }
		}
		container.style.width = img.offsetWidth + 'px';
		container.style.height = img.offsetHeight + 'px';
		if(classSelect) alignClassChange();
		populate();
		setupResizable();
		if(img.getAttribute('data-crop')) { var ca = $('#crop_action'); if(ca) startCrop.call(ca); }
		$$('button.submit_save_copy, button.submit_save_replace').forEach(function(b) {
			b.addEventListener('click', function() { form.classList.add('processing'); api.disableButtons(); });
		});
	}

	function init() {
		var pageId = $('#page_id');
		if(pageId) {
			var current = pageId.value;
			pageId.addEventListener('pageSelected', function(e) {
				var d = e.detail || {};
				if(!d.id || String(d.id) === String(current)) return;
				window.location = './?id=' + d.id + '&modal=1';
			});
		}
		var img = $('#selected_image');
		if(img) {
			var go = function() { setTimeout(setupSelectedImage, 250); };
			if(img.complete && img.naturalWidth > 0) go(); else img.addEventListener('load', go, { once: true });
		} else if($('#ImageVariations')) {
			setupVariations();
		}
		api.enableButtons();
		// Enter never submits these forms
		window.addEventListener('keydown', function(e) { if(e.key === 'Enter') e.preventDefault(); });
	}

	window.ProcessWireAdminTheme = window.ProcessWireAdminTheme || {};
	ProcessWireAdminTheme.imageSelect = { api: api, makeCropper: makeCropper, makeResizable: makeResizable };
	if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
	else init();
})();

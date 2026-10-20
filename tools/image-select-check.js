// Native image select, Crop and Variations (tools/image-select-check.js, milestone 3.9, ADR 0016):
// on the native page editor the image field's Crop and Variations open the native dialog (no
// jQuery on the page or in the window); in the Crop window the crop box comes up with its data in
// the image's pixels, the dialog's buttons wait while cropping, Cancel brings back the resize
// handles; the size inputs resize the image (width and height attributes, what the editors insert);
// Variations opens natively with its list. Then the rich text editors' image window (page/image/) on its
// own: the image list, a chosen image with resize handles. Saves nothing (no crop is applied).
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] PROBE_PASS=<sandbox bridge password> node tools/image-select-check.js
//     <playwright-core dir> <firefox|chromium|webkit>
// Admin URL: the atispro sandbox (http://localhost:8089, user "bridge"), or ADMIN=<admin url>.
// Uses tools/sandbox-fixture.php's /bridge-native/ (NATIVE_ID, default 1517) with bf_images.
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'firefox';
const ADMIN = process.env.ADMIN || 'http://localhost:8089/fv9673g5vdfigh/';
const NATIVE = process.env.NATIVE_ID || '1517';
const IMG = '#wrap_Inputfield_bf_images';
const results = [];
const check = (name, ok, info) => { results.push({ ok: !!ok, name, info: info === undefined ? '' : String(info).slice(0, 400) }); };

(async () => {
	const browser = await pw[browserName].launch({ headless: true });
	const fs = require('fs');
	const statePath = process.env.PW_STATE || '';
	const ctx = await browser.newContext(Object.assign({ viewport: { width: 1300, height: 950 } },
		statePath && fs.existsSync(statePath) ? { storageState: statePath } : {}));
	const consoleErrors = require('./console-errors')(ctx);
	const page = await ctx.newPage();
	const errors = [];
	const ignore = process.env.IGNORE_ERRORS ? new RegExp(process.env.IGNORE_ERRORS) : null;
	const onError = e => { if(!ignore || !ignore.test(e.message)) errors.push(e.message); };
	page.on('pageerror', onError);
	page.on('dialog', d => d.accept());

	const open = async (path) => {
		await page.goto(ADMIN + path, { waitUntil: 'networkidle' });
		if(await page.locator('#login_name').count()) {
			await page.fill('#login_name', 'bridge');
			await page.fill('#login_pass', process.env.PROBE_PASS);
			await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);
			if(statePath) await ctx.storageState({ path: statePath });
			await page.goto(ADMIN + path, { waitUntil: 'networkidle' });
		}
		if(await page.locator('#login_name').count()) throw new Error('login failed (throttled? wrong PROBE_PASS?)');
		await page.waitForTimeout(500);
	};
	const waitFor = async (target, fn, arg, ms = 10000) => {
		for(let t = 0; t < ms; t += 200) {
			if(await target.evaluate(fn, arg).catch(() => false)) return true;
			await page.waitForTimeout(200);
		}
		return false;
	};
	const dialogFrame = async () => {
		for(let t = 0; t < 15000; t += 200) {
			const el = await page.$('pw-dialog dialog[open] iframe');
			const f = el ? await el.contentFrame() : null;
			if(f && /image/.test(f.url()) && await f.evaluate(() => document.readyState === 'complete').catch(() => false)) return f;
			await page.waitForTimeout(200);
		}
		return null;
	};
	const footer = () => page.evaluate(() => [...document.querySelectorAll('pw-dialog .pw-dialog-button')].map(b => b.disabled));
	const closeDialog = async () => { await page.evaluate(() => Bridge.dialog.close(true)); await page.waitForTimeout(300); };
	const editItem = async (n) => {
		const item = `${IMG} .gridImages > li.gridImage:nth-child(${n})`;
		await page.hover(item);
		await page.click(item + ' .gridImage__edit');
		await page.waitForTimeout(300);
	};

	// A: Crop from the native editor
	await open('page/edit/?id=' + NATIVE);
	check('A no jQuery on the native editor', !(await page.evaluate(() => !!window.jQuery)));
	await editItem(1);
	await page.click(IMG + ' .InputfieldImageEdit--active .InputfieldImageButtonCrop');
	let f = await dialogFrame();
	check('A Crop opens the native dialog, still no jQuery on the page', !!f && !(await page.evaluate(() => !!window.jQuery)));
	if(f) {
		check('A the window has no jQuery and shows the image', await waitFor(f, () => !window.jQuery && !!document.getElementById('selected_image') && !!document.querySelector('.ui-resizable-handle'), null, 10000),
			JSON.stringify(await f.evaluate(() => ({ jq: !!window.jQuery, img: !!document.getElementById('selected_image'), reasons: (ProcessWire.config.AdminThemeBridge || {}).legacyReasons }))));
		check('A the window\'s buttons are in the dialog footer', (await footer()).length > 0);
		// the size inputs resize it
		const w0 = await f.evaluate(() => parseInt(document.getElementById('selected_image').getAttribute('width'), 10));
		if(await f.$('#input_width')) {
			await f.evaluate((w) => { const i = document.getElementById('input_width'); i.value = Math.max(20, Math.round(w / 2)); i.dispatchEvent(new Event('change', { bubbles: true })); }, w0);
			const after = await f.evaluate(() => { const i = document.getElementById('selected_image'); return { w: parseInt(i.getAttribute('width'), 10), h: parseInt(i.getAttribute('height'), 10), input: document.getElementById('input_height').value }; });
			check('A the width input resizes the image (attributes and height input follow)', after.w === Math.max(20, Math.round(w0 / 2)) && after.h > 0 && String(after.h) === after.input, JSON.stringify({ w0, after }));
		}
		// crop on, then cancel
		if(await f.$('#crop_action')) {
			await f.click('#crop_action');
			const cropping = await waitFor(f, () => !!document.querySelector('.cropper-crop-box') && parseInt(document.getElementById('crop_w').value, 10) > 0, null, 5000);
			check('A crop: the crop box comes up with its data', cropping, JSON.stringify(await f.evaluate(() => ['crop_x', 'crop_y', 'crop_w', 'crop_h'].map(id => (document.getElementById(id) || {}).value))));
			check('A crop: the dialog\'s buttons wait', (await footer()).every(d => d));
			// drag the box's face: x and y change
			const face = await f.$('.cropper-face');
			const x0 = await f.evaluate(() => parseInt(document.getElementById('crop_x').value, 10));
			if(face) {
				const b = await face.boundingBox();
				await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
				await page.mouse.down();
				await page.mouse.move(b.x + b.width / 2 - 25, b.y + b.height / 2, { steps: 5 });
				await page.mouse.up();
			}
			const x1 = await f.evaluate(() => parseInt(document.getElementById('crop_x').value, 10));
			check('A crop: dragging the box moves it (crop_x)', face && x1 !== x0, `${x0} -> ${x1}`);
			await f.click('#button_cancel_crop');
			check('A crop: Cancel restores the resize handles and the buttons', await waitFor(f, () => !document.querySelector('.cropper-crop-box') && !!document.querySelector('.ui-resizable-handle'), null, 5000)
				&& (await footer()).every(d => !d));
		} else {
			check('A crop: the window offers cropping', false);
		}
		await closeDialog();
	}

	// B: Variations
	await open('page/edit/?id=' + NATIVE);
	await editItem(1);
	const varButton = IMG + ' .InputfieldImageEdit--active button[data-href*="variations"]';
	if(await page.locator(varButton).count()) {
		await page.evaluate((s) => { const span = document.querySelector(s + ' span'); if(span) span.setAttribute('data-was', span.textContent); }, varButton);
		await page.click(varButton);
		f = await dialogFrame();
		check('B Variations opens the native dialog, no jQuery in it', !!f && await waitFor(f, () => !window.jQuery && !!document.getElementById('ImageVariations'), null, 10000));
		// upstream writes the count into #<varcnt> in the opener when such an element exists (core
		// 3.0.274 renders none); the window carries the count
		if(f) check('B the window lists the variations with their count', await waitFor(f, () => {
			const cnt = document.getElementById('varcnt_id');
			return !!cnt && cnt.getAttribute('data-cnt') !== null;
		}, null, 5000));
		await closeDialog();
	} else {
		check('B a Variations button', false);
	}

	// D: a crop saved as a copy: the window's setupProcessSave() reloads the field in the native
	// opener and closes the dialog; the copy is trashed and the page saved again afterwards
	// copies of earlier runs (name-v<n>.ext) go first; then the editor is fresh
	const dropCopies = async () => {
		await open('page/edit/?id=' + NATIVE);
		const n = await page.evaluate((s) => {
			let k = 0;
			document.querySelectorAll(s + ' .gridImages > li.gridImage').forEach(li => {
				const img = li.querySelector('img');
				const name = img ? (img.getAttribute('data-original') || img.getAttribute('src') || '') : '';
				const box = li.querySelector('.gridImage__deletebox');
				if(/-v\d+\.[a-z]+(\?|$)/i.test(name.split('/').pop()) && box) { box.checked = true; k++; }
			});
			return k;
		}, IMG);
		if(n) {
			await page.evaluate(() => { window.__saved = 0; document.addEventListener('pw-page-saved', () => { window.__saved = 1; }, { once: true }); });
			await page.click('#submit_save');
			await waitFor(page, () => window.__saved === 1, null, 30000);
			await open('page/edit/?id=' + NATIVE);
		}
		return n;
	};
	await dropCopies();
	const count = () => page.evaluate((s) => document.querySelectorAll(s + ' .gridImages > li.gridImage').length, IMG);
	const n0 = await count();
	await editItem(1);
	await page.click(IMG + ' .InputfieldImageEdit--active .InputfieldImageButtonCrop');
	f = await dialogFrame();
	// the window sets up its image 250 ms after load (the resize handles mark it ready)
	if(f && await waitFor(f, () => !!document.getElementById('crop_action') && !!document.querySelector('.ui-resizable-handle'), null, 10000)) {
		await f.click('#crop_action');
		await page.waitForTimeout(400);
		await f.click('#button_crop');
		// the window loads the cropped result (its URL names the crop), then offers to save it
		const ready = await waitFor(page, () => {
			const fr = document.querySelector('pw-dialog dialog[open] iframe');
			let url = '';
			try { url = fr ? fr.contentWindow.location.href : ''; } catch(e) {}
			return /cropx/.test(url) && fr.contentDocument.readyState === 'complete'
				&& [...document.querySelectorAll('pw-dialog .pw-dialog-button')].some(b => /Copy/.test(b.textContent) && !b.disabled);
		}, null, 20000);
		check('D after the crop the window offers Save as Copy', ready);
		if(ready) {
			await page.locator('pw-dialog .pw-dialog-button', { hasText: /Copy/ }).first().click();
			const closed = await waitFor(page, () => { const d = document.querySelector('pw-dialog dialog'); return !d || !d.open; }, null, 20000);
			const grew = await waitFor(page, (a) => document.querySelectorAll(a.s + ' .gridImages > li.gridImage').length === a.n + 1, { s: IMG, n: n0 }, 10000);
			check('D Save as Copy: the field reloads with the copy, the dialog closes, still no jQuery', closed && grew && !(await page.evaluate(() => !!window.jQuery))
				&& await page.evaluate((s) => !!document.querySelector(s + ' .gridImages[data-pw-image]'), IMG), `${n0} -> ${await count()}`);
			// clean up: a copy is temporary until the page is saved (upstream: isTemp), so reopening
			// the editor drops it; saved copies of interrupted runs are deleted by dropCopies()
			const dropped = await dropCopies();
			check('cleanup: the unsaved copy is gone again', await count() === n0, `${dropped} dropped, ${await count()} images`);
		}
	} else {
		check('D the Crop window opens', false);
	}
	await closeDialog().catch(() => {});

	// C: the editors' image window on its own
	await open('page/image/?id=' + NATIVE + '&modal=1');
	check('C image window: no jQuery', !(await page.evaluate(() => !!window.jQuery)), JSON.stringify(await page.evaluate(() => (ProcessWire.config.AdminThemeBridge || {}).legacyReasons)));
	const first = page.locator('#ProcessPageEditImageSelect a[href*="edit"] img, ul.gridImages a, a.InputfieldImageSelect').first();
	if(await first.count()) {
		await Promise.all([page.waitForNavigation({ timeout: 15000 }).catch(() => null), first.click()]);
		await page.waitForLoadState('networkidle').catch(() => {});
		check('C a chosen image comes up with resize handles and its size', await waitFor(page, () => !!document.querySelector('#selected_image') && !!document.querySelector('.ui-resizable-handle')
			&& parseInt(document.getElementById('input_width').value, 10) > 0, null, 8000));
		// Enter never submits
		const url = page.url();
		await page.focus('#input_width').catch(() => {});
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);
		check('C Enter does not submit', page.url() === url);
	} else {
		check('C the window lists the page\'s images', false, (await page.content()).slice(0, 300));
	}

	// E: a legacy editor's CKEditor image button (the parent has jQuery and a jQuery UI dialog, the
	// window is native): choose an image, resize it, insert; nothing is saved
	await open('page/edit/?id=' + (process.env.CK_ID || 1494));
	const ck = page.locator('.cke_button__pwimage').first();
	if(await ck.count() && await page.evaluate(() => !!window.CKEDITOR)) {
		await ck.scrollIntoViewIfNeeded();
		await ck.click();
		let frame = null;
		for(let t = 0; t < 15000 && !frame; t += 300) {
			const el = await page.$('.ui-dialog iframe');
			frame = el ? await el.contentFrame() : null;
			if(frame && !(await frame.$('#select_images'))) frame = null;
			if(!frame) await page.waitForTimeout(300);
		}
		check('E the editor\'s image window has no jQuery (its opener does)', !!frame && !(await frame.evaluate(() => !!window.jQuery)) && await page.evaluate(() => !!window.jQuery));
		if(frame) {
			await frame.locator('#select_images li a img:visible').first().click();
			const chosen = await waitFor(page, () => {
				const fr = document.querySelector('.ui-dialog iframe');
				const d = fr && fr.contentDocument;
				return !!d && !!d.querySelector('#selected_image') && !!d.querySelector('.ui-resizable-handle');
			}, null, 15000);
			check('E a chosen image comes up natively in the editor\'s dialog', chosen);
			const frame2 = await (await page.$('.ui-dialog iframe')).contentFrame();
			const w = await frame2.evaluate(() => {
				const i = document.getElementById('input_width');
				const w = Math.max(20, Math.round(parseInt(i.value, 10) / 2));
				i.value = w;
				i.dispatchEvent(new Event('change', { bubbles: true }));
				return w;
			});
			const before = await page.evaluate(() => { const k = Object.keys(CKEDITOR.instances)[0]; return CKEDITOR.instances[k].getData(); });
			await page.locator('.ui-dialog-buttonpane button', { hasText: /Insert/ }).first().click();
			const inserted = await waitFor(page, (a) => {
				const k = Object.keys(CKEDITOR.instances)[0];
				const d = CKEDITOR.instances[k].getData();
				return d !== a.before && new RegExp('<img[^>]*width="' + a.w + '"').test(d);
			}, { before, w }, 30000); // a resized image is made on the server first (page/image/resize)
			const got = await page.evaluate(() => Object.keys(CKEDITOR.instances).map(k => (CKEDITOR.instances[k].getData().match(/<img[^>]*>/g) || []).join(' ')).join(' | '));
			check('E Insert puts the resized image into CKEditor and closes the dialog', inserted && await waitFor(page, () => ![...document.querySelectorAll('.ui-dialog')].some(d => d.offsetParent !== null), null, 5000), `width ${w}: ${got}`);
		}
	} else {
		check('E a legacy editor with CKEditor\'s image button (CK_ID): skipped', true);
	}

	check('no page errors', errors.length === 0, errors.join(' | '));
	await consoleErrors.settle();
	consoleErrors.check(check);
	report();
	await browser.close();
})().catch(e => { check('run completed', false, String(e.message).split(String.fromCharCode(10))[0]); report(); process.exit(1); });

function report() {
	const failed = results.filter(x => !x.ok);
	console.log(JSON.stringify({ browser: browserName, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
	if(failed.length) process.exitCode = 1;
}

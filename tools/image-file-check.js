// Native File and Image fields check (tools/image-file-check.js, milestone 3.2, ADR 0016): drives
// the fields of the native fixture page in a real browser engine and verifies that they work
// without jQuery: view modes and size (cookie), edit panel, rename, delete, sort, lightbox, focus,
// action note, uploads (file input and drop, errors), file tags and delete, save round trip, and
// Crop opening the native dialog (milestone 3.9). Restores what it changes (uploaded
// files are deleted again).
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] PROBE_PASS=<sandbox bridge password> node tools/image-file-check.js
//     <playwright-core dir> <firefox|chromium|webkit>
// Admin URL: the atispro sandbox (http://localhost:8089, user "bridge"), or ADMIN=<admin url> for
// another sandbox. Page /bridge-native/ (NATIVE_ID, default 1517) from tools/sandbox-fixture.php:
// bf_images (3 images), bf_image (single), bf_files (2 files); a legacy editor with the same field
// types, /bridge-fixture/ (LEGACY_ID, default 1494).
// IGNORE_ERRORS=<regex>: page errors of known third-party bugs to leave out (davinci: Fluency loads
// fluency.bundle.js from a relative URL, whose HTML answer throws "Unexpected token '<'").
// NO_IMAGE_UPLOAD=1: skip the image upload round trip (atispro: the site's own upload hook,
// hooks/pageimage.lqip.php, fails under FileCompiler; it fails the same under every admin theme).
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'firefox';
const ADMIN = process.env.ADMIN || 'http://localhost:8089/fv9673g5vdfigh/';
const NATIVE = process.env.NATIVE_ID || '1517';
const LEGACY = process.env.LEGACY_ID || '1494';
const results = [];
const check = (name, ok, info) => { results.push({ ok: !!ok, name, info: info === undefined ? '' : String(info).slice(0, 400) }); };

// a small valid PNG (48x32, one colour), encoded here
function makePng(w, h, rgb) {
	const zlib = require('zlib');
	const table = Array.from({ length: 256 }, (_, n) => { let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
	const crc = (buf) => { let c = 0xffffffff; for(const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
	const chunk = (type, data) => {
		const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type), data]);
		const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
		return Buffer.concat([len, td, c]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
	const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill(rgb).flat())]);
	const raw = Buffer.concat(Array(h).fill(row));
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = makePng(48, 32, [40, 120, 220]);

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
	page.on('pageerror', e => { if(!ignore || !ignore.test(e.message)) errors.push(e.message); });
	page.on('dialog', d => d.accept());

	const open = async (id) => {
		await page.goto(ADMIN + 'page/edit/?id=' + id, { waitUntil: 'networkidle' });
		if(await page.locator('#login_name').count()) {
			await page.fill('#login_name', 'bridge');
			await page.fill('#login_pass', process.env.PROBE_PASS);
			await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);
			if(statePath) await ctx.storageState({ path: statePath });
			await page.goto(ADMIN + 'page/edit/?id=' + id, { waitUntil: 'networkidle' });
		}
		if(await page.locator('#login_name').count()) throw new Error('login failed (throttled? wrong PROBE_PASS?)');
		await page.waitForTimeout(500);
	};
	const jq = () => page.evaluate(() => !!window.jQuery);
	const IMG = '#wrap_Inputfield_bf_images';
	const FILES = '#wrap_Inputfield_bf_files';
	const names = () => page.$$eval(IMG + ' .gridImages > li.gridImage .gridImage__overflow img', imgs => imgs.map(i => (i.getAttribute('data-original') || '').split('/').pop().split('?')[0]));
	const editItem = async (n) => {
		const item = `${IMG} .gridImages > li.gridImage:nth-child(${n})`;
		await page.hover(item);
		await page.click(item + ' .gridImage__edit');
		await page.waitForTimeout(300);
	};
	const waitFor = async (fn, arg, ms = 10000) => {
		for(let t = 0; t < ms; t += 200) {
			if(await page.evaluate(fn, arg)) return true;
			await page.waitForTimeout(200);
		}
		return false;
	};
	const save = async () => {
		await page.evaluate(() => { window.__saved = null; document.addEventListener('pw-page-saved', e => { window.__saved = e.detail; }, { once: true }); });
		await page.click('#submit_save');
		// a save with new images can take a while on the single-threaded PHP dev server
		return waitFor(() => !!window.__saved, null, 30000);
	};

	// leftovers of an interrupted run: probe uploads are deleted first
	await open(NATIVE);
	const leftovers = await page.evaluate(() => {
		let n = 0;
		document.querySelectorAll('#wrap_Inputfield_bf_images .gridImage, #wrap_Inputfield_bf_files .InputfieldFileItem').forEach(li => {
			if(!/probe-/.test(li.textContent + ((li.querySelector('img') || {}).src || ''))) return;
			const box = li.querySelector('.gridImage__deletebox, .InputfieldFileDelete input');
			if(box) { box.checked = true; n++; }
		});
		return n;
	});
	if(leftovers) await save();

	// A: native fields, no jQuery
	await open(NATIVE);
	check('A no jQuery on the native editor with File and Image', !(await jq()), JSON.stringify(await page.evaluate(() => ProcessWire.config.AdminThemeBridge.legacyReasons)));
	const built = await page.evaluate(() => ({
		toggles: [...document.querySelectorAll('.InputfieldImage')].map(f => f.querySelectorAll('.InputfieldImageListToggle').length),
		sliders: document.querySelectorAll('.InputfieldImage input.InputfieldImageSizeSlider').length,
		tags: document.querySelectorAll('#wrap_Inputfield_bf_files .selectize-control').length,
		max1: document.querySelector('#wrap_Inputfield_bf_image').classList.contains('InputfieldImageMax1'),
	}));
	check('A image headers get the mode toggles and size slider', built.toggles.every(n => n === 3) && built.sliders === 2, JSON.stringify(built));
	check('A file tags become tag controls, single image marked Max1', built.tags === 2 && built.max1, JSON.stringify(built));

	// B: view modes, kept in the InputfieldImage cookie
	await page.click(IMG + ' .InputfieldImageListToggle[href="list"]');
	check('B list mode', await page.evaluate((s) => document.querySelector(s).classList.contains('InputfieldImageEditAll'), IMG));
	await page.click(IMG + ' .InputfieldImageListToggle[href="left"]');
	check('B left mode (whole thumbnails)', await page.evaluate((s) => !document.querySelector(s).classList.contains('InputfieldImageEditAll') && document.querySelector(s + ' .gridImages').hasAttribute('data-ragged'), IMG));
	await page.click(IMG + ' .InputfieldImageListToggle[href="list"]');
	await open(NATIVE);
	check('B mode kept after reload (cookie)', await page.evaluate((s) => document.querySelector(s).classList.contains('InputfieldImageEditAll'), IMG), await page.evaluate(() => document.cookie.split('; ').find(c => c.indexOf('InputfieldImage=') === 0)));
	await page.click(IMG + ' .InputfieldImageListToggle[href="grid"]');
	check('B grid mode', await page.evaluate((s) => !document.querySelector(s).classList.contains('InputfieldImageEditAll') && !document.querySelector(s + ' .gridImages').hasAttribute('data-ragged'), IMG));

	// C: size slider
	const sized = await page.evaluate((s) => {
		const r = document.querySelector(s + ' input.InputfieldImageSizeSlider');
		r.value = '200';
		r.dispatchEvent(new Event('input', { bubbles: true }));
		r.dispatchEvent(new Event('change', { bubbles: true }));
		const w = document.querySelector(s + ' .gridImage__overflow').style.width;
		r.value = '130';
		r.dispatchEvent(new Event('input', { bubbles: true }));
		r.dispatchEvent(new Event('change', { bubbles: true }));
		return { w, back: document.querySelector(s + ' .gridImage__overflow').style.width };
	}, IMG);
	check('C size slider resizes the thumbnails', sized.w === '200px' && sized.back === '130px', JSON.stringify(sized));

	// D: edit panel
	await editItem(2);
	const panel = await page.evaluate((s) => {
		const p = document.querySelector(s + ' .InputfieldImageEdit--active');
		const item = document.querySelector(s + ' .gridImages > li.gridImage:nth-child(2)');
		return { open: !!p, name: p ? (p.querySelector('.InputfieldImageEdit__name') || {}).textContent : '', editing: item.classList.contains('gridImageEditing'), dataLeft: item.querySelector('.ImageData').children.length, img: p ? p.querySelector('.InputfieldImageEdit__image').getAttribute('src') : '' };
	}, IMG);
	check('D edit panel opens with the image and its data', panel.open && /native-b/.test(panel.name) && panel.editing && /native-b\.png/.test(panel.img), JSON.stringify(panel));
	await page.click('#pw-content-title');
	await page.waitForTimeout(200);
	check('D a click elsewhere closes it, data back in the item', await page.evaluate((s) => !document.querySelector(s + ' .InputfieldImageEdit--active') && document.querySelector(s + ' .gridImages > li.gridImage:nth-child(2) .ImageData .InputfieldImageEdit__name') !== null, IMG));

	// E: rename
	await editItem(1);
	await page.click(IMG + ' .InputfieldImageEdit--active .InputfieldImageEdit__name span');
	await page.keyboard.press('End');
	await page.keyboard.type('-x');
	await page.keyboard.press('Enter');
	check('E rename writes the new name', await page.evaluate((s) => document.querySelector(s + ' .InputfieldImageEdit--active .InputfieldFileRename').value === 'native-a-x', IMG), await page.evaluate((s) => document.querySelector(s + ' .InputfieldImageEdit--active .InputfieldFileRename').value, IMG));

	// J: action note
	await page.selectOption(IMG + ' .InputfieldImageEdit--active .InputfieldFileActionSelect', 'hide');
	check('J action note shows', await page.evaluate((s) => getComputedStyle(document.querySelector(s + ' .InputfieldImageEdit--active .InputfieldFileActionNote')).display !== 'none', IMG));
	await page.selectOption(IMG + ' .InputfieldImageEdit--active .InputfieldFileActionSelect', '');

	// H: lightbox
	await page.click(IMG + ' .InputfieldImageEdit--active .InputfieldImageEdit__image');
	let lb = await page.evaluate(() => { const d = document.querySelector('dialog.pw-lightbox'); return d && d.open ? d.querySelector('img').getAttribute('src') : ''; });
	check('H lightbox opens the full image', /native-a\.png/.test(lb), lb);
	await page.click('dialog.pw-lightbox .pw-lightbox-next');
	lb = await page.evaluate(() => document.querySelector('dialog.pw-lightbox img').getAttribute('src'));
	check('H lightbox steps to the next image', /native-b\.png/.test(lb), lb);
	await page.keyboard.press('Escape');
	check('H Escape closes it', await page.evaluate(() => !document.querySelector('dialog.pw-lightbox').open));

	// I: focus
	await page.click(IMG + ' .InputfieldImageEdit--active .InputfieldImageButtonFocus');
	await page.waitForTimeout(300);
	await page.waitForSelector(IMG + ' .InputfieldImageEdit--active .focusCircle', { timeout: 3000 }).catch(() => {});
	const circle = await page.$(IMG + ' .InputfieldImageEdit--active .focusCircle');
	check('I focus circle shown', !!circle);
	if(circle) {
		const box = await circle.boundingBox();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 30, { steps: 5 });
		await page.mouse.up();
		const value = await page.evaluate((s) => document.querySelector(s + ' .InputfieldImageEdit--active .InputfieldImageFocus').value, IMG);
		check('I dragging the circle sets the focus', value !== '50 50 0' && parseFloat(value.split(' ')[1]) < 50, value);
		await page.click(IMG + ' .InputfieldImageEdit--active .InputfieldImageButtonFocus');
		check('I Focus again stops it', await page.evaluate((s) => !document.querySelector(s + ' .focusCircle'), IMG));
	}
	await open(NATIVE); // drop the rename, action and focus edits

	// F: delete marks
	await page.hover(IMG + ' .gridImages > li.gridImage:nth-child(1)');
	await page.click(IMG + ' .gridImages > li.gridImage:nth-child(1) .gridImage__trash');
	check('F trash marks the image for deletion', await page.evaluate((s) => { const li = document.querySelector(s + ' .gridImages > li.gridImage:nth-child(1)'); return li.classList.contains('gridImage--delete') && li.querySelector('.gridImage__deletebox').checked; }, IMG));
	await page.dblclick(IMG + ' .gridImages > li.gridImage:nth-child(1) .gridImage__trash');
	const all = await page.$$eval(IMG + ' .gridImage__deletebox', b => b.map(x => x.checked));
	await page.dblclick(IMG + ' .gridImages > li.gridImage:nth-child(1) .gridImage__trash');
	const none = await page.$$eval(IMG + ' .gridImage__deletebox', b => b.map(x => x.checked));
	check('F double click marks all, then none', all.length === 3 && all.every(Boolean) === all.every(Boolean) && (all.every(Boolean) || all.every(x => !x)) && none.every(x => x === none[0]) && all[0] !== none[0], JSON.stringify({ all, none }));
	await open(NATIVE);

	// G: sort by dragging
	const before = await names();
	await page.$eval(IMG, el => el.scrollIntoView({ block: 'center' }));
	const first = await (await page.$(IMG + ' .gridImages > li.gridImage:nth-child(1)')).boundingBox();
	const third = await (await page.$(IMG + ' .gridImages > li.gridImage:nth-child(3)')).boundingBox();
	await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
	await page.mouse.down();
	await page.mouse.move(first.x + first.width / 2 + 20, first.y + first.height / 2, { steps: 3 });
	await page.mouse.move(third.x + third.width * 0.8, third.y + third.height / 2, { steps: 8 });
	await page.mouse.up();
	await page.waitForTimeout(300);
	const after = await names();
	const sorts = await page.$$eval(IMG + ' .gridImages > li.gridImage .InputfieldFileSort', s => s.map(x => x.value).join(','));
	check('G drag sorts the images and renumbers them', after.join() === [before[1], before[2], before[0]].join() && sorts === '0,1,2', JSON.stringify({ before, after, sorts }));
	check('G the drag opened no edit panel', await page.evaluate((s) => !document.querySelector(s + ' .InputfieldImageEdit--active'), IMG));
	await open(NATIVE);

	// K: image upload, save round trip, delete again
	if(!process.env.NO_IMAGE_UPLOAD) {
	await page.setInputFiles(IMG + ' input[type=file]', { name: 'probe-upload.png', mimeType: 'image/png', buffer: PNG });
	const uploaded = await waitFor((s) => [...document.querySelectorAll(s + ' .gridImages > li.gridImage .gridImage__overflow img')].some(i => /probe-upload/.test(i.getAttribute('data-original') || '')) && !document.body.classList.contains('pw-uploading'), IMG, 15000);
	check('K image upload adds the image', uploaded, JSON.stringify(await names()));
	check('K still no jQuery', !(await jq()));
	check('K saved in place', await save());
	await open(NATIVE);
	const saved = (await names()).filter(n => /probe-upload/.test(n));
	check('K uploaded image persisted', saved.length === 1, JSON.stringify(await names()));
	if(saved.length) {
		const idx = (await names()).findIndex(n => /probe-upload/.test(n)) + 1;
		await page.hover(`${IMG} .gridImages > li.gridImage:nth-child(${idx})`);
		await page.click(`${IMG} .gridImages > li.gridImage:nth-child(${idx}) .gridImage__trash`);
		await save();
		await open(NATIVE);
		check('K deleting it and saving removes it', !(await names()).some(n => /probe-upload/.test(n)), JSON.stringify(await names()));
	}
	}

	// L: rejected upload
	await page.setInputFiles(IMG + ' input[type=file]', { name: 'probe.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
	check('L wrong extension reported', await waitFor((s) => /probe\.txt/.test(document.querySelector(s + ' .InputfieldImageErrors').textContent), IMG, 3000));

	// N: drop upload on the files field
	await open(NATIVE);
	await page.evaluate((s) => {
		const dt = new DataTransfer();
		dt.items.add(new File(['dropped\n'], 'probe-drop.txt', { type: 'text/plain' }));
		const content = document.querySelector(s + ' > .InputfieldContent');
		content.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
		content.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
	}, FILES);
	const dropped = await waitFor((s) => [...document.querySelectorAll(s + ' .InputfieldFileItem .InputfieldFileName')].some(a => /probe-drop/.test(a.textContent)) && !document.body.classList.contains('pw-uploading'), FILES, 15000);
	check('N drop on the files field uploads', dropped);
	await page.waitForTimeout(700);
	check('N the new file gets its tag control', await page.evaluate((s) => { const li = [...document.querySelectorAll(s + ' .InputfieldFileItem')].find(l => /probe-drop/.test(l.textContent)); return !!li && !!li.querySelector('.selectize-control'); }, FILES));

	// M: file delete mark, sort, save, clean up
	const fileDelete = await page.evaluate((s) => {
		const li = [...document.querySelectorAll(s + ' .InputfieldFileItem')].find(l => /probe-drop/.test(l.textContent));
		const box = li.querySelector('.InputfieldFileDelete input');
		box.click();
		return { marked: li.querySelector('.InputfieldFileInfo').classList.contains('ui-state-error'), dataHidden: getComputedStyle(li.querySelector('.InputfieldFileData')).display === 'none' };
	}, FILES);
	check('M file delete box marks the row and hides its data', fileDelete.marked && fileDelete.dataHidden, JSON.stringify(fileDelete));
	check('M saved in place', await save());
	await open(NATIVE);
	check('M deleted upload is gone after save', !(await page.evaluate((s) => [...document.querySelectorAll(s + ' .InputfieldFileName')].some(a => /probe-drop/.test(a.textContent)), FILES)));
	const fileNames = () => page.$$eval(FILES + ' .InputfieldFileItem .InputfieldFileName', a => a.map(x => x.textContent.trim()));
	const fb = await fileNames();
	await page.$eval(FILES, el => el.scrollIntoView({ block: 'center' }));
	const r1 = await (await page.$(FILES + ' .InputfieldFileItem:nth-child(1) .InputfieldFileInfo')).boundingBox();
	const r2 = await (await page.$(FILES + ' .InputfieldFileItem:nth-child(2)')).boundingBox();
	await page.mouse.move(r1.x + r1.width * 0.6, r1.y + r1.height / 2);
	await page.mouse.down();
	await page.mouse.move(r1.x + r1.width * 0.6, r1.y + r1.height / 2 + 10, { steps: 3 });
	await page.mouse.move(r1.x + r1.width * 0.6, r2.y + r2.height - 4, { steps: 8 });
	await page.mouse.up();
	await page.waitForTimeout(300);
	const fa = await fileNames();
	check('M drag sorts the files', fa.join() === [fb[1], fb[0]].join() && await page.evaluate((s) => document.querySelector(s).classList.contains('InputfieldStateChanged'), FILES), JSON.stringify({ fb, fa }));
	await open(NATIVE);

	// R-U (0.14.0, ADR 0018): selecting several items, dragging them together, and moving them to
	// another field of the page (bf_docs: txt pdf png jpg, two at most, no tags; bf_image: single).
	// Everything the moves change is put back through the move endpoint at the end of U.
	const DOCS = '#wrap_Inputfield_bf_docs';
	const SINGLE = '#wrap_Inputfield_bf_image';
	const tile = (n) => `${IMG} .gridImages > li.gridImage:nth-child(${n})`;
	const row = (n) => `${FILES} .InputfieldFileList > li.InputfieldFileItem:nth-child(${n})`;
	const selected = (s) => page.$$eval(s + ' .pw-selected', l => l.map(li => li.id));
	const tileIds = () => page.$$eval(IMG + ' .gridImages > li.gridImage', l => l.map(li => li.id));
	const fieldNames = (s) => page.$$eval(s + ' li[id^="file_"]', l => l.map(li => {
		const a = li.querySelector('a.InputfieldFileName');
		const img = li.querySelector('.gridImage__overflow img');
		const u = (a && a.getAttribute('href')) || (img && img.getAttribute('data-original')) || '';
		return decodeURIComponent(u.split('?')[0].split('/').pop());
	}));
	const allNames = async () => ({ images: await fieldNames(IMG), files: await fieldNames(FILES), docs: await fieldNames(DOCS), image: await fieldNames(SINGLE) });
	const md5 = (s) => require('crypto').createHash('md5').update(s).digest('hex');
	// the endpoint the drags use, called directly (restoring the fixture)
	const apiMove = (from, to, names, index = -1, resolve = '', meta = null) => page.evaluate(async ([from, to, hashes, index, resolve, meta]) => {
		const form = document.getElementById('wrap_Inputfield_' + to).closest('form');
		const token = form.querySelector('input._post_token');
		const body = new FormData();
		body.append('bridgeFilesMove', '1');
		body.append('from', from);
		body.append('to', to);
		body.append('index', String(index));
		body.append(token.name, token.value);
		const all = {};
		hashes.forEach(h => {
			body.append('ids[]', h);
			if(resolve) body.append('resolve[' + h + ']', resolve);
			if(meta) all[h] = meta;
		});
		body.append('meta', JSON.stringify(all));
		const r = await fetch(form.getAttribute('action'), { method: 'POST', body, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
		return r.json();
	}, [from, to, names.map(md5), index, resolve, meta]);
	// a drag from one element to another, held over the target so the move chunk loads (first drag)
	const dragTo = async (fromSel, toSel, fx = 0.5) => {
		const a = await (await page.$(fromSel)).boundingBox();
		const b = await (await page.$(toSel)).boundingBox();
		await page.mouse.move(a.x + a.width * fx, a.y + a.height / 2);
		await page.mouse.down();
		await page.mouse.move(a.x + a.width * fx + 10, a.y + a.height / 2 + 10, { steps: 3 });
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
		await page.waitForTimeout(700);
		await page.mouse.move(b.x + b.width / 2 + 3, b.y + b.height / 2 + 3, { steps: 2 });
		await page.waitForTimeout(200);
		const during = await page.evaluate(() => {
			const g = document.querySelector('.pw-drag-ghost');
			const ids = (c) => [...document.querySelectorAll('.' + c)].map(f => f.id);
			return { ghost: !!g, count: g ? g.getAttribute('data-pw-count') : null, ok: ids('pw-drop-ok'), partial: ids('pw-drop-partial'), no: ids('pw-drop-no'), placeholder: !!document.querySelector('.pw-drop-placeholder') };
		});
		await page.mouse.up();
		return during;
	};
	// the dialog's close event starts the move a moment after the click
	const settled = async () => { await page.waitForTimeout(400); return waitFor(() => !document.body.classList.contains('pw-uploading') && !document.querySelector('.pw-moving, .pw-drag-ghost'), null, 20000); };
	await page.setViewportSize({ width: 1300, height: 2400 });

	// R: selection
	await open(NATIVE);
	await page.$eval(IMG, el => el.scrollIntoView({ block: 'start' }));
	const ids0 = await tileIds();
	await page.click(tile(1), { modifiers: ['Control'] });
	await page.click(tile(3), { modifiers: ['Control'] });
	check('R Ctrl+click selects two images and opens nothing', (await selected(IMG)).join() === [ids0[0], ids0[2]].join()
		&& await page.evaluate((s) => !document.querySelector(s + ' .InputfieldImageEdit--active') && !document.querySelector('dialog.pw-lightbox[open]') && document.querySelector(s + ' > .InputfieldContent').classList.contains('pw-has-selection'), IMG), JSON.stringify(await selected(IMG)));
	await page.click(tile(2), { modifiers: ['Shift'] });
	check('R Shift+click selects the range from the last one toggled', (await selected(IMG)).join() === [ids0[1], ids0[2]].join(), JSON.stringify(await selected(IMG)));
	await page.keyboard.press('Escape');
	check('R Escape clears the selection', !(await selected(IMG)).length);
	await page.click(tile(1), { modifiers: ['Control'] });
	await editItem(1);
	check('R a plain click clears the selection and still opens the editor', !(await selected(IMG)).length && await page.evaluate((s) => !!document.querySelector(s + ' .InputfieldImageEdit--active'), IMG));
	await open(NATIVE);
	await page.$eval(IMG, el => el.scrollIntoView({ block: 'start' }));
	{
		const t2 = await (await page.$(tile(2))).boundingBox();
		const t3 = await (await page.$(tile(3))).boundingBox();
		// from the empty part of the grid right of the last image, left to the middle one
		await page.mouse.move(t3.x + t3.width + 40, t3.y + t3.height / 2);
		await page.mouse.down();
		await page.mouse.move(t3.x + t3.width + 30, t3.y + t3.height / 2 + 5, { steps: 3 });
		await page.mouse.move(t2.x + t2.width / 2, t2.y + t2.height / 2 + 10, { steps: 8 });
		const band = await page.evaluate(() => !!document.querySelector('.pw-marquee'));
		await page.mouse.up();
		check('R a rubber band from the grid\'s background selects the images it touches', band && (await selected(IMG)).join() === [ids0[1], ids0[2]].join(), JSON.stringify({ band, sel: await selected(IMG) }));
		check('R the band opened no editor', await page.evaluate((s) => !document.querySelector(s + ' .InputfieldImageEdit--active') && !document.querySelector('.pw-marquee'), IMG));
	}
	await page.keyboard.press('Control+a');
	check('R Ctrl+A selects every image of the field pressed last', (await selected(IMG)).length === 3, JSON.stringify(await selected(IMG)));
	await page.mouse.click(5, 5);
	check('R a press outside clears it', !(await selected(IMG)).length);

	// S: group drag in a field, trash and delete boxes of a selection
	await open(NATIVE);
	await page.$eval(IMG, el => el.scrollIntoView({ block: 'start' }));
	const sBefore = await names();
	await page.evaluate(() => { window.__sorted = 0; document.addEventListener('sorted', () => { window.__sorted++; }); });
	await page.click(tile(1), { modifiers: ['Control'] });
	await page.click(tile(3), { modifiers: ['Control'] });
	{
		const t1 = await (await page.$(tile(1))).boundingBox();
		const t3 = await (await page.$(tile(3))).boundingBox();
		await page.mouse.move(t3.x + t3.width / 2, t3.y + t3.height / 2);
		await page.mouse.down();
		await page.mouse.move(t3.x + t3.width / 2 - 20, t3.y + t3.height / 2, { steps: 3 });
		await page.mouse.move(t1.x + t1.width * 0.2, t1.y + t1.height / 2, { steps: 10 });
		const mid = await page.evaluate((s) => { const lead = document.querySelector(s + ' .pw-sorting'); return { count: lead ? lead.getAttribute('data-pw-count') : null, hidden: document.querySelectorAll(s + ' .pw-drag-member').length }; }, IMG);
		await page.mouse.up();
		await page.waitForTimeout(300);
		const sAfter = await names();
		const sorts = await page.$$eval(IMG + ' .gridImages > li.gridImage .InputfieldFileSort', s => s.map(x => x.value).join(','));
		check('S two selected images drag together, in their order', sAfter.join() === [sBefore[0], sBefore[2], sBefore[1]].join() && sorts === '0,1,2', JSON.stringify({ sBefore, sAfter, sorts }));
		check('S the lead shows the count, the other is hidden while dragging', mid.count === '2' && mid.hidden === 1, JSON.stringify(mid));
		check('S one sorted event for the group', await page.evaluate(() => window.__sorted === 1), await page.evaluate(() => window.__sorted));
	}
	await open(NATIVE);
	await page.$eval(IMG, el => el.scrollIntoView({ block: 'start' }));
	{
		const kBefore = await names();
		await page.click(tile(1), { modifiers: ['Control'] });
		await page.click(tile(2), { modifiers: ['Control'] });
		// tiles take no focus (their edit link has no href): the key goes to the tile itself
		await page.$eval(tile(1), li => li.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true })));
		const kAfter = await names();
		check('S Alt+ArrowDown moves the selected pair past the next image', kAfter.join() === [kBefore[2], kBefore[0], kBefore[1]].join(), JSON.stringify({ kBefore, kAfter }));
	}
	await open(NATIVE);
	await page.$eval(IMG, el => el.scrollIntoView({ block: 'start' }));
	await page.click(tile(1), { modifiers: ['Control'] });
	await page.click(tile(2), { modifiers: ['Control'] });
	await page.hover(tile(1));
	await page.click(tile(1) + ' .gridImage__trash');
	check('S the trash of a selected image marks every selected image', JSON.stringify(await page.$$eval(IMG + ' .gridImage__deletebox', b => b.map(x => x.checked))) === '[true,true,false]',
		JSON.stringify(await page.$$eval(IMG + ' .gridImage__deletebox', b => b.map(x => x.checked))));
	await page.$eval(FILES, el => el.scrollIntoView({ block: 'center' }));
	for(const n of [1, 2]) {
		const r = await (await page.$(row(n) + ' .InputfieldFileInfo')).boundingBox();
		await page.mouse.move(r.x + r.width * 0.6, r.y + r.height / 2);
		await page.keyboard.down('Control');
		await page.mouse.down();
		await page.mouse.up();
		await page.keyboard.up('Control');
	}
	check('S Ctrl+click selects file rows', (await selected(FILES)).length === 2, JSON.stringify(await selected(FILES)));
	await page.click(row(1) + ' .InputfieldFileDelete');
	check('S the delete box of a selected row sets every selected row', JSON.stringify(await page.$$eval(FILES + ' .InputfieldFileDelete input', b => b.map(x => x.checked))) === '[true,true]');

	// T: moves between fields (each saved at the drop)
	await open(NATIVE);
	await page.$eval(IMG, el => el.scrollIntoView({ block: 'start' }));
	const n0 = await allNames();
	await page.evaluate(() => { window.__moved = []; document.addEventListener('pw-files-moved', e => { window.__moved.push(e.target.id); }); });
	await page.fill(row(1) + ' input[name^="description_bf_files_"]', 'moved along');
	const t1 = await dragTo(row(1) + ' .InputfieldFileInfo', DOCS + ' > .InputfieldContent', 0.6);
	await settled();
	check('T a file over another file field: ghost, ok ring, placeholder', t1.ghost && t1.ok.join() === 'wrap_Inputfield_bf_docs' && t1.placeholder, JSON.stringify(t1));
	const nT1 = await allNames();
	check('T dropping moves it at once: gone from Files, in Docs', nT1.docs.join() === n0.files[0] && nT1.files.join() === n0.files.slice(1).join(), JSON.stringify(nT1));
	check('T pw-files-moved on both fields', await page.evaluate(() => window.__moved.join()) === 'wrap_Inputfield_bf_files,wrap_Inputfield_bf_docs', await page.evaluate(() => window.__moved.join()));
	await open(NATIVE);
	await page.$eval(IMG, el => el.scrollIntoView({ block: 'start' }));
	const nT1b = await allNames();
	check('T the move was saved, with the unsaved description', nT1b.docs.join() === n0.files[0] && await page.$eval(DOCS + ' input[name^="description_bf_docs_"]', i => i.value) === 'moved along', JSON.stringify(nT1b));
	check('T still no jQuery', !(await jq()));
	const t3 = await dragTo(tile(1), FILES + ' > .InputfieldContent');
	await settled();
	check('T an image over a field that takes no images: no ring, nothing moves', t3.no.join() === 'wrap_Inputfield_bf_files' && JSON.stringify(await allNames()) === JSON.stringify(nT1b), JSON.stringify(t3));
	await page.click(tile(1), { modifiers: ['Control'] });
	await page.click(tile(2), { modifiers: ['Control'] });
	const t4 = await dragTo(tile(2), DOCS + ' > .InputfieldContent');
	const ask = await waitFor(() => !!document.querySelector('dialog.pw-ask-move[open]'), null, 5000);
	const askInfo = ask ? await page.evaluate(() => ({ rows: document.querySelectorAll('dialog.pw-ask-move li').length, button: document.querySelector('dialog.pw-ask-move button[value="ok"]').textContent })) : null;
	check('T two images onto a field with room for one: partial, the dialog says one moves', t4.partial.join() === 'wrap_Inputfield_bf_docs' && t4.count === '2' && askInfo && askInfo.rows === 2 && /1/.test(askInfo.button), JSON.stringify({ t4, askInfo }));
	if(ask) await page.click('dialog.pw-ask-move button[value="ok"]');
	await settled();
	const nT4 = await allNames();
	check('T the first image moved into Docs, the other stayed', nT4.docs.length === 2 && nT4.docs.indexOf(n0.images[0]) > -1 && nT4.images.join() === n0.images.slice(1).join(), JSON.stringify(nT4));
	const t5 = await dragTo(tile(1), SINGLE + ' > .InputfieldContent');
	const ask5 = await waitFor(() => !!document.querySelector('dialog.pw-ask-move[open] select'), null, 5000);
	check('T an image onto the single image field asks Replace or Swap', t5.partial.join() === 'wrap_Inputfield_bf_image' && ask5
		&& JSON.stringify(await page.$$eval('dialog.pw-ask-move select option', o => o.map(x => x.value))) === '["replace","swap","skip"]', JSON.stringify(t5));
	if(ask5) {
		await page.selectOption('dialog.pw-ask-move select', 'swap');
		await page.click('dialog.pw-ask-move button[value="ok"]');
	}
	await settled();
	const nT5 = await allNames();
	check('T Swap exchanges the two images', nT5.image.join() === n0.images[1] && nT5.images[0] === n0.image[0], JSON.stringify(nT5));
	await open(NATIVE);
	check('T the swap was saved', JSON.stringify(await allNames()) === JSON.stringify(nT5), JSON.stringify(await allNames()));
	check('T still no jQuery, no page errors so far', !(await jq()) && !errors.length, errors.join(' | '));

	// U: back to the fixture through the endpoint
	const u1 = await apiMove('bf_docs', 'bf_images', [n0.images[0]], 0);
	const u2 = await apiMove('bf_docs', 'bf_files', [n0.files[0]], 0, '', { description: '' });
	const u3 = await apiMove('bf_images', 'bf_image', [n0.image[0]], -1, 'swap');
	const u4 = await apiMove('bf_files', 'bf_images', [n0.files[1]]);
	await open(NATIVE);
	const nU = await allNames();
	check('U the endpoint moves back, the fixture is as before', u1.ok && u2.ok && u3.ok && JSON.stringify(nU) === JSON.stringify(n0), JSON.stringify({ n0, nU }));
	check('U the endpoint refuses a txt for an image field', !u4.ok && u4.errors.length === 1 && /txt/.test(u4.errors[0].message), JSON.stringify(u4));
	await page.setViewportSize({ width: 1300, height: 950 });
	await open(NATIVE);

	// P: Crop opens the native dialog; the page and the field stay native (milestone 3.9; the
	// window itself: tools/image-select-check.js)
	await editItem(1);
	await page.click(IMG + ' .InputfieldImageEdit--active .InputfieldImageButtonCrop');
	const crop = await waitFor(() => { const d = document.querySelector('pw-dialog dialog'); return !!d && d.open && !window.jQuery; }, null, 15000);
	check('P Crop opens the native dialog without loading jQuery', crop);
	check('P the field stays native (its own toggles and slider)', await page.evaluate((s) => document.querySelectorAll(s + ' input.InputfieldImageSizeSlider').length === 1 && !document.querySelector(s + ' .ui-slider'), IMG));
	await page.evaluate(() => Bridge.dialog.close(true));

	// Q: a legacy editor keeps upstream's fields
	await open(LEGACY);
	check('Q legacy editor: upstream runs the fields', await jq() && await page.evaluate(() => !document.querySelector('[data-pw-image], [data-pw-file]') && !!document.querySelector('#wrap_Inputfield_bf_images .gridImages.ui-sortable')));

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

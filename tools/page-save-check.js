// In-place page save check (tools/page-save-check.js): drives the page editor in a real browser
// engine and verifies that Save / Publish update the page without a reload (scripts/page-save.js,
// ADR 0013) and that everything else still takes the classic submit. Restores what it changes.
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   PROBE_PASS=<sandbox bridge password> node tools/page-save-check.js <playwright-core dir>
//     <firefox|chromium|webkit>
// Base URL: the atispro sandbox (http://localhost:8089, user "bridge"); pages 1264 (cases) and
// 1224 (case: CKEditor body, image fields, the "metrics" repeater).
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'firefox';
const BASE = 'http://localhost:8089';
const ADMIN = BASE + '/fv9673g5vdfigh/';
const results = [];
const check = (name, ok, info) => { results.push({ ok: !!ok, name, info: info === undefined ? '' : String(info).slice(0, 400) }); };

(async () => {
	const browser = await pw[browserName].launch({ headless: true });
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const page = await ctx.newPage();
	page.on('dialog', d => d.accept());
	await page.goto(ADMIN);
	await page.fill('#login_name', 'bridge');
	await page.fill('#login_pass', process.env.PROBE_PASS);
	await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);

	const open = async (id, extra) => {
		await page.goto(ADMIN + 'page/edit/?id=' + id + (extra || ''), { waitUntil: 'networkidle' });
		await page.waitForTimeout(500);
	};
	// save with a button; returns { inPlace, navigated, detail }
	const save = async (selector, opts) => {
		opts = opts || {};
		await page.evaluate(() => {
			window.__pwMark = 'm' + Math.random();
			window.__pwSaved = null;
			document.addEventListener('pw-page-saved', (e) => { window.__pwSaved = e.detail; }, { once: true });
		});
		const mark = await page.evaluate(() => window.__pwMark);
		await page.click(selector, opts.shift ? { modifiers: ['Shift'] } : {});
		for(let i = 0; i < 150; i++) {
			await page.waitForTimeout(100);
			let state;
			try { state = await page.evaluate(() => ({ mark: window.__pwMark, saved: window.__pwSaved })); } catch(e) { continue; }
			if(state.mark !== mark) { await page.waitForLoadState('networkidle'); return { inPlace: false, navigated: true }; }
			if(state.saved) { await page.waitForTimeout(300); return { inPlace: true, navigated: false, detail: state.saved }; }
		}
		return { inPlace: false, navigated: false };
	};
	const val = (sel) => page.$eval(sel, el => el.value);
	const count = (sel) => page.$$eval(sel, els => els.length);

	// A: title, notices, persistence
	await open(1264);
	const title0 = await val('#Inputfield_title');
	await page.fill('#Inputfield_title', title0 + ' A');
	let r = await save('#submit_save');
	check('A save in place (no navigation)', r.inPlace, JSON.stringify(r.detail));
	check('A change counted', r.detail && r.detail.changes >= 1, r.detail && r.detail.changes);
	check('A success notice shown', await count('#notices li.pw-notice-success') > 0);
	check('A form state clean', await page.evaluate(() => !document.querySelector('#ProcessPageEdit').classList.contains('InputfieldFormSubmitted') && !document.querySelector('.InputfieldStateChanged')));
	await page.click('#notices .pw-notice-remove');
	await page.waitForTimeout(400);
	check('A notice close works after swap', await count('#notices') === 0);
	// B: change tracking still alive, repeated saves, head copy
	await page.fill('#Inputfield_title', title0 + ' B');
	check('B change tracking after swap', await count('.InputfieldStateChanged') > 0);
	r = await save('#submit_save');
	check('B second save in place', r.inPlace);
	r = await save('#submit_save_copy');
	check('B third save via head copy in place', r.inPlace);
	await open(1264);
	check('B title persisted', await val('#Inputfield_title') === title0 + ' B', await val('#Inputfield_title'));
	// G: validation error (required title) shown inline after an in-place save
	await page.fill('#Inputfield_title', '');
	r = await save('#submit_save');
	check('G save with error stays in place', r.inPlace, JSON.stringify(r.detail));
	check('G inline error on title', await count('#wrap_Inputfield_title.InputfieldStateError') > 0);
	check('G errors reported', r.detail && r.detail.errors > 0, r.detail && r.detail.errors);
	await page.fill('#Inputfield_title', title0);
	r = await save('#submit_save');
	check('G restore title', r.inPlace && await val('#Inputfield_title') === title0);

	// D: CKEditor body
	await open(1224);
	const body0 = await page.evaluate(() => CKEDITOR.instances.Inputfield_body.getData());
	await page.evaluate(() => CKEDITOR.instances.Inputfield_body.setData('<p>bridge in-place save test D</p>'));
	r = await save('#submit_save');
	check('D save in place with CKEditor', r.inPlace);
	await page.waitForTimeout(1500);
	check('D editor re-initialised after swap', await page.evaluate(() => !!(window.CKEDITOR && CKEDITOR.instances.Inputfield_body && CKEDITOR.instances.Inputfield_body.getData().indexOf('test D') > -1)));
	await open(1224);
	await page.waitForTimeout(1000);
	check('D body persisted', await page.evaluate(() => CKEDITOR.instances.Inputfield_body.getData().indexOf('test D') > -1));
	await page.evaluate((b) => CKEDITOR.instances.Inputfield_body.setData(b), body0);
	r = await save('#submit_save');
	check('D restore body', r.inPlace);

	// E: image description
	await open(1224);
	const descSel = '#wrap_Inputfield_image [name^=description_image_]';
	const desc0 = await val(descSel);
	await page.$eval(descSel, (el) => { el.value = 'bridge test E'; el.dispatchEvent(new Event('change', { bubbles: true })); });
	r = await save('#submit_save');
	check('E save in place with image description', r.inPlace);
	check('E description in swapped markup', await val(descSel) === 'bridge test E', await val(descSel));
	r = await save('#submit_save');
	check('E second save after swap', r.inPlace && await val(descSel) === 'bridge test E');
	await page.$eval(descSel, (el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, desc0);
	r = await save('#submit_save');
	check('E restore description', r.inPlace && await val(descSel) === desc0);

	// F: repeater add and delete
	await open(1224);
	const repItems = '#wrap_Inputfield_metrics .InputfieldRepeaterItem:not(.InputfieldRepeaterNewItem):not(.InputfieldRepeaterItemDeleted)';
	const n0 = await count(repItems);
	await page.click('#wrap_Inputfield_metrics .InputfieldRepeaterAddLink');
	await page.waitForTimeout(2500);
	const newItem = await page.evaluate(() => { const items = document.querySelectorAll('#wrap_Inputfield_metrics .InputfieldRepeaterItem'); const it = items[items.length - 1]; const inp = it && it.querySelector('input[type=text], textarea'); if(inp) { inp.value = 'bridge test F'; inp.dispatchEvent(new Event('change', { bubbles: true })); } return it ? it.id : null; });
	r = await save('#submit_save');
	check('F save in place with a new repeater item', r.inPlace, newItem);
	check('F item count after save', await count(repItems) === n0 + 1, (await count(repItems)) + ' vs ' + (n0 + 1));
	await open(1224);
	check('F item persisted', await count(repItems) === n0 + 1);
	await page.evaluate(() => { const items = document.querySelectorAll('#wrap_Inputfield_metrics .InputfieldRepeaterItem:not(.InputfieldRepeaterNewItem)'); const it = items[items.length - 1]; const del = it.querySelector('.InputfieldRepeaterTrash'); jQuery(del).trigger('click'); });
	r = await save('#submit_save');
	check('F save in place after deleting the item', r.inPlace);
	check('F item gone from swapped markup', await count(repItems) === n0, await count(repItems));
	await open(1224);
	check('F deletion persisted', await count(repItems) === n0);

	// H: unpublish via Settings, then Publish in place
	await open(1224);
	await page.evaluate(() => { const cb = document.querySelector('input[name="status[]"][value="2048"]'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); });
	r = await save('#submit_save');
	check('H unpublish in place', r.inPlace);
	check('H Publish and Keep Unpublished buttons appear', await count('#submit_publish') === 1 && await count('#submit_save_unpublished') === 1);
	check('H head copy of Publish', await count('#submit_publish_copy') === 1);
	r = await save('#submit_publish');
	check('H publish in place', r.inPlace);
	check('H buttons back to Save', await count('#submit_publish') === 0 && await count('#submit_save') === 1);

	// I: name change updates URL preview and View link
	await open(1224);
	await page.click('#_ProcessPageEditSettings');
	const name0 = await val('input[name=_pw_page_name]');
	await page.fill('input[name=_pw_page_name]', name0 + '-bt');
	r = await save('#submit_save');
	check('I rename in place', r.inPlace);
	check('I View link follows the new name', await page.evaluate((n) => { const a = document.querySelector('#_ProcessPageEditView'); return a && a.getAttribute('href').indexOf(n) > -1; }, name0 + '-bt'));
	check('I Settings tab kept after the swap', await page.evaluate(() => getComputedStyle(document.getElementById('ProcessPageEditSettings')).display !== 'none'));
	await page.fill('input[name=_pw_page_name]', name0);
	r = await save('#submit_save');
	check('I restore name', r.inPlace && await val('input[name=_pw_page_name]') === name0);

	// K: dropdowns after a swap
	await page.hover('#pw-nav a.pw-dropdown-toggle >> nth=1');
	await page.waitForTimeout(500);
	check('K top nav menu opens after swap', await page.evaluate(() => { const a = document.querySelectorAll('#pw-nav a.pw-dropdown-toggle')[1]; const d = jQuery(a).data('pw-dropdown-ul'); return !!(d && d[0] && getComputedStyle(d[0]).display !== 'none'); }));
	await page.mouse.move(640, 700);
	await page.waitForTimeout(400);
	const kBefore = await page.$eval('#pw-dropdown-toggle-submit_save_copy', t => t.className.split(' ').filter(c => /open|hover|disabled|init/.test(c)).join(','));
	// a real click: the pointer must be on the toggle (upstream closes click menus 1 s after the pointer leaves)
	await page.click('#pw-dropdown-toggle-submit_save_copy');
	await page.waitForTimeout(500);
	const kInfo = await page.evaluate(() => { const t = document.getElementById('pw-dropdown-toggle-submit_save_copy'); const d = t && jQuery(t).data('pw-dropdown-ul'); return { open: !!(d && d[0] && getComputedStyle(d[0]).display !== 'none'), after: t ? t.className.split(' ').filter(c => /open|hover|disabled|init/.test(c)).join(',') : 'missing', ul: !!(d && d[0]), inDoc: !!(d && d[0] && document.contains(d[0])) }; });
	kInfo.before = kBefore;
	check('K head Save dropdown opens after swap', kInfo.open, JSON.stringify(kInfo));
	await page.click('#pw-dropdown-toggle-submit_save_copy');

	// L: Enter in a text field of a multi-button form saves nothing (upstream's and the runtime's
	// Enter guard; page-save.js runs first and must step aside), on a legacy and a native editor.
	// With one button upstream lets Enter submit, so the case adds a second one (as an unpublished
	// page's Publish / Save unpublished pair would be)
	for(const id of [1264, process.env.NATIVE_ID].filter(Boolean)) {
		await open(id);
		const t0 = await val('#Inputfield_title');
		await page.evaluate(() => {
			const b = document.createElement('button');
			b.type = 'submit';
			b.name = 'bridge_check_second';
			b.textContent = 'Second';
			document.getElementById('submit_save').after(b);
			window.__pwMark = 'm' + Math.random();
			window.__pwSaved = null;
			document.addEventListener('pw-page-saved', (e) => { window.__pwSaved = e.detail; }, { once: true });
		});
		const mark = await page.evaluate(() => window.__pwMark);
		await page.fill('#Inputfield_title', t0 + ' L');
		await page.focus('#Inputfield_title');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(1500);
		const st = await page.evaluate(() => ({ mark: window.__pwMark, saved: window.__pwSaved, focus: document.activeElement ? document.activeElement.tagName + '#' + document.activeElement.id : '' })).catch(() => ({ mark: null }));
		check('L Enter in the title saves nothing (page ' + id + ')', st.mark === mark && !st.saved, JSON.stringify(st));
		check('L the focus moved to a save button (page ' + id + ')', /^BUTTON#/.test(st.focus || ''), st.focus);
		await open(id);
		const t1 = await val('#Inputfield_title');
		check('L title unchanged (page ' + id + ')', t1 === t0, t1);
		if(t1 !== t0) { await page.fill('#Inputfield_title', t0); await save('#submit_save'); }
	}

	// J: classic paths
	await open(1264);
	r = await save('#submit_save', { shift: true });
	check('J Shift+click is a classic save (reload)', r.navigated);
	await open(1264);
	await page.evaluate(() => { document.getElementById('after-submit-action').value = 'exit'; });
	r = await save('#submit_save');
	check('J Save + Exit is classic (navigates away)', r.navigated && page.url().indexOf('edit') < 0, page.url());
	await open(1264, '&modal=1');
	check('J modal editor has no in-place save', await page.evaluate(() => !(ProcessWire.config.AdminThemeBridge || {}).pageSave && ![...document.scripts].some(s => /page-save\.js/.test(s.src))));

	report();
	await browser.close();
})().catch(e => { check('run completed', false, String(e.message).split(String.fromCharCode(10))[0]); report(); process.exit(1); });

function report() {
	const failed = results.filter(x => !x.ok);
	console.log(JSON.stringify({ browser: browserName, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
}

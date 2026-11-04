// PageAutocomplete check (tools/autocomplete-check.js, 0.26.1): types a term into a page
// autocomplete, picks the first suggestion with a real click, saves the editor and reads the
// stored value back after a reload, in the places the field lives:
//   a. the multiple one (bf_pages_auto) in a native page editor (/bridge-native/, Extra tab)
//   b. the single one (bf_page_auto_one, the no_list text input) in the same editor
//   c. both in the field-zoo editor (/bridge-fixture/), where the legacy stack runs upstream's
//      script: one search request per typed term
//   d. both in the native editor after the legacy stack arrived later (legacy.load(), the handover)
//   e. the multiple one inside the tab that opens in a modal (/bridge-autocomplete/)
//   f. the single one in a repeater item inside that modal: an existing item opened (its fields
//      load by AJAX) and an item added with "Add new"; saved with the dialog's Save button
// Each case reports four facts: the menu is visible (and on top: the option is what a click at its
// place hits), the pick shows (a list row, or the label in the input), the hidden
// .InputfieldPageAutocompleteData value, and the value after save and reload. Restores what it
// changes (values emptied, added repeater items deleted).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] node tools/autocomplete-check.js <playwright-core dir>
//     <firefox|chromium|webkit>
// Admin URL and password: the sandbox's .credentials (tools/lib/sandbox.cjs), or ADMIN=<admin url>.
// Pages from tools/sandbox-fixture.php: NATIVE_ID (/bridge-native/), FIXTURE_ID (/bridge-fixture/),
// AUTO_ID (/bridge-autocomplete/); tools/lib/sandbox-ids.php prints them. AUTO_TERM: the search
// term (default: the first two letters of the title of the first page under the root).
//
// Original work, MIT.
'use strict';
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'chromium';
const sandbox = require('./lib/sandbox.cjs');
const ADMIN = sandbox.adminUrl();
const NATIVE = process.env.NATIVE_ID || '';
const FIXTURE = process.env.FIXTURE_ID || '';
const AUTO = process.env.AUTO_ID || '';
const results = [];
const check = (name, ok, info) => { results.push({ ok: !!ok, name, info: info === undefined ? '' : String(info).slice(0, 400) }); };

(async () => {
	if(!NATIVE || !FIXTURE || !AUTO) throw new Error('NATIVE_ID, FIXTURE_ID and AUTO_ID needed (php tools/lib/sandbox-ids.php <sandbox>)');
	const browser = await pw[browserName].launch({ headless: true });
	const fs = require('fs');
	const statePath = process.env.PW_STATE || '';
	const ctx = await browser.newContext(Object.assign({ viewport: { width: 1300, height: 950 } },
		statePath && fs.existsSync(statePath) ? { storageState: statePath } : {}));
	const consoleErrors = require('./console-errors')(ctx);
	const page = await ctx.newPage();
	const errors = [];
	const ignore = process.env.IGNORE_ERRORS ? new RegExp(process.env.IGNORE_ERRORS) : null;
	page.on('pageerror', e => { if(!ignore || !ignore.test(e.message + ' ' + (e.stack || ''))) errors.push(page.url().replace(ADMIN, '') + ': ' + e.message); });
	page.on('dialog', d => d.accept());
	let searches = 0;
	page.on('request', r => { if(/\/page\/search\/for\?/.test(r.url())) searches++; });

	const edit = (id, extra) => ADMIN + 'page/edit/?id=' + id + (extra || '');
	const open = async (url) => {
		await page.goto(url, { waitUntil: 'networkidle' });
		if(await page.locator('#login_name').count()) {
			await page.fill('#login_name', 'bridge');
			await page.fill('#login_pass', sandbox.password());
			await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);
			if(statePath) await ctx.storageState({ path: statePath });
			await page.goto(url, { waitUntil: 'networkidle' });
		}
		if(await page.locator('#login_name').count()) throw new Error('login failed (throttled? wrong PROBE_PASS?)');
		await page.waitForTimeout(400);
	};
	const waitFor = async (frame, fn, arg, ms = 10000) => {
		for(let t = 0; t < ms; t += 200) {
			if(await frame.evaluate(fn, arg).catch(() => false)) return true;
			await page.waitForTimeout(200);
		}
		return false;
	};
	// the editor's in-place save (ADR 0013) or a plain submit with a reload: either way the page
	// settles on the editor again
	const save = async () => {
		await page.evaluate(() => { window.__saved = null; document.addEventListener('pw-page-saved', e => { window.__saved = e.detail; }, { once: true }); });
		await Promise.all([
			page.waitForLoadState('networkidle'),
			page.click('#submit_save'),
		]);
		await waitFor(page, () => !!window.__saved || document.readyState === 'complete', null, 30000);
		await page.waitForTimeout(800);
	};
	const value = (frame, id) => frame.evaluate((i) => { const el = document.getElementById(i); return el ? el.value : null; }, id);
	const showTab = async (frame, id) => {
		// the field may sit on a WireTabs tab: open the tab that holds it
		await frame.evaluate((i) => {
			const el = document.getElementById(i);
			const tab = el && el.closest('.InputfieldFieldsetTabOpen, .WireTab');
			if(!tab || !tab.id) return;
			const a = document.querySelector('#PageEditTabs a[href="#' + tab.id + '"], .WireTabs a[href="#' + tab.id + '"]');
			if(a) a.click();
		}, id);
		await page.waitForTimeout(300);
	};

	// the search term: the start of a page title the fixture fields can find (parent_id 1)
	let term = process.env.AUTO_TERM || '';
	if(!term) {
		await open(edit(NATIVE));
		term = await page.evaluate(async (admin) => {
			const r = await fetch(admin + 'page/list/?id=1&render=JSON', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
			const j = await r.json();
			const p = (j.children || []).find(c => c.label && /\S{2}/.test(c.label.replace(/<[^>]+>/g, '')));
			return p ? p.label.replace(/<[^>]+>/g, '').trim().slice(0, 2) : '';
		}, ADMIN);
	}
	check('search term', term.length >= 2, term);

	/**
	 * Types the term into the field's search box and clicks the first suggestion. Returns the facts:
	 * menu (visible and on top), shown (row or label), value (hidden input), requests (searches)
	 */
	const pick = async (frame, id) => {
		await showTab(frame, id);
		const single = await frame.evaluate((i) => { const el = document.getElementById(i + '_input'); return !!el && el.classList.contains('no_list'); }, id);
		if(!single) {
			// empty the list first, so the picked page is a new row (a duplicate only flashes)
			await frame.evaluate((i) => {
				const ol = document.getElementById(i + '_items');
				if(!ol) return;
				ol.querySelectorAll(':scope > li:not(.itemTemplate) a.itemRemove').forEach(a => {
					a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
					// upstream (jQuery) listens with .on('click'), which a dispatched event reaches too
				});
				ol.querySelectorAll(':scope > li:not(.itemTemplate)').forEach(li => { if(li.classList.contains('delete')) li.remove(); });
			}, id);
		}
		const input = frame.locator('#' + id + '_input');
		await input.scrollIntoViewIfNeeded();
		await input.click();
		await input.fill('');
		const before = searches;
		await input.pressSequentially(term, { delay: 80 });
		// the open menu (upstream's jQuery UI keeps one hidden menu per field in the page)
		const option = frame.locator('ul.ui-autocomplete:visible li.ui-menu-item > a, ul.ui-autocomplete:visible li.ui-menu-item > div').first();
		await option.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
		await page.waitForTimeout(300);
		const requests = searches - before;
		const label = (await option.textContent().catch(() => '') || '').trim();
		// on top: what a click at the option's place hits is the option (not a field over the menu)
		const menu = !!label && await option.evaluate((a) => {
			const r = a.getBoundingClientRect();
			const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			return !!hit && (hit === a || a.contains(hit) || hit.contains(a));
		}).catch(() => false);
		let clicked = false;
		if(label) clicked = await option.click({ timeout: 3000 }).then(() => true, () => false);
		await page.waitForTimeout(500);
		// a missed click leaves the box focused: blur as a user leaving the field would
		await frame.evaluate(() => { const a = document.activeElement; if(a && a.blur) a.blur(); });
		await page.waitForTimeout(200);
		const shown = await frame.evaluate(([i, l]) => {
			const text = document.getElementById(i + '_input');
			if(text && text.classList.contains('no_list')) return text.value.trim() === l;
			const ol = document.getElementById(i + '_items');
			return !!ol && Array.from(ol.querySelectorAll(':scope > li:not(.itemTemplate) .itemLabel')).some(x => x.textContent.trim() === l);
		}, [id, label]);
		const val = await value(frame, id);
		return { label, menu, clicked, shown, value: val, requests, single };
	};
	const facts = (name, f) => {
		check(name + ': menu visible and on top', f.menu, f.label || '(no suggestion)');
		check(name + ': the pick shows', f.shown && f.clicked, JSON.stringify(f));
		check(name + ': hidden value holds the page', /^\d+(,\d+)*$/.test(f.value || '') && f.value !== '', f.value);
	};
	const empty = async (frame, id) => {
		await frame.evaluate((i) => {
			const data = document.getElementById(i);
			if(!data) return;
			const ol = document.getElementById(i + '_items');
			if(ol) ol.querySelectorAll(':scope > li:not(.itemTemplate)').forEach(li => li.remove());
			data.value = '';
			const text = document.getElementById(i + '_input');
			if(text) { text.value = ''; text.setAttribute('data-selectedLabel', ''); }
			data.dispatchEvent(new Event('change', { bubbles: true }));
		}, id);
	};

	const MULTI = 'Inputfield_bf_pages_auto';
	const ONE = 'Inputfield_bf_page_auto_one';
	const env = () => page.evaluate(() => ({ jquery: !!window.jQuery, legacy: !!(window.ProcessWireAdminTheme && ProcessWireAdminTheme.legacy && ProcessWireAdminTheme.legacy.loaded) }));

	// a, b: native editor
	await open(edit(NATIVE));
	const envA = await env();
	check('a/b native editor: no legacy stack', !envA.jquery && !envA.legacy, JSON.stringify(envA));
	const fa = await pick(page, MULTI);
	facts('a multiple, native', fa);
	const fb = await pick(page, ONE);
	facts('b single, native', fb);
	await save();
	await open(edit(NATIVE));
	check('a multiple, native: value after save and reload', fa.value && await value(page, MULTI) === fa.value, await value(page, MULTI) + ' (picked ' + fa.value + ')');
	check('b single, native: value after save and reload', fb.value && await value(page, ONE) === fb.value, await value(page, ONE) + ' (picked ' + fb.value + ')');

	// d: the same editor after the legacy stack arrived (the handover)
	await page.evaluate(() => ProcessWireAdminTheme.legacy.load());
	await waitFor(page, () => !!window.jQuery && !!(window.ProcessWireAdminTheme.handover && ProcessWireAdminTheme.handover.over), null, 15000);
	const envD = await env();
	check('d handover: the legacy stack is there', envD.jquery, JSON.stringify(envD));
	await empty(page, MULTI);
	const fd = await pick(page, MULTI);
	facts('d multiple, after handover', fd);
	check('d multiple, after handover: one search request per term', fd.requests > 0 && fd.requests <= term.length - 1, fd.requests);
	const fd1 = await pick(page, ONE);
	facts('d single, after handover', fd1);
	await save();
	await open(edit(NATIVE));
	check('d multiple, after handover: value after save and reload', fd.value && await value(page, MULTI) === fd.value, await value(page, MULTI));
	check('d single, after handover: value after save and reload', fd1.value && await value(page, ONE) === fd1.value, await value(page, ONE));
	// restore: both empty again
	await empty(page, MULTI);
	await empty(page, ONE);
	await save();

	// c: the field-zoo editor (legacy stack, upstream's script)
	await open(edit(FIXTURE));
	const envC = await env();
	check('c field zoo: the legacy stack runs', envC.jquery, JSON.stringify(envC));
	const keepMulti = await value(page, MULTI);
	const fc = await pick(page, MULTI);
	facts('c multiple, legacy', fc);
	check('c multiple, legacy: one search request per term', fc.requests > 0 && fc.requests <= term.length - 1, fc.requests);
	const fc1 = await pick(page, ONE);
	facts('c single, legacy', fc1);
	await save();
	await open(edit(FIXTURE));
	check('c multiple, legacy: value after save and reload', fc.value && await value(page, MULTI) === fc.value, await value(page, MULTI));
	check('c single, legacy: value after save and reload', fc1.value && await value(page, ONE) === fc1.value, await value(page, ONE));
	// restore: the fixture's own list (three pages) and an empty single
	await page.evaluate(([i, ids]) => {
		const data = document.getElementById(i);
		if(data) data.value = ids;
		const ol = document.getElementById(i + '_items');
		if(ol) ol.querySelectorAll(':scope > li:not(.itemTemplate)').forEach(li => li.remove());
	}, [MULTI, keepMulti]);
	await empty(page, ONE);
	await save();
	await open(edit(FIXTURE));
	check('c restore: the field zoo keeps its pages', await value(page, MULTI) === keepMulti, await value(page, MULTI) + ' / ' + keepMulti);

	// e, f: the tab that opens in a modal
	const R = '#wrap_Inputfield_ba_results';
	const itemsSel = R + ' > .InputfieldContent > .Inputfields > .InputfieldRepeaterItem:not(.InputfieldRepeaterNewItem)';
	const openModal = async () => {
		await open(edit(AUTO));
		const link = page.locator('a.pw-modal[href*="field=ba_tab"]').first();
		check('e/f the Results tab is a modal link', await link.count() === 1);
		await link.click();
		// the iframe sits in pw-dialog's shadow root: look for it among the page's frames
		let frame = null;
		for(let t = 0; t < 10000 && !frame; t += 200) {
			frame = page.frames().find(f => /field=ba_tab/.test(f.url())) || null;
			if(!frame) await page.waitForTimeout(200);
		}
		if(!frame) throw new Error('the modal did not open');
		await frame.waitForLoadState('networkidle');
		await waitFor(frame, (s) => !!document.querySelector(s), R, 10000);
		await page.waitForTimeout(500);
		return frame;
	};
	const saveModal = async () => {
		const button = page.locator('pw-dialog button, dialog button, .ui-dialog-buttonpane button').filter({ hasText: /^\s*Save\s*$/ }).first();
		await button.click();
		// data-autoclose: the dialog closes after the save (its frame goes)
		for(let t = 0; t < 30000 && page.frames().some(f => /field=ba_tab/.test(f.url())); t += 200) await page.waitForTimeout(200);
		await page.waitForTimeout(800);
	};
	const openItem = async (frame, itemId) => {
		const sel = `${R} .InputfieldRepeaterItem[data-page="${itemId}"]`;
		const collapsed = await frame.evaluate((s) => { const el = document.querySelector(s); return !!el && el.classList.contains('InputfieldStateCollapsed'); }, sel);
		if(collapsed) await frame.click(sel + ' > .InputfieldHeader .InputfieldRepeaterItemLabel');
		await waitFor(frame, (s) => !!document.querySelector(s + ' .InputfieldPageAutocompleteData'), sel, 10000);
		await page.waitForTimeout(500);
		return frame.evaluate((s) => { const d = document.querySelector(s + ' .InputfieldPageAutocompleteData'); return d ? d.id : ''; }, sel);
	};
	const itemIds = (frame) => frame.$$eval(itemsSel, l => l.map(i => i.getAttribute('data-page')));

	let frame = await openModal();
	const envE = await frame.evaluate(() => ({ jquery: !!window.jQuery }));
	check('e/f modal editor: no legacy stack', !envE.jquery, JSON.stringify(envE));
	const fe = await pick(frame, MULTI);
	facts('e multiple, in the modal', fe);
	const ids0 = await itemIds(frame);
	const first = ids0[0];
	const oneId = first ? await openItem(frame, first) : '';
	check('f existing item: its fields load', !!oneId, oneId);
	const ff = oneId ? await pick(frame, oneId) : { menu: false, shown: false, clicked: false, value: '' };
	facts('f single, existing repeater item in the modal', ff);
	// Add new: the item and its fields come by AJAX
	await frame.$eval(R + ' .InputfieldRepeaterAddLink', el => el.scrollIntoView({ block: 'center' }));
	await frame.click(R + ' .InputfieldRepeaterAddLink');
	await waitFor(frame, ([s, n]) => document.querySelectorAll(s).length === n + 1, [itemsSel, ids0.length], 10000);
	const ids1 = await itemIds(frame);
	const addedId = ids1.find(i => ids0.indexOf(i) < 0) || '';
	const newOne = addedId ? await openItem(frame, addedId) : '';
	check('f Add new: the item and its fields load', !!newOne, addedId + ' ' + newOne);
	const fn = newOne ? await pick(frame, newOne) : { menu: false, shown: false, clicked: false, value: '' };
	facts('f single, added repeater item in the modal', fn);
	if(newOne) await frame.fill(`${R} .InputfieldRepeaterItem[data-page="${addedId}"] input[name^="bf_text"]`, 'Added by autocomplete-check');
	await saveModal();
	frame = await openModal();
	check('e multiple, in the modal: value after save and reload', fe.value && await value(frame, MULTI) === fe.value, await value(frame, MULTI));
	const oneAfter = first ? await openItem(frame, first) : '';
	check('f single, existing item: value after save and reload', ff.value && oneAfter && await value(frame, oneAfter) === ff.value, oneAfter && await value(frame, oneAfter));
	const newAfter = addedId && (await itemIds(frame)).indexOf(addedId) > -1 ? await openItem(frame, addedId) : '';
	check('f single, added item: value after save and reload', fn.value && newAfter && await value(frame, newAfter) === fn.value, newAfter && await value(frame, newAfter));

	// restore: the multiple and the first item's single empty, items beyond the fixture's two deleted
	await empty(frame, MULTI);
	if(oneAfter) await empty(frame, oneAfter);
	await frame.evaluate((s) => {
		const list = [...document.querySelectorAll(s)];
		const keep = list.map(i => parseInt(i.getAttribute('data-page'), 10)).sort((a, b) => a - b).slice(0, 2);
		list.forEach(i => {
			if(keep.indexOf(parseInt(i.getAttribute('data-page'), 10)) > -1) return;
			const box = document.getElementById('delete_repeater' + i.getAttribute('data-page'));
			if(box) box.checked = true;
		});
	}, itemsSel);
	await saveModal();
	frame = await openModal();
	check('restore: the modal fields are empty and two items remain', await value(frame, MULTI) === '' && (await itemIds(frame)).length === 2, (await value(frame, MULTI)) + ' / ' + JSON.stringify(await itemIds(frame)));

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

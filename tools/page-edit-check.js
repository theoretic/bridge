// Native page editor check (tools/page-edit-check.js, milestone 3.1, ADR 0016): drives the page
// editor of the native fixture pages in a real browser engine and verifies that it runs without
// jQuery: native WireTabs (scripts/wire-tabs.js), the editor's own behaviours
// (scripts/page-edit.js), page name and title (runtime fields/pagename.ts), in-place save, and
// the Children tab's page tree (native since milestone 3.4). Also checks that a legacy
// editor still runs upstream's initPageEditForm(). Restores what it changes.
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] PROBE_PASS=<sandbox bridge password> node tools/page-edit-check.js
//     <playwright-core dir> <firefox|chromium|webkit>
// Admin URL: the atispro sandbox (http://localhost:8089, user "bridge"), or ADMIN=<admin url>. Pages from
// tools/sandbox-fixture.php: /bridge-native/ (NATIVE_ID, default 1517) and /bridge-native-parent/
// (PARENT_ID, default 1518); a legacy editor: 1264 (LEGACY_ID).
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'firefox';
const ADMIN = process.env.ADMIN || 'http://localhost:8089/fv9673g5vdfigh/';
const NATIVE = process.env.NATIVE_ID || '1517';
const PARENT = process.env.PARENT_ID || '1518';
const LEGACY = process.env.LEGACY_ID || '1264';
const results = [];
const check = (name, ok, info) => { results.push({ ok: !!ok, name, info: info === undefined ? '' : String(info).slice(0, 400) }); };

(async () => {
	const browser = await pw[browserName].launch({ headless: true });
	// PW_STATE=<file>: reuse a saved login (repeated logins trip ProcessWire's login throttle)
	const fs = require('fs');
	const statePath = process.env.PW_STATE || '';
	const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } },
		statePath && fs.existsSync(statePath) ? { storageState: statePath } : {}));
	const page = await ctx.newPage();
	const errors = [];
	const ignore = process.env.IGNORE_ERRORS ? new RegExp(process.env.IGNORE_ERRORS) : null;
	page.on('pageerror', e => { if(!ignore || !ignore.test(e.message)) errors.push(e.message); });
	let dialogs = [];
	let dialogAnswer = true;
	page.on('dialog', d => { dialogs.push(d.message()); dialogAnswer ? d.accept() : d.dismiss(); });

	const open = async (id, extra) => {
		await page.goto(ADMIN + 'page/edit/?id=' + id + (extra || ''), { waitUntil: 'networkidle' });
		if(await page.locator('#login_name').count()) {
			await page.fill('#login_name', 'bridge');
			await page.fill('#login_pass', process.env.PROBE_PASS);
			await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);
			if(statePath) await ctx.storageState({ path: statePath });
			await page.goto(ADMIN + 'page/edit/?id=' + id + (extra || ''), { waitUntil: 'networkidle' });
		}
		if(await page.locator('#login_name').count()) throw new Error('login failed (throttled? wrong PROBE_PASS?)');
		await page.waitForTimeout(400);
	};
	const mark = () => page.evaluate(() => { window.__pwMark = 'm' + Math.random(); window.__pwSaved = null;
		document.addEventListener('pw-page-saved', (e) => { window.__pwSaved = e.detail; }, { once: true }); return window.__pwMark; });
	// click a save button; returns { inPlace, navigated }
	const save = async (selector, opts) => {
		const m = await mark();
		await page.click(selector, opts && opts.shift ? { modifiers: ['Shift'] } : {});
		for(let i = 0; i < 150; i++) {
			await page.waitForTimeout(100);
			let state;
			try { state = await page.evaluate(() => ({ mark: window.__pwMark, saved: window.__pwSaved })); } catch(e) { continue; }
			if(state.mark !== m) { await page.waitForLoadState('networkidle'); await page.waitForTimeout(300); return { inPlace: false, navigated: true }; }
			if(state.saved) { await page.waitForTimeout(300); return { inPlace: true, navigated: false, detail: state.saved }; }
		}
		return { inPlace: false, navigated: false };
	};
	const tabs = () => page.evaluate(() => ({
		active: [...document.querySelectorAll('#PageEditTabs a.on')].map(a => a.id),
		shown: [...document.querySelectorAll('#ProcessPageEdit > .Inputfields > .InputfieldWrapper')].filter(w => getComputedStyle(w).display !== 'none').map(w => w.id),
	}));
	const jq = () => page.evaluate(() => !!window.jQuery);
	const shown = (sel) => page.evaluate((sel) => { const el = document.querySelector(sel); return !!el && el.offsetParent !== null; }, sel);

	// A: a native editor loads no jQuery and builds its tabs
	await open(NATIVE);
	check('A no jQuery, no legacy stack', !(await jq()) && await page.evaluate(() => !ProcessWire.config.AdminThemeBridge.legacy), JSON.stringify(await page.evaluate(() => ProcessWire.config.AdminThemeBridge.legacyReasons)));
	check('A native editor scripts printed', await page.evaluate(() => [...document.scripts].filter(s => /scripts\/(wire-tabs|page-edit)\.js/.test(s.src)).length === 2));
	let t = await tabs();
	check('A first tab active, only its content shown', t.active.join() === '_ProcessPageEditContent' && t.shown.join() === 'ProcessPageEditContent', JSON.stringify(t));
	check('A form carries the active tab class', await page.evaluate(() => document.getElementById('ProcessPageEdit').classList.contains('_ProcessPageEditContent')));

	// B: switching tabs, with the native event
	await page.evaluate(() => { window.__tabEv = []; document.addEventListener('pw-wiretabs-change', e => window.__tabEv.push((e.detail.tab || {}).id + '<' + (e.detail.previous || {}).id)); });
	await page.click('#_Inputfield_bf_tab');
	t = await tabs();
	check('B custom tab shows its content only', t.active.join() === '_Inputfield_bf_tab' && t.shown.join() === 'Inputfield_bf_tab', JSON.stringify(t));
	check('B pw-wiretabs-change sent', (await page.evaluate(() => window.__tabEv)).join() === 'Inputfield_bf_tab<ProcessPageEditContent', JSON.stringify(await page.evaluate(() => window.__tabEv)));
	check('B form class follows the tab', await page.evaluate(() => { const c = document.getElementById('ProcessPageEdit').classList; return c.contains('_Inputfield_bf_tab') && !c.contains('_ProcessPageEditContent'); }));
	check('B fields in the tab work (asmSelect built)', await page.locator('#wrap_Inputfield_bf_pages_asm .asmContainer').count() > 0);

	// C: tab from the URL
	await open(NATIVE, '&WireTab=ProcessPageEditSettings');
	t = await tabs();
	check('C ?WireTab= opens that tab', t.active.join() === '_ProcessPageEditSettings', JSON.stringify(t));
	await open(NATIVE, '#Inputfield_bf_tab');
	t = await tabs();
	check('C #hash opens that tab, hash cleared', t.active.join() === '_Inputfield_bf_tab' && await page.evaluate(() => location.hash.length <= 1), JSON.stringify(t) + ' ' + await page.evaluate(() => location.hash));

	// D: content head title follows the title field
	await open(NATIVE);
	const title0 = await page.inputValue('#Inputfield_title');
	await page.click('#Inputfield_title');
	await page.keyboard.press('End');
	await page.keyboard.type(' typed');
	check('D headline follows the title', (await page.textContent('#pw-content-title')).trim() === title0 + ' typed', await page.textContent('#pw-content-title'));
	await page.fill('#Inputfield_title', '');
	await page.dispatchEvent('#Inputfield_title', 'input');
	check('D empty title shows the original headline', (await page.textContent('#pw-content-title')).trim() === title0);
	await page.fill('#Inputfield_title', title0);

	// E: page name preview and sanitizing
	await page.click('#_ProcessPageEditSettings');
	const name0 = await page.inputValue('#Inputfield__pw_page_name');
	await page.fill('#Inputfield__pw_page_name', '');
	await page.click('#Inputfield__pw_page_name');
	await page.keyboard.type('Hello World 42');
	check('E preview shows the sanitized name', (await page.textContent('#Inputfield__pw_page_name_path strong')) === 'hello-world-42/', await page.textContent('#Inputfield__pw_page_name_path'));
	await page.click('#pw-content-title');
	check('E leaving the input sanitizes it', await page.inputValue('#Inputfield__pw_page_name') === 'hello-world-42', await page.inputValue('#Inputfield__pw_page_name'));
	await page.fill('#Inputfield__pw_page_name', name0);
	await page.dispatchEvent('#Inputfield__pw_page_name', 'blur');

	// F: Save dropdown (native stand-in), template change switches it off
	await open(NATIVE);
	check('F Save has a dropdown, head copy too', await page.locator('#pw-dropdown-toggle-submit_save').count() === 1 && await page.locator('#pw-dropdown-toggle-submit_save_copy').count() === 1);
	await page.click('#pw-dropdown-toggle-submit_save_copy');
	await page.waitForTimeout(300);
	check('F dropdown lists the after-save actions', await page.evaluate(() => { const t = document.getElementById('pw-dropdown-toggle-submit_save_copy'); const ul = t && t.parentNode.querySelector('ul.pw-dropdown-menu'); return !!ul && getComputedStyle(ul).display !== 'none' && ul.querySelectorAll('a[data-pw-dropdown-value]').length > 0; }));
	await page.keyboard.press('Escape');
	await page.mouse.click(5, 600);
	// the template select loads by AJAX when its field opens
	await page.click('#_ProcessPageEditSettings');
	await page.click('#ProcessPageEditSettings .Inputfield_template > .InputfieldHeader');
	await page.waitForSelector('select#template', { timeout: 10000 });
	const tplInfo = await page.evaluate(() => {
		const s = document.getElementById('template');
		if(!s) return null;
		const other = [...s.options].find(o => o.value && o.value !== s.value);
		if(!other) return null;
		const orig = s.value;
		const vis = () => [...document.querySelectorAll('.pw-button-dropdown-toggle')].map(t => t.style.display !== 'none');
		s.value = other.value; s.dispatchEvent(new Event('change', { bubbles: true }));
		const off = vis();
		s.value = orig; s.dispatchEvent(new Event('change', { bubbles: true }));
		return { off, on: vis() };
	});
	check('F changed template hides the dropdowns, revert shows them', tplInfo && tplInfo.off.every(v => !v) && tplInfo.on.every(Boolean), JSON.stringify(tplInfo));
	await page.click('#_ProcessPageEditContent');

	// H: Delete tab hides the other buttons; delete needs its confirm box
	await page.click('#_ProcessPageEditDelete');
	check('H Delete tab hides Save', !(await shown('#wrap_submit_save')) && await page.locator('#wrap_submit_save.pw-hidden-tmp').count() === 1);
	let m = await mark();
	await page.click('#submit_delete');
	await page.waitForTimeout(600);
	check('H Delete without its confirm box does nothing', await page.evaluate(() => window.__pwMark) === m && await page.locator('input[type=hidden][name=submit_delete]').count() === 0);
	await page.click('#_ProcessPageEditContent');
	check('H leaving the Delete tab restores Save', await shown('#wrap_submit_save') && await page.locator('.pw-hidden-tmp').count() === 0);

	// I: in-place save keeps the native editor
	await open(NATIVE);
	const text0 = await page.inputValue('#Inputfield_bf_text');
	await page.fill('#Inputfield_bf_text', 'native ' + Date.now());
	const text1 = await page.inputValue('#Inputfield_bf_text');
	await page.click('#_Inputfield_bf_tab');
	let r = await save('#submit_save_copy');
	check('I save in place', r.inPlace, JSON.stringify(r));
	check('I still no jQuery after the save', !(await jq()));
	t = await tabs();
	check('I tab kept after the save', t.active.join() === '_Inputfield_bf_tab' && t.shown.join() === 'Inputfield_bf_tab', JSON.stringify(t));
	check('I one dropdown per Save button after the save', await page.locator('#pw-dropdown-toggle-submit_save').count() === 1 && await page.locator('#pw-dropdown-toggle-submit_save_copy').count() === 1);
	await page.click('#_ProcessPageEditContent');
	t = await tabs();
	check('I tabs work after the save', t.active.join() === '_ProcessPageEditContent' && t.shown.join() === 'ProcessPageEditContent', JSON.stringify(t));
	check('I value saved', await page.inputValue('#Inputfield_bf_text') === text1);
	await page.fill('#Inputfield_bf_text', text0);
	r = await save('#submit_save');
	check('I restore saved in place', r.inPlace);

	// J: a classic save remembers the tab once
	await page.click('#_ProcessPageEditSettings');
	r = await save('#submit_save', { shift: true });
	t = await tabs();
	check('J classic save reloads into the same tab', r.navigated && t.active.join() === '_ProcessPageEditSettings', JSON.stringify(r) + JSON.stringify(t));
	await open(NATIVE);
	t = await tabs();
	check('J the remembered tab is used once', t.active.join() === '_ProcessPageEditContent', JSON.stringify(t));

	// K: a save while an upload runs asks first
	dialogs = [];
	dialogAnswer = false;
	await page.evaluate(() => document.body.classList.add('pw-uploading'));
	m = await mark();
	await page.click('#submit_save');
	await page.waitForTimeout(800);
	check('K upload in progress: asks, cancel keeps the page', dialogs.length === 1 && await page.evaluate(() => window.__pwMark) === m && !(await page.evaluate(() => window.__pwSaved)), JSON.stringify(dialogs));
	dialogAnswer = true;
	await page.evaluate(() => document.body.classList.remove('pw-uploading'));

	// L: the Children tab's page tree (native since milestone 3.4) opens without the stack
	await open(PARENT);
	check('L parent editor starts without jQuery', !(await jq()), JSON.stringify(await page.evaluate(() => ProcessWire.config.AdminThemeBridge.legacyReasons)));
	await page.click('#_ProcessPageEditChildren');
	let listed = false;
	for(let i = 0; i < 50 && !listed; i++) {
		await page.waitForTimeout(200);
		listed = await page.evaluate(() => /Child A/.test((document.getElementById('ProcessPageEditChildren') || {}).textContent || '') && !!document.querySelector('#ProcessPageEditChildren .PageListItem'));
	}
	check('L Children tab shows the page tree, still no jQuery', listed && !(await jq()), await page.evaluate(() => ((document.getElementById('ProcessPageEditChildren') || {}).textContent || '').replace(/\s+/g, ' ').slice(0, 200)));

	// M: a legacy editor still runs upstream
	await open(LEGACY);
	check('M legacy editor: jQuery and upstream initPageEditForm', await jq() && await page.evaluate(() => typeof initPageEditForm === 'function' && ![...document.scripts].some(s => /scripts\/page-edit\.js/.test(s.src))));
	await page.click('#_ProcessPageEditSettings');
	t = await tabs();
	check('M legacy editor tabs work', t.active.join() === '_ProcessPageEditSettings', JSON.stringify(t));

	check('no page errors', errors.length === 0, errors.join(' | '));
	report();
	await browser.close();
})().catch(e => { check('run completed', false, String(e.message).split(String.fromCharCode(10))[0]); report(); process.exit(1); });

function report() {
	const failed = results.filter(x => !x.ok);
	console.log(JSON.stringify({ browser: browserName, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
	if(failed.length) process.exitCode = 1;
}

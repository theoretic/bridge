// Native Lister check (tools/lister-check.js, milestone 3.5, ADR 0016): drives the Lister
// (ProcessPageLister, page/lister/) in a real browser engine and verifies that it works without
// jQuery: tabs, results by POST, pager, column sort, a filter, an added column, row actions and
// extras, an AJAX action with the row refreshed, the refresh tab, the ProcessLister API, mobile
// labels (AdminDataTable). Resets the Lister at the end (its filters and columns live in the
// session).
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] PROBE_PASS=<sandbox bridge password> node tools/lister-check.js
//     <playwright-core dir> <firefox|chromium|webkit>
// Admin URL: the atispro sandbox (http://localhost:8089, user "bridge"), or ADMIN=<admin url>.
// Uses the fixture pages of tools/sandbox-fixture.php ("Bridge native", the page table rows).
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'firefox';
const ADMIN = process.env.ADMIN || 'http://localhost:8089/fv9673g5vdfigh/';
const results = [];
const check = (name, ok, info) => { results.push({ ok: !!ok, name, info: info === undefined ? '' : String(info).slice(0, 400) }); };

(async () => {
	const browser = await pw[browserName].launch({ headless: true });
	const fs = require('fs');
	const statePath = process.env.PW_STATE || '';
	const ctx = await browser.newContext(Object.assign({ viewport: { width: 1300, height: 950 } },
		statePath && fs.existsSync(statePath) ? { storageState: statePath } : {}));
	const page = await ctx.newPage();
	const errors = [];
	const ignore = process.env.IGNORE_ERRORS ? new RegExp(process.env.IGNORE_ERRORS) : null;
	page.on('pageerror', e => { if(!ignore || !ignore.test(e.message)) errors.push(e.message); });
	page.on('dialog', d => d.accept());

	const open = async (path) => {
		await page.goto(ADMIN + path, { waitUntil: 'networkidle' });
		if(await page.locator('#login_name').count()) {
			await page.fill('#login_name', 'bridge');
			await page.fill('#login_pass', process.env.PROBE_PASS);
			await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);
			// the page after login (a Lister) posts for its results 250 ms after load: let that finish,
			// or a following ?reset=1 can be served first and the results come back for an emptied
			// session (that race once made "no page errors" fail at random)
			await page.waitForLoadState('networkidle');
			if(statePath) await ctx.storageState({ path: statePath });
			await page.goto(ADMIN + path, { waitUntil: 'networkidle' });
		}
		if(await page.locator('#login_name').count()) throw new Error('login failed (throttled? wrong PROBE_PASS?)');
		await page.waitForTimeout(500);
	};
	const waitFor = async (fn, arg, ms = 10000) => {
		for(let t = 0; t < ms; t += 200) {
			if(await page.evaluate(fn, arg)) return true;
			await page.waitForTimeout(200);
		}
		return false;
	};
	const headline = () => page.evaluate(() => ((document.querySelector('#ProcessListerResults .lister_headline') || {}).textContent || '').replace(/\s+/g, ' ').trim());
	const loaded = (re) => waitFor((src) => { const h = document.querySelector('#ProcessListerResults .lister_headline'); return !!h && !h.querySelector('.fa-spin') && new RegExp(src).test(h.textContent); }, re.source, 15000);

	// A: native Lister
	await open('page/lister/?reset=1');
	await open('page/lister/');
	check('A no jQuery on the Lister', !(await page.evaluate(() => !!window.jQuery)), JSON.stringify(await page.evaluate(() => ProcessWire.config.AdminThemeBridge.legacyReasons)));
	check('A results load', await loaded(/1 to \d+ of \d+/), await headline());
	check('A tabs: Filters, Columns, Bookmarks, refresh, reset', await page.evaluate(() => document.querySelectorAll('#ProcessLister > ul.WireTabs a').length === 5));
	check('A the ProcessLister API is there (native)', await page.evaluate(() => !!(window.ProcessLister && ProcessLister.native && typeof ProcessLister.refreshRow === 'function')));

	// B: pager
	await page.click('#ProcessListerResults .MarkupPagerNav a[href$="page2"]');
	check('B pager loads page 2', await loaded(/26 to/), await headline());

	// C: column sort
	await page.click('#ProcessListerResults .ProcessListerTable thead th:nth-child(1)');
	await loaded(/1 to/);
	const asc = await page.evaluate(() => ({ sort: document.getElementById('lister_sort').value, th: document.querySelector('.ProcessListerTable thead th').innerHTML }));
	check('C a header click sorts by it', asc.sort === 'title' && /<u>/.test(asc.th) && /↓|&darr;/.test(asc.th), JSON.stringify(asc));
	await page.click('#ProcessListerResults .ProcessListerTable thead th:nth-child(1)');
	await page.waitForTimeout(400);
	await loaded(/1 to/);
	check('C again reverses it', await page.evaluate(() => document.getElementById('lister_sort').value === '-title'));

	// D: a filter (the title row of the native selector)
	const before = await headline();
	const titleInput = await page.evaluateHandle(() => {
		const inputs = [...document.querySelectorAll('#wrap_ProcessListerFilters input[type=text]')].filter(i => i.offsetParent !== null);
		return inputs[inputs.length - 1];
	});
	await titleInput.asElement().fill('Bridge native');
	await titleInput.asElement().press('Tab');
	check('D a filter narrows the results', await waitFor((b) => { const h = document.querySelector('#ProcessListerResults .lister_headline'); return !!h && !h.querySelector('.fa-spin') && h.textContent.replace(/\s+/g, ' ').trim() !== b && document.querySelectorAll('#ProcessListerResults tbody tr').length >= 1 && document.querySelectorAll('#ProcessListerResults tbody tr').length < 25; }, before, 15000), await headline());
	check('D the filter is in the selector value', await page.evaluate(() => /Bridge native/.test(document.getElementById('ProcessListerFilters').value)), await page.evaluate(() => document.getElementById('ProcessListerFilters').value));

	// F, G: row actions, extras, an AJAX action
	const rowSel = await page.evaluate(() => { const a = [...document.querySelectorAll('#ProcessListerResults a.actions_toggle')].find(x => /Bridge native/.test(x.textContent)); return a ? '#' + a.id : ''; });
	check('F the fixture page is listed', !!rowSel, rowSel);
	if(rowSel) {
		await page.click(rowSel);
		check('F a title shows its actions', await page.evaluate((s) => { const a = document.querySelector(s).nextElementSibling; return !!a && a.offsetParent !== null && !!a.querySelector('.PageEdit'); }, rowSel));
		await page.click(rowSel + ' + .actions .PageExtras');
		check('F Extras shows the extra actions', await page.evaluate((s) => [...document.querySelector(s).nextElementSibling.querySelectorAll('.PageExtra')].some(a => a.offsetParent !== null), rowSel));
		const hidden0 = await page.evaluate((s) => /PageListStatusHidden|secondary/.test(document.querySelector(s).innerHTML), rowSel);
		const label = hidden0 ? /Unhide/ : /^Hide$/;
		const idx = await page.evaluate(([s, src]) => [...document.querySelector(s).nextElementSibling.querySelectorAll('.PageExtra')].findIndex(a => new RegExp(src).test(a.textContent.trim())), [rowSel, label.source]);
		if(idx > -1) {
			await page.locator(rowSel + ' + .actions .PageExtra').nth(idx).click();
			const refreshed = await waitFor((s) => !!document.querySelector('[class*="row_refreshed_"]') && !!document.querySelector(s), rowSel, 15000);
			check('G an AJAX action refreshes the row', refreshed);
			await page.waitForTimeout(1600);
			// undo: the opposite action
			if(!(await page.evaluate((s) => document.querySelector(s).nextElementSibling.offsetParent !== null, rowSel))) await page.click(rowSel);
			await page.click(rowSel + ' + .actions .PageExtras');
			const back = await page.evaluate(([s, src]) => [...document.querySelector(s).nextElementSibling.querySelectorAll('.PageExtra')].findIndex(a => new RegExp(src).test(a.textContent.trim())), [rowSel, hidden0 ? '^Hide$' : 'Unhide']);
			if(back > -1) { await page.locator(rowSel + ' + .actions .PageExtra').nth(back).click(); await page.waitForTimeout(2500); }
			check('G the opposite action restores it', back > -1);
		} else {
			check('G an AJAX action refreshes the row', false, 'no Hide/Unhide extra');
		}
	}

	// E: an added column
	await open('page/lister/');
	await loaded(/1 to/);
	const cols0 = await page.$$eval('.ProcessListerTable thead th', t => t.length);
	await page.evaluate(() => {
		const s = document.getElementById('lister_columns');
		const o = [...s.options].find(x => !x.selected && /^(id|name)$/.test(x.value)) || [...s.options].find(x => !x.selected);
		o.selected = true;
		s.dispatchEvent(new Event('change', { bubbles: true }));
	});
	check('E a new column shows in the results', await waitFor((n) => document.querySelectorAll('.ProcessListerTable thead th').length === n + 1, cols0, 15000), cols0);

	// H, I: refresh tab, API
	await page.click('#_ProcessListerRefreshTab');
	check('H the refresh tab reloads the results', await loaded(/1 to/));
	const firstID = await page.$eval('#ProcessListerResults tbody tr', tr => tr.getAttribute('data-pid'));
	await page.evaluate((id) => ProcessLister.refreshRow(id, 'refreshed by the API'), firstID);
	check('I ProcessLister.refreshRow() refreshes that row', await waitFor((id) => !!document.querySelector('.row_refreshed_' + id), firstID, 15000));

	// J: mobile labels (AdminDataTable)
	await page.setViewportSize({ width: 600, height: 900 });
	await page.evaluate(() => window.dispatchEvent(new Event('resize')));
	check('J narrow screen: cells get their column labels', await waitFor(() => !!document.querySelector('.ProcessListerTable.AdminDataTableMobile td > .th'), null, 5000));
	await page.setViewportSize({ width: 1300, height: 950 });

	await open('page/lister/?reset=1');

	// L: the results' ProcessListerScript part is jQuery code from core ($.getScript chains for
	// scripts the session has not loaded, $.extend(config, configAdd)). A reset elsewhere in the same
	// session (another tab: the request below, redirect not followed, so no page render records the
	// files again) empties that record, and the next results carry the whole payload. On a page
	// without jQuery nothing may throw, and the config must still arrive
	await open('page/lister/');
	await loaded(/1 to/);
	const errorsBeforeL = errors.length;
	await ctx.request.get(ADMIN + 'page/lister/?reset=1', { maxRedirects: 0 }).catch(() => {});
	let payload = '';
	const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().indexOf('/page/lister/') > -1, { timeout: 15000 }).catch(() => null);
	await page.click('#_ProcessListerRefreshTab');
	const r = await response;
	if(r) { try { const m = (await r.text()).match(/id=['"]?ProcessListerScript['"]?>([\s\S]*?)<\/div>/); if(m) payload = m[1]; } catch(e) {} }
	await loaded(/1 to/);
	await page.waitForTimeout(600);
	let configKeys = [];
	try { configKeys = Object.keys(JSON.parse((payload.match(/var configAdd=(\{[\s\S]*?\});/) || [])[1] || '{}')); } catch(e) {}
	const merged = configKeys.length ? await page.evaluate((keys) => keys.every(k => k in ProcessWire.config), configKeys) : false;
	check('L a results payload for a reset session (getScript, configAdd) throws nothing', /getScript|configAdd/.test(payload) && errors.length === errorsBeforeL, payload.slice(0, 100) + ' | ' + errors.slice(errorsBeforeL).join(' | '));
	check('L its config keys reach ProcessWire.config', merged, configKeys.join(','));
	await open('page/lister/?reset=1');

	// K: no layout shift while the filters initialise and the results arrive (Lighthouse CLS)
	const page2 = await ctx.newPage();
	await page2.addInitScript(() => {
		window.__cls = 0;
		window.__clsSupported = (PerformanceObserver.supportedEntryTypes || []).indexOf('layout-shift') > -1;
		if(window.__clsSupported) new PerformanceObserver(list => { for(const e of list.getEntries()) if(!e.hadRecentInput) window.__cls += e.value; })
			.observe({ type: 'layout-shift', buffered: true });
	});
	await page2.goto(ADMIN + 'page/lister/', { waitUntil: 'networkidle' });
	await page2.waitForFunction(() => document.querySelector('#ProcessListerResults tbody tr'), null, { timeout: 15000 }).catch(() => {});
	await page2.waitForTimeout(500);
	const cls = await page2.evaluate(() => window.__clsSupported ? window.__cls : -1);
	if(cls < 0) check('K layout shift: not measurable in ' + browserName + ' (Chromium only), skipped', true);
	else check('K the Lister loads without layout shift (CLS < 0.1)', cls < 0.1, cls.toFixed(3));
	await page2.close();

	check('no page errors', errors.length === 0, errors.join(' | '));
	report();
	await browser.close();
})().catch(e => { check('run completed', false, String(e.message).split(String.fromCharCode(10))[0]); report(); process.exit(1); });

function report() {
	const failed = results.filter(x => !x.ok);
	console.log(JSON.stringify({ browser: browserName, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
	if(failed.length) process.exitCode = 1;
}

// New-tab check (tools/new-tab-check.js, AdminThemeBridge 1.3.0): Ctrl+click (Cmd+click on a Mac)
// and middle click on the admin's link-like elements open them in a new tab and leave this one
// where it was: the module list's Settings, Install and Delete (posts, caught before they reach
// the server: nothing is installed or deleted), a page title in the tree and in the Lister (the
// page's editor), the tree's Edit, the head copy of Add New (a button inside a link), an asmSelect
// edit link and a PageTable row (dialog links, opened without modal=1). A plain click on Settings
// still goes there in this tab.
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] PROBE_PASS=<sandbox bridge password> node tools/new-tab-check.js
//     <playwright-core dir> <firefox|chromium|webkit>
// Admin URL and password: the sandbox's .credentials (tools/lib/sandbox.cjs), or ADMIN=<admin url>.
// Uses tools/sandbox-fixture.php's template "bridge_native" and its page (NATIVE_ID, default 1517,
// with bf_pagetable). A module list without an uninstalled or deleteable module reports that case
// as not found, not as failed.
//
// Original work, MIT.
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'firefox';
const sandbox = require('./lib/sandbox.cjs');
const ADMIN = sandbox.adminUrl();
const NATIVE_ID = process.env.NATIVE_ID || 1517;
const KEY = process.platform === 'darwin' ? 'Meta' : 'Control';
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
	page.on('pageerror', e => { if(!ignore || !ignore.test(e.message)) errors.push(page.url().replace(ADMIN, '') + ': ' + e.message); });
	page.on('dialog', d => d.accept());

	// Install and Delete never reach the server: any post with install= or delete= gets a stub
	const posts = [];
	await ctx.route(url => /\/module\/?$/.test(url.pathname), async route => {
		const req = route.request();
		const body = req.method() === 'POST' ? (req.postData() || '') : '';
		if(/(^|&)(install|delete)=/.test(body)) {
			posts.push(body);
			return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>new-tab-check: post stopped</p>' });
		}
		return route.continue();
	});

	const open = async (path) => {
		await page.goto(ADMIN + path, { waitUntil: 'networkidle' });
		if(await page.locator('#login_name').count()) {
			await page.fill('#login_name', 'bridge');
			await page.fill('#login_pass', sandbox.password());
			await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);
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

	/**
	 * Click with the new-tab key (how: 'key') or the middle button ('middle'); answer the theme's
	 * confirm when one opens. Returns the new tab's URL (after its first load), whether a post was
	 * stopped, and whether this tab stayed where it was.
	 */
	const inNewTab = async (locator, how) => {
		const here = page.url();
		const before = posts.length;
		const opened = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
		await locator.click(how === 'middle' ? { button: 'middle' } : { modifiers: [KEY] });
		// a confirm (Delete, Install with missing requirements): OK
		if(await waitFor(() => !!document.querySelector('dialog.pw-ask[open]'), null, 1500)) {
			await page.click('dialog.pw-ask[open] button[value="ok"]');
		}
		const tab = await opened;
		let url = '';
		if(tab) {
			await tab.waitForLoadState('domcontentloaded').catch(() => {});
			url = tab.url();
			await tab.close();
		}
		await page.waitForTimeout(300);
		return { url: url.replace(ADMIN, ''), post: posts.slice(before).join(' '), stayed: page.url() === here };
	};
	const both = async (label, locator, test) => {
		for(const how of ['key', 'middle']) {
			if(!(await locator.count())) { check(`${label} (${how})`, false, 'not found'); continue; }
			await locator.scrollIntoViewIfNeeded();
			const r = await inNewTab(locator, how);
			check(`${label} (${how === 'key' ? KEY : 'middle'} click)`, r.stayed && test(r), JSON.stringify(r));
		}
	};
	// a module list tab holding the element: shown
	const showTabOf = (selector) => page.evaluate(sel => {
		const el = [...document.querySelectorAll(sel)][0];
		const tab = el ? el.closest('.WireTab') : null;
		const link = tab ? (document.getElementById('_' + tab.id) || document.querySelector(`a[href="#${tab.id}"]`)) : null;
		if(link) link.click();
		return !!el;
	}, selector);

	// A: the module list
	await open('module/');
	await showTabOf('button.ProcessModuleSettings');
	const settings = page.locator('button.ProcessModuleSettings:visible').first();
	await both('A Settings opens the module\'s settings', settings, r => /module\/edit\?name=\w+.*collapse_info=1/.test(r.url));
	if(await showTabOf('button[data-install]')) {
		await both('A Install posts in a new tab', page.locator('button[data-install]:visible').first(), r => /(^|&)install=/.test(r.post) && /module\/?(\?|$)/.test(r.url));
		check('A Install has no formtarget left', await page.evaluate(() => [...document.querySelectorAll('button[data-install]')].every(b => !b.hasAttribute('formtarget'))));
	} else {
		check('A an uninstalled module (sandbox)', true, 'not found: Install not checked');
	}
	if(await showTabOf('button[data-delete]')) {
		await both('A Delete asks, then posts in a new tab', page.locator('button[data-delete]:visible').first(), r => /(^|&)delete=/.test(r.post));
	} else {
		check('A a deleteable module (sandbox)', true, 'not found: Delete not checked');
	}
	await open('module/');
	await showTabOf('button.ProcessModuleSettings');
	await Promise.all([page.waitForURL(/module\/edit\?name=/, { timeout: 10000 }).catch(() => {}), page.locator('button.ProcessModuleSettings:visible').first().click()]);
	check('A a plain click on Settings stays in this tab', /module\/edit\?name=\w+.*collapse_info=1/.test(page.url()), page.url());

	// B: the page tree
	await open('page/');
	await waitFor(() => !!document.querySelector('.PageListItem .PageListActionEdit a'));
	const title = page.locator('.PageListItem:has(> .PageListActions .PageListActionEdit) > a.PageListPage').first();
	const openBefore = await page.evaluate(() => document.querySelectorAll('.PageListItemOpen').length);
	await both('B a tree title opens the page\'s editor', title, r => /page\/edit\/\?id=\d+/.test(r.url));
	check('B the tree title did not open or close its row', await page.evaluate(() => document.querySelectorAll('.PageListItemOpen').length) === openBefore);
	// its actions show on hover
	await title.hover();
	await both('B the tree\'s Edit (a dialog on a long press) opens the editor', page.locator('.PageListActionEdit a').first(), r => /page\/edit\/\?id=\d+/.test(r.url) && !/modal=/.test(r.url));

	// C: the Lister
	await open('page/lister/');
	await waitFor(() => !!document.querySelector('table.ProcessListerTable a.actions_toggle'));
	await both('C a Lister title opens the page\'s editor', page.locator('table.ProcessListerTable a.actions_toggle').first(), r => /page\/edit\/\?id=\d+/.test(r.url));
	check('C the Lister title did not show its actions', await page.evaluate(() => !document.querySelector('table.ProcessListerTable tr.open')));

	// D: templates: Add New's head copy, an asmSelect edit link in the fixture template
	await open('setup/template/');
	await both('D the head copy of Add New (a button in a link)', page.locator('#pw-content-head-buttons a > button').first(), r => /setup\/template\/add/.test(r.url));
	const tplHref = await page.evaluate(() => { const a = [...document.querySelectorAll('a')].find(x => x.textContent.trim() === 'bridge_native'); return a ? a.getAttribute('href') : ''; });
	await open('setup/template/' + tplHref.replace(/^.*?(edit\?id=\d+).*$/, '$1'));
	await waitFor(() => !!document.querySelector('#wrap_fieldgroup_fields .asmListItem a[href*="edit"]'));
	await both('D an asmSelect edit link (a dialog) opens the field editor', page.locator('#wrap_fieldgroup_fields .asmListItem a[href*="edit"]').first(), r => /field\/edit/.test(r.url) && !/modal=/.test(r.url));
	check('D no dialog opened', await page.evaluate(() => !document.querySelector('pw-dialog dialog[open]')));

	// E: a PageTable row (a dialog) in the fixture page
	await open('page/edit/?id=' + NATIVE_ID);
	await page.evaluate(() => { if(window.Inputfields) Inputfields.open('#wrap_Inputfield_bf_pagetable'); });
	await waitFor(() => !!document.querySelector('#wrap_Inputfield_bf_pagetable .InputfieldPageTableEdit'));
	await both('E a PageTable row opens its page\'s editor', page.locator('#wrap_Inputfield_bf_pagetable .InputfieldPageTableEdit').first(), r => /page\/edit\/\?id=\d+/.test(r.url) && !/modal=/.test(r.url));
	check('E no dialog opened', await page.evaluate(() => !document.querySelector('pw-dialog dialog[open]')));

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

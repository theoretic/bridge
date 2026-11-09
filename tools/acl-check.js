// Admin access control check (tools/acl-check.js, BridgeAdminAccessControl): rules set on the
// module's config screen as `bridge` reach `acl`'s open session on its next load (A0, A, B), an
// allow exception and a forged Lister filter (C), the custom top-level item under four denied
// menus and the landing page (C2, C3), the same enforcement under AdminThemeUikit and two roles
// (E), the cleanup through the config screen (D). The negative tests go by direct URL and XHR.
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
// Run alone: it logs in as four sandbox users and changes the sandbox's rules.
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   TREE_ID= NATIVE_ID= FIXTURE_ID= AUTO_ID= CUSTOM_MENU_ID= [PW_STATE=<bridge's login state file>]
//     [PHP=<php>] [SANDBOX=<sandbox root>] node tools/acl-check.js <playwright-core dir> [chromium|firefox|webkit]
// PowerShell: $env:TREE_ID = '...' (each variable), then node tools/acl-check.js <dir> chromium
// The ids: php tools/lib/sandbox-ids.php <sandbox>. Admin URL and logins: the sandbox's .credentials
// (tools/lib/sandbox.cjs). Only `bridge` uses PW_STATE; every other user has its own context.
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'chromium';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const sandbox = require('./lib/sandbox.cjs');
const watchConsole = require('./console-errors');

const ADMIN = sandbox.adminUrl();
const PHP = process.env.PHP || 'php';
const SANDBOX = sandbox.info().root;
const CONFIG = 'module/edit?name=BridgeAdminAccessControl';
const DENIED = 'You do not have access to this section.';
const PHPERR = /Fatal error|Warning:|Uncaught|Exception/;
const ITEM = 'Tree item 01', SIBLING = 'Tree item 02';
const ids = {};
for(const n of ['TREE_ID', 'NATIVE_ID', 'FIXTURE_ID', 'AUTO_ID', 'CUSTOM_MENU_ID']) {
	ids[n] = parseInt(process.env[n] || '', 10);
	if(!ids[n]) { console.error(n + ' is not set: export the ids of tools/lib/sandbox-ids.php'); process.exit(2); }
}
const { TREE_ID: TREE, NATIVE_ID: NATIVE, FIXTURE_ID: FIXTURE, AUTO_ID: AUTO, CUSTOM_MENU_ID: CUSTOM } = ids;

const results = [];
const check = (name, ok, info) => { results.push({ ok: !!ok, name, info: info === undefined ? '' : String(info).slice(0, 400) }); };
const report = () => {
	const failed = results.filter(x => !x.ok);
	console.log(JSON.stringify({ browser: browserName, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
	if(failed.length) process.exitCode = 1;
};
const preset = (name) => execFileSync(PHP, [path.join(sandbox.REPO, 'tools', 'sandbox-acl.php'), SANDBOX, name], { encoding: 'utf8' });

const ignore = process.env.IGNORE_ERRORS ? new RegExp(process.env.IGNORE_ERRORS) : null;
const pageErrors = [];
const watches = [];

/** A context of its own for one user, signed in (or from PW_STATE, for `bridge`) */
async function session(browser, user, statePath, watched) {
	const useState = statePath && fs.existsSync(statePath);
	const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 950 } }, useState ? { storageState: statePath } : {}));
	const consoleErrors = watched ? watchConsole(ctx) : null;
	if(consoleErrors) watches.push(consoleErrors);
	const page = await ctx.newPage();
	page.moduleErrors = [];
	page.on('pageerror', e => {
		if(/BridgeAdminAccess|_acl_/.test(e.message)) page.moduleErrors.push(e.message);
		if(watched && (!ignore || !ignore.test(e.message))) pageErrors.push(user + ' ' + page.url() + ': ' + e.message);
	});
	page.on('console', m => { if(m.type() === 'error' && /BridgeAdminAccess|_acl_/.test(m.text())) page.moduleErrors.push(m.text()); });
	page.on('dialog', d => d.accept());
	page.response = null;
	page.go = async (p) => {
		page.response = await page.goto(ADMIN + p, { waitUntil: 'networkidle' });
		if(await page.locator('#login_name').count() && user === 'bridge') await signIn(page, user, ctx, statePath, p);
		await page.waitForTimeout(250);
	};
	await page.goto(ADMIN, { waitUntil: 'networkidle' });
	if(await page.locator('#login_name').count()) await signIn(page, user, ctx, statePath, '');
	return page;
}
async function signIn(page, user, ctx, statePath, then) {
	await page.fill('#login_name', user);
	await page.fill('#login_pass', sandbox.password(user));
	await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);
	await page.waitForLoadState('networkidle');
	if(await page.locator('#login_name').count()) throw new Error('login failed for ' + user + ' (throttled?)');
	if(statePath) await ctx.storageState({ path: statePath });
	if(then) page.response = await page.goto(ADMIN + then, { waitUntil: 'networkidle' });
}

const text = (page) => page.evaluate(() => document.body.innerText);
const xhr = (page, url) => page.evaluate(async u => (await fetch(u, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).text(), ADMIN + url);
const json = async (page, url) => { const s = await xhr(page, url); try { return JSON.parse(s); } catch(e) { return { unparsed: s.slice(0, 300) }; } };
const childIds = (j) => (j.children || []).map(c => +c.id);
const hasAction = (j, id, re) => { const c = (j.children || []).find(x => +x.id === id); return !!c && (c.actions || []).some(a => re.test(String(a.cn))); };
const hasEdit = (j, id) => hasAction(j, id, /edit/i);
const hasNew = (j, id) => hasAction(j, id, /new/i);
/** The last path segment of each top-level item of the Bridge masthead: page, setup, ... */
const nav = (page) => page.$$eval('.pw-primary-nav > li > a', a => a.map(x => x.getAttribute('href').replace(/\/+$/, '').split('/').pop()));
const treeRows = async (page) => { await page.waitForSelector('.PageListItem', { timeout: 10000 }); await page.waitForTimeout(300); };
const form = (page) => page.locator('#ProcessPageEdit').count();

const search = async (page, q) => { await page.go('page/search/?q=' + encodeURIComponent(q)); await page.waitForTimeout(500); return text(page); };
const live = (page, q) => xhr(page, 'page/search/live/?q=' + encodeURIComponent(q));
const lister = async (page) => {
	await page.go('page/lister/');
	await page.waitForSelector('.ListerTable, #ProcessListerResults', { timeout: 10000 }).catch(() => {});
	await page.waitForTimeout(1200);
	return page.evaluate(() => { const r = document.querySelector('#ProcessListerResults') || document.body; return { head: (r.querySelector('h2') || {}).textContent || '', text: r.innerText }; });
};
const total = (s) => { const m = /of\s+([\d,]+)/.exec(s); return m ? parseInt(m[1].replace(/,/g, ''), 10) : -1; };
/** Filters POSTed to the Lister as a form would, with the page's token */
const listerPost = async (page, filters) => {
	const out = await page.evaluate(async ({ url, filters }) => {
		const d = new DOMParser().parseFromString(await (await fetch(url)).text(), 'text/html');
		const tok = d.querySelector('input[name^="TOKEN"]');
		const fd = new FormData();
		if(tok) fd.append(tok.name, tok.value);
		fd.append('filters', filters);
		fd.append('columns', 'ignore');
		fd.append('render_results', '1');
		const r = await fetch(url, { method: 'POST', body: fd, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
		return await r.text();
	}, { url: ADMIN + 'page/lister/', filters });
	return { head: (/\d+ to \d+ of \d+|No results/.exec(out) || [''])[0], items: [...new Set(out.match(/Tree item \d+/g) || [])], err: PHPERR.test(out) };
};
/** Types into the autocomplete on the fixture page's modal tab: what the menu's request answers */
const autocomplete = async (page, term) => {
	await page.go('page/edit/?id=' + AUTO);
	const href = await page.locator('a.pw-modal[href*="field=ba_tab"]').first().getAttribute('href');
	await page.goto(new URL(href, page.url()).href, { waitUntil: 'networkidle' });
	const input = page.locator('[id$=bf_pages_auto_input]').first();
	await input.click({ timeout: 5000 });
	const wait = page.waitForResponse(r => /\/page\/search\/for\?/.test(r.url()), { timeout: 8000 }).catch(() => null);
	await input.pressSequentially(term, { delay: 60 });
	const r = await wait;
	await page.waitForTimeout(500);
	let j = {};
	if(r) { try { j = JSON.parse(await r.text()); } catch(e) {} }
	return { answered: !!r, ids: (j.matches || []).map(m => +m.id) };
};

// the config screen as a user: Bridge saves it in place (pw-form-saved), Uikit the classic way
const roleId = (page, name) => page.evaluate(n => {
	for(const w of document.querySelectorAll('[class*="Inputfield__acl_set_"]')) {
		if(w.querySelector('.InputfieldHeader').textContent.trim() === 'Role: ' + n) return +/Inputfield__acl_set_(\d+)/.exec(w.className)[1];
	}
	return 0;
}, name);
const openSet = async (page, r) => {
	const w = page.locator('.Inputfield__acl_set_' + r);
	if(await w.evaluate(e => e.classList.contains('InputfieldStateCollapsed'))) await w.locator('> .InputfieldHeader').first().click();
	await page.waitForTimeout(350);
};
const save = async (page) => {
	if(await page.evaluate(() => !!window.jQuery)) {
		await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.locator('button[name=submit_save_module]').first().click()]);
		await page.waitForTimeout(200);
		return;
	}
	await page.evaluate(() => { window.__saved = 0; document.addEventListener('pw-form-saved', () => { window.__saved++; }, { once: true }); });
	await page.locator('button[name=submit_save_module]').first().click();
	await page.waitForFunction(() => window.__saved > 0, null, { timeout: 20000 });
	await page.waitForTimeout(700);
};
/** Picks a page in a role's "Add rule" tree: `through` are the ids to open on the way */
const pick = async (page, r, id, through) => {
	const w = page.locator('#wrap_Inputfield__acl_page_' + r);
	await w.locator('a.PageListSelectActionToggleStart').click();
	await w.locator('.PageListItem').first().waitFor({ timeout: 8000 });
	await page.waitForTimeout(400);
	for(const t of through || []) {
		await w.locator('.PageListID' + t + ' a.PageListPage').first().click();
		await w.locator('.PageListID' + id).first().waitFor({ timeout: 8000 });
		await page.waitForTimeout(400);
	}
	await w.locator('.PageListID' + id + ' a.PageListPage').first().click();
	await page.waitForTimeout(400);
	await w.locator('.PageListID' + id + ' .PageListActionSelect a').first().click();
	await page.waitForTimeout(400);
	return +(await page.inputValue('#Inputfield__acl_page_' + r));
};
const menuBox = (page, r, id) => page.locator('[name="_acl_menus_' + r + '[]"][value="' + id + '"]');
const SETUP = 22;

(async () => {
	preset('clear');
	const browser = await pw[browserName].launch({ headless: true });
	try {
		// A0: `acl` signs in first, so its menu is in its session before any rule exists
		const acl = await session(browser, 'acl', '', true);
		await acl.go('page/');
		await treeRows(acl);
		const baseNav = await nav(acl);
		check('A0 acl: the menu lists Pages, Setup and the custom item, no Modules, no Access', baseNav.includes('page') && baseNav.includes('setup') && baseNav.includes('bridge-custom-menu')
			&& !baseNav.includes('module') && !baseNav.includes('access'), baseNav);
		check('A0 acl: /bridge-tree/ is in the tree', await acl.locator('.PageListID' + TREE).count() === 1);
		// read-only control for the add test of B: a GET of page/add/ here would create a page (one allowed template)
		const baseRoot = await json(acl, 'page/?id=1&render=JSON&mode=actions');
		check('A0 baseline: /bridge-tree/ offers Edit and New', hasEdit(baseRoot, TREE) && hasNew(baseRoot, TREE), JSON.stringify((baseRoot.children || []).find(c => +c.id === TREE) || baseRoot).slice(0, 300));
		const baseAuto = await autocomplete(acl, 'Bridge');
		check('A0 baseline: the autocomplete offers /bridge-tree/', baseAuto.ids.includes(TREE), baseAuto.ids);
		check('A0 baseline: search finds a tree item', (await search(acl, ITEM)).includes(ITEM));
		check('A0 baseline: live search finds it', (await live(acl, ITEM)).includes(ITEM));
		const baseLister = await lister(acl);
		check('A0 baseline: the Lister counts the tree', total(baseLister.head) > 60, baseLister.head);

		// A: the rules, through the config screen
		const bridge = await session(browser, 'bridge', process.env.PW_STATE || '', true);
		await bridge.go(CONFIG);
		check('A config screen: no jQuery', !(await bridge.evaluate(() => !!window.jQuery)));
		const R1 = await roleId(bridge, 'acl-editor');
		const R2 = await roleId(bridge, 'acl-restricted');
		check('A config screen: the fieldsets of the two roles', R1 > 0 && R2 > 0, R1 + ' ' + R2);
		await openSet(bridge, R1);
		check('A /bridge-tree/ picked', await pick(bridge, R1, TREE) === TREE);
		await menuBox(bridge, R1, SETUP).uncheck({ force: true });
		await save(bridge);
		await bridge.go(CONFIG);
		check('A saved: the table lists /bridge-tree/, Setup is unticked', await bridge.locator('.Inputfield__acl_rules_' + R1 + ' table td', { hasText: '/bridge-tree/' }).count() === 1
			&& !(await menuBox(bridge, R1, SETUP).isChecked()));

		// B: the same open `acl` session, no new login
		await acl.go('page/');
		await treeRows(acl);
		const nav1 = await nav(acl);
		check('B the menu has no Setup without a new login', !nav1.includes('setup') && nav1.includes('page'), nav1);
		check('B the tree has no /bridge-tree/ row', await acl.locator('.PageListID' + TREE).count() === 0);
		const root = await json(acl, 'page/?id=1&render=JSON');
		check('B root JSON: no /bridge-tree/ child, other children', !childIds(root).includes(TREE) && childIds(root).length > 0, JSON.stringify(childIds(root)));
		const denied = await json(acl, 'page/?id=' + TREE + '&render=JSON');
		check('B denied JSON: the error, no children', denied.error === true && denied.children === undefined, JSON.stringify(denied));
		await acl.go('page/edit/?id=' + TREE);
		check('B edit of the denied page: no form, a notice', await form(acl) === 0 && await acl.locator('#notices li').count() > 0, (await text(acl)).slice(0, 200));
		await acl.go('page/edit/?id=' + NATIVE);
		check('B edit of another page has the form', await form(acl) === 1);
		await acl.go('page/add/?parent_id=' + TREE);
		const added = await text(acl);
		check('B add under the denied page: an error, no add form, no page created', await acl.locator('#notices li.NoticeError').count() > 0 && await acl.locator('#ProcessPageAdd').count() === 0
			&& !acl.url().includes('page/edit') && await form(acl) === 0, acl.url() + ' ' + added.slice(0, 200));
		check('B search: no tree item', !(await search(acl, ITEM)).includes(ITEM));
		check('B live search: no match', !(await live(acl, ITEM)).includes(ITEM));
		const auto1 = await autocomplete(acl, 'Bridge');
		check('B the autocomplete offers no /bridge-tree/, still answers for others', auto1.answered && !auto1.ids.includes(TREE) && auto1.ids.length > 0, auto1.ids);
		const list1 = await lister(acl);
		check('B Lister: 61 pages less, no tree item', total(baseLister.head) - total(list1.head) === 61 && !/Tree item \d/.test(list1.text), baseLister.head + ' -> ' + list1.head);
		await acl.go('setup/');
		check('B setup/ denied', (await text(acl)).includes(DENIED));
		await acl.go('setup/bridge-demo/');
		check('B setup/bridge-demo/ denied', (await text(acl)).includes(DENIED));
		await acl.go(CONFIG);
		check('B the config screen is refused to acl (core)', await acl.locator('[name^=_acl_]').count() === 0);
		await acl.go('');
		check('B the admin home lands on the page tree (Pages allowed)', /\/page\/?$/.test(new URL(acl.url()).pathname), acl.url());

		// C: an allow exception on a child, and the forged Lister filter against it
		const kids = await json(bridge, 'page/?id=' + TREE + '&render=JSON');
		const E = childIds(kids)[0], S = childIds(kids)[1];
		await bridge.go(CONFIG);
		check('C the exception child picked', E > 0 && await pick(bridge, R1, E, [TREE]) === E, E);
		await bridge.locator('[name=_acl_mode_' + R1 + '][value=allow]').check({ force: true });
		await save(bridge);

		await acl.go('page/');
		await treeRows(acl);
		check('C /bridge-tree/ is back in the tree', await acl.locator('.PageListID' + TREE).count() === 1);
		const root2 = await json(acl, 'page/?id=1&render=JSON&mode=actions');
		check('C /bridge-tree/ has no edit action', childIds(root2).includes(TREE) && !hasEdit(root2, TREE), JSON.stringify((root2.children || []).find(c => +c.id === TREE) || root2).slice(0, 300));
		const kids2 = await json(acl, 'page/?id=' + TREE + '&render=JSON&mode=actions');
		check('C the exception child has an edit action, its sibling is not listed', hasEdit(kids2, E) && !childIds(kids2).includes(S), JSON.stringify(childIds(kids2)));
		await acl.go('page/edit/?id=' + TREE);
		check('C edit of the pass-through parent: no form', await form(acl) === 0);
		await acl.go('page/edit/?id=' + E);
		check('C edit of the exception child: the form', await form(acl) === 1);
		await acl.go('page/lister/');
		const plain = await listerPost(acl, 'template=bridge_pt_item');
		const forged = await listerPost(acl, 'template=bridge_pt_item, r' + TREE + '=(id>0)');
		check('C Lister baseline: the exception is listed, its sibling is not', plain.items.includes(ITEM) && !plain.items.includes(SIBLING), JSON.stringify(plain));
		check('C a forged Lister filter joins nothing: same rows, no denied item', forged.head === plain.head && forged.items.length === plain.items.length && !forged.items.includes(SIBLING) && !forged.err, JSON.stringify({ plain, forged }));

		// C2: the four core menus denied: the custom item stays
		preset('deny-all-menus');
		const rCustom = await acl.goto(ADMIN + 'bridge-custom-menu/', { waitUntil: 'networkidle' });
		const customText = await text(acl);
		check('C2 the custom item: 200, the demo, no denial', rCustom.status() === 200 && await acl.locator('#BridgeDemoTabs').count() === 1 && !customText.includes(DENIED) && !PHPERR.test(customText), customText.slice(0, 200));
		const nav2 = await nav(acl);
		check('C2 the menu lists the custom item and none of the four', nav2.includes('bridge-custom-menu') && !['page', 'setup', 'module', 'access'].some(n => nav2.includes(n)), nav2);
		check('C2 no tree drawer button (Pages denied)', await acl.locator('[data-pw-drawer="tree"]').count() === 0 && await acl.locator('#pw-drawer-tree').count() === 0);
		await acl.go('');
		check('C2 the admin home lands on the custom item', /bridge-custom-menu\/?$/.test(new URL(acl.url()).pathname), acl.url());
		await acl.go('page/');
		check('C2 page/ denied', (await text(acl)).includes(DENIED));
		await acl.go('access/');
		check('C2 access/ denied', (await text(acl)).includes(DENIED));

		// C3: Pages denied alone: the landing page and the drawers
		preset('deny-pages');
		await acl.go('');
		check('C3 the admin home lands on Setup, not on a denial', /\/setup\/?$/.test(new URL(acl.url()).pathname) && !(await text(acl)).includes(DENIED), acl.url());
		const nav3 = await nav(acl);
		check('C3 the menu has no Pages, keeps Setup', !nav3.includes('page') && nav3.includes('setup'), nav3);
		check('C3 no tree drawer button, the history stays', await acl.locator('[data-pw-drawer="tree"]').count() === 0 && await acl.locator('[data-pw-drawer="history"]').count() === 1);
		await acl.go('setup/bridge-demo/');
		check('C3 setup/bridge-demo/ works, no tree drawer button', await acl.locator('#BridgeDemoTabs').count() === 1 && await acl.locator('[data-pw-drawer="tree"]').count() === 0);

		// E: another theme, two roles
		preset('two-roles');
		await bridge.go(CONFIG);
		await openSet(bridge, R1);
		check('E /bridge-tree/ picked', await pick(bridge, R1, TREE) === TREE);
		await menuBox(bridge, R1, SETUP).uncheck({ force: true });
		await save(bridge);
		const acl2 = await session(browser, 'acl2', '', false);
		await acl2.go('page/');
		check('E acl2 is on Uikit', await acl2.evaluate(() => !!document.querySelector('#pw-masthead') && !!document.querySelector('[class*="uk-"]')));
		const uikitTexts = [await text(acl2)];
		await acl2.go('page/edit/?id=' + TREE);
		uikitTexts.push(await text(acl2));
		check('E edit of the denied page: no form, a notice', await form(acl2) === 0 && await acl2.locator('.pw-notices li, #notices li, .NoticeError').count() > 0, uikitTexts[1].slice(0, 200));
		await acl2.go('page/edit/?id=' + NATIVE);
		uikitTexts.push(await text(acl2));
		check('E edit of the page one role denies: no form, a notice (any deny wins)', await form(acl2) === 0 && await acl2.locator('.pw-notices li, #notices li, .NoticeError').count() > 0, uikitTexts[2].slice(0, 200));
		const root3 = await json(acl2, 'page/?id=1&render=JSON');
		check('E root JSON has neither denied page', childIds(root3).length > 0 && !childIds(root3).includes(TREE) && !childIds(root3).includes(NATIVE), JSON.stringify(childIds(root3)));
		await acl2.go('page/edit/?id=' + FIXTURE);
		uikitTexts.push(await text(acl2));
		check('E edit of a free page has the form', await form(acl2) === 1);
		check('E no PHP error text', !uikitTexts.some(t => PHPERR.test(t)));

		const uikit = await session(browser, 'uikit', '', false);
		await uikit.go(CONFIG);
		const ut = await uikit.evaluate(() => ({ sets: document.querySelectorAll('[class*="Inputfield__acl_set_"]').length, uk: !!document.querySelector('[class*="uk-"]') }));
		const uText = await text(uikit);
		check('E uikit: the config screen renders, 200, no PHP error text', uikit.response.status() === 200 && ut.sets >= 2 && ut.uk && !PHPERR.test(uText), JSON.stringify(ut));
		check('E uikit: no console error from the module', uikit.moduleErrors.length === 0 && acl2.moduleErrors.length === 0, uikit.moduleErrors.concat(acl2.moduleErrors).join(' | '));

		// D: the cleanup through the config screen, the preset only as a belt
		await bridge.go(CONFIG);
		for(const r of [R1, R2]) {
			await openSet(bridge, r);
			const boxes = bridge.locator('[name="_acl_remove_' + r + '[]"]');
			for(let i = 0; i < await boxes.count(); i++) await boxes.nth(i).check({ force: true });
		}
		await menuBox(bridge, R1, SETUP).check({ force: true });
		await save(bridge);
		const belt = preset('clear');
		check('D the config screen left no rule', /rules before: 0\)/.test(belt), belt.split('\n')[0]);
		await acl.go('page/');
		await treeRows(acl);
		check('D acl: Setup is back, without a new login', (await nav(acl)).includes('setup'));
		await acl.go('page/edit/?id=' + TREE);
		check('D acl: the tree page is editable again', await form(acl) === 1);

		check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
		for(const w of watches) await w.settle();
		watches.forEach((w, i) => w.check((n, ok, info) => check(n + (i ? ' (bridge)' : ' (acl)'), ok, info)));
	} finally {
		preset('clear');
		await browser.close();
	}
	report();
})().catch(e => { check('run completed', false, String(e.message).split(String.fromCharCode(10))[0]); report(); process.exit(1); });

// Native page tree check (tools/pagetree-check.js, milestone 3.4, ADR 0016): drives the page tree
// (ProcessPageList, "actions" mode) in a real browser engine and verifies that it works without
// jQuery: open and close with the remembered state, hover actions, Edit as a link and a long press
// into the native dialog, pagination and More, extra actions over AJAX (hide, unhide), moving a
// page (drag, saved order), pageListRefresh. Restores what it changes.
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] PROBE_PASS=<sandbox bridge password> node tools/pagetree-check.js
//     <playwright-core dir> <firefox|chromium|webkit>
// Admin URL: the atispro sandbox (http://localhost:8089, user "bridge"), or ADMIN=<admin url>.
// Branch /bridge-tree/ with 60 children (TREE_ID, default 1568) from tools/sandbox-fixture.php.
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'firefox';
const ADMIN = process.env.ADMIN || 'http://localhost:8089/fv9673g5vdfigh/';
const TREE = process.env.TREE_ID || '1568';
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
	const jq = () => page.evaluate(() => !!window.jQuery);
	const T = '.PageListID' + TREE;
	const childTitles = () => page.$$eval(T + ' + .PageList > .PageListItem > a.PageListPage', a => a.map(x => x.textContent.trim()));
	const serverOrder = () => page.evaluate(async ([admin, id]) => {
		const r = await fetch(admin + 'page/list/?id=' + id + '&render=JSON&start=0&mode=actions', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
		return (await r.json()).children.map(c => c.label.replace(/<[^>]+>/g, ''));
	}, [ADMIN, TREE]);
	const toggle = async (sel) => { await page.$eval(sel + ' > a.PageListPage', a => a.scrollIntoView({ block: 'center' })); await page.click(sel + ' > a.PageListPage'); };
	const closeTree = async () => { if(await page.locator(T + '.PageListItemOpen').count()) await toggle(T); await page.waitForTimeout(400); };

	// A: native tree
	await open('page/');
	check('A no jQuery on the page tree', !(await jq()), JSON.stringify(await page.evaluate(() => ProcessWire.config.AdminThemeBridge.legacyReasons)));
	check('A the root is open with its children', await page.evaluate(() => document.querySelector('.PageListID1').classList.contains('PageListItemOpen') && document.querySelectorAll('.PageListID1 + .PageList > .PageListItem').length > 1));
	await closeTree();

	// B: open, close, remembered
	await toggle(T);
	const opened = await waitFor((t) => document.querySelectorAll(t + ' + .PageList > .PageListItem').length === 50, T);
	check('B opening an item loads its children (50 of 60)', opened, (await childTitles()).length);
	check('B pagination and More under a long branch', await page.evaluate((t) => !!document.querySelector(t + ' + .PageList > ul[data-pagination]') && !!document.querySelector(t + ' + .PageList > ul > li.PageListActionMore'), T));
	await open('page/');
	check('B reopened after a reload (pagelist_open cookie)', await waitFor((t) => document.querySelector(t).classList.contains('PageListItemOpen') && document.querySelectorAll(t + ' + .PageList > .PageListItem').length === 50, T));
	await toggle(T);
	check('B a click closes it', await waitFor((t) => !document.querySelector(t).classList.contains('PageListItemOpen') && !document.querySelector(t + ' + .PageList'), T));

	// C, D: hover actions; Edit as link, long press as dialog
	const item = T + ' + .PageList > .PageListItem:nth-of-type(1)';
	await toggle(T);
	await waitFor((t) => document.querySelectorAll(t + ' + .PageList > .PageListItem').length === 50, T);
	await page.hover(item + ' > a.PageListPage');
	await page.waitForTimeout(600);
	check('C hovering shows the actions', await page.evaluate((s) => { const a = document.querySelector(s + ' > .PageListActions'); return !!a && a.offsetParent !== null && document.querySelector(s).classList.contains('PageListItemHover'); }, item));
	const edit = item + ' > .PageListActions .PageListActionEdit > a';
	const box = await (await page.$(edit)).boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(900);
	await page.mouse.up();
	const dlg = await waitFor(() => !!document.querySelector('dialog.pw-dialog[open]'), null, 5000);
	check('D a long press on Edit opens it in the dialog', dlg && page.url().indexOf('page/edit') < 0, page.url());
	if(dlg) {
		const footer = await waitFor(() => document.querySelectorAll('dialog.pw-dialog[open] .pw-dialog-buttons button').length > 0, null, 15000);
		check('D the editor\'s buttons are in the dialog footer', footer);
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
	}
	await page.hover(item + ' > a.PageListPage');
	await page.waitForTimeout(600);
	await Promise.all([page.waitForNavigation({ timeout: 15000 }).catch(() => {}), page.click(edit)]);
	check('D a click on Edit follows the link', /page\/edit\/\?id=\d+/.test(page.url()), page.url());

	// E: pagination and More
	await open('page/');
	if(!(await page.locator(T + '.PageListItemOpen').count())) await toggle(T);
	await waitFor((t) => document.querySelectorAll(t + ' + .PageList > .PageListItem').length === 50, T);
	await page.click(T + ' + .PageList > ul[data-pagination] a[href="1"]');
	check('E page 2 of the pagination shows the last 10', await waitFor((t) => { const l = document.querySelectorAll(t + ' + .PageList > .PageListItem'); return l.length === 10 && /51/.test(l[0].textContent); }, T), JSON.stringify((await childTitles()).slice(0, 2)));
	await page.click(T + ' + .PageList > ul[data-pagination] a[href="0"]');
	await waitFor((t) => document.querySelectorAll(t + ' + .PageList > .PageListItem').length === 50, T);
	await page.click(T + ' + .PageList > ul > li.PageListActionMore > a');
	check('E More appends the rest', await waitFor((t) => document.querySelectorAll(t + ' + .PageList > .PageListItem').length === 60, T), (await childTitles()).length);

	// F: extra actions over AJAX
	await open('page/');
	if(!(await page.locator(T + '.PageListItemOpen').count())) await toggle(T);
	await waitFor((t) => document.querySelectorAll(t + ' + .PageList > .PageListItem').length >= 50, T);
	const third = T + ' + .PageList > .PageListItem:nth-of-type(3)';
	const thirdId = await page.$eval(third, li => li.getAttribute('data-page-id'));
	const third2 = '.PageListID' + thirdId;
	const extrasAction = async (re) => {
		await page.hover(third2 + ' > a.PageListPage');
		await page.waitForTimeout(500);
		await page.click(third2 + ' > .PageListActions .PageListActionExtras > a');
		await page.waitForTimeout(200);
		const links = await page.$$eval(third2 + ' > .PageListActions a.PageListActionExtra', a => a.map(x => x.textContent.trim()));
		const i = links.findIndex(t => re.test(t));
		if(i < 0) return links;
		await page.locator(third2 + ' > .PageListActions a.PageListActionExtra').nth(i).click();
		return links;
	};
	const ex1 = await extrasAction(/^Hide$/);
	check('F Extras shows the extra actions', ex1.length > 2, JSON.stringify(ex1));
	check('F Hide over AJAX marks the page hidden', await waitFor((s) => { const li = document.querySelector(s); return !!li && li.classList.contains('PageListStatusHidden'); }, third2, 15000));
	await page.waitForTimeout(1500);
	await extrasAction(/^Unhide$/);
	check('F Unhide restores it', await waitFor((s) => { const li = document.querySelector(s); return !!li && !li.classList.contains('PageListStatusHidden'); }, third2, 15000));
	await page.waitForTimeout(1500);

	// G: move a page by dragging
	await open('page/');
	if(!(await page.locator(T + '.PageListItemOpen').count())) await toggle(T);
	await waitFor((t) => document.querySelectorAll(t + ' + .PageList > .PageListItem').length >= 50, T);
	const order0 = await serverOrder();
	const moveItem = async (fromN, toN) => {
		const src = T + ` + .PageList > .PageListItem:nth-of-type(${fromN})`;
		const dst = T + ` + .PageList > .PageListItem:nth-of-type(${toN})`;
		await page.$eval(src, el => el.scrollIntoView({ block: 'center' }));
		await page.hover(src + ' > a.PageListPage');
		await page.waitForTimeout(500);
		await page.click(src + ' > .PageListActions .PageListActionMove > a');
		await page.waitForTimeout(200);
		const a = await (await page.$(src + ' > a.PageListPage')).boundingBox();
		const b = await (await page.$(dst + ' > a.PageListPage')).boundingBox();
		await page.mouse.move(a.x + 10, a.y + a.height / 2);
		await page.mouse.down();
		await page.mouse.move(a.x + 10, a.y + a.height / 2 - 5, { steps: 3 });
		await page.mouse.move(b.x + 10, b.y + 3, { steps: 8 });
		await page.mouse.up();
		await waitFor(() => !document.querySelector('.PageListSortSaving'), null, 15000);
		await page.waitForTimeout(500);
	};
	await moveItem(2, 1);
	const order1 = await serverOrder();
	check('G dragging Move saves the new order', order1[0] === order0[1] && order1[1] === order0[0], JSON.stringify({ order0: order0.slice(0, 3), order1: order1.slice(0, 3) }));
	check('G still no jQuery', !(await jq()));
	await open('page/');
	if(!(await page.locator(T + '.PageListItemOpen').count())) await toggle(T);
	await waitFor((t) => document.querySelectorAll(t + ' + .PageList > .PageListItem').length >= 50, T);
	await moveItem(2, 1);
	const order2 = await serverOrder();
	check('G moving it back restores the order', order2.slice(0, 3).join() === order0.slice(0, 3).join(), JSON.stringify(order2.slice(0, 3)));

	// I: pageListRefresh
	await page.evaluate((id) => document.dispatchEvent(new CustomEvent('pageListRefresh', { detail: id })), TREE);
	check('I pageListRefresh reloads the list holding the page', await waitFor((t) => !!document.querySelector(t), T, 10000));

	await open('page/');
	await closeTree();
	check('no page errors', errors.length === 0, errors.join(' | '));
	report();
	await browser.close();
})().catch(e => { check('run completed', false, String(e.message).split(String.fromCharCode(10))[0]); report(); process.exit(1); });

function report() {
	const failed = results.filter(x => !x.ok);
	console.log(JSON.stringify({ browser: browserName, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
	if(failed.length) process.exitCode = 1;
}

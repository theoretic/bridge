// Native page tree check (tools/pagetree-check.js, milestone 3.4, ADR 0016): drives the page tree
// (ProcessPageList, "actions" mode) in a real browser engine and verifies that it works without
// jQuery: open and close with the remembered state, hover actions, Edit as a link and a long press
// into the native dialog, pagination and More, extra actions over AJAX (hide, unhide), moving a
// page (drag, saved order), pageListRefresh, the top nav's nested tree flyouts. Restores what it
// changes.
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
	const consoleErrors = require('./console-errors')(ctx);
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

	// H (0.14.0, ADR 0018): rows selected and moved together; a page the server refuses goes back.
	// The branch's order is put back through page/sort/ at the end.
	await open('page/');
	if(!(await page.locator(T + '.PageListItemOpen').count())) await toggle(T);
	await waitFor((t) => document.querySelectorAll(t + ' + .PageList > .PageListItem').length >= 50, T);
	const hRow = (n) => T + ` + .PageList > .PageListItem:nth-of-type(${n})`;
	const hSelected = () => page.$$eval('.PageListRoot .PageListItem.pw-selected', l => l.map(li => li.getAttribute('data-page-id')));
	const hDom = () => page.$$eval(T + ' + .PageList > .PageListItem', l => l.slice(0, 8).map(li => li.getAttribute('data-page-id')));
	const serverIds = () => page.evaluate(async ([admin, id]) => {
		const r = await fetch(admin + 'page/list/?id=' + id + '&render=JSON&start=0&mode=actions', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
		return (await r.json()).children.map(c => String(c.id));
	}, [ADMIN, TREE]);
	const alerts = [];
	page.on('dialog', d => alerts.push(d.message()));
	const ctrlClick = async (sel) => { await page.$eval(sel, el => el.scrollIntoView({ block: 'center' })); await page.click(sel + ' > a.PageListPage', { modifiers: ['Control'] }); };
	const h0 = await serverIds();
	await ctrlClick(hRow(1));
	await ctrlClick(hRow(3));
	check('H Ctrl+click selects two rows and opens neither', (await hSelected()).join() === [h0[0], h0[2]].join()
		&& !(await page.locator(hRow(1) + '.PageListItemOpen, ' + hRow(3) + '.PageListItemOpen').count()), JSON.stringify(await hSelected()));
	await ctrlClick(T);
	check('H selecting their parent leaves the parent alone selected', (await hSelected()).join() === TREE, JSON.stringify(await hSelected()));
	await page.keyboard.press('Escape');
	check('H Escape clears the selection', !(await hSelected()).length);
	// several rows: one band per run of adjacent rows, one menu for all (0.14.1)
	const MENU = '.pw-group-actions';
	const menuFor = async (n) => {
		await page.mouse.move(5, 5);
		await page.waitForTimeout(400);
		await page.hover(hRow(n) + ' > a.PageListPage');
		return waitFor((m) => { const el = document.querySelector(m); return !!el && !el.hidden; }, MENU, 5000);
	};
	const menuClick = async (re) => {
		const links = page.locator(MENU + ' a');
		const texts = await links.allTextContents();
		const i = texts.findIndex(t => re.test(t.trim()));
		if(i > -1) await links.nth(i).click();
		return texts;
	};
	await ctrlClick(hRow(1));
	await ctrlClick(hRow(2));
	await ctrlClick(hRow(4));
	const band = await page.evaluate((rows) => {
		const [a, b, d] = rows.map(s => document.querySelector(s));
		const st = (e) => getComputedStyle(e);
		const list = a.parentElement.getBoundingClientRect();
		const ra = a.getBoundingClientRect();
		return {
			joined: st(a).borderBottomLeftRadius === '0px' && st(b).borderTopLeftRadius === '0px',
			ends: st(a).borderTopLeftRadius !== '0px' && st(b).borderBottomRightRadius !== '0px' && st(d).borderTopLeftRadius !== '0px' && st(d).borderBottomLeftRadius !== '0px',
			inside: ra.left >= list.left && ra.right <= list.right,
		};
	}, [hRow(1), hRow(2), hRow(4)]);
	check('H adjacent selected rows make one band, rounded at its ends, inside the branch', band.joined && band.ends && band.inside, JSON.stringify(band));
	const shown = await menuFor(2);
	const gm = await page.evaluate(([m, r1, r2]) => {
		const menu = document.querySelector(m);
		const a = document.querySelector(r1).getBoundingClientRect();
		const b = document.querySelector(r2).getBoundingClientRect();
		const r = menu.getBoundingClientRect();
		const own = document.querySelector(r2 + ' > .PageListActions');
		const labels = [document.querySelector(r1 + ' > a.PageListPage'), document.querySelector(r2 + ' > a.PageListPage')].map(x => x.getBoundingClientRect().right);
		return { cns: [...menu.querySelectorAll('a[data-cn]')].map(x => x.getAttribute('data-cn')), ownHidden: !own || own.offsetParent === null,
			centred: Math.abs((r.top + r.bottom) / 2 - (a.top + b.bottom) / 2) <= 3, after: r.left >= Math.max(...labels) };
	}, [MENU, hRow(1), hRow(2)]);
	check('H hovering a selected row shows one menu for the selection, without View, rows\' own menus hidden', shown && gm.ownHidden
		&& gm.cns.indexOf('View') < 0 && gm.cns.indexOf('Edit') > -1 && gm.cns.indexOf('Move') > -1, JSON.stringify(gm));
	check('H the menu sits after the titles, centred on the band', gm.centred && gm.after, JSON.stringify(gm));
	// Edit: one page after another in the dialog
	await menuClick(/^Edit|Редакт/);
	const d1 = await waitFor(() => { const t = document.querySelector('dialog.pw-dialog[open] .pw-dialog-title'); return !!t && /\(1\/3\)/.test(t.textContent); }, null, 10000);
	const next = await waitFor(() => [...document.querySelectorAll('dialog.pw-dialog[open] .pw-dialog-buttons button')].some(b => /›|Next|Следующ/.test(b.textContent) || b.querySelector('.fa-angle-right')), null, 15000);
	if(next) await page.locator('dialog.pw-dialog[open] .pw-dialog-buttons button', { has: page.locator('.fa-angle-right') }).click();
	const d2 = await waitFor(() => { const t = document.querySelector('dialog.pw-dialog[open] .pw-dialog-title'); return !!t && /\(2\/3\)/.test(t.textContent); }, null, 10000);
	check('H Edit opens the selected pages in turn, with Next in the dialog', d1 && next && d2);
	// Escape inside the window's frame stays in the frame: its close button
	await page.click('dialog.pw-dialog[open] .pw-dialog-close');
	check('H closing the dialog ends the round', await waitFor(() => !document.querySelector('dialog.pw-dialog[open]'), null, 5000));
	await waitFor((t) => document.querySelectorAll(t + ' + .PageList > .PageListItem').length >= 50, T);
	await page.waitForTimeout(500);
	// Hide and Unhide: every selected page
	await page.keyboard.press('Escape');
	await ctrlClick(hRow(1));
	await ctrlClick(hRow(2));
	await menuFor(1);
	await menuClick(/^$/); // the Extras toggle: an icon only
	const extras = await page.locator(MENU + ' a').allTextContents();
	await menuClick(/^(Hide|Скрыть)/);
	const hid = await waitFor((rows) => rows.every(s => document.querySelector(s).classList.contains('PageListStatusHidden')), [hRow(1), hRow(2)], 20000);
	await page.waitForTimeout(1500);
	check('H Hide from the menu hides every selected page, which stay selected', hid && (await hSelected()).length === 2, JSON.stringify({ extras, sel: await hSelected() }));
	await menuFor(1);
	await menuClick(/^$/);
	await menuClick(/^(Unhide|Показать|Отобразить)/);
	const shownAgain = await waitFor((rows) => rows.every(s => !document.querySelector(s).classList.contains('PageListStatusHidden')), [hRow(1), hRow(2)], 20000);
	await page.waitForTimeout(1500);
	check('H Unhide from the menu shows them again', shownAgain);
	await page.keyboard.press('Escape');
	// Move from the menu: the selection waits; a press on any of its rows drags them all
	await ctrlClick(hRow(1));
	await ctrlClick(hRow(3));
	await menuFor(3);
	await menuClick(/^(Move|Переместить)/);
	await waitFor(() => !!document.querySelector('.PageListRoot.pw-move-armed'), null, 5000);
	const armedInfo = await page.evaluate(() => ({ note: (document.querySelector('.PageListMoveNote') || {}).textContent || '', hidden: document.querySelectorAll('.PageListRoot .pw-drag-member').length, selected: document.querySelectorAll('.PageListRoot .pw-selected').length }));
	{
		// the others hide when the press begins the drag: the drop row is measured after it
		const a = await (await page.$(hRow(1) + ' > a.PageListPage')).boundingBox();
		const drop = await page.$(hRow(5) + ' > a.PageListPage');
		await page.mouse.move(a.x + 10, a.y + a.height / 2);
		await page.mouse.down();
		await page.mouse.move(a.x + 10, a.y + a.height / 2 + 5, { steps: 3 });
		const b = await drop.boundingBox();
		await page.mouse.move(b.x + 10, b.y + b.height - 3, { steps: 10 });
		await page.mouse.up();
		await waitFor(() => !document.querySelector('.PageListSortSaving'), null, 20000);
		await page.waitForTimeout(500);
	}
	const h1 = await serverIds();
	const want = [h0[1], h0[3], h0[4], h0[0], h0[2]];
	check('H Move from the menu: both rows stay shown with the note, none hidden yet', /2/.test(armedInfo.note) && armedInfo.hidden === 0 && armedInfo.selected === 2, JSON.stringify(armedInfo));
	check('H both pages land after the drop row, in their order', h1.slice(0, 5).join() === want.join() && (await hDom()).slice(0, 5).join() === want.join(), JSON.stringify({ h0: h0.slice(0, 5), h1: h1.slice(0, 5) }));
	check('H the selection is cleared after the move', !(await hSelected()).length);
	// into a page whose template takes no children: refused, both rows back in place
	const before = await hDom();
	await page.$eval(hRow(7), el => el.scrollIntoView({ block: 'center' }));
	await page.click(hRow(7) + ' > a.PageListPage');
	await ctrlClick(hRow(1));
	await ctrlClick(hRow(2));
	alerts.length = 0;
	await menuFor(2);
	await menuClick(/^(Move|Переместить)/);
	await waitFor(() => !!document.querySelector('.PageListRoot.pw-move-armed'), null, 5000);
	{
		const a = await (await page.$(hRow(2) + ' > a.PageListPage')).boundingBox();
		// the lower half of an open row puts the item first in its child list (here its placeholder);
		// measured once the press has hidden the other selected row
		const open7 = await page.$(hRow(7));
		await page.mouse.move(a.x + 10, a.y + a.height / 2);
		await page.mouse.down();
		await page.mouse.move(a.x + 10, a.y + a.height / 2 + 5, { steps: 3 });
		const b = await open7.boundingBox();
		await page.mouse.move(b.x + 10, b.y + b.height * 0.8, { steps: 10 });
		const into = await page.$eval('.PageListSortItem', li => li.parentElement.classList.contains('PageListPlaceholder'));
		await page.mouse.up();
		check('H the dragged row went into the open row\'s placeholder list', into);
		await waitFor(() => !document.querySelector('.PageListSortSaving'), null, 20000);
		await page.waitForTimeout(500);
	}
	check('H a refused move: both rows back where they were, one alert', (await hDom()).join() === before.join() && alerts.length === 1, JSON.stringify({ before, after: await hDom(), alerts }));
	check('H a refused move changes nothing on the server', (await serverIds()).join() === h1.join());
	// the branch's order as it was
	await page.evaluate(async ([admin, tree, ids]) => {
		const c = document.getElementById('PageListContainer');
		const body = new URLSearchParams();
		body.set('id', ids[0]);
		body.set('parent_id', tree);
		body.set('sort', ids.join(',') + ',');
		body.set(c.getAttribute('data-token-name'), c.getAttribute('data-token-value'));
		await fetch(admin + 'page/sort/', { method: 'POST', body, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
	}, [ADMIN, TREE, h0]);
	check('H the order is back', (await serverIds()).join() === h0.join());
	check('H still no jQuery', !(await jq()));

	// I: pageListRefresh
	await page.evaluate((id) => document.dispatchEvent(new CustomEvent('pageListRefresh', { detail: id })), TREE);
	check('I pageListRefresh reloads the list holding the page', await waitFor((t) => !!document.querySelector(t), T, 10000));

	await open('page/');
	await closeTree();
	// J: the top nav's tree flyouts. The branch's flyout sits inside the Tree flyout, which
	// scrolls: it must open beside its item (position: fixed), not inside the scrolling list
	const treeNav = '.pw-primary-nav a.pw-has-ajax-items[data-json*="page/list/navJSON"]';
	const branchNav = treeNav + ' + ul a.pw-has-ajax-items[data-json$="parent_id=' + TREE + '"]';
	await page.hover('.pw-primary-nav > li > a.pw-dropdown-toggle[href$="/page/"]');
	await page.waitForTimeout(300);
	await page.hover(treeNav);
	if(await waitFor((s) => !!document.querySelector(s), branchNav, 10000)) {
		await page.hover(branchNav);
		await waitFor((s) => { const a = document.querySelector(s); return !!a && a.nextElementSibling.children.length > 0; }, branchNav, 10000);
		await page.waitForTimeout(400);
		const fly = await page.evaluate((s) => {
			const a = document.querySelector(s), ul = a.nextElementSibling, outer = a.closest('ul');
			const r = ul.getBoundingClientRect(), o = outer.getBoundingClientRect(), li = a.parentElement.getBoundingClientRect();
			return { pos: getComputedStyle(ul).position, vis: getComputedStyle(ul).visibility, left: Math.round(r.left), outerRight: Math.round(o.right),
				top: Math.round(r.top), itemTop: Math.round(li.top), outerScrollbarX: getComputedStyle(outer).overflowX !== 'hidden' && outer.scrollWidth > outer.clientWidth };
		}, branchNav);
		check('J a flyout inside a flyout opens beside its item, outside its parent', fly.pos === 'fixed' && fly.vis === 'visible'
			&& fly.left >= fly.outerRight - 2 && Math.abs(fly.top - fly.itemTop) <= 8 && !fly.outerScrollbarX, JSON.stringify(fly));
	} else {
		check('J a flyout inside a flyout opens beside its item, outside its parent', false, 'no Tree flyout item for TREE_ID ' + TREE);
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

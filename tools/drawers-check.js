// Drawers check (tools/drawers-check.js, 0.25.0): the theme's tab-focus bus (pw-tab-focus) that
// the drawers refresh on (A), the drawer shell (B), the page tree in its drawer (C), the history
// drawer (D) and two tabs of one user: the tab that gets the focus back refreshes both (E).
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] PROBE_PASS=<sandbox bridge password> node tools/drawers-check.js
//     <playwright-core dir> <firefox|chromium|webkit>
// Admin URL and password: the sandbox's .credentials (tools/lib/sandbox.cjs), or ADMIN=<admin url>.
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'firefox';
const sandbox = require('./lib/sandbox.cjs');
const ADMIN = sandbox.adminUrl();
// branch /bridge-tree/ with 60 children (TREE_ID) and a page with children (PARENT_ID) from tools/sandbox-fixture.php
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
	// pw-tab-focus counted from the first script on, so a fire during load shows
	await ctx.addInitScript(() => { window.__tabFocusSeen = 0; document.addEventListener('pw-tab-focus', () => { window.__tabFocusSeen++; }); });
	const page = await ctx.newPage();
	const errors = [];
	const ignore = process.env.IGNORE_ERRORS ? new RegExp(process.env.IGNORE_ERRORS) : null;
	page.on('pageerror', e => { if(!ignore || !ignore.test(e.message)) errors.push(e.message); });
	page.on('dialog', d => d.accept());

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
		await page.waitForTimeout(300);
	};
	const jq = () => page.evaluate(() => !!window.jQuery);

	// A: the tab-focus bus
	await open('setup/field/');
	check('A no jQuery on the Fields screen', !(await jq()));
	const bus = await page.evaluate(() => {
		const seen = [];
		document.addEventListener('pw-tab-focus', e => seen.push(e.detail && typeof e.detail.hidden === 'number'));
		const atLoad = window.__tabFocusSeen;
		window.dispatchEvent(new Event('focus'));
		const unvisited = seen.length;
		window.dispatchEvent(new Event('blur'));
		window.dispatchEvent(new Event('focus'));
		const first = seen.length;
		window.dispatchEvent(new Event('focus'));
		const throttled = seen.length;
		ProcessWireAdminTheme.tabFocusDelay = 0;
		const visible = document.visibilityState === 'visible';
		document.dispatchEvent(new Event('visibilitychange'));
		return { atLoad, unvisited, first, throttled, visible, after: seen.length, detail: seen.every(Boolean) };
	});
	check('A nothing fires at page load', bus.atLoad === 0, JSON.stringify(bus));
	check('A a focus without a blur or hidden before it fires nothing', bus.unvisited === 0, JSON.stringify(bus));
	check('A a window focus after a blur fires pw-tab-focus once', bus.first === 1, JSON.stringify(bus));
	check('A a second focus at once is throttled', bus.throttled === 1, JSON.stringify(bus));
	check('A visibilitychange to visible fires once the delay has passed (tabFocusDelay 0)', bus.visible && bus.after === 2, JSON.stringify(bus));
	check('A detail.hidden is a number', bus.detail, JSON.stringify(bus));

	// B: the drawer shell: buttons right of the logo, <dialog> drawers, one at a time
	await open('setup/field/');
	check('B both buttons right of the logo', await page.evaluate(() => {
		const b = document.querySelector('.pw-logo-link + .pw-drawer-buttons');
		return !!b && !!b.querySelector('[data-pw-drawer="tree"]') && !!b.querySelector('[data-pw-drawer="history"]');
	}));
	await page.evaluate(() => {
		window.__drawerEvents = [];
		document.addEventListener('pw-drawer-open', e => window.__drawerEvents.push(e.detail.name + ':' + e.detail.first));
	});
	const state = () => page.evaluate(() => ({
		tree: !!document.querySelector('dialog#pw-drawer-tree[open]'),
		history: !!document.querySelector('dialog#pw-drawer-history[open]'),
		focus: document.activeElement ? (document.activeElement.closest('dialog.pw-drawer') || {}).id || document.activeElement.getAttribute('data-pw-drawer') || document.activeElement.tagName : '',
		expanded: Array.from(document.querySelectorAll('[data-pw-drawer]')).map(b => b.getAttribute('aria-expanded')).join(','),
	}));
	await page.click('[data-pw-drawer="tree"]');
	await page.waitForTimeout(300);
	let st = await state();
	check('B a click on the tree button opens its drawer, the focus inside', st.tree && !st.history && st.focus === 'pw-drawer-tree' && st.expanded === 'true,false', JSON.stringify(st));
	await page.keyboard.press('Escape');
	await page.waitForTimeout(300);
	st = await state();
	check('B Escape closes it, the focus back on its button', !st.tree && st.focus === 'tree' && st.expanded === 'false,false', JSON.stringify(st));
	await page.click('[data-pw-drawer="history"]');
	await page.waitForTimeout(300);
	st = await state();
	check('B the history button opens its drawer, the tree stays closed', st.history && !st.tree && st.focus === 'pw-drawer-history', JSON.stringify(st));
	await page.mouse.click(1000, 500);
	await page.waitForTimeout(300);
	st = await state();
	check('B a click on the backdrop closes it', !st.history && st.focus === 'history', JSON.stringify(st));
	await page.click('[data-pw-drawer="tree"]');
	await page.waitForTimeout(300);
	await page.click('#pw-drawer-tree .pw-drawer-close');
	await page.waitForTimeout(300);
	st = await state();
	check('B the close button closes it', !st.tree && st.focus === 'tree', JSON.stringify(st));
	const events = await page.evaluate(() => window.__drawerEvents.join(' '));
	check('B pw-drawer-open says whether it is the first open on the page', events === 'tree:true history:true tree:false', events);
	check('B the API opens one drawer at a time', await page.evaluate(() => {
		const d = ProcessWireAdminTheme.drawer;
		d.open('tree');
		d.open('history');
		const ok = d.isOpen('history') && !d.isOpen('tree');
		d.close('history');
		return ok && !d.isOpen('history');
	}));
	check('B no jQuery on the Fields screen with the drawers', !(await jq()));
	await open('page/');
	check('B the page tree screen: no tree button, the history one', await page.evaluate(() => !document.querySelector('[data-pw-drawer="tree"]') && !!document.querySelector('[data-pw-drawer="history"]')));
	{
		const guest = await browser.newContext();
		const gp = await guest.newPage();
		await gp.goto(ADMIN, { waitUntil: 'domcontentloaded' });
		check('B the login screen has no drawer buttons or drawers', await gp.evaluate(() => !!document.querySelector('#login_name') && !document.querySelector('.pw-drawer-buttons, dialog.pw-drawer')));
		await guest.close();
	}

	// C: the page tree in the drawer
	{
		const D = '#pw-drawer-tree ';
		const T = D + '.PageListID' + TREE;
		const waitFor = async (fn, arg, ms = 10000) => {
			for(let t = 0; t < ms; t += 200) {
				if(await page.evaluate(fn, arg)) return true;
				await page.waitForTimeout(200);
			}
			return false;
		};
		const openTree = async () => {
			await page.click('[data-pw-drawer="tree"]');
			return waitFor((d) => {
				const root = document.querySelector(d + '.PageListItem.PageListID1');
				return !!root && root.classList.contains('PageListItemOpen') && document.querySelectorAll(d + '.PageListID1 + .PageList > .PageListItem').length > 1;
			}, D);
		};
		await open('setup/field/');
		check('C the tree drawer shows the home page open with its children', await openTree());
		const branch = () => page.evaluate((t) => { const i = document.querySelector(t); return !!i && i.classList.contains('PageListItemOpen') && document.querySelectorAll(t + ' + .PageList > .PageListItem').length > 0; }, T);
		if(await branch()) {
			await page.click(T + ' > a.PageListPage');
			await page.waitForTimeout(500);
		}
		await page.$eval(T + ' > a.PageListPage', a => a.scrollIntoView({ block: 'center' }));
		await page.click(T + ' > a.PageListPage');
		check('C a click on a title opens its branch', await waitFor((t) => document.querySelectorAll(t + ' + .PageList > .PageListItem').length > 1, T));
		const cookie = await page.evaluate(() => decodeURIComponent((document.cookie.match(/(?:^|;\s*)bridge_tree_open=([^;]*)/) || [])[1] || ''));
		check('C the drawer tree\'s own cookie (bridge_tree_open) holds the branch', cookie.split(',').some(v => v.split('-')[0] === TREE), cookie);
		check('C the drawer body scrolls the long branch, no branch cap inside the drawer', await page.evaluate((d) => {
			const body = document.querySelector(d + '.pw-drawer-body');
			return body.scrollHeight > body.clientHeight && !Array.from(document.querySelectorAll(d + '.PageList')).some(l => l.style.getPropertyValue('--pw-branch-max'));
		}, D));
		check('C an Edit link is a plain link to the page editor', await page.evaluate((t) => {
			const a = document.querySelector(t + ' > .PageListActions .PageListActionEdit a') || document.querySelector(t + ' + .PageList .PageListActionEdit a');
			return !!a && /page\/edit\/\?id=\d+/.test(a.getAttribute('href') || '');
		}, T));
		check('C the trash is there for the superuser', await page.evaluate((d) => !!document.querySelector(d + '.PageListID7'), D));
		await open('setup/field/');
		check('C after a reload the branch is open again (openPageIDs from the cookie)', await openTree() && await waitFor((t) => {
			const i = document.querySelector(t);
			return !!i && i.classList.contains('PageListItemOpen') && document.querySelectorAll(t + ' + .PageList > .PageListItem').length > 1;
		}, T));
		check('C the drawer stylesheet: ProcessPageList.css on a screen without the tree', await page.evaluate(() => !!document.querySelector('link[href*="ProcessPageList.css"]')));
		check('C no jQuery with the tree drawer', !(await jq()));
		// close the branch again: other harnesses start from a closed tree
		await page.click(T + ' > a.PageListPage');
		await page.waitForTimeout(500);
		await page.keyboard.press('Escape');

		// the page editor's Children tab keeps its own tree with the drawer on the page
		const parent = process.env.PARENT_ID || TREE;
		await open('page/edit/?id=' + parent);
		const tabCfg = await page.evaluate(() => { const c = ProcessWire.config.ProcessPageList || {}; return { root: c.rootPageID, show: c.showRootPage }; });
		check('C the page editor\'s global tree config is the Children tab\'s', String(tabCfg.root) === String(parent) && tabCfg.show === false, JSON.stringify(tabCfg));
		check('C the drawer tree opens on the page editor too', await openTree());
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		const tab = page.locator('#_ProcessPageEditChildren');
		if(await tab.count()) await tab.click();
		const kidsOk = await waitFor((p) => {
			const c = document.getElementById('PageListContainer');
			if(!c) return false;
			const rows = c.querySelectorAll('.PageListItem');
			return rows.length > 0 && !c.querySelector('.PageListID1') && !c.querySelector('.PageListID' + p + ' > a.PageListPage:not(.PageListRootHidden *)');
		}, parent);
		check('C the Children tab shows the edited page\'s children, not the home page', kidsOk);
		check('C the drawer tree still opens after the tab', await page.evaluate(() => { ProcessWireAdminTheme.drawer.open('tree'); return ProcessWireAdminTheme.drawer.isOpen('tree') && !!document.querySelector('#pw-drawer-tree .PageListID1'); }));
		await page.keyboard.press('Escape');
	}

	// D: the history drawer
	const H = '#pw-drawer-history ';
	const firstRow = () => page.evaluate((h) => {
		const tr = document.querySelector(h + 'table.pw-history tbody tr');
		if(!tr) return null;
		const a = tr.querySelector('a');
		return { href: a.getAttribute('href'), name: a.textContent, type: tr.children[1].textContent, visits: parseInt(tr.children[2].textContent, 10), current: a.getAttribute('aria-current') };
	}, H);
	const rowFor = (href) => page.evaluate(([h, u]) => {
		const rows = Array.from(document.querySelectorAll(h + 'table.pw-history tbody tr')).filter(tr => tr.querySelector('a').getAttribute('href') === u);
		return { count: rows.length, visits: rows.length ? parseInt(rows[0].children[2].textContent, 10) : 0, type: rows.length ? rows[0].children[1].textContent : '' };
	}, [H, href]);
	const openHistory = async () => {
		await page.click('[data-pw-drawer="history"]');
		for(let t = 0; t < 10000 && !(await page.locator(H + 'table.pw-history, ' + H + '.pw-history-empty').count()); t += 200) await page.waitForTimeout(200);
	};
	let editorHref = '';
	{
		await open('setup/template/');
		const link = page.locator('table.AdminDataTable a[href*="edit?id="]').first();
		await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), link.click()]);
		editorHref = new URL(page.url()).pathname + new URL(page.url()).search;
		await openHistory();
		let row = await firstRow();
		const visits = row ? row.visits : 0;
		check('D the template editor is the first row, a "template", the current screen', !!row && row.href === editorHref && row.type === 'template' && row.current === 'page' && visits >= 1, JSON.stringify(row) + ' ' + editorHref);
		await page.keyboard.press('Escape');
		await page.goto(page.url(), { waitUntil: 'networkidle' });
		await openHistory();
		const again = await rowFor(editorHref);
		check('D a second visit: still one row for it, one visit more', again.count === 1 && again.visits === visits + 1, JSON.stringify(again));
		await page.keyboard.press('Escape');
		await open('setup/field/');
		await openHistory();
		row = await firstRow();
		check('D the Fields screen is a "screen" (the type map)', !!row && /setup\/field\/$/.test(row.href) && row.type === 'screen', JSON.stringify(row));
		check('D the table has a caption and a header row', await page.evaluate((h) => !!document.querySelector(h + 'table.pw-history caption') && document.querySelectorAll(h + 'table.pw-history thead th').length === 3, H));
		await page.keyboard.press('Escape');
	}

	// E: two tabs of one user; the tab that gets the focus back refreshes both drawers
	{
		await open('setup/field/');
		const a = page;
		await openHistory();
		await a.keyboard.press('Escape');
		await a.click('[data-pw-drawer="tree"]');
		await a.waitForTimeout(1500);
		await a.keyboard.press('Escape');
		const treeClosed = await a.evaluate((t) => { const i = document.querySelector(t); return !!i && !i.classList.contains('PageListItemOpen'); }, '#pw-drawer-tree .PageListID' + TREE);
		// tab B: a branch opened in its drawer tree on another screen (the cookie), then a template
		// editor (the newest visit)
		const b = await ctx.newPage();
		const BT = '#pw-drawer-tree .PageListID' + TREE;
		await b.goto(ADMIN + 'access/users/', { waitUntil: 'networkidle' });
		await b.click('[data-pw-drawer="tree"]');
		for(let t = 0; t < 10000 && !(await b.locator(BT).count()); t += 200) await b.waitForTimeout(200);
		await b.$eval(BT + ' > a.PageListPage', el => el.scrollIntoView({ block: 'center' }));
		await b.click(BT + ' > a.PageListPage');
		await b.waitForTimeout(1500);
		await b.goto(ADMIN + 'setup/template/', { waitUntil: 'networkidle' });
		const links = b.locator('table.AdminDataTable a[href*="edit?id="]');
		const second = (await links.count()) > 1 ? links.nth(1) : links.first();
		await Promise.all([b.waitForNavigation({ waitUntil: 'networkidle' }), second.click()]);
		const bHref = new URL(b.url()).pathname + new URL(b.url()).search;
		const requests = [];
		const onRequest = r => { const u = r.url(); if(u.includes('bridgeHistory=1') || /page\/list\/\?id=1(&|$)/.test(u)) requests.push(u.includes('bridgeHistory=1') ? 'history' : 'tree'); };
		await a.waitForTimeout(1000);
		a.on('request', onRequest);
		requests.length = 0;
		await a.evaluate(() => {
			ProcessWireAdminTheme.tabFocusDelay = 0;
			window.dispatchEvent(new Event('blur'));
			window.dispatchEvent(new Event('focus'));
		});
		const refreshed = await (async () => {
			for(let t = 0; t < 5000; t += 200) {
				const ok = await a.evaluate(([h, href, tree]) => {
					const tr = document.querySelector(h + 'table.pw-history tbody tr a');
					const item = document.querySelector('#pw-drawer-tree .PageListID' + tree);
					return !!tr && tr.getAttribute('href') === href && !!item && item.classList.contains('PageListItemOpen')
						&& document.querySelectorAll('#pw-drawer-tree .PageListID' + tree + ' + .PageList > .PageListItem').length > 1;
				}, [H, bHref, TREE]);
				if(ok) return true;
				await a.waitForTimeout(200);
			}
			return false;
		})();
		const stateA = await a.evaluate(([h, tree]) => {
			const top = document.querySelector(h + 'table.pw-history tbody tr a');
			return { vis: document.visibilityState, fired: window.__tabFocusSeen, top: top ? top.getAttribute('href') : null,
				open: !!document.querySelector('#pw-drawer-tree .PageListID' + tree + '.PageListItemOpen'), trees: document.querySelectorAll('#pw-drawer-tree [data-pw-tree]').length };
		}, [H, TREE]);
		check('E focus back in tab A: its history shows tab B\'s visit on top, its tree the branch B opened', treeClosed && refreshed, JSON.stringify({ treeClosed, bHref, stateA, requests }));
		const counted = { history: requests.filter(x => x === 'history').length, tree: requests.filter(x => x === 'tree').length };
		check('E one history request and one root tree request for that focus', counted.history === 1 && counted.tree === 1, JSON.stringify(counted));
		requests.length = 0;
		await a.evaluate(() => {
			ProcessWireAdminTheme.tabFocusDelay = 5000;
			window.dispatchEvent(new Event('blur'));
			window.dispatchEvent(new Event('focus'));
		});
		await a.waitForTimeout(1500);
		check('E a second focus at once fetches nothing more', requests.length === 0, requests.join(','));
		a.off('request', onRequest);
		// close the branch again for the other harnesses
		await b.goto(ADMIN + 'access/users/', { waitUntil: 'networkidle' });
		await b.click('[data-pw-drawer="tree"]');
		for(let t = 0; t < 10000 && !(await b.locator(BT + '.PageListItemOpen').count()); t += 200) await b.waitForTimeout(200);
		if(await b.locator(BT + '.PageListItemOpen').count()) {
			await b.click(BT + ' > a.PageListPage');
			await b.waitForTimeout(800);
		}
		await b.close();
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

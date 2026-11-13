// Keyboard and accessibility check (tools/a11y-check.js, audit UX1-UX4, 0.20.x): on native
// screens of the sandbox, the things a keyboard or a screen reader user meets first.
// - the dialog (<pw-dialog>): the focus goes into its window; a form changed there asks before
//   the close button, Escape or the backdrop throw the change away; Cancel keeps the dialog
// - the mobile drawer: opening it focuses its first link, Escape closes it and focuses the toggle
// - WireTabs (the page editor) and language tabs (the field lab): tab roles, aria-selected,
//   Left / Right move between the tabs and open them
// - names: the image view toggles (pressed state too), the submit dropdown's toggle, every
//   button and link on the screens without a name (a scan)
// Saves nothing. Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] node tools/a11y-check.js <playwright-core dir> <firefox|chromium>
// Admin URL and password: the sandbox's .credentials (tools/lib/sandbox.cjs), or ADMIN=<admin url>.
// Uses tools/sandbox-fixture.php's /bridge-native/ (NATIVE_ID, default 1517) with bf_images.
// Exit code 1 when a check fails.
//
// Original work, MIT.
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'chromium';
const sandbox = require('./lib/sandbox.cjs');
const ADMIN = sandbox.adminUrl();
const NATIVE = process.env.NATIVE_ID || '1517';
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
	page.on('dialog', d => d.dismiss());

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
	const until = async (fn, arg, ms = 10000) => {
		for(let t = 0; t < ms; t += 150) {
			if(await page.evaluate(fn, arg).catch(() => false)) return true;
			await page.waitForTimeout(150);
		}
		return false;
	};
	// buttons and links without an accessible name: no text, aria-label(ledby) or title
	const unnamed = () => page.evaluate(() => {
		const out = [];
		document.querySelectorAll('a[href], button, [role="button"], [role="tab"]').forEach(el => {
			if(!(el.offsetWidth || el.offsetHeight) || el.closest('[aria-hidden="true"], [hidden]')) return;
			const text = (el.textContent || '').replace(/[\s×▾▸]+/g, '');
			const img = el.querySelector('img[alt]:not([alt=""]), svg[aria-label], [role="img"][aria-label]');
			if(text || img || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')) return;
			out.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + String(el.className).trim().split(/\s+/).slice(0, 2).join('.'));
		});
		return out;
	});

	// 1. the page editor: WireTabs, names, the image view toggles, the submit dropdown
	await open(`page/edit/?id=${NATIVE}`);
	const tabs = await page.evaluate(() => {
		const list = document.querySelector('ul.WireTabs[role="tablist"]');
		const tabs = list ? Array.from(list.querySelectorAll('[role="tab"]')) : [];
		const selected = tabs.filter(t => t.getAttribute('aria-selected') === 'true');
		const panel = selected[0] ? document.getElementById(selected[0].getAttribute('aria-controls')) : null;
		return { list: !!list, tabs: tabs.length, selected: selected.length, panel: !!panel && panel.getAttribute('role') === 'tabpanel' && panel.style.display !== 'none',
			roving: tabs.filter(t => t.tabIndex === 0).length };
	});
	check('WireTabs: a tablist, one selected tab, its panel shown', tabs.list && tabs.tabs > 1 && tabs.selected === 1 && tabs.panel && tabs.roving === 1, JSON.stringify(tabs));
	await page.focus('ul.WireTabs [role="tab"][aria-selected="true"]');
	const before = await page.evaluate(() => document.activeElement.id);
	await page.keyboard.press('ArrowRight');
	await page.waitForTimeout(200);
	const after = await page.evaluate(() => ({ id: document.activeElement.id, selected: document.activeElement.getAttribute('aria-selected'),
		shown: (() => { const p = document.getElementById(document.activeElement.getAttribute('aria-controls') || ''); return !!p && p.style.display !== 'none'; })() }));
	check('WireTabs: Arrow Right opens the next tab and focuses it', after.id !== before && after.selected === 'true' && after.shown, JSON.stringify({ before, after }));
	await page.keyboard.press('ArrowLeft');
	await page.waitForTimeout(200);
	check('WireTabs: Arrow Left goes back', await page.evaluate(id => document.activeElement.id === id && document.activeElement.getAttribute('aria-selected') === 'true', before));

	const toggles = await page.$$eval('#wrap_Inputfield_bf_images .InputfieldImageListToggle', els => els.map(a => ({ name: a.getAttribute('aria-label') || '', pressed: a.getAttribute('aria-pressed') })));
	check('image view toggles: named, one pressed', toggles.length === 3 && toggles.every(t => t.name) && toggles.filter(t => t.pressed === 'true').length === 1, JSON.stringify(toggles));
	const dropToggle = await page.$$eval('.pw-button-dropdown-toggle', els => els.map(b => b.getAttribute('aria-label') || ''));
	check('submit dropdown toggle: named', dropToggle.length > 0 && dropToggle.every(Boolean), JSON.stringify(dropToggle));
	const noName = await unnamed();
	check('page editor: no button or link without a name', noName.length === 0, noName.join(', '));

	// 2. the dialog: focus into the window, unsaved changes ask first
	const opened = await page.evaluate(url => {
		const B = window.Bridge;
		if(!B || !B.dialog || typeof B.dialog.open !== 'function') return false;
		B.dialog.open(url, 'large', {});
		return true;
	}, ADMIN + `page/edit/?id=${NATIVE}`);
	check('dialog: opens through Bridge.dialog', opened);
	const loaded = await until(() => {
		const f = document.querySelector('pw-dialog dialog[open] iframe');
		try { return !!f && !!f.contentDocument && !!f.contentDocument.querySelector('#Inputfield_title'); } catch(e) { return false; }
	}, null, 20000);
	// the focus goes in at the window's load event: after its images
	const focusedIn = loaded && await until(() => !!document.activeElement && document.activeElement.matches('pw-dialog iframe'), null, 15000);
	check('dialog: the focus is in its window once the page is there', focusedIn);
	const frame = await (await page.$('pw-dialog dialog[open] iframe')).contentFrame();
	await frame.fill('#Inputfield_title', 'a11y check, not saved');
	await frame.dispatchEvent('#Inputfield_title', 'change');
	await page.click('pw-dialog dialog[open] .pw-dialog-close');
	const asked = await until(() => !!document.querySelector('dialog.pw-ask[open]'), null, 4000);
	check('dialog: the close button asks when the window has unsaved changes', asked);
	if(asked) await page.click('dialog.pw-ask[open] button[value="cancel"]');
	await page.waitForTimeout(300);
	check('dialog: Cancel keeps it open', await page.evaluate(() => !!document.querySelector('pw-dialog dialog[open]')));
	await page.keyboard.press('Escape');
	const askedEsc = await until(() => !!document.querySelector('dialog.pw-ask[open]'), null, 4000);
	check('dialog: Escape asks too', askedEsc);
	if(askedEsc) await page.click('dialog.pw-ask[open] button[value="ok"]');
	const closed = await until(() => !document.querySelector('pw-dialog dialog[open]'), null, 4000);
	check('dialog: OK closes it, with no second question from the window', closed && !(await page.evaluate(() => !!document.querySelector('dialog.pw-ask[open]'))));

	// 3. language tabs on the field lab, where the sandbox has more than one language
	await open('setup/bridge-demo/fields/');
	const lang = await page.evaluate(() => {
		const ul = document.querySelector('#wrap_Inputfield_lab_multilang .langTabs > ul');
		if(!ul) return null;
		const tabs = Array.from(ul.querySelectorAll('a.langTabLink'));
		return { role: ul.getAttribute('role'), tabs: tabs.length, roles: tabs.every(a => a.getAttribute('role') === 'tab' && a.getAttribute('aria-controls')),
			selected: tabs.filter(a => a.getAttribute('aria-selected') === 'true').length };
	});
	if(lang && lang.tabs > 1) {
		check('language tabs: a tablist, one selected', lang.role === 'tablist' && lang.roles && lang.selected === 1, JSON.stringify(lang));
		await page.focus('#wrap_Inputfield_lab_multilang a.langTabLink[aria-selected="true"]');
		await page.keyboard.press('ArrowRight');
		await page.waitForTimeout(200);
		const moved = await page.evaluate(() => {
			const a = document.activeElement;
			const p = a ? document.getElementById(a.getAttribute('aria-controls') || '') : null;
			return !!a && a.classList.contains('langTabLink') && a.getAttribute('aria-selected') === 'true' && !!p && p.classList.contains('LanguageSupportCurrent');
		});
		check('language tabs: Arrow Right opens the next language', moved);
	} else {
		check('language tabs: skipped (one language)', true);
	}
	const labNames = await unnamed();
	check('field lab: no button or link without a name', labNames.length === 0, labNames.join(', '));

	// 4. the drawer at phone width
	await page.setViewportSize({ width: 700, height: 900 });
	await page.waitForTimeout(400);
	await page.focus('.pw-nav-toggle');
	await page.keyboard.press('Enter');
	await page.waitForTimeout(300);
	const drawer = await page.evaluate(() => ({ open: document.body.classList.contains('pw-nav-open'),
		expanded: document.querySelector('.pw-nav-toggle').getAttribute('aria-expanded'),
		inside: !!document.activeElement && !!document.activeElement.closest('#pw-nav') }));
	check('drawer: Enter opens it and focuses its first link', drawer.open && drawer.expanded === 'true' && drawer.inside, JSON.stringify(drawer));
	await page.keyboard.press('Escape');
	await page.waitForTimeout(200);
	const shut = await page.evaluate(() => ({ open: document.body.classList.contains('pw-nav-open'),
		expanded: document.querySelector('.pw-nav-toggle').getAttribute('aria-expanded'),
		toggle: !!document.activeElement && document.activeElement.matches('.pw-nav-toggle') }));
	check('drawer: Escape closes it and focuses the toggle', !shut.open && shut.expanded === 'false' && shut.toggle, JSON.stringify(shut));

	// 5. the page tree from the keyboard (0.20.1, audit UX2): Ctrl+Space selects, Alt+Arrow moves
	await page.setViewportSize({ width: 1300, height: 950 });
	await open('page/');
	const T = '.PageListID' + TREE;
	if(!(await page.locator(T + '.PageListItemOpen').count())) {
		await page.$eval(T + ' > a.PageListPage', a => a.scrollIntoView({ block: 'center' }));
		await page.click(T + ' > a.PageListPage');
	}
	await until(t => document.querySelectorAll(t + ' + .PageList > .PageListItem').length >= 50, T, 15000);
	const serverOrder = () => page.evaluate(async ([admin, id]) => {
		const r = await fetch(admin + 'page/list/?id=' + id + '&render=JSON&start=0&mode=actions', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
		return (await r.json()).children.map(c => c.label.replace(/<[^>]+>/g, ''));
	}, [ADMIN, TREE]);
	const row = (n) => T + ` + .PageList > .PageListItem:nth-of-type(${n}) > a.PageListPage`;
	await page.focus(row(1));
	await page.keyboard.press('Control+Space');
	await page.waitForTimeout(150);
	const sel1 = await page.evaluate(t => document.querySelectorAll(t + ' + .PageList > .PageListItem.pw-selected').length, T);
	await page.keyboard.press('Control+Space');
	await page.waitForTimeout(150);
	const sel0 = await page.evaluate(t => document.querySelectorAll(t + ' + .PageList > .PageListItem.pw-selected').length, T);
	check('tree: Ctrl+Space on a title selects its row, again unselects it', sel1 === 1 && sel0 === 0, JSON.stringify({ sel1, sel0 }));
	const order0 = await serverOrder();
	await page.focus(row(1));
	await page.keyboard.press('Alt+ArrowDown');
	await until(() => !document.querySelector('.PageListSortSaving'), null, 15000);
	await page.waitForTimeout(400);
	const order1 = await serverOrder();
	const focusKept = await page.evaluate(() => !!document.activeElement && document.activeElement.matches('a.PageListPage'));
	check('tree: Alt+Arrow Down moves a row one place and saves it', order1[0] === order0[1] && order1[1] === order0[0], JSON.stringify({ order0: order0.slice(0, 3), order1: order1.slice(0, 3) }));
	check('tree: the moved row keeps the focus', focusKept);
	await page.keyboard.press('Alt+ArrowUp');
	await until(() => !document.querySelector('.PageListSortSaving'), null, 15000);
	await page.waitForTimeout(400);
	const order2 = await serverOrder();
	check('tree: Alt+Arrow Up puts it back', order2.slice(0, 3).join() === order0.slice(0, 3).join(), JSON.stringify(order2.slice(0, 3)));

	// 6. reduced motion (UX3) and touch (UX4)
	const motion = await page.evaluate(() => typeof ProcessWireAdminTheme.still === 'function' && ProcessWireAdminTheme.still() === false);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	const motionOff = await page.evaluate(() => ProcessWireAdminTheme.still() === true);
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	check('reduced motion: the classic scripts see the preference', motion && motionOff);
	await open(`page/edit/?id=${NATIVE}`);
	const touch = await page.evaluate(() => {
		const css = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).touchAction : 'none-found'; };
		return { asm: css('.asmListItem'), input: getComputedStyle(document.documentElement).getPropertyValue('--input').trim() };
	});
	check('touch: list items leave the page scroll to the finger (a hold drags them)', touch.asm !== 'none', JSON.stringify(touch));

	// 7. the user's own colour in the user menu (0.22.0): named swatches, applied at once, kept
	await open(`page/edit/?id=${NATIVE}`);
	const colours = () => page.evaluate(() => ({ variant: document.documentElement.getAttribute('data-pw-variant'),
		primary: document.documentElement.style.getPropertyValue('--pw-primary'),
		pressed: Array.from(document.querySelectorAll('.pw-color-pick button[aria-pressed="true"]')).map(b => b.getAttribute('data-pw-variant-pick')) }));
	const named = await page.$$eval('.pw-color-pick button, .pw-color-pick input', els => els.every(el => el.getAttribute('aria-label')) && els.length === 7);
	check('colour picker: seven named controls in the user menu', named);
	const site = await colours();
	await page.hover('#tools-toggle');
	await page.waitForTimeout(300);
	await page.click('.pw-color-pick [data-pw-variant-pick="green"]');
	await page.waitForTimeout(700);
	const picked = await colours();
	await page.reload({ waitUntil: 'networkidle' });
	const kept = await colours();
	check('colour picker: a preset applies at once and is kept for the user', picked.variant === 'green' && kept.variant === 'green' && kept.pressed.join() === 'green', JSON.stringify({ picked, kept }));
	await page.hover('#tools-toggle');
	await page.waitForTimeout(300);
	await page.click('.pw-color-pick .pw-color-reset');
	await page.waitForTimeout(700);
	await page.reload({ waitUntil: 'networkidle' });
	const back = await colours();
	check('colour picker: "Site default" goes back to the site\'s colour', back.variant === site.variant && back.pressed.join() === '', JSON.stringify({ site, back }));

	// 8. phone width (0.30.1, audits U1 and B1.3): no screen scrolls sideways from 767 to 320 px, also with a
	// wide custom logo; below 768 px the search is its icon and opens over the masthead with the focus in it
	{
		const FIXTURE = process.env.FIXTURE_ID || '1498';
		const NESTING = process.env.NESTING_ID || '1582';
		const screens = ['page/', `page/edit/?id=${NATIVE}`, `page/edit/?id=${FIXTURE}`, `page/edit/?id=${NESTING}`, 'setup/field/', 'setup/field/edit?id=1',
			'setup/template/', 'module/', 'module/edit?name=AdminThemeBridge', 'module/edit?name=BridgeAdminAccessControl', 'access/users/', 'access/roles/', 'page/lister/', 'profile/'];
		const wider = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth,
			at: Array.from(document.querySelectorAll('body *')).filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('dialog:not([open]), [hidden]')).slice(-1).map(e => e.tagName + (e.id ? '#' + e.id : '') + '.' + String(e.className).slice(0, 40)).join('') }));
		for(const width of [767, 700, 640, 600, 540, 480, 375, 320]) {
			await page.setViewportSize({ width, height: 760 });
			const over = [];
			for(const s of screens) {
				await open(s);
				const r = await wider();
				if(r.sw > r.w) over.push(s + ' ' + r.sw + ' ' + r.at);
			}
			check(`8 ${width}px: no screen is wider than the viewport (${screens.length} screens)`, over.length === 0, over.join('; '));
		}
		// a custom logo 120px wide (renderLogo() prints an img in the logo link)
		const logos = [];
		for(const width of [767, 700, 640, 540, 375]) {
			await page.setViewportSize({ width, height: 760 });
			await open('page/');
			const logo = await page.evaluate(() => {
				const a = document.querySelector('.pw-logo-link');
				if(!a) return null;
				a.innerHTML = "<img class='pw-logo pw-logo-custom' alt='home' width='120' height='40' src=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='40'/%3E\">";
				return new Promise(r => setTimeout(() => r({ sw: document.documentElement.scrollWidth, w: innerWidth }), 100));
			});
			if(!logo || logo.sw > logo.w) logos.push(width + ' ' + JSON.stringify(logo));
		}
		check('8 767 to 375px with a 120px custom logo: not wider than the viewport', logos.length === 0, logos.join('; '));
		// the search is its icon below 768px: at a phone width and at a small tablet width (B1.3)
		for(const width of [375, 540]) {
			await page.setViewportSize({ width, height: 760 });
			await open('page/');
			const closed = await page.evaluate(() => { const i = document.getElementById('ProcessPageSearchQuery'); return i ? Math.round(i.getBoundingClientRect().width) : 0; });
			await page.focus('#ProcessPageSearchQuery');
			await page.keyboard.type('ho');
			await page.waitForTimeout(150);
			const opened = await page.evaluate(() => {
				const f = document.getElementById('ProcessPageSearchForm'), i = document.getElementById('ProcessPageSearchQuery');
				return { form: Math.round(f.getBoundingClientRect().width), input: Math.round(i.getBoundingClientRect().width), value: i.value, color: getComputedStyle(i).color !== 'rgba(0, 0, 0, 0)', opaque: getComputedStyle(f).backgroundColor !== 'rgba(0, 0, 0, 0)', w: innerWidth };
			});
			check(`8 ${width}px: the search is a 32px icon, and with the focus in it an opaque full-width field that takes typing`, closed === 32 && opened.form >= opened.w - 24 && opened.input === opened.form && opened.value === 'ho' && opened.color && opened.opaque, closed + ' ' + JSON.stringify(opened));
			const submitted = await Promise.all([page.waitForNavigation({ timeout: 10000 }).then(() => true).catch(() => false), page.keyboard.press('Enter')]);
			check(`8 ${width}px: Enter submits the search`, submitted[0] && /[?&]q=ho/.test(page.url()), page.url());
			await open('page/');
			await page.focus('#ProcessPageSearchQuery');
			await page.keyboard.press('Shift+Tab');
			const back = await page.evaluate(() => Math.round(document.getElementById('ProcessPageSearchQuery').getBoundingClientRect().width));
			check(`8 ${width}px: the field closes to its icon when the focus leaves`, back === 32, back);
			// Escape: the first closes the result list, the next (no list open) leaves the field (0.30.1)
			await page.focus('#ProcessPageSearchQuery');
			await page.keyboard.type('ho');
			await page.waitForSelector('.pw-search-results', { state: 'visible', timeout: 5000 }).catch(() => {});
			await page.keyboard.press('Escape');
			const escOne = await page.evaluate(() => ({ list: getComputedStyle(document.querySelector('.pw-search-results') || document.body).display !== 'none' && !!document.querySelector('.pw-search-results'), focused: document.activeElement && document.activeElement.id === 'ProcessPageSearchQuery' }));
			await page.keyboard.press('Escape');
			const escTwo = await page.evaluate(() => ({ focused: document.activeElement && document.activeElement.id === 'ProcessPageSearchQuery', width: Math.round(document.getElementById('ProcessPageSearchQuery').getBoundingClientRect().width) }));
			check(`8 ${width}px: Escape closes the result list, a second Escape closes the field to its icon`, !escOne.list && escOne.focused && !escTwo.focused && escTwo.width === 32, JSON.stringify([escOne, escTwo]));
		}
		await page.setViewportSize({ width: 768, height: 900 });
		await open('page/');
		const tablet = await page.evaluate(() => Math.round(document.getElementById('ProcessPageSearchQuery').getBoundingClientRect().width));
		check('8 768px: the search keeps its width (120px, padding and border)', tablet === 164, tablet);
		await page.setViewportSize({ width: 1300, height: 950 });
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

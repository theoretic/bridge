// Native core screens check (tools/screens-check.js, milestone 3.7, ADR 0016): drives the Add
// Page, Profile, Logs, Recent, Clone, Trash and link-editor screens in a real browser engine and
// verifies that they work without jQuery: the add form's name check and Publish buttons, the log's
// AJAX filter and refresh, the link window's URL handling, preview and page picker. Saves nothing.
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] PROBE_PASS=<sandbox bridge password> node tools/screens-check.js
//     <playwright-core dir> <firefox|chromium|webkit>
// Admin URL: the atispro sandbox (http://localhost:8089, user "bridge"), or ADMIN=<admin url>.
// Uses tools/sandbox-fixture.php's pages: NATIVE_ID (/bridge-native/, default 1517) and
// PARENT_ID (/bridge-native-parent/, default 1518, which has children).
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'firefox';
const ADMIN = process.env.ADMIN || 'http://localhost:8089/fv9673g5vdfigh/';
const NATIVE = process.env.NATIVE_ID || '1517';
const PARENT = process.env.PARENT_ID || '1518';
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
	const noJquery = async (label) => check(label + ': no jQuery', !(await page.evaluate(() => !!window.jQuery)),
		JSON.stringify(await page.evaluate(() => (ProcessWire.config.AdminThemeBridge || {}).legacyReasons)));

	// A: Add Page under the fixture parent
	await open('page/add/?parent_id=' + PARENT);
	await noJquery('A Add Page');
	const sibling = await page.evaluate(async (parent) => {
		const r = await fetch(ProcessWire.config.urls.admin + 'page/list/?id=' + parent + '&render=JSON', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }).then(x => x.json());
		const c = (r.children || [])[0];
		return c ? c.path.replace(/\/$/, '').split('/').pop() : '';
	}, PARENT);
	const name = page.locator('#Inputfield__pw_page_name');
	if(sibling && await name.count()) {
		await name.fill('');
		await name.pressSequentially(sibling);
		check('A a name taken by a sibling is flagged', await waitFor(() => {
			const s = document.getElementById('ProcessPageAddStatus');
			return !!s && !!s.querySelector('.taken') && document.getElementById('Inputfield__pw_page_name').classList.contains('ui-state-error-text');
		}, null, 8000), sibling);
		await name.fill('');
		await name.pressSequentially(sibling + '-free-xyz');
		check('A a free name is not', await waitFor(() => !document.getElementById('Inputfield__pw_page_name').classList.contains('ui-state-error-text'), null, 8000));
		// without X-Requested-With the core renders ./exists as a whole admin page, .taken included
		check('A the status is the AJAX fragment, not an admin page', await page.evaluate(() => {
			const s = document.getElementById('ProcessPageAddStatus');
			return !!s && !s.querySelector('h1, header, nav, form, script');
		}));
	} else {
		check('A the fixture parent has a child to collide with', false, `sibling ${sibling}, name input ${await name.count()}`);
	}
	const publish = await page.evaluate(() => {
		const t = document.getElementById('template');
		const b = document.getElementById('submit_publish');
		if(!t || !b) return { skip: true };
		const li = b.closest('.Inputfield');
		const option = t.tagName === 'SELECT' ? t.querySelector('option[value="' + t.value + '"]') : t;
		return { want: !!option && option.getAttribute('data-publish') === '1', shown: li.style.display !== 'none' };
	});
	check('A Publish follows the template', publish.skip || publish.want === publish.shown, JSON.stringify(publish));

	// B: Profile
	await open('profile/');
	await noJquery('B Profile');
	check('B its form is there', await page.evaluate(() => !!document.querySelector('form#ProcessProfile')));

	// C: Logs (the first log that has entries)
	await open('setup/logs/');
	await noJquery('C Logs list');
	const logHref = await page.evaluate(() => { const a = document.querySelector('a[href*="view/"]'); return a ? a.getAttribute('href') : ''; });
	if(logHref) {
		await open('setup/logs/' + logHref.replace(/^.*?(view\/[^?#]+).*$/, '$1'));
		await noJquery('C a log');
		check('C the ProcessLogger API is there (native)', await page.evaluate(() => !!(window.ProcessLogger && ProcessLogger.native)));
		const before = await page.evaluate(() => document.querySelectorAll('#ProcessLogEntries tbody tr').length);
		const q = page.locator('#Inputfield_q');
		if(await q.count()) {
			// the filters sit in a collapsed fieldset
			await page.evaluate(() => Inputfields.find('q'));
			await page.waitForTimeout(500);
			const json = page.waitForResponse(r => /[?&]q=zzzz-no-match/.test(r.url()), { timeout: 10000 }).catch(() => null);
			await q.pressSequentially('zzzz-no-match');
			const res = await json;
			check('C typing a filter reloads the entries by AJAX', !!res && await waitFor((n) => document.querySelectorAll('#ProcessLogEntries tbody tr').length < n || !document.querySelector('#ProcessLogEntries tbody tr'), before, 8000), `${before} rows before`);
		}
		check('C new entries are polled every 5 s', !!(await page.waitForResponse(r => /[?&]time=\d+/.test(r.url()) && !/time=0\b/.test(r.url()), { timeout: 9000 }).catch(() => null)));
	} else {
		check('C a log to view', false, 'no logs');
	}

	// D: screens without scripts of their own
	for(const [label, path] of [['D Recent', 'page/recent/'], ['D Clone', 'page/clone/?id=' + NATIVE], ['D Trash', 'page/trash/']]) {
		await open(path);
		await noJquery(label);
	}

	// E: the link window (as the editors open it)
	await open('page/link/?id=' + NATIVE + '&modal=1');
	await noJquery('E link window');
	const url = page.locator('#link_page_url_input');
	await url.fill('');
	await url.pressSequentially('example.com/x');
	check('E a bare domain gets its scheme, the link is external', await waitFor(() => {
		const i = document.getElementById('link_page_url_input');
		return i.value === 'http://example.com/x' && i.classList.contains('external-link');
	}, null, 3000), await url.inputValue());
	const text = page.locator('#link_text');
	if(await text.count() && await text.isEditable()) await text.fill('Example');
	check('E the preview shows the link markup', await waitFor(() => /<a [^>]*href="http:\/\/example\.com\/x"/.test(document.getElementById('link_markup').textContent), null, 3000),
		await page.evaluate(() => document.getElementById('link_markup').textContent));
	await url.fill('');
	await url.pressSequentially('someone@example.com');
	check('E an address becomes mailto:', await waitFor(() => document.getElementById('link_page_url_input').value === 'mailto:someone@example.com', null, 3000));
	// the page picker: open its field, choose the first page under Home
	// as a user does: the header opens the field, and its tree opens with it
	await page.locator('#wrap_link_page_id > .InputfieldHeader').click();
	const picked = await waitFor(() => !!document.querySelector('#wrap_link_page_id .PageListItem a.PageListPage'), null, 8000);
	if(picked) {
		// the root item opens with the tree: its Choose action is showing
		const sel = page.locator('#wrap_link_page_id .PageListActionSelect a:visible').first();
		if(await sel.count()) await sel.click();
		check('E choosing a page fills the URL', await waitFor(() => /^(\/|\.\/|\.\.\/|[a-z0-9-])/.test(document.getElementById('link_page_url_input').value) && !/mailto:/.test(document.getElementById('link_page_url_input').value), null, 5000),
			await url.inputValue());
	} else {
		check('E the page picker opens', false);
	}

	// F (0.8.9): the shell's layout under stress, on the native page editor
	// notices: one that wraps on a phone goes into the flow instead of covering the head buttons
	const phone = await ctx.newPage();
	await phone.setViewportSize({ width: 375, height: 812 });
	await phone.goto(ADMIN + 'page/edit/?id=' + NATIVE, { waitUntil: 'networkidle' });
	await phone.evaluate(() => {
		let list = document.getElementById('notices');
		if(!list) {
			list = document.createElement('ul');
			list.id = 'notices';
			list.className = 'pw-notices';
			document.getElementById('pw-masthead').after(list);
		}
		const li = document.createElement('li');
		li.className = 'NoticeMessage pw-notice-success';
		li.textContent = 'Saved Page: /bridge-native/ (3 changes): title, summary, and a third field whose label is long enough to wrap on a phone';
		list.appendChild(li);
	});
	await phone.waitForTimeout(300);
	const band = await phone.evaluate(() => {
		const btn = document.querySelector('#pw-content-head-buttons button, #pw-content-head-buttons .ui-button') || document.getElementById('pw-content-title');
		const r = btn.getBoundingClientRect();
		const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
		return { cls: document.body.classList.contains('pw-notices-static'), covered: !!(hit && hit.closest('#notices')), what: btn.id || btn.tagName };
	});
	check('F a notice that wraps goes into the flow (pw-notices-static), not over the head', band.cls && !band.covered, JSON.stringify(band));
	await phone.close();

	// touch: the first tap on a menu toggle opens the menu, it does not follow the link
	const touchCtx = await browser.newContext({ viewport: { width: 1024, height: 800 }, hasTouch: true, isMobile: false,
		storageState: await ctx.storageState() });
	const tab = await touchCtx.newPage();
	await tab.goto(ADMIN + 'page/edit/?id=' + NATIVE, { waitUntil: 'networkidle' });
	const before = tab.url();
	const toggle = await tab.$('#tools-toggle');
	if(toggle) {
		const box = await toggle.boundingBox();
		await tab.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
		await tab.waitForTimeout(500);
		const opened = await tab.evaluate(() => { const t = document.getElementById('tools-toggle'); const m = t && t.nextElementSibling; return !!m && m.style.display === 'block'; }).catch(() => false);
		check('F touch: the first tap opens the user menu and stays on the page', opened && tab.url() === before, tab.url().replace(ADMIN, ''));
	}
	await touchCtx.close();

	// the top bar turns into the drawer when its items do not fit
	const wide = await ctx.newPage();
	await wide.setViewportSize({ width: 1000, height: 800 });
	await wide.goto(ADMIN + 'page/edit/?id=' + NATIVE, { waitUntil: 'networkidle' });
	const fits = await wide.evaluate(() => document.body.classList.contains('pw-nav-overflow'));
	await wide.evaluate(() => {
		const list = document.querySelector('.pw-primary-nav');
		for(let i = 0; i < 8; i++) { const li = document.createElement('li'); li.className = 'pw-nav-item pw-nav-item-top'; li.innerHTML = '<a href="#">Section with a long name ' + i + '</a>'; list.appendChild(li); }
		window.dispatchEvent(new Event('resize'));
	});
	await wide.waitForTimeout(300);
	const over = await wide.evaluate(() => ({ cls: document.body.classList.contains('pw-nav-overflow'), toggle: getComputedStyle(document.querySelector('.pw-nav-toggle')).display !== 'none' }));
	check('F a top bar that does not fit becomes the drawer', !fits && over.cls && over.toggle, JSON.stringify({ fits, over }));
	await wide.close();

	// the Save split button's toggle shows a focus ring when reached by keyboard
	const kb = await ctx.newPage();
	await kb.goto(ADMIN + 'page/edit/?id=' + NATIVE, { waitUntil: 'networkidle' });
	const toggleSel = await kb.evaluate(() => { const t = document.querySelector('#ProcessPageEdit .pw-button-dropdown-wrap .pw-button-dropdown-toggle, .pw-button-dropdown-toggle'); return t ? '#' + t.id : ''; });
	if(toggleSel && toggleSel !== '#') {
		await kb.focus(toggleSel);
		await kb.keyboard.press('Shift+Tab');
		await kb.keyboard.press('Tab');
		const shadow = await kb.evaluate(() => ({ id: document.activeElement.id, shadow: getComputedStyle(document.activeElement).boxShadow }));
		check('F the split button toggle shows a focus ring', shadow.id === toggleSel.slice(1) && shadow.shadow !== 'none', JSON.stringify(shadow));
	} else {
		check('F a split button toggle on the editor', false, 'none');
	}
	await kb.close();

	// G (0.9.2): contrast per variant and scheme, from computed colours. Primary button text at
	// least 4.5 to 1, except Boss blue and pink with white text, which ADR 0010 keeps (3.7, 3.8);
	// the focus ring at least 3 to 1 against the page
	const cv = await ctx.newPage();
	await cv.goto(ADMIN + 'page/edit/?id=' + NATIVE, { waitUntil: 'networkidle' });
	const contrast = await cv.evaluate(async () => {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 1;
		const g = canvas.getContext('2d', { willReadFrequently: true });
		// any CSS colour (rgb(), color(srgb ...), color-mix results) to sRGB through a canvas
		const rgb = (css) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = css; g.fillRect(0, 0, 1, 1); return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3)); };
		const lum = (c) => { const v = c.map(x => x / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
		const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
		const root = document.documentElement;
		const btn = document.getElementById('submit_save');
		const rows = [];
		for(const scheme of ['light', 'dark']) for(const v of ['blue', 'vibrant', 'black', 'pink', 'green']) {
			root.setAttribute('data-pw-scheme', scheme);
			root.setAttribute('data-pw-variant', v);
			// past the buttons' 150ms colour transition
			await new Promise(r => setTimeout(r, 400));
			const s = getComputedStyle(btn);
			const page = getComputedStyle(document.body).backgroundColor;
			const ring = getComputedStyle(root).getPropertyValue('--ring').trim();
			const text = ratio(s.color, s.backgroundColor);
			const focus = ratio(ring, page);
			const need = (v === 'blue' || v === 'pink') && rgb(s.color).every(x => x > 240) ? 3.5 : 4.5;
			rows.push({ scheme, v, text: +text.toFixed(2), need, focus: +focus.toFixed(2), ok: text >= need && focus >= 3 });
		}
		return rows;
	});
	const bad = contrast.filter(r => !r.ok);
	check('G primary text and focus ring contrast in every variant and scheme', bad.length === 0, JSON.stringify(bad.length ? bad : contrast.map(r => `${r.scheme}/${r.v} ${r.text}/${r.focus}`)));
	await cv.close();

	// forced colours (Windows high contrast): focus still shows, as an outline
	if(browserName === 'chromium') {
		const hc = await ctx.newPage();
		await hc.emulateMedia({ forcedColors: 'active' });
		await hc.goto(ADMIN + 'page/edit/?id=' + NATIVE, { waitUntil: 'networkidle' });
		await hc.focus('#Inputfield_title');
		const ring = await hc.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle + ' ' + s.outlineWidth; });
		check('F forced colours: a focused input has an outline', !/^none/.test(ring), ring);
		await hc.close();
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

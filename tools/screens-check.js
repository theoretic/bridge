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

// Drawers check (tools/drawers-check.js, 0.25.0): the theme's tab-focus bus (pw-tab-focus) that
// the page tree and history drawers refresh on.
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

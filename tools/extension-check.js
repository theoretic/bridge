// Contract tests of a Bridge extension in the browser (docs/extensions.md, extension contract 0.1),
// the client half of tools/extension-check.php. On the page tree, signed in as the sandbox user
// `bridge`, per extension of <Module> (a module class, or a directory: every module in it with a
// manifest): it is in Bridge.extensions.list() and compatible, Bridge.extensions.loaded() has it
// without error, `pw-extension-loaded` fired with its name (when it has a module), each slot it fills
// has its part in the DOM (data-bridge-slot + data-bridge-extension; `head` parts carry no wrapper
// and are not looked for), the custom elements in its parts are defined, Bridge.extensions.reload()
// fires `pw-extension-loaded` again without an error; and for the page: `pw-extensions-ready` fired
// once, no jQuery unless the theme recorded legacy reasons (the --gate idea of native-check.js), no
// console errors.
//
// The manifests and the slots each extension fills come from
// `php tools/extension-check.php <sandbox> <Module> --json` (run with PHP, on SANDBOX).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] [PROBE_PASS=<password>] [PHP=<php>] [SANDBOX=<sandbox root>]
//     node tools/extension-check.js <playwright-core dir> <firefox|chromium> <Module> [admin url]
// Exit code 1 when a check fails, 2 when the harness itself fails.
//
// Original work, MIT.
'use strict';
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'chromium';
const target = process.argv[4] || '';
const sandbox = require('./lib/sandbox.cjs');
if(!target) {
	console.error('usage: node tools/extension-check.js <playwright-core dir> <firefox|chromium> <Module> [admin url]');
	process.exit(2);
}
const ADMIN = sandbox.adminUrl(process.argv[5] || '');
const PHP = process.env.PHP || 'php';
const SANDBOX = sandbox.info().root;
const results = [];
const check = (name, ok, info) => { results.push({ ok: !!ok, name, info: info === undefined ? '' : String(info).slice(0, 300) }); };

(async () => {
	let manifests;
	try {
		const out = execFileSync(PHP, [path.join(sandbox.REPO, 'tools', 'extension-check.php'), SANDBOX, target, '--json'], { encoding: 'utf8' });
		manifests = JSON.parse(out.slice(out.indexOf('[')));
	} catch(e) {
		console.error('extension-check.php --json failed: ' + ((e.stdout || '') + (e.stderr || '') || e.message).trim());
		process.exit(2);
	}
	check(`${target}: declares at least one extension`, manifests.length > 0);

	const browser = await pw[browserName].launch({ headless: true });
	const statePath = process.env.PW_STATE || '';
	const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } },
		statePath && fs.existsSync(statePath) ? { storageState: statePath } : {}));
	const consoleErrors = require('./console-errors')(ctx);
	await ctx.addInitScript(() => {
		window.__extLoaded = [];
		window.__extReady = 0;
		document.addEventListener('pw-extension-loaded', (e) => { window.__extLoaded.push(e.detail || {}); });
		document.addEventListener('pw-extensions-ready', () => { window.__extReady++; });
	});
	const page = await ctx.newPage();
	const errors = [];
	page.on('pageerror', e => errors.push(e.message));
	const TREE = ADMIN + 'page/';
	await page.goto(TREE, { waitUntil: 'networkidle' });
	if(await page.locator('#login_name').count()) {
		await page.fill('#login_name', 'bridge');
		await page.fill('#login_pass', sandbox.password());
		await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);
		if(statePath) await ctx.storageState({ path: statePath });
		await page.goto(TREE, { waitUntil: 'networkidle' });
	}
	if(await page.locator('#login_name').count()) throw new Error('login failed (throttled? wrong PROBE_PASS?)');
	await page.waitForFunction(() => window.__extReady > 0, null, { timeout: 8000 }).catch(() => {});

	const env = await page.evaluate(() => {
		const c = (window.ProcessWire && ProcessWire.config.AdminThemeBridge) || {};
		return { ready: window.__extReady, jquery: !!window.jQuery, reasons: Object.keys(c.legacyReasons || {}) };
	});
	check('page: pw-extensions-ready fired once', env.ready === 1, env.ready);
	check('page: no jQuery unless the theme recorded legacy reasons', !env.jquery || env.reasons.length > 0, env.reasons.join(', '));

	for(const m of manifests) {
		const name = m.name;
		const state = await page.evaluate((name) => {
			const listed = Bridge.extensions.list().filter(e => e.name === name)[0] || null;
			const loaded = Bridge.extensions.loaded().filter(e => e.name === name)[0] || null;
			const events = window.__extLoaded.filter(d => d.name === name);
			return { listed, loaded, events };
		}, name);
		check(`${name}: in Bridge.extensions.list(), compatible`, state.listed && state.listed.compatible === true, JSON.stringify(state.listed));
		check(`${name}: in Bridge.extensions.loaded() without error`, state.loaded && state.loaded.error === null, JSON.stringify(state.loaded));
		if(m.module) {
			check(`${name}: pw-extension-loaded fired with its name and module`, state.events.length === 1 && !!state.events[0].module, JSON.stringify(state.events));
		} else {
			check(`${name}: pw-extension-loaded fired with its name (no module)`, state.events.length === 1 && state.events[0].module === null, JSON.stringify(state.events));
		}
		for(const [slot, filled] of Object.entries(m.slots)) {
			if(!filled || slot === 'head') continue;
			const parts = await page.evaluate(({ slot, name }) => {
				const els = Array.from(document.querySelectorAll('[data-bridge-slot]')).filter(el => el.dataset.bridgeSlot === slot && el.dataset.bridgeExtension === name);
				const undef = els.reduce((n, el) => n + el.querySelectorAll(':not(:defined)').length, 0);
				const button = slot === 'drawer' ? !!document.querySelector('[data-pw-drawer="' + els.map(el => el.dataset.pwDrawerName)[0] + '"]') : true;
				return { count: els.length, undef, button };
			}, { slot, name });
			check(`${name}: slot ${slot} has its part in the DOM`, parts.count === 1 && parts.button, JSON.stringify(parts));
			check(`${name}: slot ${slot}: the custom elements in it are defined`, parts.undef === 0, parts.undef);
		}
		if(m.module) {
			// the exported tag need not be a custom element (a Process component's is its own name)
			const definedBefore = !!(state.loaded && state.loaded.tag) && await page.evaluate((tag) => !!customElements.get(tag), state.loaded.tag);
			const reloaded = await page.evaluate(async (name) => {
				const before = window.__extLoaded.filter(d => d.name === name).length;
				let error = '';
				try { await Bridge.extensions.reload(name); } catch(e) { error = String(e); }
				const loaded = Bridge.extensions.loaded().filter(e => e.name === name)[0] || null;
				return { fired: window.__extLoaded.filter(d => d.name === name).length - before, error, loaded };
			}, name);
			check(`${name}: reload() fires pw-extension-loaded again, no error`, reloaded.fired === 1 && reloaded.error === '' && reloaded.loaded && reloaded.loaded.error === null, JSON.stringify(reloaded));
			if(definedBefore) {
				check(`${name}: ${state.loaded.tag} still defined after reload()`, await page.evaluate((tag) => !!customElements.get(tag), state.loaded.tag));
			}
		}
	}
	check('page: no page errors', errors.length === 0, errors.join(' | '));
	await consoleErrors.settle();
	consoleErrors.check(check);
	await browser.close();
	const failed = results.filter(r => !r.ok);
	for(const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.info && !r.ok ? '  [' + r.info + ']' : ''}`);
	console.log(`\n${browserName}: ${results.length - failed.length}/${results.length} passed`);
	process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

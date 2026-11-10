// Dev mode for an extension's client module (docs/extensions.md 9): opens the admin's page tree in a
// browser, signed in as the sandbox user `bridge`, watches the module's directory and, on a change,
// calls Bridge.extensions.reload(<name>) for each extension whose module lies in that directory.
// The page stays; the module is imported again with a fresh ?v= and `pw-extension-loaded` fires
// again. A changed .css file swaps the href of every link[data-bridge-styles] (the extension's
// `styles`, contract 0.2) whose path ends with that file to a fresh ?v=, so the stylesheet loads
// again without a module reload. One line per reload or swap; the page's console errors are printed
// too. A changed PHP file is only reported (PHP takes a page load). Not hot module replacement: see
// the doc.
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   PW=<playwright-core dir> [HEADLESS=1] [BROWSER=chromium|firefox] [PW_STATE=<login state file>]
//     [PROBE_PASS=<password>] [SANDBOX=<sandbox root>] node tools/extension-dev.js <module dir> [admin url]
// Stops on Ctrl+C or when the browser is closed. Exit code 2 when it cannot start.
//
// Original work, MIT.
'use strict';
const path = require('path');
const fs = require('fs');
const sandbox = require('./lib/sandbox.cjs');

const dirArg = process.argv[2] || '';
if(!dirArg || !process.env.PW) {
	console.error('usage: PW=<playwright-core dir> node tools/extension-dev.js <module dir> [admin url]');
	process.exit(2);
}
const dir = path.resolve(dirArg);
if(!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
	console.error(`not a directory: ${dir}`);
	process.exit(2);
}
const dirName = path.basename(dir);
const ADMIN = sandbox.adminUrl(process.argv[3] || '');
const pw = require(process.env.PW);
const browserName = process.env.BROWSER || 'chromium';
const log = (line) => console.log(`[extension-dev] ${new Date().toTimeString().slice(0, 8)} ${line}`);

(async () => {
	const browser = await pw[browserName].launch({ headless: process.env.HEADLESS === '1' });
	const statePath = process.env.PW_STATE || '';
	const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } },
		statePath && fs.existsSync(statePath) ? { storageState: statePath } : {}));
	await ctx.addInitScript(() => {
		window.__extDevLoaded = [];
		document.addEventListener('pw-extension-loaded', (e) => { window.__extDevLoaded.push((e.detail && e.detail.name) || ''); });
	});
	const page = await ctx.newPage();
	page.on('console', (msg) => { if(msg.type() === 'error') log(`console error: ${msg.text()}`); });
	page.on('pageerror', (e) => log(`page error: ${e.message}`));
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

	// the extensions of this page whose module lies in the watched directory (by its URL path)
	const names = async () => page.evaluate((dirName) => {
		if(!window.Bridge || !Bridge.extensions) return [];
		return Bridge.extensions.list().filter(e => e.module && new URL(e.module, location.href).pathname.split('/').indexOf(dirName) >= 0).map(e => e.name);
	}, dirName).catch(() => []);
	const first = await names();
	log(`watching ${dir}; page ${page.url()}; extensions: ${first.length ? first.join(', ') : `none with a module in ${dirName}/ on this page`}`);

	let timer = null;
	let changed = new Set();
	let busy = Promise.resolve();
	const reload = async () => {
		const files = Array.from(changed);
		changed = new Set();
		const php = files.filter(f => /\.php$/i.test(f));
		const css = files.filter(f => /\.css$/i.test(f));
		const other = files.filter(f => !/\.php$/i.test(f) && !/\.css$/i.test(f));
		if(php.length) log(`${php.join(', ')} changed: PHP, not reloaded (load the page again)`);
		for(const file of css) {
			// the extension's stylesheets (data-bridge-styles) whose path ends with the file: a fresh ?v=
			const swapped = await page.evaluate((file) => {
				const out = [];
				for(const link of Array.from(document.querySelectorAll('link[data-bridge-styles]'))) {
					const url = new URL(link.getAttribute('href') || '', location.href);
					if(!url.pathname.endsWith('/' + file)) continue;
					url.searchParams.set('v', String(Date.now()));
					link.setAttribute('href', url.origin === location.origin ? url.pathname + url.search : url.href);
					out.push(link.getAttribute('data-bridge-styles') + ' ' + link.getAttribute('href'));
				}
				return out;
			}, file).catch(e => ['error: ' + e.message]);
			log(`${file} changed -> ${swapped.length ? 'link[data-bridge-styles] href swapped: ' + swapped.join(', ') : 'no link[data-bridge-styles] of it on this page'}`);
		}
		if(!other.length) return;
		const list = await names();
		if(!list.length) {
			log(`${other.join(', ')} changed: no extension of ${dirName}/ on this page`);
			return;
		}
		for(const name of list) {
			const r = await page.evaluate(async (name) => {
				const before = window.__extDevLoaded.filter(n => n === name).length;
				let error = '';
				try { await Bridge.extensions.reload(name); } catch(e) { error = String(e); }
				const l = Bridge.extensions.loaded().filter(e => e.name === name)[0] || null;
				return { fired: window.__extDevLoaded.filter(n => n === name).length - before, error: error || (l && l.error) || '', version: l && l.version, url: l && l.url };
			}, name).catch(e => ({ fired: 0, error: e.message, version: null, url: null }));
			log(`${other.join(', ')} changed -> Bridge.extensions.reload('${name}'): ${r.error ? 'error: ' + r.error : (r.fired ? 'pw-extension-loaded' : 'no pw-extension-loaded') + ', version ' + r.version + ', ' + r.url}`);
		}
	};
	const watcher = fs.watch(dir, { recursive: true }, (event, file) => {
		if(!file) return;
		changed.add(String(file).replace(/\\/g, '/'));
		clearTimeout(timer);
		timer = setTimeout(() => { busy = busy.then(reload, reload); }, 150);
	});
	const stop = async (code) => {
		watcher.close();
		clearTimeout(timer);
		await browser.close().catch(() => {});
		process.exit(code);
	};
	process.on('SIGINT', () => stop(0));
	process.on('SIGTERM', () => stop(0));
	browser.on('disconnected', () => { watcher.close(); process.exit(0); });
	page.on('close', () => stop(0));
})().catch(e => { console.error(e); process.exit(2); });

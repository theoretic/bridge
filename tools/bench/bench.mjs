// Admin theme benchmark on a Bridge sandbox: Lighthouse (desktop preset, performance only,
// cold cache per run) plus the bytes each screen loads, raw and gzipped.
// usage (tools/bench/README.md): cd tools/bench && npm install, then
//   SB_ROOT=<sandbox root> PHP=<php binary> PROBE_PASS=... node bench.mjs <playwright-core dir> <out dir> [runs]
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import puppeteer from 'puppeteer-core';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { gzipSync } from 'zlib';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const require = createRequire(import.meta.url);
const pw = require(process.argv[2]);
const OUT = process.argv[3];
const RUNS = +(process.argv[4] || 3);
const here = (rel) => new URL(rel, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const ROOT = process.env.SB_ROOT || here('../../sandbox/atispro');
const PHP = process.env.PHP || 'php';
const SWITCH = here('./switch-theme.php');
const ADMIN = 'http://localhost:8089/fv9673g5vdfigh/';
const PORT = 9333;

const THEMES = [
	{ key: 'Bridge', user: 'bridge', module: 'AdminThemeBridge', style: '', marker: '/AdminThemeBridge/' },
	{ key: 'Uikit (original)', user: 'uikit', module: 'AdminThemeUikit', style: '', marker: '/AdminThemeUikit/' },
	{ key: 'Uikit (2025 redesign)', user: 'uikit', module: 'AdminThemeUikit', style: 'default', marker: '/AdminThemeUikit/' },
	{ key: 'AdminThemeBoss', user: 'uikit', module: 'AdminThemeBoss', style: '', marker: '/AdminThemeBoss/' },
	{ key: 'Reno', user: 'uikit', module: 'AdminThemeReno', style: '', marker: '/AdminThemeReno/' },
	{ key: 'Default', user: 'uikit', module: 'AdminThemeDefault', style: '', marker: '/AdminThemeDefault/' },
];
const SCREENS = [
	{ key: 'Page tree', path: 'page/' },
	{ key: 'Page editor', path: 'page/edit/?id=1' },
	{ key: 'Lister', path: 'page/lister/' },
	{ key: 'Modules', path: 'module/' },
];
const only = (process.env.ONLY_THEMES || '').split(',').filter(Boolean);

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const flags = { port: PORT, output: 'json', logLevel: 'error', onlyCategories: ['performance'], emulatedUserAgent: false, disableStorageReset: true }; // cache cleared per run below; storage reset would also drop the session cookie

async function go(page, url, waitUntil = 'networkidle0') {
	for(let i = 1; ; i++) {
		try { return await page.goto(url, { waitUntil, timeout: 90000 }); }
		catch(e) { if(i >= 3) throw e; console.log('  retry goto', url, e.message.slice(0, 60)); await new Promise(r => setTimeout(r, 5000)); }
	}
}
mkdirSync(OUT, { recursive: true });
const results = [];

for(const theme of THEMES) {
	if(only.length && !only.includes(theme.key)) continue;
	console.log(execFileSync(PHP, [SWITCH, ROOT, theme.module, theme.style], { encoding: 'utf8' }).trim());
	const chrome = await chromeLauncher.launch({ chromePath: pw.chromium.executablePath(), chromeFlags: ['--headless=new', '--no-first-run', '--dns-prefetch-disable', '--disable-features=NetworkPrediction,Prerender2'] });
	const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + chrome.port, defaultViewport: null });
	const page = await browser.newPage();
	await go(page, ADMIN);
	await page.type('#login_name', theme.user);
	await page.type('#login_pass', process.env.PROBE_PASS);
	await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#Inputfield_login_submit')]);
	if(await page.$('#login_name')) throw new Error('login failed for ' + theme.user);
	const cookieHeader = async () => (await page.cookies('http://localhost:8089/')).map(c => c.name + '=' + c.value).join('; ');
	flags.port = chrome.port;
	const cdp = await page.createCDPSession();

	for(const screen of SCREENS) { try {
		const url = ADMIN + screen.path;
		await go(page, url); // warm PHP, check the session
		if(await page.$('#login_name')) throw new Error('session lost before ' + screen.key + '; cookies: ' + (await page.cookies('http://localhost:8089/')).map(c => c.name).join(','));
		const jq = await page.evaluate(() => typeof window.jQuery === 'function');
		const runs = [];
		let lastLhr;
		for(let i = 0; i < RUNS; i++) {
			await cdp.send('Network.clearBrowserCache'); // cold HTTP cache, cookies kept
			const r = await lighthouse(url, flags, desktopConfig, page);
			console.log('  run', i + 1, screen.key, 'url', page.url(), 'cookies', (await page.cookies('http://localhost:8089/')).map(c => c.name).join(','));
			const lhr = r.lhr;
			if(lhr.runtimeError) throw new Error(lhr.runtimeError.message);
			const a = lhr.audits;
			runs.push({
				score: Math.round(lhr.categories.performance.score * 100),
				fcp: a['first-contentful-paint'].numericValue, lcp: a['largest-contentful-paint'].numericValue,
				tbt: a['total-blocking-time'].numericValue, cls: a['cumulative-layout-shift'].numericValue,
				si: a['speed-index'].numericValue,
			});
			lastLhr = lhr;
		}
		// bytes and requests from the last run's network log
		const all = lastLhr.audits['network-requests'].details.items;
		const external = all.filter(x => !x.url.startsWith('http://localhost:8089/')).map(x => x.url);
		const items = all.filter(x => x.url.startsWith('http://localhost:8089/'));
		const themeSeen = items.some(x => x.url.includes(theme.marker));
		if(!page.url().startsWith('http://localhost:8089/')) await go(page, ADMIN, 'domcontentloaded');
		const by = {};
		for(const x of items) {
			const t = x.resourceType || 'Other';
			by[t] = by[t] || { requests: 0, raw: 0, gzip: 0 };
			by[t].requests++;
			by[t].raw += x.resourceSize || 0;
			if(['Script', 'Stylesheet', 'Document', 'XHR', 'Fetch'].includes(t)) {
				try { const b64 = await page.evaluate(async (u) => { const r = await fetch(u, { credentials: 'same-origin' }); const a = new Uint8Array(await r.arrayBuffer()); let s = ''; for(let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); }, x.url); by[t].gzip += gzipSync(Buffer.from(b64, 'base64'), { level: 6 }).length; }
				catch(e) { by[t].gzip += x.resourceSize || 0; }
			} else by[t].gzip += x.resourceSize || 0;
		}
		const row = {
			theme: theme.key, screen: screen.key, jquery: jq, themeAssetsSeen: themeSeen,
			score: median(runs.map(r => r.score)), fcp: median(runs.map(r => r.fcp)), lcp: median(runs.map(r => r.lcp)),
			tbt: median(runs.map(r => r.tbt)), cls: median(runs.map(r => r.cls)), si: median(runs.map(r => r.si)),
			requests: items.length, external, bytes: by, runs,
		};
		results.push(row);
		writeFileSync(join(OUT, `lhr-${theme.key.replace(/\W+/g, '_')}-${screen.key.replace(/\W+/g, '_')}.json`), JSON.stringify(lastLhr));
		console.log(`${theme.key} | ${screen.key} | score ${row.score} | LCP ${Math.round(row.lcp)} ms | TBT ${Math.round(row.tbt)} ms | req ${row.requests} | JS ${Math.round((by.Script?.gzip || 0) / 1024)} kB gz | CSS ${Math.round((by.Stylesheet?.gzip || 0) / 1024)} kB gz | jQuery ${jq} | themeSeen ${themeSeen}`);
		writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
	} catch(e) { console.log('FAILED', theme.key, '|', screen.key, '|', e.message.slice(0, 160)); results.push({ theme: theme.key, screen: screen.key, error: e.message }); writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1)); } }
	await browser.disconnect();
	await chrome.kill();
}
console.log(execFileSync(PHP, [SWITCH, ROOT, 'AdminThemeUikit', ''], { encoding: 'utf8' }).trim());
console.log('done');

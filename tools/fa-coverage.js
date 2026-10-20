// Font Awesome subset coverage (tools/fa-coverage.js): opens admin screens under AdminThemeBridge and
// reports which Font Awesome files each screen requests (the subsets of
// runtime/scripts/fa-subset.mjs or a full file) and which rendered icons are outside the subsets.
// Those still render, from the full file; the list shows candidates for runtime/fa-icons.txt.
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   PROBE_PASS=<sandbox bridge password> node tools/fa-coverage.js <playwright-core dir> <screens.json>
//     [base url, default http://localhost:8089] [Font Awesome version, default 6.7.2]
// <screens.json>: a gate1/conformance JSON of the sandbox (its keys or url fields are the screens).
const pw = require(process.argv[2]);
const fs = require('fs');
const path = require('path');
const BASE = process.argv[4] || 'http://localhost:8089';
const VERSION = process.argv[5] || '6.7.2';
const src = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const screens = Array.isArray(src) ? src.map(x => x.url || x.screen) : Object.keys(src.screens || src);

// family|weight -> code points served by a subset file
const faCss = fs.readFileSync(path.join(__dirname, '..', 'modules', 'AdminThemeBridge', 'assets', 'fonts', 'fa-' + VERSION, 'fa.css'), 'utf8');
const subset = {};
for(const m of faCss.matchAll(/@font-face\{font-family:"([^"]+)";font-style:normal;(?:font-weight:(\d+);)?font-display:block;src:url\(([^)]+)\)[^;]*;unicode-range:([^}]+)\}/g)) {
	if(!/-subset\.woff2/.test(m[3])) continue;
	const key = m[1] + '|' + (m[2] || '400');
	subset[key] = subset[key] || new Set();
	for(const part of m[4].split(',')) {
		const [a, b] = part.trim().toLowerCase().replace('u+', '').split('-');
		for(let cp = parseInt(a, 16); cp <= parseInt(b || a, 16); cp++) subset[key].add(cp);
	}
}

(async () => {
	const browser = await pw.chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
	let fonts = [];
	page.on('request', r => { if(/\/fa-[a-z0-9-]+\.woff2/.test(r.url())) fonts.push(r.url().replace(/^.*\//, '').replace(/\?.*$/, '')); });
	await page.goto(BASE + screens[0], { waitUntil: 'networkidle' });
	if(await page.locator('#login_name').count()) {
		await page.fill('#login_name', 'bridge');
		await page.fill('#login_pass', process.env.PROBE_PASS);
		await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);
	}
	const missing = new Map();
	let full = 0, done = 0;
	for(const url of screens) {
		fonts = [];
		try { await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 60000 }); } catch(e) { console.log('skip', url, e.message.slice(0, 60)); continue; }
		if(await page.locator('#login_name').count()) { console.log('session lost at', url); break; }
		done++;
		// icons with layout boxes (display:none ones fetch nothing until shown): family, weight, code point
		const icons = await page.evaluate(() => {
			const out = [];
			for(const el of document.querySelectorAll('*')) {
				if(!el.getClientRects().length) continue;
				for(const pe of ['::before', '::after']) {
					const st = getComputedStyle(el, pe);
					if(!/Awesome/i.test(st.fontFamily)) continue;
					const c = st.content.replace(/^"|"$/g, '');
					if(!c || c === 'none' || c.length > 2) continue;
					out.push({ fam: st.fontFamily.split(',')[0].replace(/["']/g, '').trim(), w: +st.fontWeight >= 600 ? '900' : '400', cp: c.codePointAt(0), name: [...el.classList].filter(x => /^fa-/.test(x) && !/^fa-(fw|lg|spin|[0-9]x)$/.test(x)).join(' ') });
				}
			}
			return out;
		});
		const out = icons.filter(i => !(subset[i.fam + '|' + i.w] || new Set()).has(i.cp));
		out.forEach(i => { const k = (i.name || 'U+' + i.cp.toString(16)) + ' (' + i.fam + ' ' + i.w + ')'; missing.set(k, (missing.get(k) || 0) + 1); });
		const fullFiles = [...new Set(fonts.filter(f => !/-subset\./.test(f)))];
		if(fullFiles.length) full++;
		console.log(`${fullFiles.length ? 'FULL' : 'ok  '} ${url} | icons ${icons.length}, outside ${out.length}${fullFiles.length ? ' | full: ' + fullFiles.join(' ') : ''}`);
	}
	console.log(`\n${done} screens, ${full} requested a full file`);
	if(missing.size) console.log('icons outside the subsets (screens):');
	[...missing.entries()].sort((a, b) => b[1] - a[1]).forEach(([n, c]) => console.log(`  ${n} ${c}`));
	await browser.close();
})();

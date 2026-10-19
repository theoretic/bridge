// Dropdown hover stress test (tools/dropdown-stress.js): random pointer paths over the top-bar
// toggles, their menus and flyouts in a real browser engine; after each rest it checks that a
// toggle under the pointer has its menu open and that a menu under the pointer is visible.
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1 so the page path is not rewritten):
//   PROBE_PASS=<sandbox bridge password> node tools/dropdown-stress.js <playwright-core dir>
//     <firefox|chromium|webkit> <admin page path> [moves=80] [seed=7]
// The base URL is the atispro sandbox (http://localhost:8089, user "bridge").
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'firefox';
const pagePath = process.argv[4] || '/fv9673g5vdfigh/page/edit/?id=1264';
const MOVES = +(process.argv[5] || 80);
let seed = +(process.argv[6] || 7);
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const BASE = 'http://localhost:8089';

const instrument = () => {
	window.__log = [];
	const t0 = performance.now();
	const label = (ul) => { const a = ul.parentElement && ul.parentElement.querySelector(':scope > a'); return (ul.id || ul.className.split(' ')[0]) + (a && ul.parentElement.tagName === 'LI' ? '<' + a.textContent.trim().slice(0, 10) : ''); };
	const vis = (ul) => { const s = getComputedStyle(ul); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05; };
	const state = new Map();
	const check = () => {
		document.querySelectorAll('ul.pw-dropdown-menu, ul.pw-dropdown-menu ul, ul.pw-button-dropdown').forEach(ul => {
			const v = vis(ul);
			if(state.get(ul) !== v) { state.set(ul, v); window.__log.push((Math.round(performance.now() - t0)) + (v ? ' SHOW ' : ' hide ') + label(ul)); }
		});
	};
	const start = () => { new MutationObserver(check).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['style', 'class'], childList: true }); setInterval(check, 10); };
	if(document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
};

(async () => {
	const browser = await pw[browserName].launch({ headless: true });
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const page = await ctx.newPage();
	await page.goto(BASE + '/fv9673g5vdfigh/');
	await page.fill('#login_name', 'bridge');
	await page.fill('#login_pass', process.env.PROBE_PASS);
	await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);
	await page.addInitScript(instrument);
	await page.goto(BASE + pagePath, { waitUntil: 'networkidle' });
	await page.waitForTimeout(800);

	// state of the world at the pointer: which toggle (hit area) or visible menu is under it
	const probe = (x, y) => page.evaluate(([x, y]) => {
		const el = document.elementFromPoint(x, y);
		const toggle = el && el.closest('#pw-nav a.pw-dropdown-toggle, .pw-user-nav a.pw-dropdown-toggle');
		const menu = el && el.closest('ul.pw-dropdown-menu');
		const vis = (u) => u && getComputedStyle(u).display !== 'none' && getComputedStyle(u).visibility !== 'hidden';
		let menuOfToggle = null;
		if(toggle && window.jQuery) { const d = jQuery(toggle).data('pw-dropdown-ul'); menuOfToggle = d && d[0]; }
		if(toggle && !menuOfToggle) menuOfToggle = toggle.parentElement.querySelector('.pw-dropdown-menu');
		return { toggle: toggle ? toggle.textContent.trim() : null, toggleMenuVisible: toggle ? !!vis(menuOfToggle) : null, inMenu: !!menu, menuVisible: menu ? !!vis(menu.closest('ul.pw-dropdown-menu:not(ul ul)') || menu) : null };
	}, [x, y]);

	const targets = async (px, py) => page.evaluate(([px, py]) => {
		const r = [];
		document.querySelectorAll('#pw-nav a.pw-dropdown-toggle, .pw-user-nav a.pw-dropdown-toggle').forEach(a => { const b = a.getBoundingClientRect(); r.push({ k: 'toggle', x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: 56 }); });
		// only the menu chain the pointer is in: the menu of the toggle under it, or the menu under it
		const el = document.elementFromPoint(px, py);
		let root = el && el.closest('ul.pw-dropdown-menu');
		while(root && root.parentElement && root.parentElement.closest('ul.pw-dropdown-menu')) root = root.parentElement.closest('ul.pw-dropdown-menu');
		const tg = el && el.closest('a.pw-dropdown-toggle');
		if(!root && tg) { const d = window.jQuery && jQuery(tg).data('pw-dropdown-ul'); root = (d && d[0]) || tg.parentElement.querySelector('.pw-dropdown-menu'); }
		const shown = (u) => { const s = getComputedStyle(u); return s.display !== 'none' && s.visibility !== 'hidden'; };
		if(root && shown(root)) {
			root.querySelectorAll(':scope > li > a').forEach((a, i) => { if(i > 8) return; const b = a.getBoundingClientRect(); if(b.width) r.push({ k: 'item', x: b.x + b.width / 3, y: b.y + b.height / 2, w: b.width / 2, h: b.height - 4 }); });
			const li = el && el.closest('ul.pw-dropdown-menu > li');
			const fly = li && li.querySelector(':scope > ul');
			if(fly && shown(fly)) fly.querySelectorAll(':scope > li > a').forEach((a, i) => { if(i > 6) return; const b = a.getBoundingClientRect(); if(b.width) r.push({ k: 'flyout', x: b.x + b.width / 3, y: b.y + b.height / 2, w: b.width / 2, h: b.height - 4 }); });
		}
		r.push({ k: 'away', x: 640, y: 650, w: 200, h: 100 });
		return r;
	}, [px, py]);

	let x = 640, y = 650;
	const violations = [], stats = { moves: 0, onToggle: 0, inMenu: 0 };
	const path = [];
	for(let i = 0; i < MOVES; i++) {
		await page.evaluate(() => window.__log.length > 40 && window.__log.splice(0, window.__log.length - 40));
		const ts = await targets(x, y);
		const prefer = ts.filter(t => t.k !== 'away');
		const t = (rnd() < .85 && prefer.length ? prefer : ts)[Math.floor(rnd() * (rnd() < .85 && prefer.length ? prefer.length : ts.length))] || ts[0];
		const nx = t.x + (rnd() - .5) * t.w * .8, ny = t.y + (rnd() - .5) * t.h * .8;
		const steps = 2 + Math.floor(rnd() * 14);
		await page.mouse.move(nx, ny, { steps });
		x = nx; y = ny;
		const rest = 50 + Math.floor(rnd() * 500);
		await page.waitForTimeout(rest);
		const s = await probe(x, y);
		stats.moves++;
		path.push(t.k + (s.toggle ? ':' + s.toggle : '') + '@' + Math.round(x) + ',' + Math.round(y) + '/' + steps + 's/' + rest + 'ms');
		if(s.toggle) {
			stats.onToggle++;
			if(rest >= 300 && !s.toggleMenuVisible) violations.push(`#${i} rest ${rest}ms on toggle "${s.toggle}" (${t.k}, steps ${steps}) but its menu is hidden; prev: ${path.slice(-3).join(' > ')}; log: ${(await page.evaluate(() => window.__log.slice(-8))).join(' / ')}`);
		}
		if(s.inMenu) {
			stats.inMenu++;
			if(!s.menuVisible) violations.push(`#${i} pointer inside a hidden menu (${t.k})`);
		}
		if(t.k !== 'away' && t.k !== 'toggle' && !s.inMenu && !s.toggle) violations.push(`#${i} aimed at ${t.k} but menu closed before arrival (steps ${steps}); at ${Math.round(x)},${Math.round(y)} el=${await page.evaluate(([x,y])=>{const e=document.elementFromPoint(x,y); return e? e.tagName+'.'+String(e.className).slice(0,40):'none'},[x,y])}; prev: ${path.slice(-3).join(' > ')}; log: ${(await page.evaluate(() => window.__log.slice(-8))).join(' / ')}`);
	}
	console.log(JSON.stringify({ browser: browserName, page: pagePath, stats, violations: violations.length, details: violations.slice(0, 25) }, null, 1));
	await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

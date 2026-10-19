// Colour scheme scan (tools/scheme-scan.js): opens admin screens under AdminThemeBridge in the
// dark and the light scheme and lists what does not follow the scheme:
//   bg       (dark only) an element painting a light background: colour or gradient stop with
//            relative luminance > 0.4 and alpha > 0.5
//   text     text with contrast below 3:1 against the background it sits on (both schemes)
// Rich-text iframes (CKEditor, TinyMCE) are scanned too. A last pass loads the fixture page in
// light, switches to dark with the masthead toggle and scans again (live switching).
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core) and
// the field fixture page (php tools/sandbox-fixture.php <sandbox>; its id in FIXTURE_ID).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   PROBE_PASS=<sandbox bridge password> FIXTURE_ID=<id> node tools/scheme-scan.js <playwright-core dir>
//     <firefox|chromium> [base url, default http://localhost:8089/fv9673g5vdfigh/] [--json out.json]
// PAGES=<id>,<id> adds more page editors to the screens (third-party fields on other sandboxes).
// Exit code 1 when anything is found.
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'firefox';
const ADMIN = (process.argv[4] && !process.argv[4].startsWith('--')) ? process.argv[4] : 'http://localhost:8089/fv9673g5vdfigh/';
const jsonOut = process.argv.indexOf('--json') > -1 ? process.argv[process.argv.indexOf('--json') + 1] : '';

// elements whose colours are content, not chrome
const ALLOW = [
	'img', 'canvas', 'video', 'svg', 'svg *', 'picture', 'iframe',
	'.sp-container *', '.colorpicker *', '.focusCircle', '[class*="leaflet-"]', '[class*="gm-"]',
	'.InputfieldColorPicker *', '[id^="ColorPicker_"]', '.ColorPickerSwatch', '[style*="background-color"][class*="swatch"]',
	'.swatches a', '.inputfield_swatches a', // colour swatches (FieldtypeMatrix and similar)
	'#tracy-debug', '#tracy-debug *', // TracyDebugger's own bar
	'.langTabEmpty a', // a language with no value yet: dimmed on purpose
	'.pw-scan-ignore', '.pw-scan-ignore *',
];

// runs in the page (and in each same-origin frame): returns findings
function scan(opts) {
	const allow = opts.allow.join(',');
	const out = [];
	const parse = (c) => {
		// color-mix() results compute to color(srgb r g b / a), channels 0..1
		const k = c && c.match(/color\(srgb ([^)]+)\)/);
		if(k) {
			const p = k[1].split(/[\s/]+/).filter(Boolean).map(parseFloat);
			return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 };
		}
		const m = c && c.match(/rgba?\(([^)]+)\)/);
		if(!m) return null;
		const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
		return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
	};
	const lum = (c) => {
		const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
		return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b);
	};
	const blend = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
	const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
	const sig = (el) => {
		const one = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
			Array.from(e.classList).filter(c => !/^(Inputfield_|pw-hover|ui-state-hover|ui-state-focus)/.test(c)).slice(0, 3).map(c => '.' + c).join('');
		const parts = [one(el)];
		let p = el.parentElement;
		for(let i = 0; i < 2 && p && p !== document.body; i++, p = p.parentElement) parts.unshift(one(p));
		return parts.join(' > ');
	};
	const visible = (el) => {
		if(el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
		const r = el.getBoundingClientRect();
		return r.width > 2 && r.height > 2;
	};
	// canvas colour when nothing paints: dark only if the root says so
	const canvas = getComputedStyle(document.documentElement).colorScheme.indexOf('dark') > -1
		? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
	const effectiveBg = (el) => {
		const stack = [];
		for(let e = el; e; e = e.parentElement) {
			const c = parse(getComputedStyle(e).backgroundColor);
			if(c && c.a > 0) { stack.push(c); if(c.a >= 1) break; }
		}
		let bg = canvas;
		for(let i = stack.length - 1; i >= 0; i--) bg = blend(stack[i], bg);
		return bg;
	};
	const els = document.body ? [document.body].concat(Array.from(document.body.querySelectorAll('*'))) : [];
	for(const el of els) {
		if(allow && el.matches(allow)) continue;
		if(['SCRIPT', 'STYLE', 'LINK', 'META', 'BR', 'OPTION'].includes(el.tagName)) continue;
		if(!visible(el)) continue;
		const cs = getComputedStyle(el);
		if(opts.scheme === 'dark') {
			// the body stands for the page or frame canvas: what shows through counts
			const bg = el === document.body ? effectiveBg(el) : parse(cs.backgroundColor);
			if(bg && bg.a > .5 && lum(bg) > .4) out.push({ kind: 'bg', sig: sig(el), value: cs.backgroundColor });
			const img = cs.backgroundImage;
			if(img && img.indexOf('gradient') > -1) {
				const stops = img.match(/(rgba?|color)\([^)]+\)/g) || [];
				const light = stops.map(parse).filter(c => c && c.a > .5 && lum(c) > .4);
				if(light.length) out.push({ kind: 'bg', sig: sig(el), value: 'gradient ' + stops.slice(0, 2).join(' ') });
			}
		}
		const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
		if(hasText) {
			const fg = parse(cs.color);
			if(fg && fg.a > .3) {
				const bg = effectiveBg(el);
				const r = ratio(blend(fg, bg), bg);
				if(r < 3) out.push({ kind: 'text', sig: sig(el), value: cs.color + ' on rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(', ') + ') ' + r.toFixed(2) });
			}
		}
	}
	return out;
}

(async () => {
	const browser = await pw[browserName].launch({ headless: true });
	const results = [];
	const fixture = process.env.FIXTURE_ID || '';
	const record = (scheme, screen, list) => {
		for(const f of list) results.push(Object.assign({ scheme, screen }, f));
	};

	for(const scheme of ['dark', 'light']) {
		const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
		await ctx.addInitScript((s) => { try { localStorage.setItem('pwScheme', s); } catch(e) {} }, scheme);
		const page = await ctx.newPage();
		page.on('dialog', d => d.dismiss());
		await page.goto(ADMIN);
		await page.fill('#login_name', 'bridge');
		await page.fill('#login_pass', process.env.PROBE_PASS);
		await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);

		const scanAll = async (screen) => {
			for(const frame of page.frames()) {
				let list;
				try { list = await frame.evaluate(scan, { scheme, allow: ALLOW }); } catch(e) { continue; }
				record(scheme, screen + (frame === page.mainFrame() ? '' : ' [frame ' + (frame.name() || frame.url().slice(-30)) + ']'), list);
			}
		};
		const open = async (path) => {
			await page.goto(ADMIN + path, { waitUntil: 'networkidle' });
			await page.waitForTimeout(600);
		};

		const screens = [
			['page tree', 'page/'],
			['fields', 'setup/field/'],
			['templates', 'setup/template/'],
			['modules', 'module/'],
			['users', 'access/users/'],
			['find', 'page/search/'],
		];
		if(fixture) screens.unshift(['fixture edit', 'page/edit/?id=' + fixture]);
		// more page editors to scan: PAGES=<id>,<id>
		for(const id of (process.env.PAGES || '').split(',').filter(Boolean)) screens.push(['page ' + id, 'page/edit/?id=' + id]);
		for(const [name, path] of screens) {
			try { await open(path); await scanAll(name); } catch(e) { results.push({ scheme, screen: name, kind: 'error', sig: '', value: e.message.slice(0, 200) }); }
		}
		// field and template edit: first item of each list
		for(const [name, list] of [['field edit', 'setup/field/'], ['template edit', 'setup/template/']]) {
			try {
				await open(list);
				const href = await page.$eval('#pw-content-body a[href*="edit?id="]', a => a.href);
				await page.goto(href, { waitUntil: 'networkidle' });
				await page.waitForTimeout(500);
				await scanAll(name);
			} catch(e) { results.push({ scheme, screen: name, kind: 'error', sig: '', value: e.message.slice(0, 200) }); }
		}
		// fixture states: tag dropdown, image edit panel and tooltip, CKEditor Format list, datepicker
		if(fixture) {
			const states = [
				['tags dropdown', async () => { await page.click('#wrap_Inputfield_bf_tags .selectize-input'); }],
				['image edit panel', async () => { await page.hover('#wrap_Inputfield_bf_images .gridImage'); await page.click('#wrap_Inputfield_bf_images .gridImage__edit'); }],
				['image tooltip', async () => { await page.hover('#wrap_Inputfield_bf_images .gridImage'); }],
				['ckeditor format list', async () => { await page.click('#wrap_Inputfield_bf_ckeditor .cke_combo_button'); }],
				['datepicker', async () => { await page.click('#wrap_Inputfield_bf_date input[type=text]'); }],
				['json menu', async () => { await page.click('#wrap_Inputfield_bf_json .jsoneditor-contextmenu-button', { force: true }); }],
			];
			for(const [name, act] of states) {
				try {
					await open('page/edit/?id=' + fixture);
					await act();
					await page.waitForTimeout(700);
					await scanAll('fixture: ' + name);
				} catch(e) { results.push({ scheme, screen: 'fixture: ' + name, kind: 'error', sig: '', value: e.message.split('\n')[0].slice(0, 200) }); }
			}
		}
		// live switch: loaded in light, toggled to dark (light -> dark is the first cycle step
		// from "light" in the order auto, light, dark)
		if(fixture && scheme === 'light') {
			try {
				await open('page/edit/?id=' + fixture);
				await page.evaluate(() => { localStorage.setItem('pwScheme', 'light'); ProcessWireAdminTheme.scheme.cycle(); });
				await page.waitForTimeout(2500);
				const now = await page.evaluate(() => document.documentElement.getAttribute('data-pw-scheme'));
				for(const frame of page.frames()) {
					let list;
					try { list = await frame.evaluate(scan, { scheme: now, allow: ALLOW }); } catch(e) { continue; }
					for(const f of list) results.push(Object.assign({ scheme: 'light->' + now, screen: 'live switch' + (frame === page.mainFrame() ? '' : ' [frame]') }, f));
				}
			} catch(e) { results.push({ scheme: 'light->dark', screen: 'live switch', kind: 'error', sig: '', value: e.message.slice(0, 200) }); }
		}
		await ctx.close();
	}
	await browser.close();

	// group identical findings
	const groups = new Map();
	for(const r of results) {
		const key = [r.scheme, r.kind, r.sig, r.value].join('|');
		if(!groups.has(key)) groups.set(key, Object.assign({ screens: new Set(), n: 0 }, r));
		const g = groups.get(key);
		g.screens.add(r.screen);
		g.n++;
	}
	const list = Array.from(groups.values()).sort((a, b) => (a.scheme + a.kind + a.sig).localeCompare(b.scheme + b.kind + b.sig));
	for(const g of list) {
		console.log(`${g.scheme.padEnd(11)} ${g.kind.padEnd(5)} ${g.sig}  ${g.value}  x${g.n}  [${Array.from(g.screens).slice(0, 3).join('; ')}${g.screens.size > 3 ? '; …' : ''}]`);
	}
	const by = (k) => list.filter(g => g.kind === k).length;
	console.log(`\n${browserName}: ${list.length} distinct findings (bg ${by('bg')}, text ${by('text')}, error ${by('error')}), fixture page ${fixture || 'not set'}`);
	if(jsonOut) require('fs').writeFileSync(jsonOut, JSON.stringify(list.map(g => Object.assign({}, g, { screens: Array.from(g.screens) })), null, '\t'));
	process.exit(list.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

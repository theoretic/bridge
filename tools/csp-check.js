// Content-Security-Policy check (tools/csp-check.js, ADR 0020): opens admin screens under
// AdminThemeBridge with BridgeCsp's policy (a nonce in script-src with 'strict-dynamic', Trusted
// Types required, style-src reported) and lists every violation the browser reports, by screen.
//
// Mode report-only (the default): the admin works as before; what the policy would block is the
// baseline. --enforce: the policy is enforced (0.18.4), so what it blocks does not run.
// Either way it fails on a screen without the legacy stack (native) when:
//   - the X-Bridge-Nonce header, the policy header or the csp-nonce meta is missing, or the meta's
//     nonce is not the header's;
//   - a script element is blocked (script-src-elem: what the theme prints and the core scripts it
//     knows all carry the nonce);
//   - an inline event handler is reported (script-src-attr: a nonce cannot cover one; the theme
//     turns core's into data attributes since 0.18.4). Firefox reports them when the page parses,
//     Chromium only when the handler runs;
//   - a Trusted Types sink is written past the `bridge` policy (since 0.18.4);
//   - with --enforce, a page error happens.
// style-src violations are listed, not failed (style attributes; ADR 0020 decision 10). Screens
// with the legacy stack (jQuery loaded) are listed apart: their violations are upstream's and
// third-party code's, and under --enforce they may not work.
// Only what runs while a screen loads is seen, plus the fragment probe (Setup > Bridge demo > csp/).
//
// The mode is BridgeCsp's (tools/sandbox-csp.php): set for the run and set back to what it was at
// the end.
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] PROBE_PASS=<sandbox bridge password> [PHP=<php>] [SANDBOX=<sandbox root>]
//     [NATIVE_ID=<id>] [FIXTURE_ID=<id>] [SCREENS=<path>,<path>] node tools/csp-check.js <playwright-core dir>
//     [chromium|firefox] [--enforce] [--json out.json]
// Admin URL and password: the sandbox's .credentials (tools/lib/sandbox.cjs), or ADMIN=<admin url>.
// Exit code 1 when a check fails.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const pw = require(process.argv[2]);
const browserName = (process.argv[3] && !process.argv[3].startsWith('--')) ? process.argv[3] : 'chromium';
const sandbox = require('./lib/sandbox.cjs');
const ADMIN = sandbox.adminUrl();
const jsonOut = process.argv.indexOf('--json') > -1 ? process.argv[process.argv.indexOf('--json') + 1] : '';
const MODE = process.argv.indexOf('--enforce') > -1 ? 'enforce' : 'report-only';
const REPO = path.join(__dirname, '..');
const SANDBOX = (process.env.SANDBOX || path.join(REPO, 'sandbox', 'atispro')).replace(/\\/g, '/');
const PHP = process.env.PHP || 'php';
const results = [];
const check = (name, ok, info) => { results.push({ ok: !!ok, name, info: info === undefined ? '' : String(info).slice(0, 400) }); };

// native screens first, then screens that may load the legacy stack; each is judged by whether
// jQuery is on the page once it settled, not by this list
const SCREENS = [
	'',
	'page/recent-pages/',
	'page/lister/',
	'page/add/?parent_id=1',
	'page/edit/?id=1',
	...(process.env.NATIVE_ID ? ['page/edit/?id=' + process.env.NATIVE_ID] : []),
	...(process.env.FIXTURE_ID ? ['page/edit/?id=' + process.env.FIXTURE_ID] : []),
	'page/edit/?id=1&modal=1',
	'setup/field/',
	'setup/field/edit?id=1',
	'setup/template/',
	'setup/template/edit?id=1',
	'setup/logs/',
	'setup/bridge-demo/',
	'module/',
	'module/edit?name=AdminThemeBridge',
	'access/users/',
	'access/roles/',
	'profile/',
	...(process.env.SCREENS ? process.env.SCREENS.split(',').map(s => s.trim()).filter(Boolean) : []),
];

// the fragment probe (audit SE2): Setup > Bridge demo > csp/ loads a field over AJAX whose markup
// holds a script with the response's nonce and one without; returns how often each ran
async function probe(page) {
	await page.goto(ADMIN + 'setup/bridge-demo/csp/', { waitUntil: 'networkidle' });
	const header = page.locator('li.Inputfield_csp_probe > .InputfieldHeader');
	if(!(await header.count())) return { error: 'no probe field (ProcessBridgeDemo 0.2.0?)' };
	await header.click();
	await page.waitForFunction(() => {
		const li = document.querySelector('li.Inputfield_csp_probe');
		return li && !li.classList.contains('InputfieldAjaxLoading') && !li.querySelector('.renderInputfieldAjax');
	}, null, { timeout: 15000 }).catch(() => {});
	await page.waitForTimeout(300);
	return page.evaluate(() => ({ vouched: window.__bridgeVouched || 0, unvouched: window.__bridgeUnvouched || 0 }));
}

const sandboxMode = (mode) => {
	const out = execFileSync(PHP, [path.join(REPO, 'tools', 'sandbox-csp.php'), SANDBOX].concat(mode ? [mode] : []), { encoding: 'utf8' });
	const m = out.match(/mode (\S+)(?: -> (\S+))?/);
	if(!m) throw new Error('tools/sandbox-csp.php: ' + out.trim());
	return m[1];
};

// in every page before its own scripts: the violations the browser reports, also report-only ones
const listen = () => {
	window.__pwCsp = [];
	document.addEventListener('securitypolicyviolation', (e) => {
		window.__pwCsp.push({
			directive: e.effectiveDirective || e.violatedDirective,
			disposition: e.disposition,
			blocked: e.blockedURI || '',
			source: e.sourceFile || '',
			line: e.lineNumber || 0,
			column: e.columnNumber || 0,
			sample: (e.sample || '').slice(0, 80),
		});
	}, true);
};

const short = (url) => {
	if(!url) return '';
	if(/^(inline|eval|trusted-types-sink|trusted-types-policy)$/.test(url)) return url;
	try { const u = new URL(url); return u.pathname.replace(/^.*\/(app|wire|vendor)\//, '$1/').replace(/\?.*$/, ''); } catch(e) { return url; }
};
const group = (d) => d === 'script-src-attr' ? 'handler' : d.startsWith('script-src') ? 'script' : d.startsWith('style-src') ? 'style'
	: (d === 'require-trusted-types-for' || d === 'trusted-types') ? 'trusted-types' : 'other';

async function visit(page, url) {
	const res = await page.goto(url, { waitUntil: 'networkidle' }).catch(e => ({ error: e.message }));
	if(res && res.error) return { url, status: 0, error: res.error };
	await page.waitForTimeout(800);
	const headers = res ? res.headers() : {};
	const html = res ? await res.text().catch(() => '') : '';
	const info = await page.evaluate(() => {
		const meta = document.querySelector('meta[property=csp-nonce]');
		const c = (window.ProcessWire && ProcessWire.config && ProcessWire.config.AdminThemeBridge) || {};
		return {
			meta: meta ? (meta.nonce || meta.getAttribute('nonce') || '') : null,
			// a legacy screen: jQuery is there, or the server printed the stack (under an enforced
			// policy jQuery itself may not start: its own innerHTML writes are Trusted Types sinks)
			jquery: !!window.jQuery || c.legacy === true,
			// the server's own verdict (useLegacyStack), which BridgeCsp's enforce follows
			serverLegacy: c.legacy === true,
			reasons: Object.keys(c.legacyReasons || {}),
			login: !!document.getElementById('login_name'),
			violations: window.__pwCsp || [],
		};
	});
	// an inline script the policy blocks: the page's own source at the reported place
	const lines = html.split('\n');
	for(const x of info.violations) {
		if(x.blocked !== 'inline' || !x.line || !lines[x.line - 1]) continue;
		const at = Math.max(0, (x.column || 1) - 1);
		x.excerpt = lines[x.line - 1].slice(at, at + 120).trim();
	}
	return {
		url, status: res ? res.status() : 0,
		headerNonce: headers['x-bridge-nonce'] || '',
		policy: headers['content-security-policy-report-only'] || headers['content-security-policy'] || '',
		enforced: !!headers['content-security-policy'],
		...info,
	};
}

(async () => {
	const previous = sandboxMode('');
	sandboxMode(MODE);
	const browser = await pw[browserName].launch({ headless: true });
	const visits = [];
	try {
		// the login screen, in a context of its own (never logged in)
		const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
		await anon.addInitScript(listen);
		const anonPage = await anon.newPage();
		const login = await visit(anonPage, ADMIN);
		login.screen = '(login)';
		visits.push(login);
		await anon.close();

		const statePath = process.env.PW_STATE || '';
		const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } },
			statePath && fs.existsSync(statePath) ? { storageState: statePath } : {}));
		await ctx.addInitScript(listen);
		const page = await ctx.newPage();
		const errors = [];
		page.on('pageerror', e => errors.push(e.message));
		await page.goto(ADMIN, { waitUntil: 'networkidle' });
		if(await page.locator('#login_name').count()) {
			await page.fill('#login_name', 'bridge');
			await page.fill('#login_pass', sandbox.password());
			await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);
			if(statePath) await ctx.storageState({ path: statePath });
		}
		if(await page.locator('#login_name').count()) throw new Error('login failed (throttled? wrong PROBE_PASS?)');

		for(const screen of SCREENS) {
			const before = errors.length;
			const v = await visit(page, ADMIN + screen);
			v.screen = screen || '(page tree)';
			v.errors = errors.slice(before);
			visits.push(v);
		}
		// page errors on native screens; a legacy screen's are upstream's and third-party code's
		const nativeErrors = visits.filter(v => !v.jquery && v.errors && v.errors.length).map(v => `${v.screen}: ${v.errors[0]}`);
		check(`no page errors on native screens under the ${MODE} policy`, nativeErrors.length === 0, nativeErrors.slice(0, 4).join(' | '));
		// a fragment's scripts: with the nonce only the vouched one runs; without, both, as before
		const probePage = await ctx.newPage(); // a tab of its own: the last screen may still navigate
		const withNonce = await probe(probePage);
		check('fragment probe under the policy: the vouched script ran, the other did not', withNonce.vouched === 1 && withNonce.unvouched === 0, JSON.stringify(withNonce));
		sandboxMode('off');
		const without = await probe(probePage);
		check('fragment probe without a policy: both scripts ran', without.vouched === 1 && without.unvouched === 1, JSON.stringify(without));
		sandboxMode(MODE);
		await ctx.close();
	} finally {
		await browser.close();
		sandboxMode(previous);
	}

	// per screen
	const findings = new Map();
	console.log(`${browserName}: BridgeCsp ${MODE} (mode back to ${previous} after the run)\n`);
	const warnings = [];
	console.log('screen'.padEnd(36) + 'status  stack   script  handler  tt   style  other');
	for(const v of visits) {
		if(v.error || v.status >= 400) {
			console.log(v.screen.padEnd(36) + `${v.status || 'ERR'}     skipped ${v.error ? '(' + v.error.slice(0, 60) + ')' : ''}`);
			continue;
		}
		const counts = { script: 0, handler: 0, 'trusted-types': 0, style: 0, other: 0 };
		for(const x of v.violations) {
			const g = group(x.directive);
			counts[g]++;
			// one finding per place in the code: a sink called with many values is one sink; an inline
			// script by what it says (its line differs from screen to screen)
			const sink = g === 'trusted-types' ? (x.sample.split('|')[0] || x.blocked) : '';
			const inline = x.excerpt ? x.excerpt.slice(0, 60) : '';
			const key = [x.directive, short(x.blocked), inline ? 'page' : short(x.source) + (x.line ? ':' + x.line : ''), sink || inline || x.sample].join(' | ');
			if(!findings.has(key)) findings.set(key, { directive: x.directive, group: g, blocked: short(x.blocked), source: inline ? '(page)' : short(x.source), line: inline ? 0 : x.line, sample: sink || x.excerpt || x.sample, count: 0, screens: new Set(), legacy: true });
			const f = findings.get(key);
			f.count++;
			f.screens.add(v.screen);
			if(!v.jquery) f.legacy = false;
		}
		v.counts = counts;
		console.log(v.screen.padEnd(36) + String(v.status).padEnd(8) + (v.jquery ? 'legacy  ' : 'native  ') +
			String(counts.script).padEnd(8) + String(counts.handler).padEnd(9) + String(counts['trusted-types']).padEnd(5) + String(counts.style).padEnd(7) + counts.other);

		check(`${v.screen}: nonce header, policy header and meta agree`, v.headerNonce !== '' && v.policy.indexOf(`'nonce-${v.headerNonce}'`) > -1 && v.meta === v.headerNonce,
			`header ${v.headerNonce || '-'}, meta ${v.meta === null ? '-' : v.meta || '(hidden)'}, policy ${v.policy ? 'yes' : 'no'}`);
		// 0.30.1 (audit S1): enforce enforces only where the server did not choose the legacy stack;
		// a legacy screen gets the same policy as report only (BridgeCsp's config screen says so)
		if(MODE === 'enforce') check(`${v.screen}: ${v.serverLegacy ? 'legacy screen, policy report only' : 'native screen, policy enforced'}`, v.enforced === !v.serverLegacy,
			`enforced ${v.enforced}, legacy ${v.serverLegacy}`);
		if(!v.jquery) {
			const scriptHits = v.violations.filter(x => group(x.directive) === 'script');
			check(`${v.screen}: no blocked script element on a native screen`, scriptHits.length === 0,
				scriptHits.slice(0, 3).map(x => `${x.directive} ${short(x.blocked)} ${short(x.source)}:${x.line} ${x.excerpt || x.sample}`).join(' | '));
			const handlers = v.violations.filter(x => group(x.directive) === 'handler');
			check(`${v.screen}: no inline event handler on a native screen`, handlers.length === 0,
				Array.from(new Set(handlers.map(x => x.sample.slice(0, 40)))).slice(0, 3).join(' | '));
			const tt = v.violations.filter(x => group(x.directive) === 'trusted-types');
			check(`${v.screen}: every Trusted Types sink through the bridge policy`, tt.length === 0,
				tt.slice(0, 3).map(x => `${short(x.source)}:${x.line} ${x.sample}`).join(' | '));
		}
	}

	// distinct findings, native screens first
	const list = Array.from(findings.values()).sort((a, b) => (a.legacy - b.legacy) || a.group.localeCompare(b.group) || b.screens.size - a.screens.size);
	console.log(`\n${list.length} distinct findings (${list.filter(f => !f.legacy).length} on native screens)`);
	for(const f of list) {
		const screens = Array.from(f.screens);
		console.log(`- [${f.legacy ? 'legacy only' : 'native'}] ${f.directive}: ${f.blocked || '?'} at ${f.source || '?'}${f.line ? ':' + f.line : ''}` +
			(f.sample ? ` "${f.sample.replace(/\s+/g, ' ')}"` : '') + (f.count > 1 ? ` x${f.count}` : '') + ` (${screens.length}: ${screens.slice(0, 4).join(', ')}${screens.length > 4 ? ', ...' : ''})`);
	}

	const passed = results.filter(r => r.ok).length;
	console.log('');
	for(const w of warnings) console.log(`WARN ${w}`);
	for(const r of results.filter(r => !r.ok)) console.log(`FAIL ${r.name}${r.info ? '  [' + r.info + ']' : ''}`);
	console.log(`${passed}/${results.length} passed`);
	const report = {
		browser: browserName,
		mode: MODE,
		screens: visits.map(v => ({ screen: v.screen, status: v.status, legacy: !!v.jquery, reasons: v.reasons || [], counts: v.counts || null, violations: v.violations || [] })),
		findings: list.map(f => Object.assign({}, f, { screens: Array.from(f.screens) })),
		warnings,
		results,
	};
	if(jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1));
	console.log(JSON.stringify({ browser: browserName, passed, total: results.length, findings: list.length, nativeFindings: list.filter(f => !f.legacy).length, warnings: warnings.length }));
	process.exit(passed === results.length ? 0 : 1);
})().catch(e => {
	console.error(e);
	try { sandboxMode('off'); } catch(err) {}
	process.exit(1);
});

// Save without reload on the other edit forms (tools/form-save-check.js, milestone 3.8, ADR 0013):
// the field, template and module editors, the profile, and the user, role and permission editors
// save in place on pages without jQuery: no navigation (a marker on window survives), the server's
// notice shows, the saved value comes back, the open tab stays, the screen is set up again (tabs,
// the column width slider, the field list's rows). Shift+click and Save + Exit stay classic.
// Field and template edits are put back afterwards; the other screens are saved unchanged.
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] PROBE_PASS=<sandbox bridge password> node tools/form-save-check.js
//     <playwright-core dir> <firefox|chromium|webkit>
// Admin URL: the atispro sandbox (http://localhost:8089, user "bridge"), or ADMIN=<admin url>.
// Uses tools/sandbox-fixture.php's field bf_integer, template bridge_native, role bridge-fixture;
// MODULE (default ProcessPageList) is a configurable module saved unchanged; USER_ID default 41.
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'firefox';
const ADMIN = process.env.ADMIN || 'http://localhost:8089/fv9673g5vdfigh/';
const MODULE = process.env.MODULE || 'ProcessPageList';
const results = [];
const check = (name, ok, info) => { results.push({ ok: !!ok, name, info: info === undefined ? '' : String(info).slice(0, 400) }); };

(async () => {
	const browser = await pw[browserName].launch({ headless: true });
	const fs = require('fs');
	const statePath = process.env.PW_STATE || '';
	const ctx = await browser.newContext(Object.assign({ viewport: { width: 1300, height: 950 } },
		statePath && fs.existsSync(statePath) ? { storageState: statePath } : {}));
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
	// click a save button and wait for the in-place save: pw-form-saved (or pw-page-saved)
	const saveInPlace = async (selector) => {
		await page.evaluate(() => {
			window.__bridgeMarker = 1;
			window.__bridgeSaved = 0;
			['pw-form-saved', 'pw-page-saved'].forEach(t => document.addEventListener(t, () => { window.__bridgeSaved++; }, { once: true }));
		});
		const url = page.url();
		await page.locator(selector).first().click();
		const saved = await waitFor(() => window.__bridgeSaved > 0, null, 30000);
		const kept = await page.evaluate(() => window.__bridgeMarker === 1).catch(() => false);
		const notice = await page.evaluate(() => { const n = document.getElementById('notices'); return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; }).catch(() => '');
		return { saved, kept, sameUrl: page.url() === url, notice };
	};
	const noJquery = async (label) => check(label + ': no jQuery', !(await page.evaluate(() => !!window.jQuery)),
		JSON.stringify(await page.evaluate(() => (ProcessWire.config.AdminThemeBridge || {}).legacyReasons)));

	// A: field editor (bf_integer): notes changed in place on the Input tab, then put back
	await open('setup/field/');
	const fieldHref = await page.evaluate(() => { const a = [...document.querySelectorAll('a')].find(x => x.textContent.trim() === 'bf_integer'); return a ? a.getAttribute('href') : ''; });
	if(fieldHref) {
		const fieldPath = 'setup/field/' + fieldHref.replace(/^.*?(edit\?id=\d+).*$/, '$1');
		await open(fieldPath);
		await noJquery('A field editor');
		await page.click('#_basics').catch(() => {});
		await page.evaluate(() => Inputfields.open('notes'));
		const notes = page.locator('textarea[name=notes], input[name=notes]').first();
		const before = await notes.inputValue();
		const mark = 'Bridge 3.8 ' + Date.now();
		await notes.fill(mark);
		const r = await saveInPlace('#Inputfield_submit_save_field');
		check('A field: saved in place (no reload, notice)', r.saved && r.kept && r.sameUrl && r.notice.length > 0, JSON.stringify(r));
		check('A field: the saved value comes back', await page.locator('textarea[name=notes], input[name=notes]').first().inputValue() === mark);
		check('A field: its tab stays and the screen is set up again', await page.evaluate(() => {
			const on = document.querySelector('ul.WireTabs a.on');
			return !!on && on.id === '_basics' && document.querySelectorAll('ul.WireTabs a').length >= 4 && !!document.querySelector('.InputfieldColumnWidthSlider');
		}));
		await page.locator('textarea[name=notes], input[name=notes]').first().fill(before);
		const r2 = await saveInPlace('#Inputfield_submit_save_field');
		check('A field: a second save in place (put back)', r2.saved && r2.kept && await page.locator('textarea[name=notes], input[name=notes]').first().inputValue() === before, JSON.stringify(r2));
		// Shift+click stays classic
		await page.evaluate(() => { window.__bridgeMarker = 1; });
		await Promise.all([page.waitForNavigation({ timeout: 30000 }).catch(() => null), page.locator('#Inputfield_submit_save_field').first().click({ modifiers: ['Shift'] })]);
		await page.waitForLoadState('networkidle').catch(() => {});
		check('A field: Shift+click saves the classic way (a reload)', !(await page.evaluate(() => window.__bridgeMarker === 1).catch(() => false)));
	} else {
		check('A fixture field bf_integer exists', false);
	}

	// B: template editor (bridge_native): label changed in place, then put back
	await open('setup/template/');
	const tplHref = await page.evaluate(() => { const a = [...document.querySelectorAll('a')].find(x => x.textContent.trim() === 'bridge_native'); return a ? a.getAttribute('href') : ''; });
	if(tplHref) {
		await open('setup/template/' + tplHref.replace(/^.*?(edit\?id=\d+).*$/, '$1'));
		await noJquery('B template editor');
		const label = page.locator('#templateLabel, input[name=templateLabel]').first();
		await page.evaluate(() => Inputfields.find('templateLabel'));
		const before = await label.inputValue();
		await label.fill('Bridge native 3.8');
		const r = await saveInPlace('#Inputfield_submit');
		check('B template: saved in place (no reload, notice)', r.saved && r.kept && r.sameUrl && r.notice.length > 0, JSON.stringify(r));
		check('B template: the saved label comes back, the field list is set up again', await page.locator('#templateLabel, input[name=templateLabel]').first().inputValue() === 'Bridge native 3.8'
			&& await waitFor(() => document.querySelectorAll('#wrap_fieldgroup_fields .asmListItem').length > 2 && typeof window.ProcessTemplateInitFields === 'function', null, 8000));
		await page.evaluate(() => Inputfields.find('templateLabel'));
		await page.locator('#templateLabel, input[name=templateLabel]').first().fill(before);
		const r2 = await saveInPlace('#Inputfield_submit');
		check('B template: put back in place', r2.saved && await page.locator('#templateLabel, input[name=templateLabel]').first().inputValue() === before, JSON.stringify(r2));
	} else {
		check('B fixture template bridge_native exists', false);
	}

	// C: module settings, saved unchanged; Save + Exit stays classic
	await open('module/edit?name=' + MODULE);
	await noJquery('C module settings');
	if(await page.locator('#Inputfield_submit_save_module').count()) {
		const r = await saveInPlace('#Inputfield_submit_save_module');
		check('C module: saved in place (no reload, notice)', r.saved && r.kept && r.sameUrl && /Saved Module|сохран/i.test(r.notice), JSON.stringify(r));
	} else {
		check('C module ' + MODULE + ' has settings to save', false);
	}

	// D: profile, saved unchanged
	await open('profile/');
	await noJquery('D profile');
	const rp = await saveInPlace('#submit_save_profile');
	// an unchanged profile saves without a notice
	check('D profile: saved in place (no reload)', rp.saved && rp.kept && rp.sameUrl && !!(await page.$('form#ProcessProfile')), JSON.stringify(rp));

	// E: user and role editors (ProcessPageEdit forms), saved unchanged
	await open('access/users/edit/?id=' + (process.env.USER_ID || 41));
	if(!(await page.evaluate(() => !!window.jQuery))) {
		const ru = await saveInPlace('#submit_save');
		check('E user: saved in place', ru.saved && ru.kept && ru.sameUrl, JSON.stringify(ru));
	} else {
		check('E user editor has jQuery here (legacy field): skipped', true);
	}
	const roleHref = await page.evaluate(async (admin) => {
		const r = await fetch(admin + 'access/roles/navJSON/', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }).then(x => x.json());
		const item = (r.list || []).find(x => /bridge-fixture/.test(x.label));
		return item ? item.url : '';
	}, ADMIN);
	if(roleHref) {
		await open('access/roles/' + (roleHref.match(/edit\/\?id=\d+/) || [''])[0]);
		await noJquery('E role editor');
		const rr = await saveInPlace('#submit_save');
		check('E role: saved in place, the permission tree set up again', rr.saved && rr.kept && rr.sameUrl
			&& await page.evaluate(() => [...document.querySelectorAll('#wrap_Inputfield_permissions tr.level1')].some(r => r.style.display === 'none')), JSON.stringify(rr));
	} else {
		check('E fixture role bridge-fixture exists', false, 'run tools/sandbox-fixture.php');
	}

	check('no page errors', errors.length === 0, errors.join(' | '));
	report();
	await browser.close();
})().catch(e => { check('run completed', false, String(e.message).split(String.fromCharCode(10))[0]); report(); process.exit(1); });

function report() {
	const failed = results.filter(x => !x.ok);
	console.log(JSON.stringify({ browser: browserName, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
	if(failed.length) process.exitCode = 1;
}

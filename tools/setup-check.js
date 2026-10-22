// Native setup screens check (tools/setup-check.js, milestone 3.6, ADR 0016): drives the Modules,
// Fields, Templates, Users and Roles screens in a real browser engine and verifies that they work
// without jQuery: tabs, the head copy of Add New, the modules section filter, the field editor's column width slider, icon
// picker and #find- hash, the template editor's field list (rows, a sort and a column width saved
// by saveProperty, the edit and "create a new field" dialogs), the password strength and confirm,
// the role's permission tree, the AJAX submenu labels. Puts back what it changes (field order
// and width of the fixture template); nothing else is saved.
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] PROBE_PASS=<sandbox bridge password> node tools/setup-check.js
//     <playwright-core dir> <firefox|chromium|webkit>
// Admin URL: the atispro sandbox (http://localhost:8089, user "bridge"), or ADMIN=<admin url>.
// Uses tools/sandbox-fixture.php's template "bridge_native" and role "bridge-fixture".
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'firefox';
const ADMIN = process.env.ADMIN || 'http://localhost:8089/fv9673g5vdfigh/';
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
	const posts = [];
	page.on('request', r => { if(r.method() === 'POST' && /saveProperty/.test(r.url())) posts.push(r.postData() || ''); });

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
	const dialogOpen = () => waitFor(() => { const d = document.querySelector('pw-dialog dialog'); return !!d && d.open; }, null, 10000);
	const dialogButtons = () => waitFor(() => document.querySelectorAll('pw-dialog .pw-dialog-button').length > 0, null, 15000);
	const closeDialog = async () => { await page.evaluate(() => Bridge.dialog.close(true)); await page.waitForTimeout(300); };

	// A: Modules
	await open('module/');
	await noJquery('A Modules');
	check('A tabs over the module lists', await page.evaluate(() => document.querySelectorAll('#modules_form ul.WireTabs a, ul.WireTabs a').length >= 4));
	const section = await page.evaluate(() => {
		const s = [...document.querySelectorAll('select.modules_section_select')].find(x => x.offsetParent !== null);
		if(!s) return null;
		const o = [...s.options].find(x => x.value);
		if(!o) return null;
		s.value = o.value;
		s.dispatchEvent(new Event('change', { bubbles: true }));
		const sections = [...s.closest('p').parentElement.querySelectorAll(':scope > .modules_section')];
		const shown = sections.filter(x => x.style.display !== 'none');
		const ok = shown.length === 1 && shown[0].classList.contains('modules_' + o.value);
		s.value = '';
		s.dispatchEvent(new Event('change', { bubbles: true }));
		return { ok, all: sections.length, back: sections.filter(x => x.style.display !== 'none').length };
	});
	check('A the section select shows one section, then all', section && section.ok && section.back === section.all, JSON.stringify(section));

	// B: field editor
	await open('setup/field/edit/?id=1');
	await noJquery('B field editor');
	check('B tabs (FieldEditTabs)', await page.evaluate(() => document.querySelectorAll('ul.WireTabs a').length >= 4));
	await page.click('#_inputfieldConfig').catch(() => {});
	const slider = await page.evaluate(() => {
		const input = document.getElementById('columnWidth');
		const range = input && input.nextElementSibling;
		if(!range || range.type !== 'range') return { error: 'no range after #columnWidth' };
		range.value = 50;
		range.dispatchEvent(new Event('input', { bubbles: true }));
		const a = input.value;
		input.value = '30';
		input.dispatchEvent(new Event('change', { bubbles: true }));
		return { a, b: input.value, range: range.value };
	});
	check('B the column width slider and its input follow each other', slider.a === '50%' && slider.b === '30%' && slider.range === '30', JSON.stringify(slider));
	await page.click('#_basics').catch(() => {});
	await page.evaluate(() => Inputfields.open('icon'));
	await page.waitForTimeout(400);
	const iconWrap = page.locator('.Inputfield[data-bridge-component="InputfieldIcon"]').first();
	if(await iconWrap.count()) {
		await iconWrap.locator('.InputfieldIconSearch').fill('user');
		const icons = await page.evaluate(() => [...document.querySelectorAll('.InputfieldIconAll i')].filter(i => i.style.display !== 'none').length);
		check('B icon search shows matching icons', icons > 0, icons);
		const before = await page.evaluate(() => document.querySelector('[data-bridge-component="InputfieldIcon"] select').value);
		await page.locator('.InputfieldIconAll i:visible').first().click();
		const picked = await page.evaluate(() => {
			const w = document.querySelector('[data-bridge-component="InputfieldIcon"]');
			const i = w.querySelector('.InputfieldHeader > i:first-child');
			return { value: w.querySelector('select').value, header: i ? i.className : '' };
		});
		check('B a click picks the icon (select and header)', /user/.test(picked.value) && /user/.test(picked.header), JSON.stringify(picked));
		await page.evaluate((v) => { document.querySelector('[data-bridge-component="InputfieldIcon"] select').value = v; }, before);
	} else {
		check('B icon field is native', false, 'no InputfieldIcon wrapper');
	}
	// ?focus= prints `jQuery(document).ready(... Inputfields.find('#field_label') ...)`, rewritten to
	// run at DOMContentLoaded, before the runtime's facade exists: the theme's stand-in records it
	const errs0 = errors.length;
	await open('setup/field/edit/?id=1&focus=label');
	check('B ?focus=label: no page error, the label field focused', await waitFor(() => document.activeElement && document.activeElement.id === 'field_label', null, 5000) && errors.length === errs0,
		errors.slice(errs0).join(' | ') || await page.evaluate(() => document.activeElement ? document.activeElement.id : ''));
	check('B the stand-in gave way to the facade', await page.evaluate(() => !!(window.Inputfields && window.Inputfields.native && !window.Inputfields.pwStub && window.Bridge && !window.Bridge.pwStub)));
	await open('setup/field/');
	await open('setup/field/edit/?id=1#find-columnWidth');
	check('B #find-columnWidth opens the Input tab at the width', await waitFor(() => { const w = document.getElementById('wrap_columnWidth'); return !!w && w.offsetParent !== null; }, null, 5000));

	// C: the head copy of Add New (a button inside a link) opens the add form
	await open('setup/template/');
	const headAdd = page.locator('#pw-content-head-buttons a > button.pw-head-button-copy').first();
	if(await headAdd.count()) {
		await Promise.all([page.waitForURL(/setup\/template\/add/, { timeout: 10000 }).catch(() => {}), headAdd.click()]);
		check('C the head copy of Add New opens the add form', /setup\/template\/add/.test(page.url()), page.url());
		await open('setup/template/');
	} else {
		check('C the head copy of Add New opens the add form', false, 'no head copy inside a link');
	}
	// C: template editor (fixture template)
	const tplHref = await page.evaluate(() => { const a = [...document.querySelectorAll('a')].find(x => x.textContent.trim() === 'bridge_native'); return a ? a.getAttribute('href') : ''; });
	const tplPath = 'setup/template/' + tplHref.replace(/^.*?(edit\?id=\d+).*$/, '$1');
	await open(tplPath);
	await noJquery('C template editor');
	check('C tabs (TemplateEditTabs)', await page.evaluate(() => document.querySelectorAll('ul.WireTabs a').length >= 4));
	check('C ProcessTemplateInitFields() is there', await page.evaluate(() => typeof window.ProcessTemplateInitFields === 'function'));
	await waitFor(() => document.querySelectorAll('#wrap_fieldgroup_fields .asmListItem').length > 2, null, 10000);
	const order0 = await page.evaluate(() => [...document.querySelectorAll('#fieldgroup_fields option')].filter(o => o.selected).map(o => o.value));
	// rows: give two items 50% in the page, then recount
	const rows = await page.evaluate(() => {
		const items = [...document.querySelectorAll('#wrap_fieldgroup_fields .asmListItem')];
		const w = items.map(li => li.querySelector('.columnWidth'));
		const keep = w.map(c => c ? c.textContent : '');
		if(!w[1] || !w[2]) return { error: 'no widths' };
		w[1].textContent = '50%'; w[2].textContent = '30%';
		const n = ProcessWireAdminTheme.setup.setupRows();
		const r = { n, start: items[1].classList.contains('rowStart'), stop: items[2].classList.contains('rowStop'), error: items[2].classList.contains('rowError') };
		w.forEach((c, i) => { if(c) c.textContent = keep[i]; });
		ProcessWireAdminTheme.setup.setupRows();
		return r;
	});
	check('C rows of column widths (rowStart, rowStop, rowError)', rows.n >= 1 && rows.start && rows.stop && rows.error, JSON.stringify(rows));

	// a sort is saved at once
	posts.length = 0;
	const dragItem = async (from, to) => {
		const a = await page.locator('#wrap_fieldgroup_fields .asmListItem').nth(from).boundingBox();
		const b = await page.locator('#wrap_fieldgroup_fields .asmListItem').nth(to).boundingBox();
		await page.mouse.move(a.x + 12, a.y + a.height / 2);
		await page.mouse.down();
		for(let i = 1; i <= 8; i++) await page.mouse.move(a.x + 12, a.y + a.height / 2 + (b.y - a.y - (to < from ? 6 : -6)) * i / 8);
		await page.mouse.up();
	};
	await page.locator('#wrap_fieldgroup_fields .asmListItem').nth(2).scrollIntoViewIfNeeded();
	await dragItem(2, 1);
	const sorted = await waitFor(() => true, null, 1500) && posts.some(p => /property=fieldgroup_fields/.test(p));
	const order1 = await page.evaluate(() => [...document.querySelectorAll('#fieldgroup_fields option')].filter(o => o.selected).map(o => o.value));
	check('C a drag sort is saved (saveProperty fieldgroup_fields)', sorted && order1.join() !== order0.join(), posts.join(' | ').slice(0, 200));
	// put the order back
	await page.evaluate(async (order) => {
		const body = new URLSearchParams({ id: document.getElementById('Inputfield_id').value, property: 'fieldgroup_fields', _fieldgroup_fields_changed: 'changed' });
		order.forEach(v => body.append('fieldgroup_fields[]', v));
		const csrf = document.querySelector('input._post_token');
		body.append(csrf.name, csrf.value);
		await fetch('./saveProperty', { method: 'POST', body, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
	}, order0);

	// a column width by dragging its percentage
	await open(tplPath);
	await waitFor(() => document.querySelectorAll('#wrap_fieldgroup_fields .asmListItem').length > 2, null, 10000);
	posts.length = 0;
	const cw = page.locator('#wrap_fieldgroup_fields .asmListItem').nth(1).locator('.columnWidth');
	const w0 = parseInt(await cw.textContent(), 10);
	const box = await cw.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	for(let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width / 2 - i * 40, box.y + box.height / 2);
	const bar = await page.evaluate(() => !!document.querySelector('#wrap_fieldgroup_fields .columnWidthBar'));
	await page.mouse.up();
	await page.waitForTimeout(1200);
	const w1 = parseInt(await cw.textContent(), 10);
	check('C dragging the percentage changes the width (with its bar)', bar && w1 < w0, `${w0} -> ${w1}, bar ${bar}`);
	check('C the width is saved (saveProperty columnWidth)', posts.some(p => /property=columnWidth/.test(p) && new RegExp('columnWidth=' + w1).test(p)), posts.join(' | ').slice(0, 200));
	await page.evaluate(async (w) => {
		const c = document.querySelectorAll('#wrap_fieldgroup_fields .asmListItem')[1].querySelector('.columnWidth');
		const body = new URLSearchParams({ id: document.getElementById('Inputfield_id').value, property: 'columnWidth', columnWidth: w, field: c.getAttribute('data-field') });
		const csrf = document.querySelector('input._post_token');
		body.append(csrf.name, csrf.value);
		await fetch('./saveProperty', { method: 'POST', body, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
	}, w0);

	// the edit link and "create a new field" open dialogs with the window's buttons
	await open(tplPath);
	await waitFor(() => !!document.querySelector('#wrap_fieldgroup_fields .asmListItemEdit a'), null, 10000);
	await page.locator('#wrap_fieldgroup_fields .asmListItemEdit a').first().click();
	check('C a field link opens the field (in this template) in a dialog with its buttons', await dialogOpen() && await dialogButtons());
	await closeDialog();
	await page.locator('#wrap_fieldgroup_fields p.description a').first().click();
	check('C "create a new field" opens a dialog with its buttons', await dialogOpen() && await dialogButtons());
	await closeDialog();

	// D: user editor: password strength and confirm
	// the first superuser (id 41 in a default install); USER_ID=<id> for another
	await open('access/users/edit/?id=' + (process.env.USER_ID || 41));
	const passWrap = page.locator('.Inputfield[data-bridge-component="InputfieldPassword"]').first();
	if(await passWrap.count()) {
		await page.evaluate(() => Inputfields.open('#' + document.querySelector('.Inputfield[data-bridge-component="InputfieldPassword"]').id));
		await page.waitForTimeout(400);
		const pass = passWrap.locator('input.InputfieldPasswordComplexify');
		const confirm = passWrap.locator('input.InputfieldPasswordConfirm');
		await pass.click();
		await pass.pressSequentially('abc');
		const weak = await page.evaluate(() => {
			const on = document.querySelector('[data-bridge-component="InputfieldPassword"] .pass-scores > .on');
			return { on: on ? on.className : '', confirm: document.querySelector('.InputfieldPasswordConfirm').disabled };
		});
		check('D a short password is rejected, confirm stays disabled', /pass-(fail|short)/.test(weak.on) && weak.confirm, JSON.stringify(weak));
		await pass.fill('');
		await pass.pressSequentially('Tr0ub4dor-horse-77');
		const strong = await page.evaluate(() => {
			const on = document.querySelector('[data-bridge-component="InputfieldPassword"] .pass-scores > .on');
			return { on: on ? on.textContent.trim() + ' ' + on.className : '', confirm: document.querySelector('.InputfieldPasswordConfirm').disabled,
				req: document.querySelectorAll('[data-bridge-component="InputfieldPassword"] .pass-require-good').length };
		});
		check('D a strong password scores good or better, confirm enabled', /pass-(good|excellent)/.test(strong.on) && /\(\d+%\)/.test(strong.on) && !strong.confirm, JSON.stringify(strong));
		await confirm.pressSequentially('Tr0ub4dor-horse-77');
		check('D a matching confirm shows the match', await page.evaluate(() => !!document.querySelector('[data-bridge-component="InputfieldPassword"] .pass-matches') || !!document.querySelector('.pass-confirm > .confirm-yes.on')));
		const masked = passWrap.locator('.pass-mask-show');
		if(await masked.count() && await masked.isVisible()) {
			await masked.click();
			check('D show password unmasks both inputs', await page.evaluate(() => document.querySelectorAll('[data-bridge-component="InputfieldPassword"] input.pass-unmask[type=text]').length === 2));
		}
	} else {
		check('D the password field is native', false, 'no InputfieldPassword wrapper');
	}
	check('D the guest role is checked', await page.evaluate(() => { const g = document.getElementById('Inputfield_roles_37'); return !g || g.checked; }));

	// E: role editor: the permission tree
	const roleHref = await page.evaluate(async (admin) => {
		const r = await fetch(admin + 'access/roles/navJSON/', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }).then(x => x.json());
		const item = (r.list || []).find(x => /bridge-fixture/.test(x.label));
		return item ? item.url : '';
	}, ADMIN);
	if(roleHref) {
		await open('access/roles/' + (roleHref.match(/edit\/\?id=\d+/) || [''])[0]);
		await noJquery('E role editor');
		const rowsShown = () => page.evaluate(() => [...document.querySelectorAll('#wrap_Inputfield_permissions tr.parent-permission-page-edit.level1')].filter(r => r.style.display !== 'none').length);
		const hidden0 = await rowsShown();
		await page.locator('#wrap_Inputfield_permissions tr.permission-page-edit input.global-permission').click();
		await page.waitForTimeout(400);
		const shownN = await rowsShown();
		const tplOpen = await page.evaluate(() => !!document.querySelector('#wrap_Inputfield_permissions tr.permission-page-edit .template-permissions-open'));
		check('E checking page-edit shows its permissions and templates', hidden0 === 0 && shownN > 0 && tplOpen, `${hidden0} -> ${shownN}, templates ${tplOpen}`);
		await page.locator('#wrap_Inputfield_permissions tr.permission-page-edit input.global-permission').click();
		await page.waitForTimeout(400);
		check('E unchecking hides them again', await rowsShown() === 0);
	} else {
		check('E fixture role bridge-fixture exists', false, 'run tools/sandbox-fixture.php');
	}

	// F: AJAX submenu labels are markup, not text
	const labels = await page.evaluate(async () => {
		const links = [...document.querySelectorAll('a.pw-has-ajax-items[data-json*="access/"]')];
		links.forEach(a => ProcessWireAdminTheme.loadNavJSON(a));
		await new Promise(r => setTimeout(r, 2500));
		return links.map(a => a.nextElementSibling ? a.nextElementSibling.textContent : '').join(' ');
	});
	check('F Access submenus show labels, not their markup', labels.length > 0 && !/<span|PageListStatus/.test(labels), labels.slice(0, 200));

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

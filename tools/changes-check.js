// Changes-elsewhere check (tools/changes-check.js, AdminThemeBridge 1.6.0, docs/changes.md): a
// tab whose screen depends on something changed elsewhere warns when it gets the focus back. Two
// browser contexts stand for two machines: A is `bridge` (this theme), B is `uikit` (a colleague on
// AdminThemeUikit) and makes the changes through the admin's own forms; E is `acl`, a plain editor
// (role acl-editor, no field-admin).
//   A example 1: the page's template changed (its family setting noChildren)
//   B example 2: an images field's extensions narrowed, then as an override on the page's template
//   C a concurrent save of the same page, with the unsaved field it may overwrite
//   D the page moved to the trash (a page B adds for the case and deletes for good afterwards)
//   E a field only inside repeater and FieldsetPage items changed (the nesting page)
//   F same tab: its own saves never warn (the in-place save; an upload on the legacy stack; the
//     files-move POST sends X-Bridge-Tab, its answer stubbed so nothing moves), another tab of the
//     same user does warn ("you, in another tab")
//   G a plain editor sees the safe settings' values only, the code-like ones named, the rest counted
// Everything B changes is put back by B at the end of its case (also when the case fails); those
// saves are logged too, so every case opens its tabs afresh.
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   NATIVE_ID= FIXTURE_ID= PARENT_ID= NESTING_ID= ADD_TEMPLATE_ID= [PW_STATE=<bridge's login state file>]
//   [SHOTS=<dir>] node tools/changes-check.js <playwright-core dir> <firefox|chromium|webkit>
// The ids: php tools/lib/sandbox-ids.php <sandbox> (tools/ci.sh exports them). Admin URL and logins:
// the sandbox's .credentials (tools/lib/sandbox.cjs). Only `bridge` uses PW_STATE. SHOTS saves the
// dialog on page edit in light and dark (device scale 2) as changes-modal-light.png and
// changes-modal-dark.png there.
//
// Original work, MIT.
'use strict';
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'firefox';
const fs = require('fs');
const path = require('path');
const sandbox = require('./lib/sandbox.cjs');
const ADMIN = sandbox.adminUrl();
const ids = {};
for(const n of ['NATIVE_ID', 'FIXTURE_ID', 'PARENT_ID', 'NESTING_ID', 'ADD_TEMPLATE_ID']) {
	ids[n] = process.env[n] || '';
	if(!ids[n]) { console.error(n + ' is not set: export the ids of tools/lib/sandbox-ids.php'); process.exit(2); }
}
const results = [];
const check = (name, ok, info) => { results.push({ ok: !!ok, name, info: info === undefined ? '' : String(info).slice(0, 600) }); };
const PAGE_TITLE = 'This page changed elsewhere';

(async () => {
	const browser = await pw[browserName].launch({ headless: true });
	const statePath = process.env.PW_STATE || '';
	const errors = [];
	const ignore = process.env.IGNORE_ERRORS ? new RegExp(process.env.IGNORE_ERRORS) : null;

	/** A signed-in context of its own for one user (`bridge` from PW_STATE when there is one) */
	const session = async (user, opts) => {
		const useState = user === 'bridge' && statePath && fs.existsSync(statePath);
		const ctx = await browser.newContext(Object.assign({ viewport: { width: 1300, height: 950 } }, opts || {}, useState ? { storageState: statePath } : {}));
		const page = await ctx.newPage();
		await page.goto(ADMIN, { waitUntil: 'networkidle' });
		if(await page.locator('#login_name').count()) {
			await page.fill('#login_name', user);
			await page.fill('#login_pass', sandbox.password(user));
			await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);
			if(await page.locator('#login_name').count()) throw new Error('login failed for ' + user + ' (throttled?)');
			if(user === 'bridge' && statePath) await ctx.storageState({ path: statePath });
		}
		await page.close();
		return ctx;
	};
	const watch = (p, who) => {
		p.on('pageerror', e => { if(!ignore || !ignore.test(e.message)) errors.push(who + ' ' + p.url().replace(ADMIN, '') + ': ' + e.message); });
		p.on('dialog', d => d.accept());
		return p;
	};

	const a = await session('bridge');
	const consoleErrors = require('./console-errors')(a);
	const b = await session('uikit');
	const bp = watch(await b.newPage(), 'B');

	/** A tab of A (or E) on a screen, with the changes chunk started (its tab id filled in) */
	const tab = async (ctx, where, who) => {
		const p = watch(await ctx.newPage(), who || 'A');
		await p.goto(ADMIN + where, { waitUntil: 'networkidle' });
		for(let t = 0; t < 10000; t += 200) {
			if(await p.evaluate(() => { const i = document.querySelector('input[name="_bridge_tab"]'); return !!i && !!i.value; })) break;
			await p.waitForTimeout(200);
		}
		return p;
	};
	const deps = (p) => p.evaluate(() => { const el = document.getElementById('pw-deps'); return el ? JSON.parse(el.textContent) : null; });
	/** The tab comes back: pw-tab-focus at once; returns the endpoint's answer and what the dialog shows */
	const back = async (p) => {
		const answered = p.waitForResponse(r => r.url().includes('bridgeChanges=1'), { timeout: 10000 }).catch(() => null);
		await p.evaluate(() => {
			ProcessWireAdminTheme.tabFocusDelay = 0;
			window.dispatchEvent(new Event('blur'));
			window.dispatchEvent(new Event('focus'));
		});
		const res = await answered;
		let answer = null;
		if(res) { try { answer = await res.json(); } catch(e) { answer = { status: res.status() }; } }
		await p.waitForTimeout(400);
		const shown = await p.evaluate(() => {
			const d = document.querySelector('dialog.pw-changes');
			if(!d || !d.open) return { open: false };
			const title = d.querySelector('#pw-changes-title');
			return {
				open: true, role: d.getAttribute('role'), title: title ? title.textContent.trim() : '',
				items: [...d.querySelectorAll('.pw-changes-item')].map(s => ({
					head: s.querySelector('h3').textContent.replace(/\s+/g, ' ').trim(),
					href: (s.querySelector('h3 a') || { getAttribute: () => '' }).getAttribute('href'),
					who: (s.querySelector('.pw-changes-who') || {}).textContent || '',
					rows: [...s.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(c => c.textContent.trim())),
					lines: [...s.querySelectorAll(':scope > p:not(.pw-changes-who)')].map(x => x.textContent.trim()),
				})),
				text: d.textContent.replace(/\s+/g, ' ').trim(),
			};
		});
		return { answer, shown };
	};
	const keep = async (p) => {
		const btn = p.locator('dialog.pw-changes[open] .pw-ask-buttons [data-pw-changes="close"]');
		if(await btn.count()) await btn.click();
		await p.waitForTimeout(200);
	};
	const row = (item, key) => (item && item.rows.find(r => r[0] === key)) || null;
	const item = (shown, re) => (shown.items || []).find(i => re.test(i.head)) || null;

	/** B opens an admin form, changes it (fn in the page, returns the old values) and saves it with a named button */
	const bSave = async (where, fn, arg, button) => {
		await bp.goto(ADMIN + where, { waitUntil: 'networkidle' });
		const old = await bp.evaluate(fn, arg);
		await Promise.all([bp.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }), bp.evaluate((name) => {
			const btn = [...document.querySelectorAll('[name="' + name + '"]')].find(x => x.form);
			if(!btn) throw new Error('no button ' + name);
			const f = btn.form;
			const h = document.createElement('input');
			h.type = 'hidden';
			h.name = name;
			h.value = btn.value || '1';
			f.appendChild(h);
			HTMLFormElement.prototype.submit.call(f);
		}, button)]);
		const notices = await bp.evaluate(() => [...document.querySelectorAll('.NoticeError, .uk-alert-danger, .pw-notice-error')].map(n => n.textContent.trim()).join(' | '));
		if(notices) throw new Error('B save of ' + where + ': ' + notices);
		return old;
	};
	const setValues = (values) => {
		const old = {};
		for(const name of Object.keys(values)) {
			const els = [...document.querySelectorAll('[name="' + name + '"]')];
			if(!els.length) throw new Error('no input ' + name);
			const el = els[0];
			if(el.type === 'radio') {
				old[name] = (els.find(x => x.checked) || { value: '' }).value;
				els.forEach(x => { x.checked = x.value === String(values[name]); });
			} else if(el.type === 'checkbox') {
				old[name] = el.checked;
				el.checked = !!values[name];
			} else {
				old[name] = el.value;
				el.value = values[name];
			}
		}
		return old;
	};
	const setCheckbox = ([name, value, on]) => {
		const el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
		if(!el) throw new Error('no checkbox ' + name + '=' + value);
		const old = el.checked;
		el.checked = on;
		return old;
	};
	/** An id from a Setup list: the edit link whose text is the name */
	const setupId = async (list, name) => {
		await bp.goto(ADMIN + 'setup/' + list + '/', { waitUntil: 'networkidle' });
		return bp.evaluate((n) => {
			const link = [...document.querySelectorAll('a[href*="edit?id="]')].find(x => x.textContent.trim() === n);
			return link ? +/[?&]id=(\d+)/.exec(link.getAttribute('href'))[1] : 0;
		}, name);
	};
	/** Runs a case; its undo steps run afterwards even when it throws */
	const run = async (label, fn) => {
		const undo = [];
		try {
			await fn(undo);
		} catch(e) {
			check(label + ' ran through', false, String(e.message).split('\n')[0]);
		}
		for(const u of undo.reverse()) {
			try { await u(); } catch(e) { check(label + ' undo', false, String(e.message).split('\n')[0]); }
		}
		for(const p of a.pages()) await p.close();
	};

	const T_NATIVE = await setupId('template', 'bridge_native');
	const F_IMAGES = await setupId('field', 'bf_images');
	const F_FILES = await setupId('field', 'bf_files');
	const F_TEXT = await setupId('field', 'bf_text');
	const F_INNER = await setupId('field', 'bn_rep_inner');
	check('setup: the fixture template and fields exist', T_NATIVE && F_IMAGES && F_FILES && F_TEXT && F_INNER, JSON.stringify({ T_NATIVE, F_IMAGES, F_FILES, F_TEXT, F_INNER }));

	// A: example 1, the page's template changed
	await run('A', async (undo) => {
		const p = await tab(a, 'page/edit/?id=' + ids.NATIVE_ID);
		const d = await deps(p);
		check('A page edit prints its snapshot (screen, page, template, tab)', d && d.screen === 'page-edit' && +d.page.id === +ids.NATIVE_ID && +d.template === T_NATIVE, JSON.stringify(d));
		const none = await back(p);
		check('A nothing changed: the check answers, no dialog', none.answer && Array.isArray(none.answer.changes) && !none.answer.changes.length && !none.answer.page && !none.shown.open, JSON.stringify(none));
		const old = await bSave('setup/template/edit?id=' + T_NATIVE, (v) => {
			const el = document.querySelector('input[name="noChildren"]:checked');
			const was = el ? el.value : '';
			document.querySelectorAll('input[name="noChildren"]').forEach(x => { x.checked = x.value === (was === '1' ? '0' : '1'); });
			return was;
		}, null, 'submit');
		undo.push(() => bSave('setup/template/edit?id=' + T_NATIVE, setValues, { noChildren: old }, 'submit'));
		const now = old === '1' ? '0' : '1';
		const r = await back(p);
		const it = item(r.shown, /^Template /);
		const nc = row(it, 'noChildren');
		check('A the dialog opens (alertdialog) with the page title', r.shown.open && r.shown.role === 'alertdialog' && r.shown.title === PAGE_TITLE, JSON.stringify(r.shown).slice(0, 300));
		// a default value is not stored: noChildren 0 shows as '–'
		check('A it names the template, who (uikit) and the family setting before and after', it && /bridge_native|Bridge native/i.test(it.head) && /^uikit, /.test(it.who)
			&& nc && nc[1] === old && (nc[2] === now || (now === '0' && nc[2] === '–')), JSON.stringify(it));
		check('A the template links to its editor', it && /setup\/template\/edit\?id=\d+/.test(it.href), it && it.href);
		await keep(p);
		const banner = await p.evaluate(() => { const x = document.querySelector('.pw-changes-banner'); return x ? x.textContent.replace(/\s+/g, ' ') : ''; });
		check('A Keep editing closes it and lists the change in the banner', !(await p.evaluate(() => document.querySelector('dialog.pw-changes').open)) && /Template/.test(banner) && /uikit/.test(banner), banner);
		const again = await back(p);
		check('A shown once: the next return finds nothing new', !again.shown.open && again.answer && !again.answer.changes.length, JSON.stringify(again.answer));
	});

	// B: example 2, extensions narrowed on an images field, then as an override on the page's template
	await run('B', async (undo) => {
		let p = await tab(a, 'page/edit/?id=' + ids.FIXTURE_ID);
		const d = await deps(p);
		check('B the fixture page depends on bf_images', d && d.fields.includes(F_IMAGES), JSON.stringify(d && d.fields));
		const old = await bSave('setup/field/edit?id=' + F_IMAGES, setValues, { extensions: 'png' }, 'submit_save_field');
		undo.push(() => bSave('setup/field/edit?id=' + F_IMAGES, setValues, old, 'submit_save_field'));
		let r = await back(p);
		let it = item(r.shown, /^Field /);
		let ext = row(it, 'extensions');
		check('B the field\'s extensions before and after', r.shown.open && ext && ext[1] === old.extensions && ext[2] === 'png', JSON.stringify(it));
		check('B what it means here: jpg no longer allowed', it && it.lines.some(l => /jpg/.test(l) && /no longer allowed/.test(l)), JSON.stringify(it && it.lines));
		await bSave('setup/field/edit?id=' + F_IMAGES, setValues, old, 'submit_save_field');
		undo.length = 0;
		// the override: extensions allowed per template first (a field save, seen by a tab opened later only)
		const allowed = await bSave('setup/field/edit?id=' + F_IMAGES, setCheckbox, ['allowContexts[]', 'extensions', true], 'submit_save_field');
		const fg = (await deps(p)).fieldgroup;
		undo.push(async () => {
			await bSave('setup/field/edit?id=' + F_IMAGES, (arg) => {
				const rm = document.querySelector('input[name="_remove_context[]"][value="' + arg.fg + ':extensions"]');
				if(rm) rm.checked = true;
				const al = document.querySelector('input[name="allowContexts[]"][value="extensions"]');
				if(al) al.checked = arg.allowed;
			}, { fg, allowed }, 'submit_save_field');
			await bp.goto(ADMIN + 'setup/field/edit?id=' + F_IMAGES, { waitUntil: 'networkidle' });
			const left = await bp.evaluate((fg) => !!document.querySelector('input[name="_remove_context[]"][value="' + fg + ':extensions"]'), fg);
			if(left) throw new Error('the extensions override on fieldgroup ' + fg + ' is still there');
		});
		await p.close();
		p = await tab(a, 'page/edit/?id=' + ids.FIXTURE_ID);
		await bSave('setup/field/edit?id=' + F_IMAGES + '&fieldgroup_id=' + fg, setValues, { extensions: 'png' }, 'submit_save_field');
		r = await back(p);
		it = item(r.shown, /^Field .* on template /);
		ext = row(it, 'extensions');
		check('B the override names field and template, with the extensions before and after', r.shown.open && it && /bridge_fixture/.test(it.head) && ext && ext[2] === 'png', JSON.stringify(r.shown.items));
	});

	// C: a concurrent save of the same page
	await run('C', async (undo) => {
		const p = await tab(a, 'page/edit/?id=' + ids.NATIVE_ID);
		const mine = await p.inputValue('#Inputfield_bf_text');
		await p.fill('#Inputfield_bf_text', mine + ' (A, unsaved)');
		const old = await bSave('page/edit/?id=' + ids.NATIVE_ID, setValues, { bf_text: 'changes-check ' + Date.now() }, 'submit_save');
		undo.push(() => bSave('page/edit/?id=' + ids.NATIVE_ID, setValues, old, 'submit_save'));
		const r = await back(p);
		const it = item(r.shown, /^This page/);
		check('C someone else\'s save of this page: uikit, what changed', r.shown.open && it && /^uikit, /.test(it.who) && it.lines.some(l => /bf_text/.test(l)), JSON.stringify(r.shown.items));
		check('C the unsaved field it may overwrite is named', it && it.lines.some(l => /unsaved changes to bf_text/.test(l)), JSON.stringify(it && it.lines));
		const before = p.url();
		await p.click('dialog.pw-changes[open] .pw-ask-buttons [data-pw-changes="reload"]');
		await p.waitForTimeout(600);
		const asked = await p.evaluate(() => !!document.querySelector('dialog.pw-ask[open]'));
		check('C Reload page asks first while the form has unsaved changes', asked && p.url() === before);
		if(asked) {
			await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), p.click('dialog.pw-ask[open] button[value="ok"]')]);
			check('C after OK it reloads with the other save', (await p.inputValue('#Inputfield_bf_text')).startsWith('changes-check '));
		}
	});

	// D: the page moved to the trash (a page added for the case, deleted for good after it)
	await run('D', async (undo) => {
		await bp.goto(ADMIN + 'page/add/?parent_id=' + ids.PARENT_ID + '&template_id=' + ids.ADD_TEMPLATE_ID, { waitUntil: 'networkidle' });
		if(!/page\/edit\/\?id=/.test(bp.url())) {
			await bp.fill('#Inputfield_title', 'changes-check probe');
			await bp.fill('#Inputfield__pw_page_name', 'changes-check-probe-' + Date.now());
			await Promise.all([bp.waitForNavigation({ waitUntil: 'networkidle' }), bp.click('#Inputfield_submit_save')]);
		}
		const m = /page\/edit\/\?id=(\d+)/.exec(bp.url());
		const id = m ? m[1] : '';
		check('D the probe page was added (if not, nothing is trashed or deleted)', id && id !== ids.PARENT_ID, bp.url());
		if(!id) return;
		const remove = async () => {
			await bp.goto(ADMIN + 'page/edit/?id=' + id, { waitUntil: 'networkidle' });
			if(!(await bp.locator('#delete_page').count())) return false;
			await bSave('page/edit/?id=' + id, (v) => { document.getElementById('delete_page').checked = true; return v; }, id, 'submit_delete');
			return true;
		};
		undo.push(async () => {
			// trashed by the case, or not yet: one or two deletes
			for(let i = 0; i < 2 && await remove(); i++) { /* again */ }
			await bp.goto(ADMIN + 'page/edit/?id=' + id, { waitUntil: 'networkidle' });
			if(await bp.locator('#ProcessPageEdit').count()) throw new Error('probe page ' + id + ' still there');
		});
		const p = await tab(a, 'page/edit/?id=' + id);
		await remove();
		const r = await back(p);
		check('D the trashed page warns', r.shown.open && (/moved to the trash/.test(r.shown.text) || /can no longer save/.test(r.shown.text)), r.shown.text);
	});

	// E: a field only inside repeater and FieldsetPage items
	await run('E', async (undo) => {
		const p = await tab(a, 'page/edit/?id=' + ids.NESTING_ID);
		const d = await deps(p);
		check('E the nesting page depends on bn_rep_inner (only in its items)', d && d.fields.includes(F_INNER), JSON.stringify(d && d.fields));
		const old = await bSave('setup/field/edit?id=' + F_INNER, setValues, { field_label: 'Inner repeater (changes-check)' }, 'submit_save_field');
		undo.push(() => bSave('setup/field/edit?id=' + F_INNER, setValues, old, 'submit_save_field'));
		const r = await back(p);
		const it = item(r.shown, /^Field /);
		const lb = row(it, 'label');
		check('E the item field\'s label before and after', r.shown.open && lb && lb[1] === old.field_label && lb[2] === 'Inner repeater (changes-check)', JSON.stringify(r.shown.items));
	});

	// F: same tab, never; another tab of the same user, yes
	await run('F', async (undo) => {
		const p = await tab(a, 'page/edit/?id=' + ids.NATIVE_ID);
		const other = await tab(a, 'page/edit/?id=' + ids.NATIVE_ID);
		const tabs = await Promise.all([p, other].map(x => x.evaluate(() => sessionStorage.getItem('bridge-tab'))));
		check('F two tabs have two tab ids', tabs[0] && tabs[1] && tabs[0] !== tabs[1], JSON.stringify(tabs));
		const save = async () => {
			await p.evaluate(() => { window.__saved = null; document.addEventListener('pw-page-saved', e => { window.__saved = e.detail || true; }, { once: true }); });
			await p.click('#submit_save');
			for(let t = 0; t < 15000 && !(await p.evaluate(() => !!window.__saved)); t += 200) await p.waitForTimeout(200);
			return p.evaluate(() => !!window.__saved);
		};
		const posted = [];
		p.on('request', rq => { if(rq.method() === 'POST') posted.push({ url: rq.url(), tab: rq.headers()['x-bridge-tab'] || '', body: rq.postData() || '' }); });
		const old = await p.inputValue('#Inputfield_bf_text');
		await p.fill('#Inputfield_bf_text', 'changes-check same tab ' + Date.now());
		const saved = await save();
		undo.push(async () => {
			const q = await tab(a, 'page/edit/?id=' + ids.NATIVE_ID);
			await q.fill('#Inputfield_bf_text', old);
			await q.evaluate(() => { window.__saved = null; document.addEventListener('pw-page-saved', () => { window.__saved = true; }, { once: true }); });
			await q.click('#submit_save');
			for(let t = 0; t < 15000 && !(await q.evaluate(() => !!window.__saved)); t += 200) await q.waitForTimeout(200);
		});
		check('F the in-place save posted this tab\'s id', saved && posted.some(x => x.body.includes(tabs[0])), JSON.stringify(posted.map(x => x.url.replace(ADMIN, '') + ' ' + x.tab)));
		let r = await back(p);
		check('F its own save: no dialog', r.answer && !r.answer.page && !r.answer.changes.length && !r.shown.open, JSON.stringify(r.answer));
		r = await back(p);
		check('F its own save, second return: still no dialog', r.answer && !r.answer.page && !r.answer.changes.length && !r.shown.open, JSON.stringify(r.answer));
		r = await back(other);
		const it = item(r.shown, /^This page/);
		check('F the other tab of the same user warns: you, in another tab', r.shown.open && it && /^you, in another tab/.test(it.who), JSON.stringify(r.shown.items));

		// the files-move POST (fetch) carries the tab id; its answer is stubbed, nothing moves
		const moves = [];
		await p.route(u => /\/page\/edit\//.test(u.pathname), async route => {
			const rq = route.request();
			if(rq.method() === 'POST' && /bridgeFilesMove/.test(rq.postData() || '')) {
				moves.push({ tab: rq.headers()['x-bridge-tab'] || '', body: /_bridge_tab/.test(rq.postData() || '') });
				return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"moved":[],"swapped":[],"errors":[]}' });
			}
			return route.continue();
		});
		await p.goto(ADMIN + 'page/edit/?id=' + ids.NATIVE_ID, { waitUntil: 'networkidle' });
		await p.setViewportSize({ width: 1300, height: 2400 });
		const FILES = '#wrap_Inputfield_bf_files', DOCS = '#wrap_Inputfield_bf_docs';
		const from = FILES + ' .InputfieldFileList > li.InputfieldFileItem:nth-child(1) .InputfieldFileInfo';
		if(await p.locator(from).count() && await p.locator(DOCS).count()) {
			await p.$eval(FILES, el => el.scrollIntoView({ block: 'start' }));
			const s = await (await p.$(from)).boundingBox();
			const t = await (await p.$(DOCS + ' > .InputfieldContent')).boundingBox();
			await p.mouse.move(s.x + s.width * 0.6, s.y + s.height / 2);
			await p.mouse.down();
			await p.mouse.move(s.x + s.width * 0.6 + 10, s.y + s.height / 2 + 10, { steps: 3 });
			await p.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
			await p.waitForTimeout(700);
			await p.mouse.move(t.x + t.width / 2 + 3, t.y + t.height / 2 + 3, { steps: 2 });
			await p.waitForTimeout(200);
			await p.mouse.up();
			// a drop that asks first (Docs full): Move
			await p.waitForTimeout(500);
			if(await p.locator('dialog.pw-ask[open] button[value="ok"]').count()) await p.click('dialog.pw-ask[open] button[value="ok"]');
			for(let w = 0; w < 5000 && !moves.length; w += 200) await p.waitForTimeout(200);
			const id = await p.evaluate(() => sessionStorage.getItem('bridge-tab'));
			check('F the files-move POST sends X-Bridge-Tab (this tab\'s id)', moves.length && moves[0].tab === id, JSON.stringify({ moves, id }));
		} else {
			check('F the files-move POST sends X-Bridge-Tab: a file in bf_files and the bf_docs field', false, 'fixture missing');
		}
		await p.unroute(u => /\/page\/edit\//.test(u.pathname)).catch(() => {});
		await p.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});

		// an upload on the legacy stack (the fixture page loads it): the XHR carries the tab id, no dialog after
		const q = await tab(a, 'page/edit/?id=' + ids.FIXTURE_ID);
		const legacy = await q.evaluate(() => !!window.jQuery);
		check('F the fixture page runs the legacy stack (jQuery)', legacy);
		const uploads = [];
		q.on('request', rq => { if(rq.method() === 'POST') uploads.push({ url: rq.url(), tab: rq.headers()['x-bridge-tab'] || '' }); });
		const qid = await q.evaluate(() => sessionStorage.getItem('bridge-tab'));
		const FF = '#wrap_Inputfield_bf_files';
		// upstream keeps an AJAX upload as a temporary file until the form is saved, and deletes
		// the page's temporary files when its editor renders again: a fresh editor is the undo
		const answered = q.waitForResponse(rs => /InputfieldFileAjax=1/.test(rs.url()) && rs.request().method() === 'POST', { timeout: 15000 }).catch(() => null);
		await q.setInputFiles(FF + ' input[type=file]', { name: 'changes-check.txt', mimeType: 'text/plain', buffer: Buffer.from('changes-check') });
		const res = await answered;
		let added = null;
		try { added = res ? (await res.json())[0] : null; } catch(e) { added = null; }
		const fileUrl = added && !added.error && added.file ? new URL(added.file, ADMIN).href : '';
		undo.push(async () => {
			if(!fileUrl) return;
			await tab(a, 'page/edit/?id=' + ids.FIXTURE_ID);
			const left = await bp.request.get(fileUrl).then(x => x.status()).catch(() => 0);
			if(left !== 404) throw new Error('the uploaded file is still there: ' + fileUrl + ' (' + left + ')');
		});
		await q.waitForTimeout(800);
		const upPost = uploads.find(x => /InputfieldFileAjax=1/.test(x.url));
		check('F the legacy upload was added and its XHR carries X-Bridge-Tab', fileUrl && upPost && upPost.tab === qid, JSON.stringify({ added, uploads: uploads.map(x => x.url.replace(ADMIN, '') + ' ' + x.tab), qid }));
		r = await back(q);
		check('F after its own upload the tab does not warn itself', r.answer && !r.answer.page && !r.answer.changes.length && !r.shown.open, JSON.stringify(r.answer));
		r = await back(q);
		check('F after its own upload, second return: still no warning', r.answer && !r.answer.page && !r.answer.changes.length && !r.shown.open, JSON.stringify(r.answer));
	});

	// G: a plain editor (acl: page-edit, no field-admin) and bridge on the same page
	{
		const e = await session('acl');
		await run('G', async (undo) => {
			const pe = await tab(e, 'page/edit/?id=' + ids.NATIVE_ID, 'E');
			const pa = await tab(a, 'page/edit/?id=' + ids.NATIVE_ID);
			check('G acl may edit the native page (no access rules left set)', !!(await deps(pe)), pe.url());
			const old = await bSave('setup/field/edit?id=' + F_FILES, setValues, { extensions: 'txt', showIf: 'bf_integer>0', entityEncode: false }, 'submit_save_field');
			undo.push(() => bSave('setup/field/edit?id=' + F_FILES, setValues, old, 'submit_save_field'));
			const re = await back(pe);
			const ie = item(re.shown, /^Field /);
			const ae = re.answer && (re.answer.changes || []).find(c => c.kind === 'field');
			check('G the plain editor sees the extensions before and after', re.shown.open && row(ie, 'extensions') && row(ie, 'extensions')[2] === 'txt', JSON.stringify(ie));
			check('G only safe values reach the plain editor (diff keys: extensions)', ae && Object.keys(ae.diff).join() === 'extensions', JSON.stringify(ae));
			check('G the code-like setting is named, without its value', ae && ae.named.includes('showIf') && !JSON.stringify(ae).includes('bf_integer') && ie && ie.lines.some(l => /not shown: .*showIf/.test(l)), JSON.stringify(ie && ie.lines));
			check('G the rest is counted', ae && ae.hidden >= 1 && ie && ie.lines.some(l => /Other settings changed \(\d+\)/.test(l)), JSON.stringify(ie && ie.lines));
			const ra = await back(pa);
			const aa = ra.answer && (ra.answer.changes || []).find(c => c.kind === 'field');
			check('G a field admin sees every changed setting with its values', aa && aa.diff.extensions && aa.diff.showIf && aa.diff.entityEncode !== undefined && !aa.named.length && !aa.hidden, JSON.stringify(aa));
		});
		await e.close();
	}

	// the dialog for a look in light and dark (SHOTS=<dir>)
	if(process.env.SHOTS) {
		await run('S', async (undo) => {
			const state = await a.storageState();
			const shots = [];
			for(const scheme of ['light', 'dark']) {
				const c = await browser.newContext({ viewport: { width: 1300, height: 950 }, deviceScaleFactor: 2, storageState: state });
				await c.addInitScript((s) => { try { localStorage.setItem('pwScheme', s); } catch(e) {} }, scheme);
				shots.push({ scheme, c, p: await tab(c, 'page/edit/?id=' + ids.NATIVE_ID) });
			}
			const old = await bSave('setup/field/edit?id=' + F_FILES, setValues, { extensions: 'txt', showIf: 'bf_integer>0', field_label: 'Files (changed)' }, 'submit_save_field');
			undo.push(() => bSave('setup/field/edit?id=' + F_FILES, setValues, old, 'submit_save_field'));
			const tOld = await bSave('setup/template/edit?id=' + T_NATIVE, setValues, { noChildren: '0' }, 'submit');
			undo.push(() => bSave('setup/template/edit?id=' + T_NATIVE, setValues, tOld, 'submit'));
			for(const s of shots) {
				const r = await back(s.p);
				const file = path.join(process.env.SHOTS, 'changes-modal-' + s.scheme + '.png');
				if(r.shown.open) await s.p.screenshot({ path: file });
				check('S dialog shot (' + s.scheme + ')', r.shown.open, file);
				await s.c.close();
			}
		});
	}

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

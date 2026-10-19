// Native Repeater and PageTable check (tools/repeater-check.js, milestone 3.3, ADR 0016): drives
// the fields of the native fixture page in a real browser engine and verifies that they work
// without jQuery: repeater items load and are added by AJAX, delete, on/off, sort, depth by
// dragging sideways, min items, insert after, clone through the choice dialog, save round trip;
// page table edits in the native dialog (footer buttons, close after save, table reload), delete
// mark, sort, add. Restores what it changes.
// Needs a Playwright install with its browsers (any project's node_modules/playwright-core).
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] PROBE_PASS=<sandbox bridge password> node tools/repeater-check.js
//     <playwright-core dir> <firefox|chromium|webkit>
// Admin URL: the atispro sandbox (http://localhost:8089, user "bridge"), or ADMIN=<admin url>.
// Page /bridge-native/ (NATIVE_ID, default 1517) from tools/sandbox-fixture.php: bf_repeater (3
// items), bf_repeater_depth (depth 2, min 1, max 5: Parent, Child at depth 1, Sibling),
// bf_pagetable (2 rows); a legacy editor with a repeater: 1224 (LEGACY_ID: CKEditor and
// PageTableNext keep it legacy).
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'firefox';
const ADMIN = process.env.ADMIN || 'http://localhost:8089/fv9673g5vdfigh/';
const NATIVE = process.env.NATIVE_ID || '1517';
const LEGACY = process.env.LEGACY_ID || '1224';
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
	page.on('pageerror', e => { if(!ignore || !ignore.test(e.message)) errors.push(e.message); });
	page.on('dialog', d => d.accept());

	const open = async (id) => {
		await page.goto(ADMIN + 'page/edit/?id=' + id, { waitUntil: 'networkidle' });
		if(await page.locator('#login_name').count()) {
			await page.fill('#login_name', 'bridge');
			await page.fill('#login_pass', process.env.PROBE_PASS);
			await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);
			if(statePath) await ctx.storageState({ path: statePath });
			await page.goto(ADMIN + 'page/edit/?id=' + id, { waitUntil: 'networkidle' });
		}
		if(await page.locator('#login_name').count()) throw new Error('login failed (throttled? wrong PROBE_PASS?)');
		await page.waitForTimeout(500);
	};
	const jq = () => page.evaluate(() => !!window.jQuery);
	const waitFor = async (fn, arg, ms = 10000) => {
		for(let t = 0; t < ms; t += 200) {
			if(await page.evaluate(fn, arg)) return true;
			await page.waitForTimeout(200);
		}
		return false;
	};
	const save = async () => {
		await page.evaluate(() => { window.__saved = null; document.addEventListener('pw-page-saved', e => { window.__saved = e.detail; }, { once: true }); });
		await page.click('#submit_save');
		return waitFor(() => !!window.__saved, null, 30000);
	};
	// open the dialog from a trigger and save the page editor in it with this title: the add form
	// may come first (or create the page itself and go to the editor); a save can take seconds
	// (atispro cleans its static cache on every save); resolves once the dialog has closed
	const editInDialog = async (trigger, title) => {
		await page.click(trigger);
		for(let t = 0; t < 120; t++) {
			const state = await page.evaluate(() => {
				const d = document.querySelector('dialog.pw-dialog[open]');
				if(!d) return 'closed';
				let doc = null;
				try { doc = d.querySelector('iframe').contentDocument; } catch(e) { return ''; }
				if(!doc || doc.readyState !== 'complete' || doc.__pwSeen || !doc.getElementById('Inputfield_title')) return '';
				if(!d.querySelectorAll('.pw-dialog-buttons button').length) return '';
				doc.__pwSeen = true; // act once per page load in the window
				return 'ready';
			});
			if(state === 'closed') return true;
			if(state === 'ready') {
				await page.frameLocator('dialog.pw-dialog[open] iframe').locator('#Inputfield_title').fill(title);
				await page.click('dialog.pw-dialog[open] .pw-dialog-buttons button');
			}
			await page.waitForTimeout(500);
		}
		return false;
	};
	const R = '#wrap_Inputfield_bf_repeater';
	const D = '#wrap_Inputfield_bf_repeater_depth';
	const T = '#wrap_Inputfield_bf_pagetable';
	const items = (sel) => page.$$eval(sel + ' > .InputfieldContent > .Inputfields > .InputfieldRepeaterItem:not(.InputfieldRepeaterNewItem)', l => l.map(i => i.getAttribute('data-page')));
	const nth = (sel, n) => `${sel} > .InputfieldContent > .Inputfields > .InputfieldRepeaterItem:not(.InputfieldRepeaterNewItem):nth-child(${n})`;
	const control = async (item, cls) => {
		await page.hover(item + ' > .InputfieldHeader');
		await page.click(item + ' > .InputfieldHeader .' + cls);
	};
	const dragBy = async (handle, dx, dy) => {
		await page.$eval(handle, el => el.scrollIntoView({ block: 'center' }));
		const b = await (await page.$(handle)).boundingBox();
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
		await page.mouse.down();
		await page.mouse.move(b.x + b.width / 2 + dx / 2, b.y + b.height / 2 + dy / 2, { steps: 4 });
		await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 6 });
		await page.mouse.up();
		await page.waitForTimeout(300);
	};

	// items added by AJAX exist on the server at once (unpublished): leftovers of this run or of an
	// interrupted one are deleted, keeping each fixture repeater's original items (the lowest ids)
	const cleanup = async () => {
		await open(NATIVE);
		const marked = await page.evaluate((sels) => {
			let n = 0;
			for(const [sel, keep] of sels) {
				const list = [...document.querySelectorAll(sel + ' > .InputfieldContent > .Inputfields > .InputfieldRepeaterItem:not(.InputfieldRepeaterNewItem)')];
				const originals = list.map(i => parseInt(i.getAttribute('data-page'), 10)).sort((a, b) => a - b).slice(0, keep);
				list.forEach(i => {
					if(originals.indexOf(parseInt(i.getAttribute('data-page'), 10)) > -1) return;
					const box = document.getElementById('delete_repeater' + i.getAttribute('data-page'));
					if(box) { box.checked = true; n++; }
				});
			}
			return n;
		}, [[R, 3], [D, 3]]);
		// page table rows added by this check
		const rows = await page.evaluate((t) => {
			const tbody = document.querySelector(t + ' tbody');
			const del = document.querySelector(t + ' input.InputfieldPageTableDelete');
			if(!tbody || !del) return 0;
			const ids = [...tbody.querySelectorAll('tr')].filter(tr => /Probe row/.test(tr.textContent)).map(tr => tr.getAttribute('data-id'));
			del.value = ids.join('|');
			return ids.length;
		}, T);
		if(marked || rows) { await save(); await open(NATIVE); }
	};
	await cleanup();

	// A: native, controls built
	await open(NATIVE);
	check('A no jQuery on the editor with repeaters and a page table', !(await jq()), JSON.stringify(await page.evaluate(() => ProcessWire.config.AdminThemeBridge.legacyReasons)));
	const built = await page.evaluate(([r, d]) => ({
		controls: document.querySelectorAll(r + ' .InputfieldRepeaterItemControls').length,
		drag: document.querySelectorAll(r + ' .InputfieldRepeaterDrag').length,
		depth: [...document.querySelectorAll(d + ' .InputfieldRepeaterItem:not(.InputfieldRepeaterNewItem)')].map(i => i.style.paddingLeft || '0px'),
	}), [R, D]);
	check('A item headers get controls and handles', built.controls === 4 && built.drag === 4, JSON.stringify(built));
	check('A depth shown as indent', built.depth.join() === '0px,50px,0px', JSON.stringify(built));

	// B: AJAX item load
	const first = nth(R, 1);
	await page.$eval(first, el => el.scrollIntoView({ block: 'center' }));
	await page.click(first + ' > .InputfieldHeader .InputfieldRepeaterItemLabel');
	const loaded = await waitFor((s) => { const i = document.querySelector(s); return i.querySelector('.InputfieldRepeaterLoaded').value === '1' && !!i.querySelector('input[name^="bf_text"]'); }, first);
	check('B opening an item loads its fields', loaded, await page.evaluate((s) => document.querySelector(s).querySelector('input[name^="bf_text"]') ? document.querySelector(s).querySelector('input[name^="bf_text"]').value : 'none', first));

	// D: delete toggle
	const before = await items(R);
	await control(nth(R, 2), 'InputfieldRepeaterTrash');
	const del = await page.evaluate((s) => { const i = document.querySelector(s); return { pending: i.classList.contains('InputfieldRepeaterDeletePending'), box: document.getElementById('delete_repeater' + i.getAttribute('data-page')).checked }; }, nth(R, 2));
	check('D trash marks the item for deletion', del.pending && del.box, JSON.stringify(del));
	await control(nth(R, 2), 'InputfieldRepeaterTrash');
	check('D trash again unmarks it', await page.evaluate((s) => !document.querySelector(s).classList.contains('InputfieldRepeaterDeletePending'), nth(R, 2)));

	// E: on/off
	await control(nth(R, 3), 'InputfieldRepeaterToggle');
	await page.waitForTimeout(400);
	const off = await page.evaluate((s) => { const i = document.querySelector(s); return { off: i.classList.contains('InputfieldRepeaterOff'), val: i.querySelector('.InputfieldRepeaterPublish').value }; }, nth(R, 3));
	check('E toggle turns the item off', off.off && off.val === '-1', JSON.stringify(off));
	await control(nth(R, 3), 'InputfieldRepeaterToggle');
	await page.waitForTimeout(400);
	check('E toggle again turns it on', await page.evaluate((s) => document.querySelector(s).querySelector('.InputfieldRepeaterPublish').value === '1', nth(R, 3)));

	// F: sort by handle
	await open(NATIVE);
	const sb = await items(R);
	const h3 = await (await page.$(nth(R, 3) + ' .InputfieldRepeaterDrag')).boundingBox();
	const h1 = await (await page.$(nth(R, 1) + ' .InputfieldRepeaterDrag')).boundingBox();
	await dragBy(nth(R, 1) + ' .InputfieldRepeaterDrag', 0, h3.y - h1.y + 12);
	const sa = await items(R);
	const sorts = await page.$$eval(R + ' .InputfieldRepeaterItem:not(.InputfieldRepeaterNewItem) .InputfieldRepeaterSort', s => s.map(x => x.value).join(','));
	check('F dragging the handle sorts the items', sa.join() === [sb[1], sb[2], sb[0]].join() && sorts === '0,1,2', JSON.stringify({ sb, sa, sorts }));

	// G: depth by dragging sideways
	await open(NATIVE);
	await dragBy(nth(D, 3) + ' .InputfieldRepeaterDrag', 60, 0);
	const depth = await page.evaluate((s) => { const i = document.querySelector(s); return { attr: i.getAttribute('data-depth'), pad: i.style.paddingLeft, input: i.querySelector('.InputfieldRepeaterItemDepth input').value }; }, nth(D, 3));
	check('G dragging sideways sets depth 1', depth.attr === '1' && depth.pad === '50px' && depth.input === '1', JSON.stringify(depth));

	// H: min items
	await open(NATIVE);
	await control(nth(D, 1), 'InputfieldRepeaterTrash');
	await control(nth(D, 2), 'InputfieldRepeaterTrash');
	check('H at the minimum the last trash is disabled', await page.evaluate((s) => document.querySelector(s + ' > .InputfieldHeader .InputfieldRepeaterTrash').classList.contains('pw-icon-disabled'), nth(D, 3)));

	// C: add by AJAX, save, delete again
	await open(NATIVE);
	const n0 = (await items(R)).length;
	await page.$eval(R + ' .InputfieldRepeaterAddLink', el => el.scrollIntoView({ block: 'center' }));
	await page.click(R + ' .InputfieldRepeaterAddLink');
	const added = await waitFor((s) => document.querySelectorAll(s + ' > .InputfieldContent > .Inputfields > .InputfieldRepeaterItem:not(.InputfieldRepeaterNewItem)').length > 0 && !!document.querySelector(s + ' .InputfieldRepeaterItemRequested input[name^="bf_text"]'), R);
	check('C Add New adds an item by AJAX', added && (await items(R)).length === n0 + 1, JSON.stringify(await items(R)));
	const newId = (await items(R))[n0];
	// the fixture collapses all items (repeaterCollapse), new ones too, as upstream renders them
	await page.click(`${R} .InputfieldRepeaterItem[data-page="${newId}"] > .InputfieldHeader .InputfieldRepeaterItemLabel`);
	await page.waitForTimeout(400);
	await page.fill(`${R} .InputfieldRepeaterItem[data-page="${newId}"] input[name^="bf_text"]`, 'Added item');
	check('C saved in place', await save());
	await open(NATIVE);
	check('C added item persisted', (await items(R)).length === n0 + 1);
	const addedItem = `${R} .InputfieldRepeaterItem[data-page="${newId}"]`;
	await control(addedItem, 'InputfieldRepeaterTrash');
	await save();
	await open(NATIVE);
	check('C deleting it and saving removes it', (await items(R)).length === n0, JSON.stringify(await items(R)));

	// I: insert after
	await control(nth(R, 1), 'InputfieldRepeaterInsertAfter');
	const inserted = await waitFor((s) => { const l = document.querySelectorAll(s + ' > .InputfieldContent > .Inputfields > .InputfieldRepeaterItem:not(.InputfieldRepeaterNewItem)'); return l.length === 4 && l[1].classList.contains('InputfieldRepeaterItemRequested'); }, R);
	check('I insert after puts the new item second', inserted, JSON.stringify(await items(R)));

	// J: clone through the choice dialog
	await open(NATIVE);
	await control(nth(R, 1), 'InputfieldRepeaterClone');
	await page.waitForSelector('dialog.pw-ask[open]', { timeout: 3000 }).catch(() => {});
	const asked = await page.locator('dialog.pw-ask[open]').count();
	check('J clone shows the action dialog', asked === 1);
	if(asked) {
		await page.selectOption('dialog.pw-ask select', 'clone-after');
		await page.click('dialog.pw-ask button[value=ok]');
		const cloned = await waitFor((s) => { const l = document.querySelectorAll(s + ' > .InputfieldContent > .Inputfields > .InputfieldRepeaterItem:not(.InputfieldRepeaterNewItem)'); return l.length === 4 && l[1].classList.contains('InputfieldRepeaterItemRequested'); }, R);
		check('J clone after adds the copy below', cloned, JSON.stringify(await items(R)));
	}

	// the page table parts need the fixture's bf_pagetable (FieldtypePageTable installed)
	await open(NATIVE);
	if(await page.locator(T).count()) {
		// L, M: page table delete mark and sort
		await open(NATIVE);
		await page.$eval(T, el => el.scrollIntoView({ block: 'center' }));
		await page.click(T + ' tbody tr:nth-child(1) a.InputfieldPageTableDelete');
		const mark = await page.evaluate((s) => ({ row: document.querySelector(s + ' tbody tr').classList.contains('InputfieldPageTableDelete'), input: document.querySelector(s + ' input.InputfieldPageTableDelete').value, id: document.querySelector(s + ' tbody tr').getAttribute('data-id') }), T);
		check('L trash marks the row and fills the delete input', mark.row && mark.input === mark.id, JSON.stringify(mark));
		await page.click(T + ' tbody tr:nth-child(1) a.InputfieldPageTableDelete');
		check('L trash again unmarks it', await page.evaluate((s) => document.querySelector(s + ' input.InputfieldPageTableDelete').value === '', T));
		const order0 = await page.$eval(T + ' input.InputfieldPageTableSort', i => i.value);
		const r2 = await (await page.$(T + ' tbody tr:nth-child(2) td:nth-child(2)')).boundingBox();
		const r1 = await (await page.$(T + ' tbody tr:nth-child(1) td:nth-child(2)')).boundingBox();
		await page.mouse.move(r2.x + 10, r2.y + r2.height / 2);
		await page.mouse.down();
		await page.mouse.move(r2.x + 10, r2.y + r2.height / 2 - 10, { steps: 3 });
		await page.mouse.move(r1.x + 10, r1.y + 4, { steps: 6 });
		await page.mouse.up();
		await page.waitForTimeout(300);
		const order1 = await page.$eval(T + ' input.InputfieldPageTableSort', i => i.value);
		check('M dragging a row sorts the table', order1 === order0.split('|').reverse().join('|'), JSON.stringify({ order0, order1 }));

		// K: edit a row in the native dialog
		await open(NATIVE);
		const title0 = await page.$eval(T + ' tbody tr:nth-child(1) .InputfieldPageTableEdit', a => a.textContent.trim());
		await page.click(T + ' tbody tr:nth-child(1) .InputfieldPageTableEdit');
		const frame = page.frameLocator('dialog.pw-dialog[open] iframe');
		await frame.locator('#Inputfield_title').waitFor({ timeout: 15000 });
		const footer = await page.$$eval('dialog.pw-dialog[open] .pw-dialog-buttons button', b => b.map(x => x.textContent.trim()));
		check('K the editor opens in the dialog, its Save in the footer', footer.length > 0, JSON.stringify(footer));
		check('K the window\'s own buttons are hidden', await frame.locator('#submit_save').evaluate(b => getComputedStyle(b).display === 'none').catch(() => false));
		await frame.locator('#Inputfield_title').fill(title0 + ' edited');
		await page.click('dialog.pw-dialog[open] .pw-dialog-buttons button');
		const closed = await waitFor(() => !document.querySelector('dialog.pw-dialog[open]'), null, 30000);
		check('K saving closes the dialog', closed);
		const reloaded = await waitFor(([s, t]) => document.querySelector(s + ' tbody tr:nth-child(1) .InputfieldPageTableEdit').textContent.trim() === t, [T, title0 + ' edited'], 10000);
		check('K the table reloads with the new title', reloaded, await page.$eval(T + ' tbody tr:nth-child(1) .InputfieldPageTableEdit', a => a.textContent.trim()));
		check('K still no jQuery', !(await jq()));
		// restore the title
		await editInDialog(T + ' tbody tr:nth-child(1) .InputfieldPageTableEdit', title0);
		check('K title restored', await waitFor(([s, t]) => document.querySelector(s + ' tbody tr:nth-child(1) .InputfieldPageTableEdit').textContent.trim() === t, [T, title0], 15000));

		await cleanup();
		check('cleanup: the repeaters are back to their 3 items', (await items(R)).length === 3 && (await items(D)).length === 3, JSON.stringify([await items(R), await items(D)]));

		// N: add a page table row (the add form, then the editor, then the table)
		await open(NATIVE);
		const rows0 = await page.$$eval(T + ' tbody tr', r => r.length);
		check('N the dialog closes after the new page is saved', await editInDialog(T + ' .InputfieldPageTableAdd button', 'Probe row'));
		const rowAdded = await waitFor(([t, n]) => document.querySelectorAll(t + ' tbody tr').length === n + 1 && /Probe row/.test(document.querySelector(t + ' tbody').textContent), [T, rows0], 15000);
		check('N Add New adds a row through the add form and the editor', rowAdded, await page.$$eval(T + ' tbody tr', r => r.map(x => x.textContent.trim().replace(/\s+/g, ' ')).join(' | ')));

		await cleanup();
		check('cleanup: the page table is back to its rows', await page.$$eval(T + ' tbody tr', r => r.length) === rows0);
	} else {
		check('L-N skipped: no page table on this site (FieldtypePageTable not installed)', true);
		await cleanup();
	}

	// O: a legacy editor keeps upstream's repeater
	await open(LEGACY);
	check('O legacy editor: upstream runs the repeater', await jq() && await page.evaluate(() => !document.querySelector('[data-pw-repeater]') && !!document.querySelector('.InputfieldRepeater .InputfieldRepeaterItemControls')));

	check('no page errors', errors.length === 0, errors.join(' | '));
	report();
	await browser.close();
})().catch(e => { check('run completed', false, String(e.message).split(String.fromCharCode(10))[0]); report(); process.exit(1); });

function report() {
	const failed = results.filter(x => !x.ok);
	console.log(JSON.stringify({ browser: browserName, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
	if(failed.length) process.exitCode = 1;
}

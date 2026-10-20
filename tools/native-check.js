// Native behaviour check (tools/native-check.js), Gate 2 of PLAN.md (ADR 0015): drives the field
// lab (BridgeDemo, Setup > Bridge demo > fields/) and checks the shared Inputfield behaviours
// that core fields rely on: collapse (plain and AJAX), showIf/requiredIf, columns, the Text
// counter, change tracking, the leave-page warning, the Enter guard (two submit buttons), the
// invalid-field open, submit dropdown items and a save round trip; since milestone 2.4 also
// Toggle (select, deselect), Checkboxes (shift-click range) and language tabs.
//
// The same checks pass with upstream's jQuery (fields still legacy) and must keep passing when
// the runtime owns them; --gate additionally requires that the page loads no jQuery and records
// no legacy reasons.
//
// usage (Git Bash: prefix MSYS_NO_PATHCONV=1):
//   [PW_STATE=<login state file>] PROBE_PASS=<sandbox bridge password> node tools/native-check.js <playwright-core dir>
//     <firefox|chromium> [admin url, default http://localhost:8089/fv9673g5vdfigh/] [--gate]
// Exit code 1 when a check fails.
const pw = require(process.argv[2]);
const browserName = process.argv[3] || 'chromium';
const ADMIN = (process.argv[4] && !process.argv[4].startsWith('--')) ? process.argv[4] : 'http://localhost:8089/fv9673g5vdfigh/';
const GATE = process.argv.includes('--gate');
const LAB = ADMIN + 'setup/bridge-demo/fields/';
const results = [];
const check = (name, ok, info) => { results.push({ ok: !!ok, name, info: info === undefined ? '' : String(info).slice(0, 300) }); };

(async () => {
	const browser = await pw[browserName].launch({ headless: true });
	// PW_STATE=<file>: reuse a saved login (repeated logins trip ProcessWire's login throttle)
	const fs = require('fs');
	const statePath = process.env.PW_STATE || '';
	const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } },
		statePath && fs.existsSync(statePath) ? { storageState: statePath } : {}));
	const consoleErrors = require('./console-errors')(ctx);
	const page = await ctx.newPage();
	const errors = [];
	page.on('pageerror', e => errors.push(e.message));
	await page.goto(LAB, { waitUntil: 'networkidle' });
	if(await page.locator('#login_name').count()) {
		await page.fill('#login_name', 'bridge');
		await page.fill('#login_pass', process.env.PROBE_PASS);
		await Promise.all([page.waitForNavigation(), page.click('#Inputfield_login_submit')]);
		if(statePath) await ctx.storageState({ path: statePath });
	}
	if(await page.locator('#login_name').count()) throw new Error('login failed (throttled? wrong PROBE_PASS?)');

	const open = async () => {
		await page.goto(LAB, { waitUntil: 'networkidle' });
		await page.waitForTimeout(400);
	};
	// fieldsets are their own wrapper (li#Inputfield_<name>); fields are wrapped (li#wrap_Inputfield_<name>)
	const wrapSel = (name) => name === 'lab_fieldset' ? '#Inputfield_lab_fieldset' : '#wrap_Inputfield_' + name;
	const li = (name) => page.locator(wrapSel(name));
	const hasClass = (name, cls) => li(name).evaluate((el, c) => el.classList.contains(c), cls);
	const visible = (sel) => page.locator(sel).isVisible();

	await open();
	const env = await page.evaluate(() => {
		const c = (window.ProcessWire && ProcessWire.config.AdminThemeBridge) || {};
		return { jquery: !!window.jQuery, reasons: c.legacyReasons || {} };
	});
	const reasonList = Object.keys(env.reasons);
	console.log(`${browserName}: jQuery ${env.jquery ? 'loaded' : 'absent'}; legacy reasons: ${reasonList.length ? reasonList.join(', ') : 'none'}`);
	if(GATE) {
		check('gate: no jQuery on the lab page', !env.jquery);
		check('gate: no legacy reasons', reasonList.length === 0, reasonList.join(', '));
	}

	// collapse: plain
	await page.click('#wrap_Inputfield_lab_collapsed > .InputfieldHeader');
	await page.waitForTimeout(400);
	check('collapse: header click opens', !(await hasClass('lab_collapsed', 'InputfieldStateCollapsed')) && await visible('#Inputfield_lab_collapsed'));
	await page.click('#wrap_Inputfield_lab_collapsed > .InputfieldHeader');
	await page.waitForTimeout(400);
	check('collapse: second click closes', await hasClass('lab_collapsed', 'InputfieldStateCollapsed'));

	// collapse: AJAX
	await page.click('#wrap_Inputfield_lab_ajax > .InputfieldHeader');
	await page.waitForSelector('#Inputfield_lab_ajax', { timeout: 8000 }).catch(() => {});
	check('collapse: AJAX field loads its input', await page.locator('#Inputfield_lab_ajax').count() === 1 && await visible('#Inputfield_lab_ajax'));

	// showIf / requiredIf
	check('showIf: Detail hidden at first', !(await visible('#wrap_Inputfield_lab_detail')));
	await page.check('#Inputfield_lab_radios_b');
	await page.waitForTimeout(400);
	check('showIf: Detail shown for Beta', await visible('#wrap_Inputfield_lab_detail'));
	check('requiredIf: Detail required for Beta', await hasClass('lab_detail', 'InputfieldStateRequired'));
	await page.check('#Inputfield_lab_radios_a');
	await page.waitForTimeout(400);
	check('showIf: Detail hidden again for Alpha', !(await visible('#wrap_Inputfield_lab_detail')));

	// columns: Email, URL, Name share one row
	const row = await page.evaluate(() => ['lab_email', 'lab_url', 'lab_name'].map(n => {
		const r = document.querySelector('#wrap_Inputfield_' + n).getBoundingClientRect();
		return { top: Math.round(r.top), w: Math.round(r.width) };
	}));
	check('columns: three fields on one row', row[0].top === row[1].top && row[1].top === row[2].top, JSON.stringify(row));

	// Toggle (milestone 2.4): select, then deselect with a second click on the current option
	const toggleLabel = page.locator('#wrap_Inputfield_lab_toggle .InputfieldToggleGroup label').first();
	if(await toggleLabel.count()) {
		const radio = page.locator('#wrap_Inputfield_lab_toggle .InputfieldToggleGroup input[type=radio]').first();
		await toggleLabel.click();
		await page.waitForTimeout(250);
		check('toggle: click selects with the current classes', await radio.isChecked() &&
			await radio.evaluate(el => el.classList.contains('InputfieldToggleChecked')) &&
			await toggleLabel.evaluate(el => el.classList.contains('InputfieldToggleCurrent')));
		await toggleLabel.click();
		await page.waitForTimeout(400);
		check('toggle: second click deselects', !(await radio.isChecked()) && !(await toggleLabel.evaluate(el => el.classList.contains('InputfieldToggleCurrent'))));
	} else {
		check('toggle: field present', false);
	}

	// Checkboxes (milestone 2.4): shift-click selects the range
	const boxes = page.locator('#wrap_Inputfield_lab_checkboxes input[type=checkbox]');
	if(await boxes.count() >= 4) {
		await boxes.nth(0).click();
		await boxes.nth(3).click({ modifiers: ['Shift'] });
		await page.waitForTimeout(200);
		const states = await boxes.evaluateAll(els => els.map(e => e.checked));
		check('checkboxes: shift-click selects the range', states.slice(0, 4).every(Boolean) && !states[4], JSON.stringify(states));
	} else {
		check('checkboxes: field present', false);
	}

	// asmSelect (milestone 2.4): pick, drag to sort, remove; the hidden original select follows
	const asmWrap = '#wrap_Inputfield_lab_asm';
	if(await page.locator(asmWrap + ' select.asmSelect').count()) {
		const labels = () => page.$$eval(asmWrap + ' .asmListItem .asmListItemLabel', els => els.map(e => e.textContent.trim()));
		const posted = () => page.$eval('#Inputfield_lab_asm', s => Array.from(s.selectedOptions).map(o => o.value));
		await page.selectOption(asmWrap + ' select.asmSelect', 'blue');
		await page.waitForTimeout(200);
		check('asmSelect: picking adds an item', JSON.stringify(await labels()) === '["Green","Red","Blue"]', JSON.stringify(await labels()));
		// drag Blue (last) above Green (first) by its handle
		const handle = page.locator(asmWrap + ' .asmListItem').nth(2).locator('.asmListItemHandle');
		const first = await page.locator(asmWrap + ' .asmListItem').nth(0).boundingBox();
		const hb = await handle.boundingBox();
		await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
		await page.mouse.down();
		await page.mouse.move(hb.x + hb.width / 2, first.y + 4, { steps: 8 });
		await page.mouse.up();
		await page.waitForTimeout(200);
		check('asmSelect: dragging reorders the list', JSON.stringify(await labels()) === '["Blue","Green","Red"]', JSON.stringify(await labels()));
		check('asmSelect: the original select follows the order', JSON.stringify(await posted()) === '["blue","green","red"]', JSON.stringify(await posted()));
		await page.locator(asmWrap + ' .asmListItem').nth(1).locator('.asmListItemRemove').click();
		await page.waitForTimeout(200);
		check('asmSelect: remove drops the item and its value', JSON.stringify(await labels()) === '["Blue","Red"]' && JSON.stringify(await posted()) === '["blue","red"]', JSON.stringify(await posted()));
		check('asmSelect: change tracking sees it', await hasClass('lab_asm', 'InputfieldStateChanged'));
	} else {
		check('asmSelect: widget present', false);
	}
	// Page field with asmSelect (milestone 2.4)
	const pageWrap = '#wrap_Inputfield_lab_pages';
	if(await page.locator(pageWrap + ' select.asmSelect').count()) {
		const value = await page.$eval(pageWrap + ' select.asmSelect', s => { const o = Array.from(s.options).find(x => x.value && !x.disabled); return o ? o.value : ''; });
		await page.selectOption(pageWrap + ' select.asmSelect', value);
		await page.waitForTimeout(200);
		check('page field: picking a page adds it', await page.locator(pageWrap + ' .asmListItem').count() === 1 &&
			(await page.$eval('#Inputfield_lab_pages', s => Array.from(s.selectedOptions).map(o => o.value))).indexOf(value) > -1);
	} else {
		check('page field: widget present', false);
	}

	// PageAutocomplete (milestone 2.4): type, pick a suggestion, the value input follows; remove
	const autoInput = page.locator('#Inputfield_lab_auto_input');
	if(await autoInput.count()) {
		const term = process.env.AUTO_TERM || 'Ус';
		await autoInput.click();
		await autoInput.pressSequentially(term, { delay: 60 });
		const option = page.locator('ul.ui-autocomplete a.ui-menu-item-wrapper').first();
		await option.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
		const shown = await option.isVisible();
		check('autocomplete: suggestions appear', shown, term);
		if(shown) {
			await option.click();
			await page.waitForTimeout(300);
			const items = await page.$$eval('#Inputfield_lab_auto_items > li:not(.itemTemplate)', lis => lis.length);
			const value = await page.inputValue('#Inputfield_lab_auto');
			check('autocomplete: picking adds the page', items === 1 && /^\d+$/.test(value), items + ' / ' + value);
			await page.locator('#Inputfield_lab_auto_items > li:not(.itemTemplate) a.itemRemove').first().click();
			await page.waitForTimeout(200);
			check('autocomplete: remove clears the value', await page.inputValue('#Inputfield_lab_auto') === '');
		}
	} else {
		check('autocomplete: widget present', false);
	}

	// PageListSelect (milestone 2.4): Change opens the tree, a title opens its item, Select picks it
	const treeWrap = '#wrap_Inputfield_lab_tree';
	if(await page.locator(treeWrap + ' .PageListSelectActionToggle').count()) {
		await page.click(treeWrap + ' .PageListSelectActionToggle');
		const firstChild = page.locator(treeWrap + ' .PageListRoot > .PageList > .PageList > .PageListItem > a.PageListPage').first();
		await firstChild.waitFor({ timeout: 5000 }).catch(() => {});
		check('page list select: Change opens the tree under the open root', await firstChild.isVisible() &&
			await page.locator(treeWrap + ' .PageListRoot > .PageList > .PageListItem.PageListItemOpen').count() === 1);
		const title = (await firstChild.textContent()).trim();
		await firstChild.click();
		const select = page.locator(treeWrap + ' .PageListRoot > .PageList > .PageList > .PageListItem.PageListItemOpen .PageListActionSelect > a').first();
		await select.waitFor({ timeout: 3000 }).catch(() => {});
		await select.click();
		await page.waitForTimeout(300);
		const value = await page.inputValue('#Inputfield_lab_tree');
		const shown = (await page.textContent(treeWrap + ' .PageListSelectName')).trim();
		check('page list select: Select sets the value and the header', /^\d+$/.test(value) && shown === title, value + ' / ' + shown);
		check('page list select: the tree closes', await page.locator(treeWrap + ' .PageListRoot > .PageList').count() === 0);
	} else {
		check('page list select: widget present', false);
	}
	const treesWrap = '#wrap_Inputfield_lab_trees';
	if(await page.locator(treesWrap + ' .PageListSelectActionToggle').count()) {
		await page.click(treesWrap + ' .PageListSelectActionToggle');
		const child = page.locator(treesWrap + ' .PageListRoot > .PageList > .PageList > .PageListItem > a.PageListPage').first();
		await child.waitFor({ timeout: 5000 }).catch(() => {});
		await child.click();
		const sel = page.locator(treesWrap + ' .PageListItemOpen .PageListActionSelect > a').last();
		await sel.waitFor({ timeout: 3000 }).catch(() => {});
		await sel.click();
		await page.waitForTimeout(300);
		const rows = await page.$$eval('#Inputfield_lab_trees_items > li:not(.itemTemplate)', l => l.length);
		check('page list select multiple: Select adds a row and marks it Selected', rows === 1 && /^\d+$/.test(await page.inputValue('#Inputfield_lab_trees')) &&
			await sel.evaluate(a => a.classList.contains('ui-state-disabled')));
		await page.locator('#Inputfield_lab_trees_items > li:not(.itemTemplate) a.itemRemove').first().click();
		await page.waitForTimeout(200);
		check('page list select multiple: remove clears it', await page.inputValue('#Inputfield_lab_trees') === '' && !(await sel.evaluate(a => a.classList.contains('ui-state-disabled'))));
	} else {
		check('page list select multiple: widget present', false);
	}

	// Datetime (milestone 2.4): picker on focus with time, button picker, inline calendar, selects
	if(await page.locator('#Inputfield_lab_date').count()) {
		await page.click('#Inputfield_lab_date');
		const popup = page.locator('div.ui-datepicker:not(.ui-datepicker-inline):visible');
		await popup.first().waitFor({ timeout: 3000 }).catch(() => {});
		check('datetime: focus opens the calendar', await popup.count() === 1);
		if(await popup.count()) {
			await popup.locator('td[data-date] a', { hasText: /^15$/ }).first().click();
			await popup.locator('select.ui-timepicker-hour').selectOption('14');
			await page.waitForTimeout(200);
			const v = await page.inputValue('#Inputfield_lab_date');
			check('datetime: day and time make the value (Y-m-d H:i)', /^\d{4}-\d{2}-15 14:00$/.test(v), v);
		}
		await page.click('#wrap_Inputfield_lab_date_button a.pw-ui-datepicker-trigger');
		await page.locator('div.ui-datepicker:not(.ui-datepicker-inline):visible td[data-date] a', { hasText: /^3$/ }).first().click();
		await page.waitForTimeout(200);
		const vb = await page.inputValue('#Inputfield_lab_date_button');
		check('datetime: button picker sets d.m.Y and closes', /^03\.\d{2}\.\d{4}$/.test(vb) && await popup.count() === 0, vb);
		await page.locator('#wrap_Inputfield_lab_date_inline div.ui-datepicker-inline td[data-date] a', { hasText: /^9$/ }).first().click();
		await page.waitForTimeout(200);
		const vi = await page.inputValue('#Inputfield_lab_date_inline');
		check('datetime: inline calendar sets the value', /^\d{4}-\d{2}-09$/.test(vi), vi);
		const sel = '#wrap_Inputfield_lab_date_select';
		if(await page.locator(sel + ' select.InputfieldDatetimeMonth').count()) {
			await page.selectOption(sel + ' select.InputfieldDatetimeYear', { index: 2 });
			await page.selectOption(sel + ' select.InputfieldDatetimeMonth', '2');
			await page.selectOption(sel + ' select.InputfieldDatetimeDay', '30');
			await page.waitForTimeout(200);
			check('datetime selects: 30 February is rejected', await page.$eval(sel + ' select.InputfieldDatetimeDay', s => s.value === '' && s.classList.contains('InputfieldDatetimeError')) &&
				await page.$eval(sel + ' input.InputfieldDatetimeValue', i => i.value === ''));
			await page.selectOption(sel + ' select.InputfieldDatetimeDay', '28');
			await page.waitForTimeout(200);
			check('datetime selects: a valid date fills the value', /^\d{4}-2-28$/.test(await page.$eval(sel + ' input.InputfieldDatetimeValue', i => i.value)));
		} else {
			check('datetime selects: present', false);
		}
	} else {
		check('datetime: field present', false);
	}

	// TextTags (milestone 2.4): pick a listed tag, add a new one, Backspace removes the last
	const tagsW = '#wrap_Inputfield_lab_tags';
	if(await page.locator(tagsW + ' .selectize-input').count()) {
		const tagValue = () => page.$eval('#Inputfield_lab_tags', el => el.tagName === 'SELECT' ? Array.from(el.selectedOptions).map(o => o.value).join(' ') : el.value);
		await page.click(tagsW + ' .selectize-input');
		await page.keyboard.type('ga');
		await page.waitForTimeout(200);
		check('tags: typing lists the matching tag', await page.locator(tagsW + ' .selectize-dropdown .option.active').textContent().catch(() => '') === 'gamma');
		await page.keyboard.press('Enter');
		await page.keyboard.type('omega');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(150);
		check('tags: pick and add make the value', await tagValue() === 'gamma omega', await tagValue());
		await page.keyboard.press('Backspace');
		check('tags: Backspace removes the last tag', await tagValue() === 'gamma', await tagValue());
		await page.click('#wrap_Inputfield_lab_tag .selectize-input');
		await page.keyboard.type('be'); await page.waitForTimeout(150); await page.keyboard.press('Enter');
		await page.click('#wrap_Inputfield_lab_tag .selectize-input');
		await page.keyboard.type('al'); await page.waitForTimeout(150); await page.keyboard.press('Enter');
		check('tags: a single tag field replaces its tag', await page.$eval('#Inputfield_lab_tag', el => el.value) === 'alpha');
	} else {
		check('tags: widget present', false);
	}

	// Selector (milestone 2.4): add a row, pick a field (operators load over AJAX), type a value
	const selW = '#wrap_Inputfield_lab_selector';
	if(await page.locator(selW + ' .selector-add').count()) {
		await page.click(selW + ' .selector-add');
		const row = page.locator(selW + ' .selector-row:not(.selector-template-row)').first();
		await row.locator('select.select-field').selectOption('title');
		await row.locator('.opval .select-operator').waitFor({ timeout: 5000 }).catch(() => {});
		check('selector: a field loads its operators', await row.locator('.opval .select-operator option').count() > 1);
		await row.locator('.opval .select-operator').selectOption('%=');
		await row.locator('.opval .input-value').fill('ab');
		await row.locator('.opval .input-value').press('Tab');
		await page.waitForTimeout(800);
		const sv = await page.inputValue('#Inputfield_lab_selector');
		check('selector: the value is built and previewed', sv === 'title%=ab' && (await page.textContent(selW + ' .selector-preview')).trim() === 'title%=ab', sv);
	} else {
		check('selector: widget present', false);
	}

	// language tabs (milestone 2.4), where the sandbox has more than one language
	const langLinks = page.locator('#wrap_Inputfield_lab_multilang a.langTabLink');
	if(await langLinks.count() >= 2) {
		const current = () => page.$$eval('#wrap_Inputfield_lab_multilang .LanguageSupport', ps => ps.map(p => p.classList.contains('LanguageSupportCurrent')));
		const first = await current();
		check('langtabs: first language open at start', first[0] && first.filter(Boolean).length === 1, JSON.stringify(first));
		await langLinks.nth(1).click();
		await page.waitForTimeout(200);
		const second = await current();
		check('langtabs: a tab click opens its language', second[1] && second.filter(Boolean).length === 1, JSON.stringify(second));
		const allToggle = page.locator('#wrap_Inputfield_lab_multilang .langTabsToggle');
		if(await allToggle.count()) {
			await allToggle.click();
			await page.waitForTimeout(200);
			const all = await current();
			check('langtabs: the header toggle shows every language', all.every(Boolean) && await hasClass('lab_multilang', 'InputfieldStateCollapsed') === false, JSON.stringify(all));
			await allToggle.click();
			await page.waitForTimeout(200);
		} else {
			check('langtabs: header toggle present', false);
		}
	} else {
		console.log('(no language tabs: the sandbox has one language)');
	}

	// Text counter
	await page.locator('#Inputfield_lab_count').pressSequentially('hello');
	await page.waitForTimeout(200);
	const counter = await li('lab_count').innerText();
	check('counter: shows 5 characters', /\b5\b/.test(counter), counter.replace(/\s+/g, ' '));

	// change tracking
	check('change tracking: untouched field not marked', !(await hasClass('lab_textarea', 'InputfieldStateChanged')));
	await page.fill('#Inputfield_lab_textarea', 'changed');
	await page.waitForTimeout(200);
	check('change tracking: edited field marked', await hasClass('lab_textarea', 'InputfieldStateChanged'));

	// Enter guard: two submit buttons, Enter in a text field does not submit
	// the form must be valid, so that only the guard can stop the submit (an invalid required field
	// would also stop it, and move the focus to itself)
	await page.fill('#Inputfield_lab_text', 'value');
	await page.evaluate(() => { document.querySelector('#Inputfield_lab_inner').value = 'value'; window.__labMark = 1; });
	await page.focus('#Inputfield_lab_email');
	await page.keyboard.press('Enter');
	await page.waitForTimeout(800);
	const stayed = await page.evaluate(() => window.__labMark === 1).catch(() => false);
	check('Enter guard: Enter in a field does not submit', stayed);
	if(stayed) {
		const focused = await page.evaluate(() => document.activeElement && document.activeElement.type);
		check('Enter guard: focus moves to a submit button', focused === 'submit', focused);
	}

	// invalid field inside a collapsed fieldset opens on submit
	await open();
	await page.fill('#Inputfield_lab_text', 'value');
	await page.evaluate(() => { window.__labMark = 2; });
	await page.click('#Inputfield_submit_lab');
	await page.waitForTimeout(800);
	const notSubmitted = await page.evaluate(() => window.__labMark === 2).catch(() => false);
	check('invalid-open: form not submitted with an empty required field', notSubmitted);
	if(notSubmitted) {
		check('invalid-open: collapsed fieldset opened', !(await hasClass('lab_fieldset', 'InputfieldStateCollapsed')) && await visible('#Inputfield_lab_inner'));
	}

	// leave warning: changed form, leaving asks (beforeunload)
	await open();
	await page.locator('#Inputfield_lab_textarea').pressSequentially('unsaved');
	await page.waitForTimeout(200);
	let asked = false;
	const onDialog = async (d) => { if(d.type() === 'beforeunload') asked = true; await d.dismiss(); };
	page.on('dialog', onDialog);
	await page.close({ runBeforeUnload: true });
	await new Promise(r => setTimeout(r, 1000));
	check('leave warning: asks before leaving a changed form', asked);
	const page2 = await ctx.newPage();
	page2.on('pageerror', e => errors.push(e.message));
	await page2.goto(LAB, { waitUntil: 'networkidle' });

	// dropdown + save round trip
	await page2.fill('#Inputfield_lab_text', 'round trip');
	await page2.fill('#Inputfield_lab_integer', '7');
	await page2.check('#Inputfield_lab_checkbox');
	await page2.check('#Inputfield_lab_radios_b');
	await page2.waitForTimeout(300);
	await page2.fill('#Inputfield_lab_detail', 'detail value');
	await page2.selectOption('#Inputfield_lab_select', 'c');
	const toggle2 = page2.locator('#wrap_Inputfield_lab_toggle .InputfieldToggleGroup label').first();
	if(await toggle2.count()) await toggle2.click();
	if(await page2.locator('#wrap_Inputfield_lab_asm select.asmSelect').count()) await page2.selectOption('#wrap_Inputfield_lab_asm select.asmSelect', 'cyan');
	await page2.fill('#Inputfield_lab_date', '2026-10-15 14:00');
	if(await page2.locator('#wrap_Inputfield_lab_tags .selectize-input').count()) {
		await page2.click('#wrap_Inputfield_lab_tags .selectize-input');
		await page2.keyboard.type('be'); await page2.waitForTimeout(150); await page2.keyboard.press('Enter');
		await page2.keyboard.press('Escape');
	}
	const boxes2 = page2.locator('#wrap_Inputfield_lab_checkboxes input[type=checkbox]');
	if(await boxes2.count() >= 2) { await boxes2.nth(0).check(); await boxes2.nth(1).check(); }
	await page2.click('#Inputfield_lab_fieldset > .InputfieldHeader');
	await page2.waitForTimeout(300);
	await page2.fill('#Inputfield_lab_inner', 'inner value');
	const toggle = page2.locator('#pw-dropdown-toggle-Inputfield_submit_lab');
	check('dropdown: toggle present', await toggle.count() === 1);
	let leaveAsked = false;
	page2.on('dialog', async (d) => { if(d.type() === 'beforeunload') leaveAsked = true; await d.accept(); });
	if(await toggle.count()) {
		await toggle.click();
		await page2.waitForTimeout(300);
		const item = page2.locator('a[data-pw-dropdown-value="done"]').first();
		check('dropdown: menu opens', await item.isVisible());
		await Promise.all([page2.waitForNavigation({ timeout: 10000 }).catch(() => {}), item.click()]);
	} else {
		await Promise.all([page2.waitForNavigation({ timeout: 10000 }).catch(() => {}), page2.click('#Inputfield_submit_lab')]);
	}
	await page2.waitForLoadState('networkidle');
	const notice = await page2.locator('#notices').innerText().catch(() => '');
	check('round trip: saved with the dropdown action', /Lab saved \(done\)/.test(notice), notice.replace(/\s+/g, ' ').slice(0, 200));
	check('round trip: values posted', /lab_text=round trip/.test(notice) && /lab_integer=7/.test(notice) && /lab_checkbox=checked/.test(notice) && /lab_select=c/.test(notice) && /lab_detail=detail value/.test(notice));
	check('round trip: tags posted', /lab_tags=beta/.test(notice), notice.replace(/\s+/g, ' ').slice(0, 300));
	check('round trip: date posted', /lab_date=\d{9,}/.test(notice), notice.replace(/\s+/g, ' ').slice(0, 300));
	check('round trip: asmSelect order posted', /lab_asm=green,red,cyan/.test(notice), notice.replace(/\s+/g, ' ').slice(0, 400));
	check('round trip: toggle and checkboxes posted', /lab_toggle=1/.test(notice) && /lab_checkboxes=one,two/.test(notice), notice.replace(/\s+/g, ' ').slice(0, 300));
	check('round trip: values kept in the form', await page2.inputValue('#Inputfield_lab_text') === 'round trip' && await page2.isChecked('#Inputfield_lab_radios_b'));
	check('leave warning: not asked when saving', !leaveAsked);
	check('no page errors', errors.length === 0, errors.join(' | '));

	// legacy-404: one deferred legacy script fails to load while the stack loads late (on a native
	// page, as an AJAX legacy field or a component would start it). The stack must still finish:
	// jQuery there, ready handlers released, loading class gone, upstream's admin initialised. One
	// missing file used to leave the page stuck for the session. Own page, own error list: code
	// that needs the missing file may fail, as it would with the stack printed upstream
	const page3 = await ctx.newPage();
	consoleErrors.skip(page3);
	await page3.goto(ADMIN + 'setup/bridge-demo/', { waitUntil: 'networkidle' });
	const missing = await page3.evaluate(() => ((ProcessWire.config.AdminThemeBridge || {}).legacyScripts || [])
		.find(u => /\/wire\/modules\/(Jquery|Inputfield|Process|Language)/.test(u) && !/JqueryCore|JqueryUI\/JqueryUI\./.test(u)) || '');
	if(missing) {
		const path = missing.replace(/\?.*$/, '');
		await page3.route(u => u.pathname === path, r => r.fulfill({ status: 404, body: '' }));
		await page3.reload({ waitUntil: 'networkidle' });
		const outcome = await page3.evaluate(() => ProcessWireAdminTheme.legacy.load().then(() => 'resolved', e => 'rejected: ' + e.message));
		await page3.waitForTimeout(400);
		const state = await page3.evaluate(() => ({
			loaded: document.body.classList.contains('pw-legacy-loaded'),
			loading: document.body.classList.contains('pw-legacy-loading'),
			held: !!(window.jQuery && jQuery.fn.ready && jQuery.fn.ready.pwHeld),
			jquery: typeof window.jQuery === 'function',
			admin: typeof window.ProcessWireAdmin === 'object',
		}));
		check('legacy-404: a missing legacy script does not stop the stack', outcome === 'resolved' && state.loaded && !state.loading && !state.held && state.jquery && state.admin, outcome + ' ' + JSON.stringify(state) + ' missing ' + path);
	} else {
		check('legacy-404: a deferred core legacy script to fail found on the demo page', false, 'none');
	}
	await page3.close();

	// placeholder: an AJAX-collapsed legacy field is marked data-bridge-legacy when it renders, but
	// until it is opened nothing of it runs; inserting one (an in-place save, a repeater item,
	// Inputfields.reload) must not load the stack, its content arriving must (audit B2)
	const page4 = await ctx.newPage();
	await page4.goto(LAB, { waitUntil: 'networkidle' });
	const insert = (withPlaceholder) => page4.evaluate((ph) => {
		const list = document.querySelector('#wrap_Inputfield_lab_collapsed').parentNode;
		const li = document.createElement('li');
		li.className = 'Inputfield InputfieldMarkup InputfieldStateCollapsed';
		li.id = 'wrap_probe_' + (ph ? 'placeholder' : 'content');
		li.setAttribute('data-bridge-legacy', 'Inputfield:Probe');
		li.innerHTML = '<label class="InputfieldHeader">Probe</label><div class="InputfieldContent">' +
			(ph ? '<div class="renderInputfieldAjax"><input type="hidden" value="./?probe=1"></div>' : '<p>content</p>') + '</div>';
		list.appendChild(li);
	}, withPlaceholder);
	await insert(true);
	await page4.waitForTimeout(1200);
	const ph = await page4.evaluate(() => ({ jquery: !!window.jQuery, loading: document.body.classList.contains('pw-legacy-loading'), loaded: document.body.classList.contains('pw-legacy-loaded') }));
	check('placeholder: an inserted AJAX placeholder of a legacy field does not load the stack', !ph.jquery && !ph.loading && !ph.loaded, JSON.stringify(ph));
	await insert(false);
	const came = await page4.waitForFunction(() => document.body.classList.contains('pw-legacy-loaded'), null, { timeout: 15000 }).then(() => true, () => false);
	check('placeholder: legacy content arriving loads it', came);
	await page4.close();

	// foreign jQuery: a site module that loads its own jQuery (a CDN copy, not the deferred stack)
	// does not make upstream the owner: without inputfields.js and main.js nobody else would run
	// collapse, dropdowns and dialogs (audit B11)
	const page5 = await ctx.newPage();
	await page5.goto(LAB, { waitUntil: 'networkidle' });
	const jqUrl = await page5.evaluate(() => ((ProcessWire.config.AdminThemeBridge || {}).legacyScripts || []).find(u => /JqueryCore\//.test(u)) || '');
	if(jqUrl) {
		await page5.addScriptTag({ url: jqUrl });
		await page5.waitForFunction(() => !!window.jQuery, null, { timeout: 5000 }).catch(() => {});
		const own = await page5.evaluate(() => ({ jquery: !!window.jQuery, upstream: ProcessWireAdminTheme.upstream(), runtime: !Bridge.legacy.loaded(), passive: document.body.classList.contains('pw-runtime-passive') }));
		check('foreign-jquery: a site\'s own jQuery leaves the page native', own.jquery && !own.upstream && own.runtime && !own.passive, JSON.stringify(own));
		await page5.click('#wrap_Inputfield_lab_collapsed > .InputfieldHeader');
		await page5.waitForTimeout(400);
		check('foreign-jquery: collapse still works', await page5.evaluate(() => !document.getElementById('wrap_Inputfield_lab_collapsed').classList.contains('InputfieldStateCollapsed')));
		const toggle = page5.locator('#pw-masthead a.pw-dropdown-toggle').first();
		if(await toggle.count()) {
			await toggle.hover();
			await page5.waitForTimeout(400);
			check('foreign-jquery: masthead dropdowns still open', await page5.evaluate(() => [...document.querySelectorAll('.pw-dropdown-menu')].some(m => m.style.display === 'block')));
		}
	} else {
		check('foreign-jquery: JqueryCore URL in the deferred list', false, 'none');
	}
	await page5.close();

	await consoleErrors.settle();
	consoleErrors.check(check);
	await browser.close();
	const failed = results.filter(r => !r.ok);
	for(const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.info && !r.ok ? '  [' + r.info + ']' : ''}`);
	console.log(`\n${browserName}: ${results.length - failed.length}/${results.length} passed${GATE ? ' (gate mode)' : ''}`);
	process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

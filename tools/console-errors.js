// Console errors of every page in a Playwright context, for the check harnesses (audit B24): the
// runtime and the theme script catch their own failures and log them with console.error, which
// "no page errors" never sees. Messages matching IGNORE_ERRORS (known third-party bugs) or the
// harness's own ignore pattern are left out; the 404s a harness provokes on purpose too.
//
//   const consoleErrors = require('./console-errors')(ctx, /optional ignore/);
//   ...
//   consoleErrors.skip(page);     // a page that provokes errors on purpose
//   consoleErrors.check(check);   // adds "no console errors"
module.exports = function watchConsole(ctx, ignoreAlso) {
	const ignoreEnv = process.env.IGNORE_ERRORS ? new RegExp(process.env.IGNORE_ERRORS) : null;
	const list = [];
	const skipped = new WeakSet();
	const pending = [];
	const watch = (page) => {
		page.on('console', msg => {
			if(msg.type() !== 'error' || skipped.has(page)) return;
			const loc = msg.location ? msg.location() : null;
			let where = '';
			try { where = new URL(page.url()).pathname.replace(/^\/[^/]+\//, ''); } catch(e) {}
			const add = (text) => {
				if(ignoreEnv && ignoreEnv.test(text)) return;
				if(ignoreAlso && ignoreAlso.test(text)) return;
				list.push((where ? where + ': ' : '') + text);
			};
			const raw = msg.text();
			if(/^Failed to load resource/.test(raw)) return add(raw + (loc && loc.url ? ' ' + loc.url : ''));
			// Firefox reports an Error argument as JSHandle@object: ask the page for its text
			if(!/JSHandle@/.test(raw)) return add(raw);
			pending.push(Promise.all(msg.args().map(a => a.evaluate(v => v instanceof Error ? v.name + ': ' + v.message : String(v)).catch(() => '?')))
				.then(parts => add(parts.join(' ')), () => add(raw)));
		});
	};
	ctx.pages().forEach(watch);
	ctx.on('page', watch);
	return {
		list,
		// a page whose errors are provoked on purpose (its own list)
		skip(page) { skipped.add(page); },
		ignore(pattern) { ignoreAlso = ignoreAlso ? new RegExp(ignoreAlso.source + '|' + pattern.source) : pattern; },
		// await before check(): Firefox's error texts are read from the page
		settle() { return Promise.all(pending.splice(0)); },
		check(check) {
			const unique = Array.from(new Set(list));
			check('no console errors', unique.length === 0, unique.slice(0, 6).join(' | '));
		},
	};
};

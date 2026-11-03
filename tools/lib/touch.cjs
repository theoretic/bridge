// Touch gestures for the browser harnesses (0.26.0, touch selection): Playwright's touchscreen
// only taps, and synthetic PointerEvents cannot take pointer capture, so holds and drags go
// through Chromium's CDP Input.dispatchTouchEvent. Chromium only: `touch()` gives null in other
// engines, and their harnesses report the touch cases as skipped.
//
//   const t = await require('./lib/touch.cjs')(page, browserName); // page of a hasTouch context
//   await t.hold(sel, 500); await t.tap(sel); await t.holdMove(sel, toSel); await t.tap({ x, y });
//
// A target is a selector (the point at fx, fy of its box, scrolled into view first) or { x, y }
// in viewport pixels. Original work, MIT.
'use strict';

module.exports = async function touch(page, browserName) {
	if (browserName !== 'chromium') return null;
	const cdp = await page.context().newCDPSession(page);
	const send = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
	const wait = (ms) => page.waitForTimeout(ms);
	const at = async (target, fx = 0.5, fy = 0.5) => {
		if (typeof target !== 'string') return target;
		const el = await page.$(target);
		if (!el) throw new Error('touch: nothing at ' + target);
		await el.scrollIntoViewIfNeeded();
		const b = await el.boundingBox();
		return { x: b.x + b.width * fx, y: b.y + b.height * fy };
	};
	return {
		at,
		/** a quick tap; the click follows it, so a short wait after */
		async tap(target, fx, fy) {
			const p = await at(target, fx, fy);
			await send('touchStart', p);
			await wait(40);
			await send('touchEnd');
			await wait(350);
		},
		/** a finger held still for `ms`, then lifted */
		async hold(target, ms = 500, fx, fy) {
			const p = await at(target, fx, fy);
			await send('touchStart', p);
			await wait(ms);
			await send('touchEnd');
			await wait(350);
		},
		/** a hold of `ms`, then a move to `to` (a selector's point at tx, ty, or { x, y }) and the lift */
		async holdMove(target, to, ms = 500, o = {}) {
			const p = await at(target, o.fx, o.fy);
			await send('touchStart', p);
			await wait(ms);
			const q = await at(to, o.tx, o.ty);
			const steps = o.steps || 12;
			for (let i = 1; i <= steps; i++) {
				await send('touchMove', { x: p.x + (q.x - p.x) * i / steps, y: p.y + (q.y - p.y) * i / steps });
				await wait(16);
			}
			await wait(200);
			await send('touchEnd');
			await wait(350);
		},
		detach: () => cdp.detach().catch(() => {}),
	};
};

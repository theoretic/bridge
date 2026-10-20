/**
 * The theme script's synchronous stand-ins (scripts/main.js, audit B4): on a page without jQuery
 * window.Inputfields, window.Bridge and window.AdminDataTable exist from the start as recording
 * proxies, so inline code that runs before the runtime (the field editor's ?focus=, a table's
 * AdminDataTable.initTable()) does not throw. Whoever installs the real object replays what was
 * recorded on it, in order.
 */

export interface StubCall {
	path: string[];
	args: unknown[];
}

interface Stub {
	pwStub: true;
	pwQueue: StubCall[];
}

export function isStub(value: unknown): value is Stub {
	return typeof value === 'function' && (value as unknown as Partial<Stub>).pwStub === true;
}

/** Run the recorded calls on `real`: each path is walked from it and called with its parent as this */
export function replay(stub: unknown, real: unknown, name: string): void {
	if (!isStub(stub)) return;
	const queue = stub.pwQueue.splice(0);
	for (const call of queue) {
		let owner: unknown = null;
		let target: unknown = real;
		for (const key of call.path) {
			if (target === null || target === undefined) break;
			owner = target;
			target = (target as Record<string, unknown>)[key];
		}
		try {
			(target as (...args: unknown[]) => unknown).apply(owner, call.args);
		} catch (err) {
			// not a function on the real object, or it threw
			console.error('Bridge: replayed call failed', [name, ...call.path].join('.'), err);
		}
	}
}

/**
 * Put `real` on window[name] when nothing but a stand-in (or nothing) is there, then replay the
 * stand-in's calls; returns false when another object owns the name (upstream's, on a legacy page)
 */
export function installGlobal(name: string, real: unknown, later = false): boolean {
	const w = window as unknown as Record<string, unknown>;
	const current = w[name];
	if (typeof current !== 'undefined' && !isStub(current)) return false;
	w[name] = real;
	if (isStub(current)) {
		if (later) window.setTimeout(() => replay(current, real, name), 0);
		else replay(current, real, name);
	}
	return true;
}

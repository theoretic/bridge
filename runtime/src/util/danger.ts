/**
 * Asking before a risky action (0.15.0, ADR 0019). confirm() always asks; guard() asks only while
 * the theme's "Warn before risky actions" setting is on (ProcessWire.config.AdminThemeBridge.dangerWarn)
 * and otherwise says yes at once. The dialog (util/ask.ts) is its own chunk, loaded on first use.
 */

import type { AskOptions } from './ask';
import { pwConfig } from './pw';
import { label } from './labels';

export type { AskOptions };

export function warnOn(): boolean {
	return !!pwConfig<{ dangerWarn?: boolean }>('AdminThemeBridge').dangerWarn;
}

export function confirm(opts: AskOptions | string): Promise<boolean> {
	const o = typeof opts === 'string' ? { title: opts } : opts;
	return import('./ask').then(m => m.ask(o), () => window.confirm([o.title, o.message || ''].join(' ').trim()));
}

/** A risky action's dialog, or true straight away while the warnings are off */
export function guard(opts: AskOptions): Promise<boolean> {
	return warnOn() ? confirm({ danger: true, ...opts }) : Promise.resolve(true);
}

/** A label with each %s / %d filled in order */
export function fill(key: string, fallback: string, ...values: (string | number)[]): string {
	let n = 0;
	return label(key, fallback).replace(/%[sd]/g, m => (n < values.length ? String(values[n++]) : m));
}

/** The callback form for classic scripts, which reach it through window.Bridge's stand-in */
export function callbacks(p: Promise<boolean>, onOk?: () => void, onCancel?: () => void): Promise<boolean> {
	return p.then(ok => {
		if (ok && typeof onOk === 'function') onOk();
		else if (!ok && typeof onCancel === 'function') onCancel();
		return ok;
	});
}

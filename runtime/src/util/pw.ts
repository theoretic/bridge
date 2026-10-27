/**
 * ProcessWire.config, read the same way everywhere (audit A1)
 */

type PwWindow = { ProcessWire?: { config?: Record<string, unknown> & { urls?: { admin?: string } } } };

/** A key of ProcessWire.config, or an empty object */
export function pwConfig<T>(key: string): T {
	const pw = (window as unknown as PwWindow).ProcessWire;
	return ((pw && pw.config && pw.config[key]) || {}) as T;
}

/** The admin's root URL */
export function adminUrl(): string {
	const pw = (window as unknown as PwWindow).ProcessWire;
	return (pw && pw.config && pw.config.urls && pw.config.urls.admin) || '/processwire/';
}

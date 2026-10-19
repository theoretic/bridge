/**
 * Cookies in the format of upstream's jquery.cookie.js (JqueryCore, ProcessWire's copy): values
 * URI-encoded, objects stored as `JSON` + JSON.stringify(value), SameSite=Lax, `secure` when
 * ProcessWire.config.https is set, no path (the browser's default for the current URL). Upstream
 * scripts and the native widgets read each other's cookies (InputfieldImage's view settings).
 */

export function getCookie<T = unknown>(name: string): T | string | null {
	const parts = document.cookie ? document.cookie.split(';') : [];
	for (const part of parts) {
		const c = part.trim();
		if (c.substring(0, name.length + 1) !== name + '=') continue;
		let value: string;
		try { value = decodeURIComponent(c.substring(name.length + 1)); } catch (e) { return null; }
		if (value.indexOf('JSON{') === 0 || value.indexOf('JSON[') === 0) {
			try { return JSON.parse(value.substring(4)) as T; } catch (e) { return null; }
		}
		return value;
	}
	return null;
}

export function setCookie(name: string, value: unknown, options: { secure?: boolean } = {}): void {
	const raw = value !== null && typeof value === 'object' ? 'JSON' + JSON.stringify(value) : String(value);
	const pw = (window as unknown as { ProcessWire?: { config?: { https?: boolean } } }).ProcessWire;
	const secure = options.secure !== undefined ? options.secure : !!(pw && pw.config && pw.config.https);
	document.cookie = name + '=' + encodeURIComponent(raw) + '; SameSite=Lax' + (secure ? '; secure' : '');
}

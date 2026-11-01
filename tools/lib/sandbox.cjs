// Where the browser tools find the sandbox (audit SE4): the admin URL and the login come from the
// sandbox's .credentials (tools/sandbox-admin.php writes user:password lines, admin=<admin path>
// and base=<server URL>), or from the environment. No tool names an admin path itself: the
// sandboxes copy real sites' databases, and their admin page names are those sites' own.
//
//   SANDBOX=<sandbox root>   default sandbox/atispro of this repository
//   ADMIN=<admin URL>        overrides admin= and base= (http://localhost:8090/admin/)
//   BASE=<server URL>        overrides base= (default http://localhost:8089)
//   PROBE_PASS=<password>    overrides the user's password from .credentials
//
// Original work, MIT.
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');

/** The sandbox root, its users, admin path and server URL */
function info() {
	const root = (process.env.SANDBOX || path.join(REPO, 'sandbox', 'atispro')).replace(/\\/g, '/');
	const users = {};
	let admin = '';
	let base = '';
	const file = path.join(root, '.credentials');
	if (fs.existsSync(file)) {
		for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
			if (!line || line[0] === '#') continue;
			if (line.startsWith('admin=')) admin = line.slice(6).trim();
			else if (line.startsWith('base=')) base = line.slice(5).trim();
			else {
				const m = /^([a-z0-9_-]+):(.+)$/i.exec(line);
				if (m) users[m[1]] = m[2];
			}
		}
	}
	base = (process.env.BASE || base || 'http://localhost:8089').replace(/\/+$/, '');
	return { root, users, admin, base };
}

/**
 * The admin URL with a trailing slash: an explicit value (a tool's argument), ADMIN, or base +
 * admin= from .credentials. Exits with a usage line when none is known.
 * @param {string} [explicit]
 * @returns {string}
 */
function adminUrl(explicit) {
	let url = explicit || process.env.ADMIN || '';
	if (!url) {
		const i = info();
		if (i.admin) url = i.base + i.admin;
	}
	if (!url) {
		console.error('No admin URL: set ADMIN=<admin URL>, or SANDBOX=<sandbox root> whose .credentials has admin= (rerun tools/sandbox-admin.php)');
		process.exit(2);
	}
	return url.replace(/\/*$/, '/');
}

/** The server URL (scheme, host, port), from the admin URL */
function baseUrl() {
	return new URL(adminUrl()).origin;
}

/**
 * A sandbox user's password: PROBE_PASS, else .credentials
 * @param {string} [user]
 * @returns {string}
 */
function password(user) {
	return process.env.PROBE_PASS || info().users[user || 'bridge'] || '';
}

module.exports = { REPO, info, adminUrl, baseUrl, password };

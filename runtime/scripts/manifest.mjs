/**
 * After the other build steps: assets/dist/manifest.php, what _head.php and the module read on
 * every admin request instead of reading and scanning the built files themselves (audit PP2):
 *
 * - runtimeChunks: the chunks runtime.js imports statically (modulepreload links);
 * - fontPreloads: per Font Awesome version, the solid subset's hashed file name (font preload);
 * - uikitCovered: the UIkit classes theme.css covers (scanUikitMarkup()).
 *
 * A PHP file, so opcache keeps it; the readers fall back to the files when it is missing (a
 * `vite build` alone does not write it).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const theme = fileURLToPath(new URL('../../modules/AdminThemeBridge/', import.meta.url));
const dist = theme + 'assets/dist/';

const runtime = readFileSync(dist + 'runtime.js', 'utf8');
const runtimeChunks = [...new Set([...runtime.matchAll(/from\s*["']\.\/(chunks\/[\w.-]+\.js)["']/g)].map(m => m[1]))];

const fontPreloads = {};
for (const dir of readdirSync(theme + 'assets/fonts').filter(d => /^fa-\d/.test(d))) {
	const css = theme + `assets/fonts/${dir}/fa.css`;
	if (!existsSync(css)) continue;
	const m = readFileSync(css, 'utf8').match(/url\((fa-solid-900-subset(?:\.[0-9a-f]+)?\.woff2)\)/);
	if (m) fontPreloads[dir.slice(3)] = `assets/fonts/${dir}/${m[1]}`;
}

const coveredFile = dist + 'uikit-covered.json';
const uikitCovered = existsSync(coveredFile) ? JSON.parse(readFileSync(coveredFile, 'utf8')) : [];

const php = (value, indent = '') => {
	if (Array.isArray(value)) return 'array(' + value.map(v => php(v)).join(', ') + ')';
	if (value && typeof value === 'object') {
		return 'array(\n' + Object.entries(value).map(([k, v]) => `${indent}\t${php(k)} => ${php(v, indent + '\t')},`).join('\n') + `\n${indent})`;
	}
	return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
};

writeFileSync(dist + 'manifest.php', '<?php\n// built by runtime/scripts/manifest.mjs; read by AdminThemeBridge::manifest()\nreturn ' +
	php({ runtimeChunks, fontPreloads, uikitCovered }) + ';\n');
console.log(`manifest.php: ${runtimeChunks.length} runtime chunk(s), ${Object.keys(fontPreloads).length} font preload(s), ${uikitCovered.length} UIkit classes`);

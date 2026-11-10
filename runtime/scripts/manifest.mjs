/**
 * After the other build steps: assets/dist/manifest.php, what _head.php and the module read on
 * every admin request instead of reading and scanning the built files themselves (audit PP2):
 *
 * - runtimeChunks: the chunks runtime.js imports statically (modulepreload links);
 * - fontPreloads: per Font Awesome version, the solid subset's hashed file name (font preload);
 * - uikitCovered, uikitIcons: the UIkit classes and uk-icon names theme.css covers
 *   (scanUikitMarkup()); uikitCovered stays a flat class list.
 *
 * A PHP file, so opcache keeps it; the readers fall back to the files when it is missing (a
 * `vite build` alone does not write it).
 *
 * Also assets/dist/extension-surface.json: the static part of AdminThemeBridge::extensionSurface()
 * (lib/AdminThemeBridgeExtensions.php; `slots` from slotTags()) and the module's extensionContract,
 * and extensionContracts, read from the PHP source. tools/extension-compat.php reads a Bridge checkout's surface from it
 * without booting; a smoke line compares it with the booted method's output.
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
const covered = existsSync(coveredFile) ? JSON.parse(readFileSync(coveredFile, 'utf8')) : {};
const uikitCovered = Array.isArray(covered) ? covered : covered.classes || [];
const uikitIcons = Array.isArray(covered) ? [] : covered.icons || [];

const php = (value, indent = '') => {
	if (Array.isArray(value)) return 'array(' + value.map(v => php(v)).join(', ') + ')';
	if (value && typeof value === 'object') {
		return 'array(\n' + Object.entries(value).map(([k, v]) => `${indent}\t${php(k)} => ${php(v, indent + '\t')},`).join('\n') + `\n${indent})`;
	}
	return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
};

writeFileSync(dist + 'manifest.php', '<?php\n// built by runtime/scripts/manifest.mjs; read by AdminThemeBridge::manifest()\nreturn ' +
	php({ runtimeChunks, fontPreloads, uikitCovered, uikitIcons }) + ';\n');
console.log(`manifest.php: ${runtimeChunks.length} runtime chunk(s), ${Object.keys(fontPreloads).length} font preload(s), ${uikitCovered.length} UIkit classes, ${uikitIcons.length} icons`);

// extension-surface.json (tools/extension-compat.php, docs/extensions.md 8)
const extSrc = readFileSync(theme + 'lib/AdminThemeBridgeExtensions.php', 'utf8');
const body = (name) => {
	const start = extSrc.indexOf(`function ${name}() {`);
	if (start < 0) throw new Error(`extension-surface.json: no ${name}() in AdminThemeBridgeExtensions.php`);
	return extSrc.slice(start, extSrc.indexOf('\n\t}\n', start)).replace(/\/\/[^\n]*/g, '');
};
const moduleSrc = readFileSync(theme + 'AdminThemeBridge.module.php', 'utf8');
const contractMatch = moduleSrc.match(/const extensionContract = '([^']+)';/);
if (!contractMatch) throw new Error('extension-surface.json: no extensionContract in AdminThemeBridge.module.php');
const contractsMatch = moduleSrc.match(/const extensionContracts = array\(([^)]*)\);/);
if (!contractsMatch) throw new Error('extension-surface.json: no extensionContracts in AdminThemeBridge.module.php');
// in the order of ___extensionSurface(): a smoke line compares the two with ===
const surface = { contract: contractMatch[1], contracts: [...contractsMatch[1].matchAll(/'([^']*)'/g)].map(s => s[1]) };
const surfaceBody = body('___extensionSurface');
if (!/'slots' => array_keys\(\$this->slotTags\(\)\)/.test(surfaceBody)) throw new Error("extension-surface.json: 'slots' is no longer the keys of slotTags()");
for (const key of ['hooks', 'reads', 'settings', 'slots', 'tokens', 'events', 'runtime']) {
	if (key === 'slots') {
		surface.slots = [...body('slotTags').matchAll(/'([\w-]+)' =>/g)].map(m => m[1]);
		continue;
	}
	const m = surfaceBody.match(new RegExp(`'${key}' => array\\(([^)]*)\\)`));
	if (!m) throw new Error(`extension-surface.json: no '${key}' list in ___extensionSurface()`);
	surface[key] = [...m[1].matchAll(/'([^']*)'/g)].map(s => s[1]);
}
writeFileSync(dist + 'extension-surface.json', JSON.stringify(surface, null, '\t') + '\n');
console.log(`extension-surface.json: contract ${surface.contract}, ${surface.hooks.length} hooks, ${surface.reads.length} reads, ${surface.slots.length} slots`);

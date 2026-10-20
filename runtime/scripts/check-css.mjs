/**
 * Post-build check for the theme assets: flat CSS (no nesting or @import left), font URLs
 * untouched, and each file's gzip size against its budget (the stylesheets, the runtime script and
 * the classic scripts, scripts/build-classic.mjs). Exit 1 on a hard failure.
 */
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const FILES = [
	// ~8 kB theme, ~1.5 kB Uikit utility compat, ~1 kB Uikit structural parity, Geist @font-face (ADR 0011);
	// raised from 12 to 15 kB by the owner on 2026-10-15
	{ name: 'theme.css', budget: 15 * 1024 },
	// field module recolouring: selectize, images, rich-text editors, JSON editor, third-party (ADR 0014)
	{ name: 'fields.css', budget: 6 * 1024 },
	// the component runtime: Inputfield behaviours without jQuery grow here in Phase 2 (ADR 0015);
	// with the widgets split off, the entry is a stub re-exporting a shared chunk: the runtime is
	// the entry plus every chunk it imports statically
	{ name: 'runtime.js', budget: 12 * 1024, with: [] },
];

const dist = fileURLToPath(new URL('../../modules/AdminThemeBridge/assets/dist/', import.meta.url));
const runtimeImports = [...readFileSync(dist + 'runtime.js', 'utf8').matchAll(/from\s*["']\.\/(chunks\/[^"']+)["']/g)].map(m => m[1]);
FILES[2].with = runtimeImports;

// field widgets (runtime/src/fields/): each its own chunk, loaded only where its field is
const chunkDir = dist + 'chunks/';
if (existsSync(chunkDir)) {
	for (const f of readdirSync(chunkDir).filter(f => f.endsWith('.js'))) {
		if (runtimeImports.includes('chunks/' + f)) continue;
		FILES.push({ name: 'chunks/' + f, budget: 8 * 1024 });
	}
}

let failed = false;
for (const { name, budget, with: parts = [] } of FILES) {
	const file = dist + name;
	const css = readFileSync(file, 'utf8');
	let raw = statSync(file).size;
	let gz = gzipSync(css, { level: 9 }).length;
	for (const part of parts) {
		raw += statSync(dist + part).size;
		gz += gzipSync(readFileSync(dist + part, 'utf8'), { level: 9 }).length;
	}
	const isCss = name.endsWith('.css');
	const nesting = isCss ? (css.match(/[{;}]\s*&/g) || []).length : 0;
	if (nesting) { console.error(`${name}: ${nesting} nested '&' selector(s) survived the build`); failed = true; }
	if (isCss && /@import/.test(css)) { console.error(`${name}: an @import survived the build`); failed = true; }
	const fonts = (css.match(/url\(\.\.\/fonts\//g) || []).length;
	console.log(`${name}${parts.length ? ' + ' + parts.join(' + ') : ''}: ${raw} B raw, ${gz} B gzip (budget ${budget})` + (fonts ? `, ${fonts} font url(s)` : ''));
	if (gz > budget) { console.error(`${name}: over the gzip budget`); failed = true; }
}

// the classic scripts (scripts/build-classic.mjs): minified, each with a budget about 15 % over
// its size at 0.9.0, and all of them together; printed in <head>, so they hold up the first paint
const scriptsDir = fileURLToPath(new URL('../../modules/AdminThemeBridge/scripts/', import.meta.url));
const CLASSIC = {
	'main.js': 11.5, 'setup.js': 7, 'image-select.js': 6, 'lister.js': 4.5, 'page-save.js': 3.75,
	'screens.js': 3.25, 'link.js': 3, 'wire-tabs.js': 2, 'page-edit.js': 1.75,
};
let classicTotal = 0;
for (const f of existsSync(scriptsDir) ? readdirSync(scriptsDir).filter(f => f.endsWith('.js')).sort() : []) {
	const js = readFileSync(scriptsDir + f, 'utf8');
	const gz = gzipSync(js, { level: 9 }).length;
	classicTotal += gz;
	const budget = (CLASSIC[f] || 2) * 1024;
	const minified = js.split('\n').length <= 3;
	console.log(`scripts/${f}: ${js.length} B raw, ${gz} B gzip (budget ${budget})` + (minified ? '' : ', NOT MINIFIED'));
	if (!minified) { console.error(`scripts/${f}: not built (run scripts/build-classic.mjs)`); failed = true; }
	if (gz > budget) { console.error(`scripts/${f}: over the gzip budget`); failed = true; }
}
console.log(`classic scripts: ${classicTotal} B gzip (budget ${40 * 1024})`);
if (classicTotal > 40 * 1024) { console.error('classic scripts: over the total gzip budget'); failed = true; }

// Font Awesome (scripts/fa-subset.mjs): fa.css replaces core's all.min.css (21 kB gzip) and adds
// explicit ranges; the subsets are what a screen in common use fetches
const fontsDir = fileURLToPath(new URL('../../modules/AdminThemeBridge/assets/fonts/', import.meta.url));
for (const dir of existsSync(fontsDir) ? readdirSync(fontsDir).filter(d => /^fa-\d/.test(d)) : []) {
	const css = readFileSync(fontsDir + dir + '/fa.css', 'utf8');
	const gz = gzipSync(css, { level: 9 }).length;
	const subsets = readdirSync(fontsDir + dir).filter(f => /-subset(\.[0-9a-f]+)?\.woff2$/.test(f));
	const bytes = subsets.reduce((a, f) => a + statSync(fontsDir + dir + '/' + f).size, 0);
	console.log(`${dir}/fa.css: ${gz} B gzip (budget ${28 * 1024}); ${subsets.length} subsets: ${bytes} B (budget ${48 * 1024})`);
	if (gz > 28 * 1024) { console.error(`${dir}/fa.css: over the gzip budget`); failed = true; }
	if (bytes > 48 * 1024) { console.error(`${dir}: subsets over budget, check runtime/fa-icons.txt and the scan`); failed = true; }
}
process.exit(failed ? 1 : 0);

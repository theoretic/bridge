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
	// raised from 12 to 15 kB by the owner on 2026-10-15; 15.75 kB for the stacking scale and the
	// control edges (0.20.1, audit UX5); 16 kB for the colour picker in the user menu (0.22.0); 16.25 kB for
	// text links, code blocks, the scale in percent and the sticky tree pager (0.23.0, user requests); 16.75 kB
	// for the page tree and history drawers (0.25.0, user request); 17 kB for compat classes for AdminPageTool,
	// AdminPageDealers, PageTableNext, AgentTools (0.26.0: pager, button group, table and list modifiers)
	{ name: 'theme.css', budget: 17 * 1024 },
	// field module recolouring: selectize, images, rich-text editors, JSON editor, third-party (ADR 0014)
	{ name: 'fields.css', budget: 6 * 1024 },
	// the component runtime: Inputfield behaviours without jQuery grow here in Phase 2 (ADR 0015);
	// with the widgets split off, the entry is a stub re-exporting a shared chunk: the runtime is
	// the entry plus every chunk it imports statically; raised from 12 kB to 14000 B by the owner on
	// 2026-10-26, to 14336 B on 2026-11-01 for the CSP nonce rule in the script runner (ADR 0020, audit SE2),
	// to 14848 B the same day for the Trusted Types sweep (every HTML write through util/trusted.ts),
	// to 15360 B for keyboard and screen reader support (0.20.x, audit UX1-UX4: dialog focus and
	// unsaved changes, tab roles and arrow keys, keyboard moves and selections), to 15872 B for
	// Bridge.pageTree(), the page tree drawer's tree (0.25.0)
	{ name: 'runtime.js', budget: 15872, with: [] },
	// the UIkit layer (ADR 0017): stock UIkit minus Base, on tokens; only on pages that need UIkit
	{ name: 'uikit.css', budget: 40 * 1024 },
];

const dist = fileURLToPath(new URL('../../modules/AdminThemeBridge/assets/dist/', import.meta.url));
const runtimeImports = [...readFileSync(dist + 'runtime.js', 'utf8').matchAll(/from\s*["']\.\/(chunks\/[^"']+)["']/g)].map(m => m[1]);
FILES[2].with = runtimeImports;

// field widgets (runtime/src/fields/): each its own chunk, loaded only where its field is
const chunkDir = dist + 'chunks/';
if (existsSync(chunkDir)) {
	for (const f of readdirSync(chunkDir).filter(f => f.endsWith('.js'))) {
		if (runtimeImports.includes('chunks/' + f)) continue;
		// the previous build's runtime chunk, kept one release (prune-chunks.mjs): checked as part of
		// runtime.js when it was current, not a widget
		if (f.startsWith('index-')) continue;
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

// tokens (00-tokens.css, audit C39): derived values declared where a scheme or variant can be
// set, and no var() of a token nobody defines (set at runtime by the theme script: listed)
{
	const theme = readFileSync(dist + 'theme.css', 'utf8');
	const fieldsCss = readFileSync(dist + 'fields.css', 'utf8');
	if (!/:root,\s*\[data-pw-scheme\],\s*\[data-pw-variant\]\s*\{/.test(theme)) {
		console.error('theme.css: derived tokens are not declared on :root, [data-pw-scheme], [data-pw-variant]');
		failed = true;
	}
	const runtimeSet = new Set(['--pw-range-fill', '--pw-branch-max', '--pw-flyout-max', '--pw-primary']);
	const all = theme + fieldsCss;
	const defined = new Set([...all.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
	const undefinedUses = [...new Set([...all.matchAll(/var\((--[\w-]+)\s*\)/g)].map(m => m[1]))]
		.filter(t => !defined.has(t) && !runtimeSet.has(t) && !t.startsWith('--fa-'));
	console.log(`tokens: ${defined.size} declared, ${undefinedUses.length} used without a declaration or fallback`);
	if (undefinedUses.length) { console.error('undefined tokens: ' + undefinedUses.join(', ')); failed = true; }
}

// the classic scripts (scripts/build-classic.mjs): minified, each with a budget about 15 % over
// its size at 0.9.0, and all of them together; printed in <head>, so they hold up the first paint.
// debug-tools.js is not in the total: _footer.php prints it, and only for superusers in debug mode
const scriptsDir = fileURLToPath(new URL('../../modules/AdminThemeBridge/scripts/', import.meta.url));
// main.js 11.5 and the total 42.25 kB until 2026-11-01: the CSP nonce rule (ADR 0020, audit SE2); the total
// 43.5 and page-save.js 4 kB since the Trusted Types sweep the same day (0.18.4); main.js 12.5 and the
// total 45 kB for keyboard and screen reader support (0.20.x, audit UX1-UX3: the drawer, tab roles,
// reduced motion); main.js 13 kB for the tab-focus bus (pw-tab-focus, 0.25.0); drawers.js 2.5 kB (from
// the 2 kB default) for the history's Clear button, its retry and the kept focus (0.26.0)
const CLASSIC = {
	'main.js': 13, 'setup.js': 7, 'image-select.js': 6, 'lister.js': 4.5, 'page-save.js': 4,
	'screens.js': 3.25, 'link.js': 3, 'wire-tabs.js': 2, 'page-edit.js': 1.75, 'save-wait.js': 1.5, 'uikit-layer.js': 2.5, 'drawers.js': 2.5, 'debug-tools.js': 1,
};
let classicTotal = 0;
for (const f of existsSync(scriptsDir) ? readdirSync(scriptsDir).filter(f => f.endsWith('.js')).sort() : []) {
	const js = readFileSync(scriptsDir + f, 'utf8');
	const gz = gzipSync(js, { level: 9 }).length;
	if(f !== 'debug-tools.js') classicTotal += gz;
	const budget = (CLASSIC[f] || 2) * 1024;
	const minified = js.split('\n').length <= 3;
	console.log(`scripts/${f}: ${js.length} B raw, ${gz} B gzip (budget ${budget})` + (minified ? '' : ', NOT MINIFIED'));
	if (!minified) { console.error(`scripts/${f}: not built (run scripts/build-classic.mjs)`); failed = true; }
	if (gz > budget) { console.error(`scripts/${f}: over the gzip budget`); failed = true; }
}
// total raised from 40 to 42 KiB after the UIkit layer (owner's decision, 2026-10-22), and to
// 42.25 KiB for scripts/save-wait.js (owner's decision, 2026-10-29); 46 KiB for scripts/drawers.js, the
// page tree and history drawers (0.25.0, user request); 46.5 KiB for the history drawer's polish: a retried
// fetch, the focus kept over a refresh, the Clear button (0.26.0, user request)
const CLASSIC_TOTAL = 46.5 * 1024;
console.log(`classic scripts: ${classicTotal} B gzip (budget ${CLASSIC_TOTAL})`);
if (classicTotal > CLASSIC_TOTAL) { console.error('classic scripts: over the total gzip budget'); failed = true; }

// the UIkit layer (ADR 0017): everything in one cascade layer, so unlayered sheets win; every
// selector in it names a UIkit class or attribute or is UIkit's Base outside this theme's pages
// (:where(html.pw) > body:where(:not(.AdminThemeBridge))): nothing can restyle the theme's markup
{
	const uikit = readFileSync(dist + 'uikit.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
	if (uikit.indexOf('@layer uikit{') < 0) { console.error('uikit.css: no @layer uikit'); failed = true; }
	const bare = [];
	for (const m of uikit.matchAll(/(?:^|[{}])([^{}@]+)\{/g)) {
		const list = m[1].trim();
		if (!list || /^(from|to|\d+%)/.test(list)) continue;
		for (const sel of list.split(/,(?![^(]*\))/)) {
			if (!/\.uk-|\[(?:data-)?uk-|\[class\*=['"]?uk-|^:root$|^:where\(html\.pw|^\[data-pw-(scheme|variant)\]$|^\.(dark|light)-theme|^:root:not\(\[data-pw-scheme\]\):has\(>\s*body\.(dark|light)-theme\)|^\[data-pw-variant=black\] \.dark-theme/.test(sel.trim())) bare.push(sel.trim());
		}
	}
	console.log(`uikit.css: ${bare.length} selectors without a UIkit class or attribute`);
	if (bare.length) { console.error('uikit.css: ' + bare.slice(0, 10).join(' | ')); failed = true; }
}

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

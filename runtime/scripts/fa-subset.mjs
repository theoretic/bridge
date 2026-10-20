// Font Awesome subsets for AdminThemeBridge (part of `npm run build`).
//
// Core prints Font Awesome 6 (all.min.css + v4-shims.min.css); its faces carry every icon (solid
// 155 kB, brands 116 kB, regular 25 kB) while an admin screen shows a few dozen. This step finds
// the icon names core, Bridge and any extra module trees use, plus the names in fa-icons.txt,
// writes woff2 subsets of the three faces and fa-subset.css: @font-face rules for core's families
// whose unicode-range lists exactly the glyphs of each subset. The theme prints that file after
// core's stylesheets (_head.php), so those icons come from the subsets; an icon outside them falls
// through to core's full face, which the browser then fetches. No icon can go missing: a rare one
// costs the full download, nothing else.
//
// env: BRIDGE_WIRE    core's wire/ directory (required; without it the step is skipped and the
//                     committed subsets stay as they are)
//      BRIDGE_FA_SCAN more trees to scan for icon names (e.g. site/modules of real sites),
//                     separated by the platform's path delimiter
// Output: modules/AdminThemeBridge/assets/fonts/fa-<version>/ (committed, like assets/dist/).
// The theme uses it only while core ships that Font Awesome version.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync } from 'fs';
import { join, delimiter, dirname } from 'path';
import { fileURLToPath } from 'url';
import subsetFont from 'subset-font';
import fontverter from 'fontverter';
import * as harfbuzz from 'harfbuzzjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const wire = process.env.BRIDGE_WIRE || '';
if(!wire || !existsSync(join(wire, 'templates-admin'))) {
	console.log("fa-subset: skipped (set BRIDGE_WIRE to core's wire/ directory); committed subsets kept");
	process.exit(0);
}
const styles = join(wire, 'templates-admin', 'styles');
const faDir = readdirSync(styles).filter(d => /^font-awesome-6\./.test(d)).sort().pop();
if(!faDir) { console.log('fa-subset: no Font Awesome 6 in core, skipped'); process.exit(0); }
const version = faDir.replace('font-awesome-', '');
const fa = join(styles, faDir);
const out = join(repo, 'modules', 'AdminThemeBridge', 'assets', 'fonts', 'fa-' + version);
const read = (p) => readFileSync(p, 'utf8');

// icon name -> code points, from the FA6 stylesheet and its v4 shims (a v4 name can mean another
// glyph than the same v6 name: .fa.fa-rotate-left is f0e2, .fa-rotate-left f2ea; keep both)
const names = new Map();
for(const css of ['all.css', 'v4-shims.css']) {
	for(const m of read(join(fa, 'css', css)).matchAll(/([^{}]+)\{\s*--fa:\s*"\\([0-9a-f]+)";/g)) {
		for(const n of m[1].matchAll(/\.fa-([a-z0-9-]+)/g)) {
			if(!names.has(n[1])) names.set(n[1], new Set());
			names.get(n[1]).add(parseInt(m[2], 16));
		}
	}
}

// names used in code: fa-<name> anywhere, and icons given without the prefix ('icon' => 'cubes')
const used = new Set();
const SKIP = new Set(['node_modules', 'vendor', '.git', 'cache', 'sessions', 'files', 'logs', 'dist']);
const CATALOG = 150;
const catalogs = [];
const rawCodepoints = new Set();
const EXT = /\.(php|module|inc|js|mjs|ts|css|html|json)$/;
function scan(dir) {
	let entries;
	try { entries = readdirSync(dir, { withFileTypes: true }); } catch(e) { return; }
	for(const e of entries) {
		const p = join(dir, e.name);
		// Font Awesome itself and this step's own output (assets/fonts/fa-<version>) are not usage
		if(e.isDirectory()) { if(!SKIP.has(e.name) && !e.name.startsWith('font-awesome') && !/^fa-\d/.test(e.name)) scan(p); continue; }
		if(!EXT.test(e.name) || e.name.endsWith('.min.css') || e.name.endsWith('.min.js') || statSync(p).size > 2e6) continue;
		const text = read(p);
		const found = new Set();
		for(const m of text.matchAll(/\bfa-([a-z0-9]+(?:-[a-z0-9]+)*)/g)) found.add(m[1]);
		for(const m of text.matchAll(/['"]?icon[A-Za-z_]*['"]?\s*(?:=>|:|=)\s*['"]([a-z0-9-]+)['"]/g)) found.add(m[1]);
		// icon tables: $icons = array('panel' => 'columns', ...), icons = [...], icons: {...}
		for(const m of text.matchAll(/icons['"]?\s*(?:=|:|=>)\s*(?:array\(|\[|\{)([^;]{0,3000}?)(?:\)|\]|\})\s*[;,]/gi)) {
			for(const v of m[1].matchAll(/['"]([a-z0-9]+(?:-[a-z0-9]+)*)['"]/g)) found.add(v[1]);
		}
		// raw code points: CSS content/--fa escapes ("\f054") and JS escapes (''), private use area
		const cps = new Set();
		for(const m of text.matchAll(/(?:content|--fa(?:-[a-z]+)?)\s*:\s*['"]\\([ef][0-9a-f]{3})/gi)) cps.add(parseInt(m[1], 16));
		for(const m of text.matchAll(/\\u([ef][0-9a-f]{3})\b/gi)) cps.add(parseInt(m[1], 16));
		// an icon picker or a name map lists (nearly) every icon: that is a catalog, not usage
		if(found.size > CATALOG || cps.size > CATALOG) { catalogs.push(p.replace(/\\/g, '/') + ' (' + Math.max(found.size, cps.size) + ')'); continue; }
		found.forEach(n => used.add(n));
		cps.forEach(cp => { if(cp >= 0xe000 && cp <= 0xf8ff) rawCodepoints.add(cp); });
	}
}
const extra = (process.env.BRIDGE_FA_SCAN || '').split(delimiter).filter(Boolean);
for(const dir of [join(wire, 'core'), join(wire, 'modules'), join(wire, 'templates-admin'), join(repo, 'modules'), join(repo, 'runtime', 'src'), ...extra]) scan(dir);
// name lists: runtime/fa-icons.txt, plus BRIDGE_FA_ICONS files (tools/fa-icons-site.php output)
const lists = [join(here, '..', 'fa-icons.txt'), ...(process.env.BRIDGE_FA_ICONS || '').split(delimiter).filter(Boolean)];
for(const file of lists) for(const line of read(file).split(/\r?\n/)) {
	const n = line.replace(/#.*/, '').trim().replace(/^fa-/, '');
	if(n) used.add(n);
}
// core renders v4 names as their v6 equivalents (wire/core/Functions/fa.php: 'fa-code-fork' =>
// 'fa-code-branch'): add the mapped name of every name found
const faMap = join(wire, 'core', 'Functions', 'fa.php');
if(existsSync(faMap)) {
	const map = new Map();
	for(const m of read(faMap).matchAll(/'fa-([a-z0-9-]+)'\s*=>\s*(?:array\(\s*)?'fa-([a-z0-9-]+)'/g)) map.set(m[1], m[2]);
	for(const n of [...used]) if(map.has(n)) used.add(map.get(n));
}
console.log('fa-subset: catalogs skipped: ' + (catalogs.join(', ') || 'none'));
// BRIDGE_FA_DUMP=<file>: write the icon names found (known to Font Awesome), one per line
if(process.env.BRIDGE_FA_DUMP) writeFileSync(process.env.BRIDGE_FA_DUMP, [...used].filter(n => names.has(n)).sort().join('\n') + '\n');
const wanted = new Set([...used].filter(n => names.has(n)).flatMap(n => [...names.get(n)]).concat([...rawCodepoints]));

// glyph sets of core's faces
const hb = await (harfbuzz.default || harfbuzz);
async function cmap(buffer) {
	const face = new hb.Face(new hb.Blob(await fontverter.convert(buffer, 'sfnt')), 0);
	return new Set(face.collectUnicodes());
}
// core's @font-face rules in declaration order: family, weight, file, unicode-range (null: all)
function parseRange(text) {
	const set = new Set();
	for(const part of text.split(',')) {
		const [a, b] = part.trim().toLowerCase().replace('u+', '').split('-');
		for(let cp = parseInt(a, 16); cp <= parseInt(b || a, 16); cp++) set.add(cp);
	}
	return set;
}
const allCss = read(join(fa, 'css', 'all.min.css'));
const blocks = (allCss.match(/@font-face\s*\{[^}]*\}/g) || []).map(block => ({
	family: block.match(/font-family:\s*"([^"]+)"/)[1],
	weight: (block.match(/font-weight:\s*(\d+)/) || [])[1] || '',
	file: block.match(/(fa-[a-z0-9-]+)\.woff2/)[1],
	range: (r => r ? parseRange(r[1]) : null)(block.match(/unicode-range:\s*([^;}]+)/)),
}));
if(!blocks.length) throw new Error('fa-subset: no @font-face rules in ' + join(fa, 'css', 'all.min.css'));

// glyph sets of core's files
const files = {};
for(const file of new Set(blocks.map(b => b.file))) {
	const src = readFileSync(join(fa, 'webfonts', file + '.woff2'));
	files[file] = { src, full: await cmap(src) };
}
// which file serves each code point in each family and weight, as browsers resolve core's rules:
// the last declared face whose range holds the code point and whose file has a glyph for it
const groups = new Map();
for(let i = blocks.length - 1; i >= 0; i--) {
	const b = blocks[i], key = b.family + '|' + b.weight;
	if(!groups.has(key)) groups.set(key, { family: b.family, weight: b.weight, cps: new Map() });
	const map = groups.get(key).cps;
	for(const cp of files[b.file].full) if((!b.range || b.range.has(cp)) && !map.has(cp)) map.set(cp, b.file);
}

// subsets: the wanted code points each file serves anywhere; full files copied next to them
// clear what an earlier run wrote (files only: the folder may be in use on Windows)
mkdirSync(out, { recursive: true });
for(const f of readdirSync(out)) if(/^fa-.*\.woff2$|^fa\.css$|^LICENSE\.txt$/.test(f)) rmSync(join(out, f), { force: true });
for(const [file, f] of Object.entries(files)) {
	const cps = [...wanted].filter(cp => [...groups.values()].some(g => g.cps.get(cp) === file));
	f.subset = new Set();
	if(cps.length) {
		const sub = await subsetFont(f.src, String.fromCodePoint(...cps), { targetFormat: 'woff2' });
		writeFileSync(join(out, file + '-subset.woff2'), sub);
		f.subset = await cmap(sub);
		f.subsetBytes = sub.length;
	}
	writeFileSync(join(out, file + '.woff2'), f.src);
	console.log(`fa-subset: ${file} ${f.subset.size}/${f.full.size} glyphs in the subset, ${(f.src.length / 1024).toFixed(0)} -> ${((f.subsetBytes || 0) / 1024).toFixed(1)} kB`);
}
writeFileSync(join(out, 'LICENSE.txt'), readFileSync(join(fa, 'LICENSE.txt')));

// faces with explicit ranges: subset first where it has the glyph, the full file for the rest.
// Code points no face covers (a space inside <i class="fa">, plain text) fetch nothing, where
// core's range-less faces made the browser download a full face to look for them.
// Inside the private use area a range may span code points no face of the family maps (gaps
// between icons); it breaks where the next mapped code point belongs to another file. Outside it
// (the letter and digit glyphs, symbols) ranges stay exact, so ordinary text never matches a face.
const rules = [];
for(const g of groups.values()) {
	const sorted = [...g.cps.keys()].sort((a, b) => a - b);
	const byFile = new Map();
	for(let i = 0; i < sorted.length; i++) {
		const name = (cp => files[g.cps.get(cp)].subset.has(cp) ? g.cps.get(cp) + '-subset' : g.cps.get(cp));
		const start = sorted[i], file = name(start);
		const pua = (cp) => cp >= 0xe000 && cp <= 0xf8ff;
		while(i + 1 < sorted.length && name(sorted[i + 1]) === file
			&& (sorted[i + 1] === sorted[i] + 1 || (pua(sorted[i]) && pua(sorted[i + 1])))) i++;
		if(!byFile.has(file)) byFile.set(file, []);
		byFile.get(file).push(start === sorted[i] ? 'U+' + start.toString(16) : 'U+' + start.toString(16) + '-' + sorted[i].toString(16));
	}
	// U+20 goes to the family's main subset face: the "first available font", whose metrics size
	// the line box, is the first face whose range holds the space. Core's faces have no range, so
	// there it is Font Awesome; without the space here it would be the fallback font and icons
	// would sit a pixel off. No face has a space glyph, so text still falls back as before.
	const main = [...byFile.keys()].filter(f => f.endsWith('-subset')).sort((a, b) => byFile.get(b).length - byFile.get(a).length)[0] || [...byFile.keys()][0];
	if(main) byFile.get(main).unshift('U+20');
	for(const [file, parts] of byFile) {
		rules.push(`@font-face{font-family:"${g.family}";font-style:normal;${g.weight ? `font-weight:${g.weight};` : ''}font-display:block;src:url(${file}.woff2) format("woff2");unicode-range:${parts.join(',')}}`);
	}
}

const head = `/* Font Awesome ${version} for AdminThemeBridge, generated by runtime/scripts/fa-subset.mjs (npm run build):
 * core's all.min.css with its @font-face rules replaced. ${wanted.size} icons in common use (core, Bridge,
 * runtime/fa-icons.txt${extra.length ? ', ' + extra.length + ' more trees' : ''}) come from small subsets, every other icon from the full
 * files; ranges are explicit, so nothing else fetches a font. Printed instead of core's all.min.css;
 * core's v4-shims.min.css is printed as before. Fonts: SIL OFL 1.1, see LICENSE.txt. */
`;
const classes = allCss.replace(/@font-face\s*\{[^}]*\}/g, '').replace(/^\/\*![\s\S]*?\*\//, '');
writeFileSync(join(out, 'fa.css'), head + rules.join('\n') + '\n' + classes.trim() + '\n');
console.log(`fa-subset: ${rules.length} faces -> ${out.replace(repo, '').split('\\').join('/')}/fa.css`);

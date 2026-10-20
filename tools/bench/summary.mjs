// Markdown tables from bench results.json: node summary.mjs <results.json>
import { readFileSync } from 'fs';
const R = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const kb = (b) => (b / 1024).toFixed(0);
const sum = (r, types, k) => types.reduce((a, t) => a + (r.bytes[t]?.[k] || 0), 0);
const themes = [...new Set(R.map(r => r.theme))];
const screens = [...new Set(R.map(r => r.screen))];
const get = (t, s) => R.find(r => r.theme === t && r.screen === s && !r.error);

console.log('### Lighthouse performance score (desktop, median of 3)\n');
console.log('| Theme | ' + screens.join(' | ') + ' |');
console.log('|---|' + screens.map(() => '---:').join('|') + '|');
for(const t of themes) console.log('| ' + t + ' | ' + screens.map(s => get(t, s)?.score ?? '–').join(' | ') + ' |');

for(const [title, f] of [
	['Largest Contentful Paint, ms', r => Math.round(r.lcp)],
	['Total Blocking Time, ms', r => Math.round(r.tbt)],
	['Speed Index, ms', r => Math.round(r.si)],
	['Cumulative Layout Shift', r => r.cls.toFixed(3)],
]) {
	console.log('\n### ' + title + '\n');
	console.log('| Theme | ' + screens.join(' | ') + ' |');
	console.log('|---|' + screens.map(() => '---:').join('|') + '|');
	for(const t of themes) console.log('| ' + t + ' | ' + screens.map(s => { const r = get(t, s); return r ? f(r) : '–'; }).join(' | ') + ' |');
}

console.log('\n### Weight per screen: JS + CSS, gzip kB (raw kB), requests\n');
console.log('| Theme | ' + screens.join(' | ') + ' |');
console.log('|---|' + screens.map(() => '---:').join('|') + '|');
for(const t of themes) console.log('| ' + t + ' | ' + screens.map(s => {
	const r = get(t, s); if(!r) return '–';
	return `${kb(sum(r, ['Script', 'Stylesheet'], 'gzip'))} (${kb(sum(r, ['Script', 'Stylesheet'], 'raw'))}), ${r.requests} req`;
}).join(' | ') + ' |');

console.log('\n### JS only, gzip kB · jQuery loaded?\n');
console.log('| Theme | ' + screens.join(' | ') + ' |');
console.log('|---|' + screens.map(() => '---:').join('|') + '|');
for(const t of themes) console.log('| ' + t + ' | ' + screens.map(s => { const r = get(t, s); return r ? `${kb(sum(r, ['Script'], 'gzip'))} · ${r.jquery ? 'yes' : 'no'}` : '–'; }).join(' | ') + ' |');

console.log('\n### Averages over the four screens\n');
console.log('| Theme | Score | LCP ms | JS+CSS gzip kB | Requests | Fonts kB |');
console.log('|---|---:|---:|---:|---:|---:|');
for(const t of themes) {
	const rs = R.filter(r => r.theme === t && !r.error); const avg = (f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
	console.log(`| ${t} | ${avg(r => r.score).toFixed(0)} | ${avg(r => r.lcp).toFixed(0)} | ${kb(avg(r => sum(r, ['Script', 'Stylesheet'], 'gzip')))} | ${avg(r => r.requests).toFixed(0)} | ${kb(avg(r => sum(r, ['Font'], 'raw')))} |`);
}
const ext = [...new Set(R.flatMap(r => r.external || []).map(u => new URL(u).host))];
console.log('\nExternal hosts requested: ' + (ext.join(', ') || 'none'));
const missing = R.filter(r => !r.error && !r.themeAssetsSeen).map(r => r.theme + '/' + r.screen);
console.log('Checks: ' + (missing.length ? 'theme assets MISSING on ' + missing.join(', ') : 'theme assets present on every screen'));

// Recompute JS/CSS bytes per screen from the files on disk (gzip level 6), for every lhr-*.json
// in the given dirs, and write them into that dir's results.json as bytesDisk.
// usage: node regzip.mjs <sandbox root> <dir> [<dir> ...]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { gzipSync } from 'zlib';
import { join } from 'path';

const ROOT = process.argv[2];
const cache = new Map();
function local(url) {
	let p = new URL(url).pathname;
	if(p.startsWith('/wire/')) p = '/vendor/processwire' + p; // tools/router.php aliases /wire/
	const f = join(ROOT, decodeURIComponent(p));
	return existsSync(f) ? f : null;
}
function sizes(url) {
	if(cache.has(url)) return cache.get(url);
	const f = local(url);
	let v = null;
	if(f) { const b = readFileSync(f); v = { raw: b.length, gzip: gzipSync(b, { level: 6 }).length }; }
	cache.set(url, v);
	return v;
}
for(const dir of process.argv.slice(3)) {
	const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
	for(const r of results) {
		if(r.error) continue;
		const file = join(dir, `lhr-${r.theme.replace(/\W+/g, '_')}-${r.screen.replace(/\W+/g, '_')}.json`);
		const lhr = JSON.parse(readFileSync(file, 'utf8'));
		const items = lhr.audits['network-requests'].details.items.filter(x => x.url.startsWith('http://localhost:8089/'));
		const by = { Script: { requests: 0, raw: 0, gzip: 0 }, Stylesheet: { requests: 0, raw: 0, gzip: 0 }, unresolved: [] };
		for(const x of items) {
			if(!by[x.resourceType] || x.resourceType === 'unresolved') continue;
			const s = sizes(x.url);
			by[x.resourceType].requests++;
			if(s) { by[x.resourceType].raw += s.raw; by[x.resourceType].gzip += s.gzip; }
			else by.unresolved.push(x.url);
		}
		r.bytesDisk = by;
	}
	writeFileSync(join(dir, 'results.json'), JSON.stringify(results, null, 1));
	for(const r of results) if(!r.error) console.log(dir.split(/[\\/]/).pop(), '|', r.theme, '|', r.screen, '| JS', (r.bytesDisk.Script.gzip / 1024).toFixed(0), 'kB gz | CSS', (r.bytesDisk.Stylesheet.gzip / 1024).toFixed(0), 'kB gz | unresolved', r.bytesDisk.unresolved.length);
}

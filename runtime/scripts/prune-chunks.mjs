/**
 * After `vite build` (emptyOutDir: false): delete the chunks no build needs any more. A tab that
 * stays open across a deploy still imports the chunks of the runtime it loaded (lazy field
 * widgets), so the chunks of the previous build stay one more release (audit B27): kept are the
 * chunks this build's manifest names and those listed in assets/dist/chunks.json by the build
 * before; the list is then rewritten with this build's chunks. Without a list (the first build
 * with this script) every chunk already there counts as the previous build's.
 */

import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../../modules/AdminThemeBridge/assets/dist/', import.meta.url));
const manifestFile = dist + '.vite/manifest.json';
const listFile = dist + 'chunks.json';

if (!existsSync(manifestFile)) {
	console.error('prune-chunks: no .vite/manifest.json (build.manifest in vite.config.ts)');
	process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const current = new Set();
for (const entry of Object.values(manifest)) {
	if (entry.file && entry.file.startsWith('chunks/')) current.add(entry.file.slice('chunks/'.length));
}
const present = readdirSync(dist + 'chunks').filter(f => f.endsWith('.js'));
const previous = existsSync(listFile)
	? new Set(JSON.parse(readFileSync(listFile, 'utf8')).chunks || [])
	: new Set(present.filter(f => !current.has(f)));

let removed = 0;
for (const f of present) {
	if (current.has(f) || previous.has(f)) continue;
	unlinkSync(dist + 'chunks/' + f);
	removed++;
}
writeFileSync(listFile, JSON.stringify({ note: 'chunks of the last build; the next build keeps them (scripts/prune-chunks.mjs)', chunks: [...current].sort() }, null, '\t') + '\n');
const kept = present.filter(f => !current.has(f) && previous.has(f)).length;
console.log(`chunks: ${current.size} current, ${kept} kept from the previous build, ${removed} removed`);

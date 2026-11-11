/**
 * The lazy chunks of the runtime (assets/dist/chunks/) and the list of the released ones
 * (assets/dist/chunks.json: { note, version, chunks, previous }). A tab that stays open across a
 * deploy still imports the chunks of the runtime it loaded (lazy field widgets), so the chunks of
 * the release before stay one more release (audit B27). `version` is the theme version the list
 * was last released for, `chunks` the chunk files of that release, `previous` those of the release
 * before it that differed.
 *
 * No rule can tell a development build from a release build, so moving the list on is an explicit
 * step:
 *
 *   node scripts/prune-chunks.mjs             (inside `npm run build`, after `vite build`) deletes a
 *                                             file in chunks/ only when it is neither in this
 *                                             build's .vite/manifest.json nor in `chunks` nor in
 *                                             `previous`; never rewrites the list. A list of the
 *                                             old shape (no `previous`) is migrated once: the
 *                                             files that are neither current nor listed become
 *                                             `previous`, `version` the module version, and
 *                                             nothing is deleted in that run.
 *   node scripts/prune-chunks.mjs --release   (`npm run release-chunks`, after the build of a
 *                                             release, in the step that raises the theme version)
 *                                             this build's set becomes `chunks`; the old `chunks`
 *                                             becomes `previous` when the version changed (a
 *                                             rebuilt release of the same version keeps
 *                                             `previous`); `version` becomes the module version;
 *                                             every file outside `chunks` and `previous` is
 *                                             deleted.
 *   node scripts/prune-chunks.mjs --check     (tools/release-module.sh, no build needed) exit 0 only
 *                                             when `version` is the module version, every chunk
 *                                             runtime.js imports statically (transitively) is in
 *                                             `chunks`, and the .js files in chunks/ are exactly
 *                                             `chunks` and `previous`.
 *   node scripts/prune-chunks.mjs --self-test (first stage of `npm run build`) runs the decisions
 *                                             on fixed cases, without touching the file system.
 *
 * The script never calls git.
 *
 * Original work, MIT.
 */

import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { posix } from 'node:path';

const NOTE = 'chunks of the last release and of the release before; a build keeps them, `npm run release-chunks` moves the list on (scripts/prune-chunks.mjs)';

const sorted = (set) => [...set].sort();
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

/**
 * The decisions, pure: sets in, { delete, list } out. `list` is the list to write, or null when
 * the file stays as it is.
 *
 * @param {object} p
 * @param {'build'|'release'} p.mode
 * @param {Set<string>} p.current chunk files this build's manifest names
 * @param {Set<string>} p.present .js files in chunks/
 * @param {{version?: string, chunks?: string[], previous?: string[]}|null} p.listed chunks.json, or null
 * @param {string} p.moduleVersion
 * @returns {{delete: string[], list: {version: string, chunks: string[], previous: string[]}|null, migrated: boolean}}
 */
export function decide({ mode, current, present, listed, moduleVersion }) {
	let list = listed && Array.isArray(listed.previous)
		? { version: String(listed.version || ''), chunks: [...(listed.chunks || [])].sort(), previous: [...listed.previous].sort() }
		: null;
	let migrated = false;
	if (!list) {
		// the old shape (or no list at all): what is neither current nor listed is the release before
		const chunks = new Set(listed ? (listed.chunks || []) : current);
		list = {
			version: moduleVersion,
			chunks: sorted(chunks),
			previous: sorted([...present].filter(f => !current.has(f) && !chunks.has(f))),
		};
		migrated = true;
		if (mode === 'build') return { delete: [], list, migrated };
	}
	if (mode === 'build') {
		const keep = new Set([...current, ...list.chunks, ...list.previous]);
		return { delete: sorted([...present].filter(f => !keep.has(f))), list: null, migrated };
	}
	// release
	const listedChunks = new Set(list.chunks);
	let next;
	if (sameSet(current, listedChunks)) {
		next = { version: moduleVersion, chunks: list.chunks, previous: list.previous };
	} else {
		next = {
			version: moduleVersion,
			chunks: sorted(current),
			previous: moduleVersion !== list.version ? list.chunks : list.previous,
		};
	}
	const keep = new Set([...next.chunks, ...next.previous]);
	return { delete: sorted([...present].filter(f => !keep.has(f))), list: next, migrated };
}

function selfTest() {
	const S = (...a) => new Set(a);
	const L = (version, chunks, previous) => ({ version, chunks, previous });
	const cases = [
		['development build, nothing changed: no deletion, list unchanged',
			{ mode: 'build', current: S('a1', 'b1'), present: S('a1', 'b1', 'a0', 'b0'), listed: L('1.0.0', ['a1', 'b1'], ['a0', 'b0']), moduleVersion: '1.0.0' },
			{ delete: [], list: null }],
		['the same development build run twice in a row: the second run deletes and writes nothing either',
			{ mode: 'build', current: S('a2', 'b1'), present: S('a2', 'b1', 'a1', 'a0', 'b0', 'x9'), listed: L('1.0.0', ['a1', 'b1'], ['a0', 'b0']), moduleVersion: '1.0.0' },
			{ delete: [], list: null }, true],
		['development build with new hashes: only unlisted, non-current files deleted, list unchanged',
			{ mode: 'build', current: S('a3', 'b1'), present: S('a3', 'a2', 'b1', 'a1', 'a0', 'b0'), listed: L('1.0.0', ['a1', 'b1'], ['a0', 'b0']), moduleVersion: '1.1.0' },
			{ delete: ['a2'], list: null }],
		['release, new version, changed set: previous = old chunks, old previous deleted',
			{ mode: 'release', current: S('a2', 'b1'), present: S('a2', 'b1', 'a1', 'a0', 'b0'), listed: L('1.0.0', ['a1', 'b1'], ['a0', 'b0']), moduleVersion: '1.1.0' },
			{ delete: ['a0', 'b0'], list: L('1.1.0', ['a2', 'b1'], ['a1', 'b1']) }],
		['release, same version, changed set: previous kept',
			{ mode: 'release', current: S('a3', 'b1'), present: S('a3', 'a2', 'b1', 'a1'), listed: L('1.1.0', ['a2', 'b1'], ['a1', 'b1']), moduleVersion: '1.1.0' },
			{ delete: ['a2'], list: L('1.1.0', ['a3', 'b1'], ['a1', 'b1']) }],
		['release, unchanged set: only version changes',
			{ mode: 'release', current: S('a1', 'b1'), present: S('a1', 'b1', 'a0', 'b0'), listed: L('1.0.0', ['a1', 'b1'], ['a0', 'b0']), moduleVersion: '1.0.1' },
			{ delete: [], list: L('1.0.1', ['a1', 'b1'], ['a0', 'b0']) }],
		['migration from the old shape: previous = present, neither current nor listed; nothing deleted',
			{ mode: 'build', current: S('a1', 'b1'), present: S('a1', 'b1', 'a0', 'b0'), listed: { chunks: ['a1', 'b1'] }, moduleVersion: '1.0.0' },
			{ delete: [], list: L('1.0.0', ['a1', 'b1'], ['a0', 'b0']) }],
	];
	let failed = 0;
	cases.forEach(([name, input, want, twice], i) => {
		let got = decide(input);
		if (twice) {
			// apply the first run (x9 is an unlisted leftover it removes), then run again on the result
			const first = got;
			const present = new Set([...input.present].filter(f => !first.delete.includes(f)));
			const firstOk = JSON.stringify(first.delete) === '["x9"]' && first.list === null;
			got = decide({ ...input, present, listed: first.list || input.listed });
			if (!firstOk) got = { delete: ['(first run) ' + JSON.stringify(first.delete)], list: first.list };
		}
		const ok = JSON.stringify(got.delete) === JSON.stringify(want.delete) && JSON.stringify(got.list) === JSON.stringify(want.list);
		if (!ok) failed++;
		console.log(`prune-chunks self-test (${i + 1}) ${ok ? 'ok' : 'FAIL'}: ${name}` + (ok ? '' : ` -- got ${JSON.stringify({ delete: got.delete, list: got.list })}`));
	});
	process.exit(failed ? 1 : 0);
}

// ---- file system

const dist = fileURLToPath(new URL('../../modules/AdminThemeBridge/assets/dist/', import.meta.url));
const moduleFile = fileURLToPath(new URL('../../modules/AdminThemeBridge/AdminThemeBridge.module.php', import.meta.url));
const manifestFile = dist + '.vite/manifest.json';
const listFile = dist + 'chunks.json';

function moduleVersion() {
	// as tools/release-module.sh reads it
	const m = /^[ \t]*'version' => '([0-9.]+)',/m.exec(readFileSync(moduleFile, 'utf8'));
	if (!m) {
		console.error('prune-chunks: no version in getModuleInfo() of AdminThemeBridge.module.php');
		process.exit(1);
	}
	return m[1];
}

const readList = () => (existsSync(listFile) ? JSON.parse(readFileSync(listFile, 'utf8')) : null);
const presentChunks = () => new Set(readdirSync(dist + 'chunks').filter(f => f.endsWith('.js')));
const writeList = (list) => writeFileSync(listFile, JSON.stringify({ note: NOTE, version: list.version, chunks: list.chunks, previous: list.previous }, null, '\t') + '\n');

/** Chunk files runtime.js imports statically, followed through the chunks' own static imports. */
function staticChunks() {
	const re = /(?:\bimport|\bexport)\s*(?:[^"'();]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+\.js)["']/g;
	const found = new Set();
	const queue = ['runtime.js'];
	while (queue.length) {
		const rel = queue.shift();
		const src = readFileSync(dist + rel, 'utf8');
		for (const m of src.matchAll(re)) {
			const target = posix.normalize(posix.join(posix.dirname(rel), m[1]));
			if (!target.startsWith('chunks/')) continue;
			const name = target.slice('chunks/'.length);
			if (found.has(name)) continue;
			found.add(name);
			if (existsSync(dist + target)) queue.push(target);
		}
	}
	return found;
}

function check() {
	const listed = readList();
	const problems = [];
	const version = moduleVersion();
	let staticCount = 0;
	if (!listed || !Array.isArray(listed.chunks) || !Array.isArray(listed.previous)) {
		problems.push('chunks.json is missing or has no `chunks` and `previous` (run a build, then `npm run release-chunks`)');
	} else {
		if (listed.version !== version) problems.push(`chunks.json lists version ${listed.version || '(none)'}, the module is ${version} (run \`npm run release-chunks\` after the build)`);
		const chunks = new Set(listed.chunks);
		const imported = staticChunks();
		staticCount = imported.size;
		const missing = sorted(imported).filter(f => !chunks.has(f));
		if (missing.length) problems.push(`runtime.js imports chunks not in \`chunks\`: ${missing.join(', ')}`);
		const keep = new Set([...listed.chunks, ...listed.previous]);
		const present = presentChunks();
		const extra = sorted(present).filter(f => !keep.has(f));
		const absent = sorted(keep).filter(f => !present.has(f));
		if (extra.length) problems.push(`files in chunks/ not listed: ${extra.join(', ')}`);
		if (absent.length) problems.push(`listed but not in chunks/: ${absent.join(', ')}`);
	}
	if (problems.length) {
		for (const p of problems) console.error('prune-chunks --check: ' + p);
		process.exit(1);
	}
	console.log(`prune-chunks --check: ok (${version}, ${listed.chunks.length} released, ${listed.previous.length} from the release before, ${staticCount} imported statically by runtime.js)`);
}

function run(mode) {
	if (!existsSync(manifestFile)) {
		console.error('prune-chunks: no .vite/manifest.json (build.manifest in vite.config.ts)');
		process.exit(1);
	}
	const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
	const current = new Set();
	for (const entry of Object.values(manifest)) {
		if (entry.file && entry.file.startsWith('chunks/')) current.add(entry.file.slice('chunks/'.length));
	}
	const present = presentChunks();
	const result = decide({ mode, current, present, listed: readList(), moduleVersion: moduleVersion() });
	for (const f of result.delete) unlinkSync(dist + 'chunks/' + f);
	if (result.list) writeList(result.list);
	const list = result.list || readList();
	const listedCount = new Set([...list.chunks, ...list.previous]).size;
	console.log(`chunks: ${current.size} current, ${listedCount} listed (${list.version}: ${list.chunks.length} released, ${list.previous.length} from the release before), ${result.delete.length} removed`
		+ (result.migrated ? ' (list migrated to the release shape)' : '')
		+ (mode === 'release' ? ` (released ${list.version})` : ''));
}

const arg = process.argv[2] || '';
if (process.argv.length > 3 || !['', '--release', '--check', '--self-test'].includes(arg)) {
	console.error('usage: node scripts/prune-chunks.mjs [--release | --check | --self-test]');
	process.exit(1);
}
if (arg === '--self-test') selfTest();
else if (arg === '--check') check();
else run(arg === '--release' ? 'release' : 'build');

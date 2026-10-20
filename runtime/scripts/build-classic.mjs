/**
 * The theme's classic scripts (audit B20, C32): runtime/src/classic/*.js minified with esbuild
 * into modules/AdminThemeBridge/scripts/ under the same names, so _head.php, the junctioned
 * sandboxes and nativeProcessScripts() keep their paths. Plain transforms, not bundles: each file
 * stays a classic script whose top-level declarations (`var ProcessWireAdminTheme`) are globals.
 * Source maps go to runtime/.maps/ (not committed, not served).
 *
 *   node scripts/build-classic.mjs           build once
 *   node scripts/build-classic.mjs --watch   rebuild a file when it changes
 */

import { transform } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const src = fileURLToPath(new URL('../src/classic/', import.meta.url));
const out = fileURLToPath(new URL('../../modules/AdminThemeBridge/scripts/', import.meta.url));
const maps = fileURLToPath(new URL('../.maps/', import.meta.url));
// the browsers whose CSS the theme needs (README: Chrome 111, Safari 16.2, Firefox 121)
const target = ['chrome111', 'safari16.2', 'firefox121'];

mkdirSync(out, { recursive: true });
mkdirSync(maps, { recursive: true });

async function build(file) {
	const code = readFileSync(join(src, file), 'utf8');
	const result = await transform(code, {
		loader: 'js',
		minify: true,
		target,
		legalComments: 'none',
		sourcemap: 'external',
		sourcefile: 'runtime/src/classic/' + file,
		banner: `/* AdminThemeBridge ${file}: built from runtime/src/classic/${file} (npm run build), edit the source */`,
	});
	writeFileSync(join(out, file), result.code.replace(/\r\n?/g, '\n'));
	writeFileSync(join(maps, file + '.map'), result.map);
	return result.code.length;
}

const files = readdirSync(src).filter(f => f.endsWith('.js')).sort();
for (const file of files) {
	const size = await build(file);
	console.log(`classic ${file}: ${size} B`);
}

if (process.argv.includes('--watch')) {
	console.log('watching runtime/src/classic/');
	watch(src, (event, file) => {
		if (!file || !file.endsWith('.js')) return;
		build(file).then(size => console.log(`classic ${file}: ${size} B`), err => console.error(err.message));
	});
}

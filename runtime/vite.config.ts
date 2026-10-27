import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Builds into modules/AdminThemeBridge/assets/dist/ (committed, so sites need no node):
 *
 *   runtime.js   ES module, imported by modules/AdminThemeBridge/scripts/main.js via import()
 *   theme.css    the admin stylesheet, from src/styles/theme.css (one @import per component file)
 *   fields.css   field module recolouring, from src/styles/fields/fields.css (ADR 0014)
 *
 * App build rather than lib build so the ES output is fully minified while keeping its exports.
 * The CSS entries are pure CSS: Vite drops their empty JS chunks and emits only the .css files. cssTarget
 * names browsers without native CSS nesting (nesting is Chrome 112+, Safari 16.5+, Firefox 117+),
 * so esbuild flattens any `&` nesting in the source;
 * custom properties and color-mix() pass through untouched. Font URLs (url(../fonts/...)) are not
 * resolvable at build time and are left as written, relative to assets/dist/.
 */
/**
 * px to rem at build time (interface scaling: the user's scale sets the root font size, and
 * everything sized in rem follows). The sources stay in px, which reads better; the built CSS
 * has rem, 16px = 1rem. Kept in px: 1px and less (hairlines stay sharp at any scale), border and
 * outline widths, anything in url(), and media queries (rem there is the browser's initial size
 * anyway, so nothing would change). Custom properties are converted too: the theme script reads
 * the two it measures with (--pw-masthead-h, --pw-notice-row) through cssLength(), which knows rem.
 */
const PX = /(-?\d*\.?\d+)px\b/g;
const rem = (n: number): string => {
  const r = Math.round((n / 16) * 10000) / 10000;
  return (r === 0 ? '0' : String(r).replace(/^(-?)0\./, '$1.')) + 'rem';
};
const pxToRem = {
  postcssPlugin: 'pw-px-to-rem',
  Declaration(decl: { prop: string; value: string }) {
    if (/^(border(?!.*radius)|outline|-webkit-text-stroke)/.test(decl.prop) || decl.value.indexOf('url(') > -1 || decl.value.indexOf('px') < 0) return;
    decl.value = decl.value.replace(PX, (m, n) => (Math.abs(parseFloat(n)) <= 1 ? m : rem(parseFloat(n))));
  },
};

export default defineConfig({
  base: './',
  publicDir: false,
  css: {
    postcss: { plugins: [pxToRem] },
  },
  build: {
    outDir: fileURLToPath(new URL('../modules/AdminThemeBridge/assets/dist', import.meta.url)),
    // old chunks stay for tabs opened before a deploy; scripts/prune-chunks.mjs removes what no
    // build needs (it reads the manifest)
    emptyOutDir: false,
    manifest: true,
    target: 'es2020',
    // the real baseline (README): color-mix() needs Chrome 111, Safari 16.2, Firefox 113, :has()
    // Firefox 121 (audit C30)
    cssTarget: ['chrome111', 'safari16.2', 'firefox121'],
    minify: 'esbuild',
    cssMinify: 'esbuild',
    assetsInlineLimit: 0,
    modulePreload: false,
    rollupOptions: {
      input: {
        runtime: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        theme: fileURLToPath(new URL('./src/styles/theme.css', import.meta.url)),
        fields: fileURLToPath(new URL('./src/styles/fields/fields.css', import.meta.url)),
      },
      preserveEntrySignatures: 'strict',
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});

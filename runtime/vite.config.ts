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
 * names browsers without native CSS nesting, so esbuild flattens any `&` nesting in the source;
 * custom properties and color-mix() pass through untouched. Font URLs (url(../fonts/...)) are not
 * resolvable at build time and are left as written, relative to assets/dist/.
 */
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('../modules/AdminThemeBridge/assets/dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2020',
    cssTarget: ['chrome108', 'safari16', 'firefox110'],
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

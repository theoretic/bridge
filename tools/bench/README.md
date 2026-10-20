# Admin theme benchmark

Lighthouse (desktop preset, performance only, cold cache per run) and the bytes each screen
loads, for Bridge and the other admin themes, on the atispro sandbox (`tools/sandbox-site.sh`).

```bash
cd tools/bench && npm install
SB_ROOT=../../sandbox/atispro PHP=php PROBE_PASS=<sandbox password> node bench.mjs <playwright-core dir> out 3
node summary.mjs out/results.json
node regzip.mjs ../../sandbox/atispro out
```

- `bench.mjs` switches the sandbox's `uikit` user through the themes (`switch-theme.php`, which
  refuses a directory outside `sandbox/`), runs Lighthouse on the page tree, the page editor, the
  Lister and Modules, and records each request's bytes.
- `summary.mjs` prints the table (score, LCP, TBT, CLS, bytes per screen and theme).
- `regzip.mjs` re-measures the transferred files gzipped from disk (the sandbox server sends them
  uncompressed).

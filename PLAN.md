# Bridge — project plan

Working name: **Bridge**. A distribution of ProcessWire ("based on ProcessWire", never
"ProcessWire"): an unmodified upstream `wire/` plus a new admin shell on native web
components, a legacy bridge that keeps every existing jQuery-era module working, and a
bootstrap that frees the folder layout. Decided in the ProcessWire Fork Review
(2026-10-06, https://claude.ai/code/artifact/b334cb93-741e-493b-93ce-96633699e5ef).

Plan written 2026-10-14. Core facts below were checked against a local upstream checkout
of the dev branch (3.0.274), not taken from the review alone.

## 1. Decisions carried over from the review

| # | Decision | Reason |
|---|---|---|
| D1 | Distribution, not fork. `wire/` stays upstream and is replaced wholesale on upgrade. | Weekly upstream releases; one maintainer on each side. |
| D2 | Never load jQuery by default; load the full legacy stack per request when any legacy Inputfield is on the page. | Only way to keep third-party and Pro modules running unchanged. |
| D3 | Keep every DOM id/class upstream emits (`Inputfield`, `InputfieldContent`, `InputfieldHeader`, `InputfieldStateCollapsed`, `Inputfield_<name>`, `pw-modal`, `ui-widget`) and every JSON/AJAX contract (`?render=JSON`, `?modal=1`, `renderInputfieldAjax`). | Modules and hooks look for these, not for a theme. |
| D4 | Replacement core modules keep class names, hookable method names and `getModuleInfo()` keys. Register them both by `site/modules` precedence and `$config->substituteModules`. | String-addressed hooks; two mechanisms must break before we do. |
| D5 | Shadow DOM only for our own components; legacy markup lives in light DOM. | Legacy scripts query `document` directly. |
| D6 | Own product name, own license for own code (MIT proposed), MPL headers kept on anything derived from `wire/`. Keep the `ProcessWire\` PHP namespace. | Trademark excluded by MPL §2.3; namespace change breaks every module. |
| D7 | Phases are gated. The legacy bridge gate (phase 1) decides whether the project continues or stops at "a nicer AdminTheme". | Scope-creep risk for a solo studio. |
| D8 | Phase 1 ships publicly as an ordinary AdminTheme module. | Useful alone, recruits module authors, tests the compatibility claim in the open. |

## 2. Verified against core 3.0.274

- `ProcessWire::buildConfig()` (`wire/core/ProcessWire.php:1220-1322`) takes only `siteDir`; `$wireDir = "wire"` is hardcoded at line 1301, `templates-admin` at 1304. Confirms the review's unverified claim. Upstream PR candidate: a `wireDir` option.
- Version gates: `indexVersion = 300`, `htaccessVersion = 301` (constants at :98 and :104). Current upstream `index.php` declares 302, so the check is numeric, as the review said.
- `Modules::addPath($path)` exists (`wire/core/Modules/Modules.php:345`).
- Duplicate modules (same class in `site/modules` and `wire/modules`) are tracked by `ModulesDuplicates` (`setUseDuplicate()`, `getCurrent()`), and `ModulesFiles::getModuleFile()` resolves through it. So precedence is managed state, not undefined behaviour, but it is per-install config, which is why D4 keeps `substituteModules` as the second leg.
- Inputfield seams (`wire/core/Inputfield/Inputfield.php`): `___render()` abstract :1427, `___renderValue()` :1437, `renderReady()` :1473 (not hookable) calling `___renderReadyHook()` :1494, `___processInput()` :1523.
- Wrapper seams (`wire/core/Inputfield/InputfieldWrapper.php`): `___render()` :740, static `setMarkup()` :1970 and `setClasses()` :1994.
- `AdminThemeFramework` lives in `wire/core/Admin/`, not in `wire/modules`. Hookable: `___getPrimaryNavArray()` :417, `___getUserNavArray()` :569, `___renderFile()` :851; plus `renderExtraMarkup()` :833.
- Admin JS runtime to replace: `wire/templates-admin/scripts/inputfields.js` (3114 lines) and `main.js` (980 lines).
- Inventory: 36 core Inputfield modules, 28 Process modules, 5 Jquery modules (`JqueryCore`, `JqueryUI`, `JqueryMagnific`, `JqueryTableSorter`, `JqueryWireTabs`). AdminThemeUikit gets jQuery via `$modules->get('JqueryUI')` in its module file (:233).
- Three AdminThemes ship in core (Default, Reno, Uikit); AdminThemeBoss (installed on 21 local sites) extends Uikit and is a working example of a third-party theme.
- Module loading and refresh, found on the first live install (atis.pro, 2026-10-17; `docs/install-live.md`):
  - The loader takes a module's `autoload` from the module info cache (`Modules.info`), not from its class. With no entry it uses `true` (`ModulesLoader.php:569-570`), so a `template=admin` module is initialised at boot, before the page is known.
  - Install writes the `modules` row with `flagsAutoload` only (`ModulesInstaller.php:137-147`). The info cache and `flagsConditional` come from the rebuild at the end of install (`clearModuleInfoCache()`, :232). If that rebuild dies, the row stays and the cache has no entry for the module.
  - `Modules::refresh()` compares a snapshot of module file times and sizes and returns early when it matches (`Modules.php:2093-2099`), so Modules > Refresh and `?reset=1` repair nothing until a module file changes. An empty snapshot (`$modules->saveCache('moduleFileSnapshot', array())`) forces the rebuild. `deleteCache()` doesn't, because it leaves the `modules` table row.
  - A module whose `.config.php` calls `$modules->get()` on itself runs inside every rebuild and can loop until memory runs out (StaticPages 0.6.3, fixed in 0.6.4 by checking `$modules->refreshing`).

## 3. Local environment this project builds on

- Upstream core: one local checkout of the dev branch, refreshed by a script that wipes and re-extracts `wire/` from the dev zip. Every local site's `wire` is a junction to it. This is already the "replace `wire/` only" upgrade model the distribution needs.
- A local `_patches/` folder next to that checkout holds one hand-carried override (Uikit `pw.min.css`). Bridge replaces this habit with modules; nothing may be patched into `wire/`.
- PHP 8.5 CLI. Sites run under OSPanel (Apache or Nginx, `.osp/project.ini`).
- Sibling module projects with the conventions to copy: `FieldtypeSVGSprite` (plain module, smoke test against a real install), `MapMarkerPlus` (TypeScript + Vite, custom element `<map-marker-plus>`, classic loader script that `import()`s an ES module because admin themes only print classic `<script>` tags), `webp-hook`.
- All in-house (AT / atis.pro) modules are collected in one local folder since 2026-10-18; a `README.md` there indexes them with deployment, Bridge status (today and target) and a `PLAN.md` per module (audit, actualisation, Bridge). Native targets: SelectorTester, FieldtypeSVGSprite, MapMarkerPlus, FieldtypeSwatches, AdminPageTool 2.0.
- Test sites (local copies of studio sites): davinci (Uikit theme, FieldtypeMatrix, Fluency, BatchChildEditor, SettingsFactory, HannaCode, AdminThemeBoss, MapMarkerPlus and FieldtypeSVGSprite junctions), ofsla (widest third-party set: VersionControl, FieldtypeDatetimeAdvanced, FieldtypeSecureFile, ImportPagesCSV, UserExtras, LoginPersist), atispro (PageTableNext, CKEditor, AgentTools), livingston, paraavis.
- Gap: no Pro module (ProFields Table/Combo/RepeaterMatrix, FormBuilder, ListerPro) exists on this machine or on any client site. Postponed; see section 9.

## 4. Repository layout (target)

```
bridge/
  PLAN.md, CLAUDE.md, LICENSE, CHANGELOG.md
  docs/
    decisions/          ADRs, one file per decision (D1..D8 first)
    contract.md         the component contract: interface, events, DOM/JSON invariants (D3)
  bootstrap/            goal 3: index.php, .htaccess, project.php -> Config builder
  modules/
    AdminThemeBridge/   phase 1 shell (AdminTheme module, extends AdminThemeFramework)
      assets/dist/      built runtime (committed, like MapMarkerPlus)
      legacy/           the jQuery bridge loader + shims (WireTabs, pw-modal, reloaded event)
    Inputfield*/        phase 2 replacements, same class names as core
    Process*/           phase 3 replacements, same class names as core
  runtime/              TypeScript sources (Vite) -> modules/AdminThemeBridge/assets/dist
    components/         <pw-field>, <pw-tabs>, <pw-page-list>, <pw-dialog>, ...
    legacy/             what loads jQuery stack and re-exposes the old globals
  conformance/
    modules.txt         the module list the gate runs against
    screens.txt         admin URLs to open per site
    run.php             bootstraps a site, renders screens with Uikit and with Bridge, diffs
  tests/
    smoke.php           CLI smoke test against a real local install (sibling-project pattern)
```

Deployment to a site is the sibling pattern: a directory junction from `site/modules/<Name>` to `modules/<Name>` locally, a plain copy on servers.

## 5. Phases and gates

### Phase 0 — foundation (days)

1. Repo: git init, `.gitattributes` (`* text=auto eol=lf`), `.editorconfig` (tabs), MIT `LICENSE` for own code, `CLAUDE.md`, ADRs for D1..D8.
2. Pin upstream: record `3.0.274` as the tested version; a `conformance/upstream.txt` file holds the pin and the date.
3. Conformance baseline: `conformance/modules.txt` = every third-party module installed on the local sites (section 3) + the review's "top 30 from the directory" + the Pro set (listed, marked "postponed", see section 9). `conformance/screens.txt` = page tree, page edit (one page per template), page add, lister, module list, field edit, template edit, user edit, login, profile.
4. Bootstrap prototype (goal 3, cheap and independent): `bootstrap/index.php` that reads `project.php` (`wire`, `site`, `assets`, `templates`, `modules[]`), copies the body of `buildConfig()` with those paths substituted, and boots `new ProcessWire($config)`. Prove it on a copy of atispro with `wire/` under `vendor/` and `site/` renamed. Keep `PROCESSWIRE` index version and `.htaccess` version constants.
5. Upstream PR draft: `wireDir` option on `buildConfig()` beside `siteDir`. Send early; it shrinks step 4 to nothing if accepted.

Gate 0: the bootstrap boots atispro from a non-standard layout; smoke test green.

**Status 2026-10-14: gate 0 passed.** `tools/sandbox-site.sh` builds the sandbox (`app/` for the site, `vendor/processwire/wire` for the core, private DB `atispro_bridge`); `tests/smoke.php` runs 36 checks green. Findings while doing it:
- `Modules::addPath()` must run before `Modules::init()`, and `ProcessWire::load()` calls both back to back with no hook between. Extra module directories therefore cannot come from the bootstrap; second upstream proposal written in `docs/upstream/buildConfig-wireDir.md`.
- Upstream `buildConfig()` does not prefer `site/templates-admin/` over `wire/templates-admin/` (the review said it does); `adminTemplates` is always under `wire/`. A site-level admin runtime therefore goes through the theme, not through that path.
- `AdminThemeFramework.php:183` hardcodes `'wire/templates-admin/default.php'` as a translation context (harmless, listed in the upstream proposal).
- Module caches in the `caches` table are keyed by path relative to root (`Modules.wire/modules/`), so a sandbox must have its own database; the script does that.
- Site code itself carries literal `/site/` paths (atispro: `ready.php` hooks glob, nine templates). The bootstrap cannot fix those; a site that wants a renamed directory must use `$config->paths->*`. The smoke test reports this as a warning, not a failure.
- `bootstrap/index.php` is a modified copy of upstream `index.php` and carries the MPL 2.0 header (ADR 0006).

### Phase 1 — shell, controller, legacy bridge, conformance suite (months; the gate that matters)

Milestone 1.1 — the empty shell. `AdminThemeBridge` extends `AdminThemeFramework`, renders the frame (masthead, nav from `___getPrimaryNavArray()`, notices, footer) with its own markup, declares the wrapper via `InputfieldWrapper::setMarkup()`/`setClasses()` so every field, ours or legacy, sits in the same element. No component runtime yet; the legacy stack is loaded on every page. Behaviour must be identical to AdminThemeUikit. This is the conformance baseline, and it is deliverable 1 of the public theme.

**Status 2026-10-14: milestone 1.1 done on the atispro sandbox.** `modules/AdminThemeBridge` (module + `init.php`, `default.php`, `controller.php`, `_main/_head/_masthead/_content/_footer/_body-scripts.php`, `scripts/main.js`, `styles/main.css`) renders page tree (JSON + upstream renderer), page edit (40 Inputfields, WireTabs, language tabs, collapse, head-button clone, save), modules list, fields list, field edit (7 tabs), lister, users, with the upstream stack loaded from `$config->urls->wire`. Served by `php -S` through `tools/router.php` (`.claude/launch.json`, port 8089); two sandbox superusers `bridge` and `uikit` differ only in admin theme (`tools/sandbox-admin.php`, credentials in `sandbox/atispro/.credentials`). Findings:
- Legacy `site/templates/admin.php` files (atispro's predates the core controller move) `require($config->paths->adminTemplates . 'controller.php')`; a theme must ship `controller.php`. Upstream Uikit keeps it "for backwards compatibility". Bridge keeps it too.
- `AdminThemeUikit/_head.php` and `AdminThemeDefault/default.php` build asset URLs as `$config->urls->root . "wire/templates-admin/..."`, not from `$config->urls->wire`. Under the vendor layout those 404. Production needs a web-server alias for `/wire/` whenever `wire/` is not at the web root; `tools/router.php` does that for the sandbox. Added to the upstream proposal.
- `wire/templates-admin/styles/AdminTheme.css` carries almost nothing; every theme styles Inputfield structure itself (list reset, header/content, collapse, column widths, fieldsets, repeater items). Bridge's `styles/main.css` now holds those structural rules, written from the markup contract, not copied.
- AdminThemeBoss with "activate for all users" rewrites every user's `admin_theme` to Uikit on each request (`AdminThemeBoss::init`), and caches its CSS URL in WireCache with `expireNever`, so a copied database keeps the old layout's URL. `tools/sandbox-admin.php` switches the setting off and drops non-module WireCache rows. Conformance note for Boss: a Uikit extension should check that Uikit is the current theme before acting.
- Boss's `ready()` appends its stylesheet regardless of the current theme; harmless (one 404) but a pattern to watch in other Uikit add-ons.
- The in-app browser pane kept console errors from earlier page loads; per-screen checks use `performance.getEntriesByType('resource')` status codes instead.

Milestone 1.2 — the legacy bridge proper.
- Server side: a hook after `InputfieldWrapper::renderInputfield` (or `Inputfield::render`) marks the request as "legacy present" when an Inputfield does not implement the component contract. The theme then prints the jQuery stack in the old order with the old globals (`$`, `jQuery`, `ProcessWire.config`, `Inputfields`), `inputfields.js`, `main.js`, `JqueryWireTabs`, `JqueryMagnific`.
- Client side, mandatory anyway: AJAX-loaded fields (`renderInputfieldAjax`, repeaters, modals) arrive after page load, so `<pw-field>` must detect legacy content and lazy-load the same stack with `import()` and then fire `reloaded` exactly as upstream does. The server-side flag is only an optimisation.
- Shims kept under old names: `reloaded` event, `InputfieldStateCollapsed` handling, `Inputfields.reload()`/`.find()`, `WireTabs` API, `pw-modal` links, `ProcessWire.config.*` keys.

**Status 2026-10-14: milestone 1.2 done on the atispro sandbox.** `BridgeComponent` interface; before-hooks on `Inputfield::render/renderValue` mark every wrapper (`data-bridge-component` / `data-bridge-legacy`) and record reasons; after-hook on `ProcessController::execute` flags legacy Processes; `legacyStack=auto` (default) prints the stack only when needed, else hands the URLs to the client in print order; `scripts/main.js` loads them lazily when a `data-bridge-legacy` Inputfield enters the DOM, then `Inputfields.init()` + `reloaded`. `modules/BridgeDemo` is the proof: a native Process page with two scripts and no jQuery, a working POST, and an AJAX-fetched collapsed legacy field that pulls the eight-script stack and opens on click. `docs/contract.md` v0 written. Findings:
- `LanguageSupport` adds `LanguageTabs.js` to every admin page by hook, and it dereferences `jQuery` at load. Rule adopted: on a native page every script under `wire/modules/` is deferred with the stack, not only `Jquery*`.
- The two shared scripts (`inputfields.js`, `main.js`) must sit right after the last Jquery module script and before module scripts; `_head.php` splices them in rather than appending.
- `FilenameArray::urls()` adds version suffixes; rebuilding `$config->scripts` from its own output would double them, so the theme works on a copied array.
- Wrappers (`InputfieldForm`, `InputfieldFieldset`) are native by type: their markup is the theme's and their behaviour is the shell's. Without that rule every page would be legacy because of its form.
- A native page today has no collapse/showIf/column-width behaviour (those live in `inputfields.js`); that is milestone 1.3's `<pw-field>`.

Milestone 1.3 — the component runtime (no jQuery on a page with only our fields). `<pw-field>` owns collapse, `showIf`/`requiredIf` evaluation, error rendering, AJAX reload; `<pw-tabs>` with URL-hash state; `<pw-dialog>` for `pw-modal`; notices. Written in TypeScript, built with Vite into `assets/dist`, loaded via a classic loader script (MapMarkerPlus pattern).

**Status 2026-10-14: milestone 1.3 done on the atispro sandbox.** `runtime/` (TS + Vite, esbuild-minified ES module, 12.8 kB) loaded by the theme script on every admin page. Behaviours on upstream markup when no legacy stack: collapse (incl. AJAX-collapsed placeholder), showIf/requiredIf with the upstream selector grammar, column redistribution on hide; passive once jQuery is present (checked at event time, so a lazy-loaded stack takes over cleanly). `<pw-tabs>` and `<pw-dialog>` custom elements; `.pw-modal` links open a native dialog with the `modal=1` iframe when jQuery UI is absent. Verified on the demo page and on page edit in a dialog (40 fields inside the iframe). Findings:
- `<pw-field>` as a custom element wrapping each Inputfield was dropped: the upstream contract is `li.Inputfield` inside `ul.Inputfields` and upstream scripts select on that; a custom element cannot be a list item and customised built-ins (`is=`) are not in Safari. The behaviours are a controller over the upstream markup instead; custom elements are used where Bridge owns the markup (`pw-tabs`, `pw-dialog`, later pickers).
- Equal column heights come from flex rows in CSS; upstream's height-spacer script is not needed and its spacers are hidden.
- Upstream emits `data-required-if` only when the field is also `required`; `requiredIf` alone does nothing, on Uikit as well.
- In the browser tool, a top-level `var name` collides with `window.name` and stringifies; test snippets avoid that identifier.

Milestone 1.4 — `docs/contract.md` v1: the interface a module implements to opt into the runtime (working name `BridgeComponent`: declares the custom element tag, attributes, which events it emits), plus the list of invariants from D3. Core Inputfields are not rewritten in this phase; the contract exists so that phase 2 and third parties have a target.

**Status 2026-10-14: milestone 1.4 done.** `docs/contract.md` is version 1: invariants, `BridgeComponent` keys (`tag`, `module`, `version`), wrapper attributes (`data-bridge-component|module|version|legacy`), legacy policy, theme-script and runtime APIs, events, a "writing a component" checklist. Component modules are auto-imported by the runtime from `data-bridge-module` on the wrapper (so AJAX fragments work the same) and from `ProcessWire.config.AdminThemeBridge.process` for the Process; URLs relative to the module directory are resolved and versioned by the theme. Reference: `<pw-text>` (`modules/BridgeDemo/pw-text.js`) wraps upstream `InputfieldText` markup, counts characters, trims on blur and dispatches `change`; `ProcessBridgeDemo.mjs` marks the body. Verified: both modules import once, legacy page edit carries no module attributes and no Process descriptor.

Milestone 1.5 — conformance suite runnable: for each site in section 3 and each screen in `screens.txt`, render under Uikit and under Bridge, compare the HTML inside `#content` after normalising theme wrapper markup, and run a browser pass (the in-app browser or Playwright) that exercises collapse, show-if, repeater add, image upload, page select, date pick, save.

**Status 2026-10-14: milestone 1.5 done on the atispro sandbox.** `conformance/run.php` (HTTP, two logins, 95 screens: every template, fieldtype, template editor, configurable module, lister, users, roles, permissions, profile, login, page list JSON, modal editor) digests the module-facing content and diffs it; `conformance/README.md` lists what is compared and what is normalised. Result: 94 of 95 identical, 0 differ, 1 fails under both themes (site bug, below). Browser pass under Bridge on the editor: collapse, showIf, repeater add over AJAX, date picker, page picker, CKEditor, save (`conformance/RESULTS-2026-10-14.md`). Findings:
- The only real theme differences were Uikit's own: per-field theme settings (`themeOffset`, `themeColor`, `themeBorder`, `themeInputSize`) and Font Awesome 6 (icon selects had 1896 options under Uikit, 676 under Bridge). Bridge now sets `adminIcons` version 6.7.2 like Uikit, so icon pickers match; the theme settings are normalised away as theme-own.
- Uikit strips upstream `ui-widget` and `ui-state-*` classes and uses 0% column spacing; both normalised.
- atispro's site code carries literal `/site/` paths in 17 files (`ready.php`, `shared/autoload.php`, hooks, PageTableNext field templates, `_shared/*.php`); `tools/sandbox-site.sh` rewrites them to the sandbox layout. One page (`case` 1073) failed under both themes with `blockHeading()` undefined; a separate review of the atispro repository showed this was a sandbox artefact, not a site bug: the PageTableNext field templates load their own dependencies with single-quoted `DOCUMENT_ROOT . '/site/shared/_autoload/...'` includes, which the first (double-quote only) rewrite missed. `tools/sandbox-site.sh` rewrites both quote styles and the page renders under both themes. Lesson for the suite: a failure identical under both themes is now classed `SITE` and must be traced to the site before being reported as such.
- Login over HTTP needs the CSRF token and `login_start` from the rendered form; the form's attributes are unquoted, which the runner parses.

Gate 1 (go/no-go for the distribution): every module in `modules.txt` that is installed locally runs unchanged under Bridge, plus the "top 30" community set. The Pro set is excluded from the gate for now (section 9); the gate therefore proves community compatibility only, and the Pro claim stays unmade until section 9 is resolved. If this gate cannot be met, the project ends as a published AdminTheme and phases 2-4 are dropped.

**Gate 1 status 2026-10-14: passed for the locally installed community set.** Nine sandboxes (atispro, davinci, ofsla, livingston, paraavis, tandem-chegem, txm, testfly, sla.events; `tools/sandbox-site.sh`, `tools/gate1.sh`), 950 screens, 894 identical, 0 theme-caused differences, 0 theme-caused failures, 55 failures identical under both themes (missing sandbox images, admin page restriction, SVG validator), 1 runner normalisation gap (profile user name, fixed). 46 of 47 local modules covered (MarkupSimpleNavigation is front-end only). Browser pass: collapse, showIf, repeater add, image upload, date picker, page tree, pw-modal, save all pass. Two site bugs found and filed (testfly SiteIndex hook, odnaco SaveUID include). Directory top set (TracyDebugger, RockMigrations, RockFrontend, AdminOnSteroids) installed on the davinci sandbox and run with every admin Process page in the screen list: 156 screens, 149 identical, 0 theme-caused differences. Open items of gate 1 are closed except the commercial modules (RockPageBuilder, Padloper) and the Pro set (ADR 0009). Details in `conformance/RESULTS-2026-10-14.md`. Theme fixes the gate forced: FA6 icons, column spacing 0, `useColumnWidth = 2`.

Milestone 1.6 — visual layer (inserted 2026-10-14, after the owner's first test on the real sites: works, looks plain). Decision in `docs/decisions/0010-visual-layer-own-tokens-boss-spec.md`: own token-based CSS with AdminThemeBoss as the design spec, after comparing Boss's own CSS, Franken UI / 0build and Basecoat UI on bundle size and fit for upstream markup.

**Status 2026-10-14: milestone 1.6 done.** `runtime/src/styles/` (20 component files on ~45 tokens) builds into `modules/AdminThemeBridge/assets/dist/theme.css`: 36.9 kB raw, 7.6 kB gzip, under the 8 kB budget checked by `runtime/scripts/check-css.mjs` on every build. Roboto Condensed self-hosted (three woff2, latin + cyrillic, 81 kB, OFL). Settings: colour variant (Boss's five plus a custom hex), colour scheme auto/light/dark with a user toggle applied before first paint, logo and dark-scheme logo, extended breadcrumbs (Boss behaviour). The jQuery UI skin joined the legacy stack. Boss parity checked by computed styles of the same elements under `uikit` (Uikit + Boss blue) and `bridge`; mobile (375 px) and dark checked in the browser. Findings:
- AdminThemeBoss appends its 355 kB Uikit build on every admin request whatever the current theme, so Bridge pages had been loading it underneath; `_head.php` now drops other admin themes' assets.
- Without jQuery UI, LanguageTabs.js only toggles `LanguageSupportCurrent` and moves `uk-active` inside a `ul.uk-tab`; the panel show/hide rules are the theme's (Uikit has them in pw.css). Bridge styles them and uses `uk-tab` as a hook class.
- Boss draws fields as one continuous grid with a primary-tinted shadow per field, wrappers (form tabs) flat; Bridge matches that (`--pw-gutter: 0`).
- Switching the browser to a mobile user agent ends the ProcessWire session (fingerprint), a test-procedure note, not a defect.
- The milestone sub-budgets (4.5/6.5/7.5 kB) were estimates; the 8 kB hard limit is what the build enforces.
- UI audit 2026-10-14 (owner's report plus a screen-by-screen pass and a diff against Uikit's `pw-*.less`): notices in flow, button groups, hover nav with nested/AJAX flyouts, image field, page tree carets and pills, Lister actions and pager, ~25 structural rules upstream markup relies on, Uikit utility compat for third-party modules, dark-scheme native controls. Budget raised to 11 kB gzip (11.0 kB). Second pass on dropdowns: submenu alignment, head-button copy order, pointer placement, live search (Uikit had it in its own script). Gate rerun on nine sandboxes: 0 theme-caused differences.

Milestone 1.7 — Basecoat look (inserted 2026-10-14). The owner proposed switching the foundation to Basecoat UI. The assessment (ADR 0011) showed that most friction comes from upstream markup, jQuery widgets and `uk-*` modules, none of which Basecoat changes, and that Basecoat ships a Tailwind reset, cascade layers and generic class names. Decision: hand-port Basecoat's look onto the own token CSS. Basecoat's look wins on conflicts; the Boss presets supply the colours.

**Status 2026-10-14: milestone 1.7 done on the atispro sandbox.**
- **Token CSS:** shadcn tokens; every component file restyled. Still CSS-only, 11.3 kB gzip under a 12 kB budget. Geist self-hosted (two variable woff2 subsets, 44 kB).
- **Gate rerun on nine sandboxes:** 1,375 screens, 0 theme-caused differences, 0 failures; 62 fail identically under both themes (site).

Milestone 1.8 — owner test pass (inserted 2026-10-15). The owner used the theme on the real atispro and davinci sites and reported glitches one by one; each fix was measured in Chromium and Firefox before it was committed.

**Status 2026-10-15: milestone 1.8 done (AdminThemeBridge 0.8.0).**
- **Save without reload** in the upstream page editor (ADR 0013, `scripts/page-save.js`): Save, Publish and Save + Keep Unpublished swap the fresh editor in place; everything else keeps the classic submit. `tools/page-save-check.js`: 41/41 in both browsers.
- **Fields follow the colour scheme** (ADR 0014): a second stylesheet `fields.css` recolours field modules with the tokens in both schemes; CKEditor and TinyMCE editing areas follow, live; stylesheets added at runtime are kept in front of the theme sheets; AdminThemeUikit's custom properties map to the tokens. `tools/scheme-scan.js` on the field fixture (`tools/sandbox-fixture.php`): 87 findings to 0.
- **Chrome and widgets:**
  - the ProcessWire mark from the core (ADR 0012) and a card login with notices inside;
  - one tab design;
  - notices by result, with a working close;
  - dropdown hover reliability (`tools/dropdown-stress.js`: 0 violations);
  - an SVG select chevron;
  - asmSelect and PageAutocomplete rows alike, PageAutocomplete's list below its input;
  - FloatRange alignment and a filled slider (`--pw-range-fill`);
  - page tree branches fitted to the screen with a left scrollbar (`--pw-branch-max`).
- **Footer:** "based on ProcessWire, colours from AdminThemeBoss".
- **Upstream:** Fluency asset-path fix prepared for the owner to post (`docs/upstream/fluency-asset-paths.md`).
- **Budgets:**
  - `theme.css` 12.1 kB gzip; the owner raised its budget to 15 kB.
  - `fields.css` 4.0 of 6 kB.
- **Regression gates:** conformance on atispro 151 screens, 0 differ; smoke test green.

Publish: the theme on GitHub and in the module directory as "a native-component shell that still runs every existing field".

### Phase 2 — core Inputfields without jQuery (long tail)

Re-scoped on 2026-10-15 (ADR 0015, owner decision): core fields go **native by contract**, not by same-named replacement modules.
- **Fields without scripts of their own:** the theme declares them native by exact class. The runtime takes over the shared `inputfields.js` behaviours they rely on.
- **Fields with their own jQuery scripts:** they get native client implementations.
- **Replacement modules:** a last resort, each with its own ADR.

Milestones:
- **2.1 Groundwork.**
  - Native status decided per rendered field by exact class, never `instanceof`.
  - AJAX-collapsed legacy fields marked: today they never trigger the legacy load.
  - Native submit dropdowns: `InputfieldSubmit` adds jQuery `dropdown.js`.
  - A field lab: BridgeDemo's native Process grown to one field of each Phase-2 type, from `tools/sandbox-fixture.php` data.
  - A behaviour harness (`tools/native-check.js`).
  - A runtime size budget.
- **2.2 Shared behaviours in the runtime:**
  - change tracking (`InputfieldStateChanged`, `changed` event);
  - leave-page warning (`InputfieldFormConfirm`, `InputfieldFormSubmitted`);
  - Enter-key guard;
  - invalid field opens;
  - a `window.Inputfields` facade for the calls core and third-party code make on native pages.
- **2.3 The scriptless set native:** Text, Textarea, Checkbox, Radios, Select, Integer, Float, URL, Email, Name, plus a native Text counter (`showCount`). Multi-language variants stay legacy until language tabs are native (2.4).
- **2.4 Fields with scripts:**
  - Toggle, Checkboxes and the language tabs;
  - then the ones that carry the weight: Page, AsmSelect, PageListSelect, PageAutocomplete, Datetime, TextTags, Selector, File, Image, Repeater, PageTable.

  CKEditor and TinyMCE stay as they are (framework-agnostic editors).

**Status 2026-10-15:**
- Milestones 2.1 to 2.3 are done, and Gate 2 passed on the field lab (`tools/native-check.js --gate`, 25/25 in Chromium and Firefox).
- Milestone 2.4 is done:
  - first batch done (Toggle, Checkboxes, language tabs): 32/32 in both browsers;
  - second batch done (on-demand widget chunks, asmSelect, the Page field, PageAutocomplete, PageListSelect and its multiple variant): 47/47;
  - third batch done (Datetime, TextTags, Selector): 61/61.
- Regression: conformance 0 differ, page-save 41/41, dropdown stress 0 violations.
- File, Image, Repeater and PageTable moved to Phase 3 (owner decision, 2026-10-15). They work only with a page behind them: uploads, repeater items and table rows are saved through the page editor. So they are built and tested with the native ProcessPageEdit.
- Phase 2 is complete. Gate 2: the field lab with every Phase 2 type loads no jQuery and passes `tools/native-check.js --gate`, 61/61 in Chromium and Firefox.

Gate 2: the field lab, a native Process page with every Phase 2 core field type, loads no jQuery and passes the behaviour checks:
- change tracking, leave warning and Enter guard;
- showIf/requiredIf, collapse and columns;
- invalid-open, counter and save round trip.

The conformance suite stays green. The page editor goes jQuery-free in Phase 3 with the native ProcessPageEdit.

### Phase 3 — native Process screens

Re-scoped on 2026-10-16 (ADR 0016, owner decision): the core Process modules go **native by
contract**, like the fields in Phase 2.
- Their PHP, hookables and output stay upstream's.
- Bridge marks a Process native by exact class once the runtime replaces its scripts.
- Replacement modules are a last resort, each with its own ADR.

The page-bound fields move here from Phase 2: File, Image, Repeater and PageTable. They need
a page behind them, so they are built and tested in the page editor.

Milestones (page editor first, owner decision):
- **3.1 Groundwork and the editor frame:**
  - native Process status by exact class (`$nativeProcesses`);
  - guarded inline calls;
  - the Children tab's page tree kept legacy until 3.4;
  - native ProcessPageEdit client: WireTabs, submit dropdowns, delete, view menu, template
    change, title headline, upload guard;
  - native PageTitle and PageName;
  - `pw-panel` links;
  - in-place save without jQuery;
  - a native-only fixture page and a harness.
- **3.2 File and Image:** upload (drop, progress, resize), sort, description and tags, delete,
  the image grid and edit panel, focus, variations.
- **3.3 Repeater and PageTable:** AJAX items, add, sort, delete, depth, open and close; PageTable
  modal edits and sort.
- **3.4 The page tree:** ProcessPageList on its JSON endpoint (a `<pw-page-list>` renderer,
  pointer drag sort, actions), also in the editor's Children tab.
- **3.5 Lister:** ProcessPageLister (filters on the native Selector, results table, actions).
- **3.6 Module, Field, Template and User screens:** with InputfieldIcon and the fieldgroup
  editor.
- **3.7 The remaining core screens** (owner decision 2026-10-16), each by exact class, then
  the Gate 3 audit:
  - ProcessPageAdd, ProcessProfile, ProcessLogger;
  - ProcessRecentPages, ProcessPageClone, ProcessPageTrash: no scripts of their own, native once
    their output checks out;
  - ProcessPageEditLink: the rich text editors' link window. Their plugins read it from the
    parent through `$iframe.contents()`, so the window itself needs no jQuery.

  A screen that proves heavy is split into its own milestone. ProcessPageEditImageSelect was split
  off as 3.9.
- **3.8 Save without reload where possible** (owner decision 2026-10-16): the in-place save of
  ADR 0013 (`scripts/page-save.js`, now the page editor only) for the other edit forms:
  - module settings (`module/edit`);
  - the field and template editors;
  - the user, role and permission editors (ProcessPageType around ProcessPageEdit);
  - the profile;
  - other Process forms that post back to themselves.

  The rules are the editor's:
  - the form is posted as the browser would;
  - the redirect is followed, and form, head and notices are swapped;
  - the screen's own initialisation runs again;
  - any unexpected response falls back to the classic submit.

  These keep the classic submit:
  - adding, deleting, cloning or renaming what the URL points at;
  - module install and uninstall (the menu changes);
  - after-save actions (Save + Exit and the like);
  - uploads in progress;
  - Shift+click.

  A shared module replaces the editor-only script. It has per-screen rules: which submitters,
  what to swap, and how to init again. Each screen gets a harness case (save, notices,
  re-init, the leave warning reset).
- **3.9 Image select, Crop and Variations** (split from 3.7): ProcessPageEditImageSelect.
  Today it costs a native page editor its jQuery: the image field's Crop and Variations windows
  call `parent.jQuery`. The work:
  - talk to the parent through the theme's and runtime's APIs: reload the field, close the dialog,
    update the variation count;
  - replace the jQuery UI resizable with a native resize;
  - replace the jQuery Cropper v0.7.8 plugin with a native crop box (same data: x, y, width,
    height);
  - the image insert window of the rich text editors.

**Status 2026-10-16:** milestones 3.1 to 3.9 done.
- The page editor of a page whose fields are native loads no jQuery.
- `tools/page-edit-check.js`: 35/35 in Chromium and Firefox.
- File and Image are native: `tools/image-file-check.js` passes on atispro (33/33) and davinci (38/38) in both browsers.
  - Crop and Variations open natively since 3.9 (`tools/image-select-check.js` 21/21 on all four sandboxes); a native page editor keeps no jQuery through a crop.
- Save without reload covers the field, template, module, profile, user, role and permission editors on pages without jQuery: `tools/form-save-check.js` 18/18 on atispro (both browsers), davinci, testfly and sla.events.
- The remaining core screens are native (Add Page, Profile, Logs, Recent, Clone, Trash, the link window): `tools/screens-check.js` passes 20/20 in both browsers on atispro, davinci, testfly and sla.events.
- testfly and sla.events (sandboxes since Gate 1) now run the behaviour harnesses as well: screens, setup, page tree (testfly), page editor, Lister, repeaters.
- Gate 3 audit (third-party Process modules):
  - SettingsFactory, ProcessGeneralSettings, AgentTools, ProcessWireUpgrade and the selector testers load the stack for their Process, without errors.
  - BatchChildEditor's script, added from a ProcessPageEdit hook, now loads the stack where it renders.
  - VersionControl (ofsla sandbox, enabled for two templates there): its scripts load the stack on the page editor, revisions and the History tab work, and such pages save the classic way, so its UI stays.
- The setup and access screens are native: Modules, Fields, Templates, Users, Roles and Permissions, with InputfieldIcon and InputfieldPassword. `tools/setup-check.js` passes 27/27 in both browsers.
- The Lister is native (the Find screen): `tools/lister-check.js` 19/19 in both browsers; MarkupAdminDataTable too (sorting, mobile labels), ready for the screens of 3.6.
- The page tree is native (the Pages screen and the editor's Children tab): `tools/pagetree-check.js` 20/20 in both browsers.
- Repeater and PageTable are native: `tools/repeater-check.js` 33/33 in both browsers. PageTable edits run in the native dialog, which now has modal.js's options. atispro's home page editor loads no jQuery.
- Regression: page-save 41/41, Gate 2 61/61, conformance 0 differ, dropdown stress 0 violations.

Gate 3:
- The six screens (page tree, page editor, Lister, Modules, Fields, Templates) load no jQuery
  when everything they render is native.
- They pass behaviour checks in Chromium and Firefox.
- Conformance stays green.
- The local third-party Process modules hooking into them still work: BatchChildEditor,
  ProcessGeneralSettings, SettingsFactory, VersionControl, AgentTools. Their server hooks are
  unchanged and their scripts load the stack on demand.

ListerPro waits for section 9.

### UIkit layer (inserted 2026-10-22)

Report by ProcessShowcase's author: modules that use UIkit look broken under Bridge. Decision in `docs/decisions/0017-uikit-compatibility-layer.md`: UIkit's own stylesheet minus Base, on the tokens, in a cascade layer, and core's UIkit script, both loaded only where a page uses UIkit (markup, scripts, assets or a module's request), like the legacy stack. The acceptance test is ProcessShowcase on a clean local sandbox site.

**Status 2026-10-22: done (unreleased).**
- ProcessShowcase's pages and its UIkit page render in both schemes. Before and after screenshots, in both themes, are in the session notes (`uikit-shots/`).
- On the sandbox no core screen loads the layer.
- Smoke test green.
- Open:
  - RTL;
  - layer coverage tuning: classes worth adding to `95-uikit-compat.css` so common pages skip the layer, such as `uk-margin-large-top` and `uk-button-group`;
  - a conformance pass on the sandboxes with UIkit-using modules (Fluency, PageTableNext, AgentTools) to confirm none starts loading the layer unexpectedly.

### Multi-select and moves between fields (inserted 2026-10-30)

Owner request: select several file items, image tiles or tree pages and drag them together, and
drag files and images from one field of a page to another. Decision in
`docs/decisions/0018-multiselect-and-moves-between-fields.md`: file-manager gestures (Ctrl/Cmd,
Shift, a rubber band), a plain click keeps its meaning; moves saved at the drop through a hook on
`ProcessPageEdit::ajaxSave`, by reference within a page's files directory; a target accepts what an
upload would, and a dialog settles the rest (Replace / Swap / Leave for a single-file field).

**Status 2026-10-30: done (0.14.0, unreleased).**
- `tools/image-file-check.js` sections R to U and `tools/pagetree-check.js` section H pass in Chromium
  and Firefox on atispro; smoke test green with a server-side round trip; Gate 2 unchanged.
- Open: touch multi-select; moves between a page and its repeater items (needs a physical copy);
  Extras actions on a tree selection; WireTab headers that open while dragging over them.

### Phase 4 — distribution and politics

Bootstrap from phase 0 becomes the installer path; docs; upstream PRs (`wireDir`, a formal Inputfield component interface, an admin-fired event replacing direct `jQuery(document).on(...)`); CLA signed; module-directory listing for the theme; a name check (trademark search) before any public announcement.

## 6. Risks (short form, see review for the full table)

- Legacy bridge fails on Pro modules: cannot be tested today (section 9). Until it is, no public claim of Pro compatibility; the heaviest open-source proxies (PageTableNext, FieldtypeMatrix, Repeater, FieldtypeTable-style community modules) stand in.
- Upstream changes wrapper markup or `inputfields.js` a few times a year: pin, run upstream's test suite (published for 3.0.259+) and the conformance suite before each bump.
- Precedence treated as undefined: D4.
- Single maintainer both sides: keep the distribution thin, upstream whatever can be upstreamed.
- Name conflict: own name from day one.
- Scope creep: gates; no phase starts before the previous gate passes.

## 7. Owner decisions (2026-10-14)

1. "Bridge" is the working name; the final name is chosen before any public announcement (phase 4 name check).
2. Own code is MIT. Files derived from upstream stay MPL 2.0.
3. GitHub `theoretic/bridge` (branch `master`): private from 2026-10-14 until milestone 1.1 shipped (ADR 0008); public since 2026-10-19 with the 0.8.2 release, its history starting at that release.
4. Phase 0 bootstrap targets atispro (PageTableNext, CKEditor, AgentTools, AdminThemeBoss). Done: see gate 0 status.

5. Pro modules: postponed (section 9).

## 8. First concrete tasks

1. `git init`, `.gitattributes`, `.editorconfig`, `CLAUDE.md`, MIT `LICENSE`. Done 2026-10-14.
2. `docs/decisions/0001..0009.md` from section 1 and section 9. Done 2026-10-14.
3. `conformance/modules.txt` and `screens.txt` from section 3. Done 2026-10-14 (the "top set" needs install counts from the directory).
4. `modules/AdminThemeBridge/AdminThemeBridge.module.php` skeleton: `getModuleInfo()`, `extends AdminThemeFramework`, `init()` loading the legacy stack unconditionally, templates written fresh in the spirit of Uikit's `_main.php` split. Junction into davinci's `site/modules`, select it for the admin user, compare with Uikit.
5. `tests/smoke.php` that bootstraps atispro, renders `ProcessPageEdit` for one page under both themes, and asserts the `#content` markup matches after wrapper normalisation.

## 9. Pro modules: postponed

State (2026-10-14): no ProFields (Table, Combo, RepeaterMatrix), FormBuilder or ListerPro license exists on this machine or on any client site of the studio. Nothing to test against.

Why this is parked rather than solved: the obstacle is not technical. Pro modules are licensed per purchaser and per site, support runs through the VIP board, and Ryan supports them only on his own admin themes. Testing them on Bridge means either buying licenses for a project whose admin he does not support, or asking a licensee or Ryan himself for cooperation. Both are legal and social questions (how the project is presented, whether the community and the author see it as a distribution or as a competitor) that should be settled after phase 1 exists in public and the "based on ProcessWire" positioning has been seen to hold.

Consequences while postponed:
- Gate 1 proves community-module compatibility only. The review's claim "Pro modules run unchanged" is not made in any public text until this section is closed.
- The legacy bridge is still built to the full upstream contract (jQuery UI, `inputfields.js`, WireTabs, `reloaded`), because the Pro modules use the same runtime as the community ones. Open-source proxies with the same patterns stand in: PageTableNext and FieldtypeMatrix (atispro, davinci) for table/matrix editing, core Repeater and PageTable for nested AJAX fields, VersionControl (ofsla) for a heavy Process-side module.
- `conformance/modules.txt` keeps the Pro entries with status `postponed`, so the gap is visible in every conformance run.

Reopen when: phase 1 is public and received, or a licensee offers a test site, or Ryan responds to the upstream PRs (phase 4). Decision then: buy, borrow, or declare Pro support out of scope for the distribution.

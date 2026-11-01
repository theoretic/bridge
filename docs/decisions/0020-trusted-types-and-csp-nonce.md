# ADR 0020: Trusted Types and a nonce-based Content-Security-Policy in the admin

Status: accepted, 2026-11-01; built in 0.18.0, 0.18.1 and 0.18.4 (the 2026-11-01 audit moved the
nonce fixes ahead of the Trusted Types sweep). Implementation plan for
[theoretic/bridge#1](https://github.com/theoretic/bridge/issues/1) (adrianbj, 2026-10-28); the owner
agrees with every suggestion in it. 0.18.0 done 2026-11-01 (see "0.18.0 as built" below);
0.18.1 and 0.18.2 open.

## Context

A site whose frontend enforces `script-src 'nonce-…' 'strict-dynamic'` (no `'unsafe-inline'`) and
`require-trusted-types-for 'script'` wants the admin under the same policy. Bridge is the only
realistic base: one TypeScript runtime, native core screens without jQuery, a small theme script.

What stops it today (0.17.0, counted on 2026-11-01):

| Problem | Where |
|---|---|
| String HTML sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `DOMParser.parseFromString`, `script.text`, `document.write`) throw under Trusted Types | 88 lines in `runtime/src/` (`fields/selector.ts` 16, `fields/asmselect.ts` 16, `fields/file.ts` 5, `elements/pw-dialog.ts` 5, four each in `repeater`, `image-upload`, `files-move`, `datetime`, then one to three in 19 more files); 36 lines in `runtime/src/classic/*.js` (`lister.js` 13, `main.js` 4, `page-save.js` 5, `setup.js` 3, `screens.js` 4, `wire-tabs.js` 2, `link.js` 2, `save-wait.js` 2, one in `debug-tools.js` and `image-select.js`) |
| `script.src` is a Trusted Types sink too (`TrustedScriptURL`) | `main.js` `legacy.loadScript()`, `uikit-layer.js`, `fields/image-upload.ts` (resizer), `fields/password.ts` (banlist) |
| Re-run inline scripts get no nonce and need a `TrustedScript` | `util/scripts.ts`, `main.js` `runScripts()`, `lister.js` `runScript()` |
| `document.open(); document.write(html)` fallback | `page-save.js`, two places |
| The theme's inline `<script>` and `<style>` carry no nonce; nor do the `<script src>` tags it prints (under `'strict-dynamic'` a parser-inserted script needs the nonce even with a `src`) nor the `<link rel=modulepreload>` tags | `_head.php` (two `<style data-pw-keep>`, the config + colour-scheme script, every script tag, the preload links), `_body-scripts.php`, `_footer.php` (debug-tools script) |
| Core inline scripts the theme already rewrites still print without a nonce | `lib/AdminThemeBridgeRewrites.php` (`deferLegacyInline`, `hookFormRender`, `nativeInlineScripts`, `hookPageEditExecute`), `lib/AdminThemeBridgeTables.php` (`initTable`) |
| Core inline scripts on native screens the theme does not touch yet | `InputfieldRepeater` (`<script>ProcessWire.config['…'] = …</script>`, core 3.0.274 :647), `ProcessPageListerBookmarks` (`ProcessLister.initialized = true`, :490) |
| Inline event handler and `javascript:` URL, blocked by any CSP without `'unsafe-inline'`, nonce or not | `fields/selector.ts:383` (`onclick="return false"`), `fields/texttags.ts:117` (`href="javascript:void(0)"`) |

Vite's own preload helper is not in play: `modulePreload: false` in `runtime/vite.config.ts`, the
theme prints its own `<link rel=modulepreload>` from `_head.php`. The widget chunks arrive by
`import()` from the runtime, which `'strict-dynamic'` allows; a nonce-only policy without
`'strict-dynamic'` also needs the theme's URL in `script-src`.

Every size budget is at its ceiling (`runtime/scripts/check-css.mjs`, 2026-11-01): `main.js` 11737
of 11776 B gzip, the classic scripts 43228 of 43264 B, `runtime.js` plus its index chunk 13950 of
14000 B. Nothing below fits without a raise.

## Decision

1. **One Trusted Types policy, `bridge`, created lazily, identity for now.** The theme script
   (`scripts/main.js`, always first on the page) creates it and exposes it as
   `ProcessWireAdminTheme.trusted` (`html(s)`, `script(s)`, `scriptURL(s)`); the runtime's
   `util/trusted.ts` delegates to it and creates its own only when the runtime runs alone (the
   pattern of `util/scripts.ts`). A policy name may be created once per page, so there is never a
   second `createPolicy('bridge')`. In a browser without Trusted Types, or where the site's
   `trusted-types` directive does not list `bridge` (`createPolicy` throws), the helpers return the
   string unchanged: no behaviour change for anyone else. Sites add `bridge` to their
   `trusted-types` directive. Every HTML write goes through the helper, so a sanitiser has one place
   to go later.
2. **No string HTML where none is needed.** Clearing becomes `replaceChildren()`; text becomes
   `textContent`; icons and other one-element snippets are built with `createElement` (a tiny
   `icon(classes)` in `util/html.ts`). What remains (server fragments, templates, labels that carry
   markup) goes through `setHTML(el, html)`, `insertHTML(el, where, html)`, `parseHTML(html)`.
   Node moves use `replaceChildren(...doc.body.childNodes)` instead of copying `innerHTML`.
3. **Re-run inline scripts only when the server marked them.** `runScripts()` (theme script and
   runtime, same rule) takes the response's nonce: on a page without a nonce (no
   `meta[property=csp-nonce]`) nothing changes; on a page with one, a script runs only when its own
   nonce (the `nonce` IDL property, which survives nonce hiding, or the attribute in a parsed
   document) is non-empty and equals the response's, and the live copy gets the current page's
   nonce and its text through `createScript`. Anything else is skipped with one console warning.
   The response's nonce comes from the document's `meta[property=csp-nonce]` for a full page
   (save responses, modal documents) and from the `X-Bridge-Nonce` response header for fragments
   (AJAX fields, repeater items, PageTable, Lister results, the moves between file fields); the
   theme sends that header on every admin response where `nonce()` is non-empty. A nonce is never
   accepted just because one is present: injected markup could carry one too.
4. **No `document.write`.** When a save response cannot be swapped in, the editor navigates:
   `location.assign(res.url)` after a redirect, and otherwise to the current URL after the
   `saveNoAnswer` alert. A response that holds the editor is swapped as today.
5. **A hookable nonce on the theme.** `AdminThemeBridge::___nonce()` returns `''` by default,
   evaluated once per request and cached. A site hooks it to return its per-request value.
   `nonceAttr()` gives ` nonce='…'` (entity-escaped) or nothing. With a nonce, the theme prints
   `<meta property="csp-nonce" nonce="…">` first in `<head>` (the Vite convention; the scripts
   read `meta.nonce`) and puts the nonce on everything it emits: both `<style>` blocks, the inline
   head script, every `<script src>` it prints (core, module and its own), both `modulepreload`
   links, the `_body-scripts.php` init, the debug-tools script, and the live `<script>`,
   `<link>` elements the theme script and the runtime create (`legacy.loadScript()`, the UIkit
   layer, the image resizer, the password banlist). Script URLs assigned from script go through
   `trusted.scriptURL()`.
6. **Core inline scripts get the nonce where the theme already rewrites them, and nowhere else
   by regex.** The rewrites (`deferLegacyInline`, `hookFormRender`, `nativeInlineScripts`,
   `hookPageEditExecute`, the `initTable` rewrite) add `nonceAttr()` to the `<script>` they emit.
   More core scripts on native screens get the same treatment where the theme already looks at
   the markup: the repeater item's config, the Lister bookmarks line and the submit dropdown init
   in `hookFormRender()` (moved from `InputfieldForm::render` to `InputfieldWrapper::render`, which
   covers the repeater's AJAX item), and `window.CKEDITOR_BASEPATH` (core's
   `AdminTheme::getExtraMarkup()`) beside the vex settings in `deferLegacyInline()`. Each pattern
   is listed in `upstreamNeedles()` so `tests/smoke.php` fails when core changes it. A
   blanket pass over the whole page (every `<script>` without a nonce gets one) is rejected: it
   would vouch for injected markup as well, which is exactly what the policy exists to catch.
   Module authors who print inline scripts use `$adminTheme->nonceAttr()` themselves (contract
   section 2.1); `renderExtraMarkup()` content stays theirs.
7. **Inline handlers go.** The two attributes become listeners (`href="#"` plus
   `preventDefault`).
8. **A build guard keeps it that way.** `runtime/scripts/check-sinks.mjs` scans `runtime/src/`
   (TypeScript and classic sources) for the raw sink patterns outside `util/trusted.ts` and
   `util/html.ts` and fails `npm run build` on a hit, as `check-css.mjs` does for the budgets.
9. **A Playwright check runs the admin under an enforced policy.** `tools/csp-check.js` opens the
   native screens with Trusted Types and the nonce policy enforced and fails on any
   `securitypolicyviolation`, console error or page error; a report-only pass over every screen
   lists what the legacy stack still trips, by screen, as a baseline. `tools/ci.sh` runs the
   enforced pass (0.21.0; `tools/gate1.sh` runs the conformance suite only).
10. **Out of scope, said so in the docs.** Screens that load the legacy stack (jQuery, jQuery UI,
    `inputfields.js`, CKEditor, TinyMCE, third-party modules) keep tripping Trusted Types; a site
    runs report-only there or enforces on native screens only. `style-src` with a nonce and no
    `'unsafe-inline'` blocks the `style=""` attributes upstream and the runtime write (column
    widths, upload progress); the docs say to keep `'unsafe-inline'` for `style-src` or use
    `'unsafe-hashes'`. Nothing in `wire/` changes.

## Sending the policy

The nonce hook alone leaves every site to generate the nonce and send the header. For the
sandbox tests something has to do it anyway, so a small optional module does both:
`modules/BridgeCsp/` (autoload in the admin; config: mode `off` / `report-only` / `enforce`, the
policy as a template with `{nonce}`, default
`script-src 'nonce-{nonce}' 'strict-dynamic' 'report-sample'; object-src 'none'; base-uri 'self'; require-trusted-types-for 'script'; trusted-types bridge;`
plus an extra report-only `style-src 'self' 'nonce-{nonce}';`). It generates 16 random bytes per
request, hooks `AdminThemeBridge::nonce`, and sends `Content-Security-Policy` or
`Content-Security-Policy-Report-Only` before `ProcessController::execute`, only when the current
admin theme is AdminThemeBridge (an enforced policy under Uikit would block its inline scripts).
The sandbox scripts junction and install it like `BridgeDemo`, mode off;
`tools/sandbox-csp.php <sandbox> <mode>` switches the mode, and `tools/csp-check.js` uses it to
run report-only and set the mode back after. No cookie or query switch: anything that can weaken
the policy from the browser is a hole. A site with its own CSP infrastructure ignores the module
and hooks `nonce()`.

Shipped in the repository next to the theme (not inside its directory, so the module-only release
of AdminThemeBridge does not carry it); whether it goes to the modules directory is the owner's
call at 0.18.2.

## Plan

Three releases, each with its smoke checks and conformance run; versions as suggested.

### 0.18.0: the nonce, server side

1. `AdminThemeBridge.module.php`: `___nonce()`, `nonceAttr()`, the cached value, the
   `X-Bridge-Nonce` header for AJAX requests (`ready()` or the first `nonce()` call during an AJAX
   request), the `meta` tag in `headPlan()`'s output.
2. `_head.php`, `_body-scripts.php`, `_footer.php`: `nonceAttr()` on every `<style>`, `<script>`
   and `modulepreload` link.
3. `lib/AdminThemeBridgeRewrites.php`, `lib/AdminThemeBridgeTables.php`: `nonceAttr()` on each
   emitted `<script>`; new `hookRepeaterRender()` and the Lister bookmarks line in
   `hookFormRender()`; `upstreamNeedles()` entries for both.
4. `modules/BridgeCsp/` (or the sandbox fixture), `tools/sandbox-site.sh`,
   `tools/sandbox-admin.php`.
5. `tests/smoke.php`: `nonce()` is `''` unhooked; a hook's value reaches `nonceAttr()`, the meta,
   and every `<script`/`<style`/`modulepreload` in a rendered head (render `_head.php` through
   `includeFile()` with the hook on); the new needles.
6. `tools/csp-check.js`, report-only pass only: the baseline list of sinks per native screen.
7. `docs/contract.md` section 2: `nonce()` for module authors; CHANGELOG.

### 0.18.0 as built (2026-11-01)

Differences from the list above:

- The nonce is asked for in the hook before `ProcessController::execute`, not in `ready()`: by then
  site/ready.php and every module's `ready()` have hooked `nonce()`. Asking earlier would cache
  `''` for the request.
- No new repeater hook: `hookFormRender()` runs on `InputfieldWrapper::render`, which the
  repeater's AJAX item is. The baseline found two more core scripts on native screens, the
  submit dropdown init and `window.CKEDITOR_BASEPATH`, both now stamped and listed as needles.
- The smoke checks test the methods and the rewrites with a hooked nonce and scan the templates'
  tags. Rendering `_head.php` in the CLI is too far from a real request to prove anything.

Baseline (`tools/csp-check.js`, Chromium, atispro sandbox, 20 screens, report-only): 39 of 39
checks pass. No native screen reports a script-src violation. Script-src reports remain on legacy
screens only: ProcessLogin's cookie check (a `document.write`, left for 0.18.1) and the inline inits of
CKEditor, TinyMCE and InputfieldJson. Trusted Types reports on native screens come from the
theme's own scripts only, 13 places: `main.js` (innerHTML, `script.text`), `lister.js`
(innerHTML, `parseFromString`), `wire-tabs.js`, `screens.js`, and the runtime's index chunk and the
asmSelect, page list, repeater, image and password chunks (`script.src`). Those are the 0.18.1
sweep's list. Style-src reports are the `style=""` attributes, from upstream markup and the
runtime alike (decision 10).

Firefox (same run) agrees on the Trusted Types counts and adds one finding Chromium does not
report until a click: core's ProcessModule list prints `onclick="return confirm(…)"` on its
Delete and Install buttons (`ProcessModule.module`, `$confirmDeleteJS`, `$confirmInstallJS`).
A nonce cannot cover a handler attribute, and an enforced policy drops it without a word: Delete
would remove a module's files without asking. **Must fix in 0.18.1, before anyone enforces:** the
theme rewrites those attributes into `data-pw-confirm` (server side, known pattern, a needle) and
a delegated listener in `scripts/setup.js` asks through `Bridge.confirm`. ProcessRole's
`onclick="return false"` on disabled items goes the same way. `tools/csp-check.js` lists handlers
on native screens as WARN lines; 0.18.1 turns them into failures.

### 0.18.1 as built (2026-11-01): the nonce rule first

The 2026-11-01 audit found the nonce stamped by prefix (SE1) and fragment scripts re-run without the
rule of decision 3 (SE2). 0.18.1 fixes both: `knownInlineScripts()` matches each core script from
start to end, and both runners apply decision 3 with `responseNonce()`, with the budget raise of
item 7 below. Items 1 (the runner part), 2 (`responseNonce()`), 3 (the fetch sites) and 7 are done;
the Trusted Types sweep below moves to 0.18.4.

### 0.18.4 as built (2026-11-01)

Items 1 to 6 and 8 to 10 below are done, with these differences:
- The runtime helpers are `toHTML()`, `toScript()`, `toScriptURL()`, `parseHTML()` and
  `htmlText()` in `util/trusted.ts` (variables named `html` are common in the widgets); the
  classic scripts call `ProcessWireAdminTheme.trusted.html()` and its siblings.
- Decision 4: a save answer that is not the screen replaces the document with the parsed answer
  (inert) instead of navigating, so an error page keeps its message.
- The `ProcessModule` confirm handlers and ProcessRole's `return false` become `data-pw-confirm`
  and `data-pw-noclick` (`nativeInlineHandlers()`), only on screens with `scripts/setup.js`.
- Item 7: the budgets went to 14848 B (`runtime.js`), 12 kB (`main.js`), 4 kB (`page-save.js`)
  and 43.5 kB (the classic total); about 80 wrapped writes cost more than the estimate.
- `tools/csp-check.js --enforce` passes on every native screen in Chromium and Firefox (atispro
  sandbox): no script, handler or Trusted Types violation, and the fragment probe runs only the
  vouched script. `tools/ci.sh` runs it with the other browser checks since 0.21.0.

### 0.18.4 (was 0.18.1): Trusted Types in the scripts

1. `runtime/src/classic/main.js`: `ProcessWireAdminTheme.trusted` (policy, `html`, `script`,
   `scriptURL`, `nonce` read from the meta); `runScripts()` with the nonce rule and `createScript`;
   `legacy.loadScript()` through `scriptURL` with the nonce. `uikit-layer.js` the same.
2. `runtime/src/util/trusted.ts` (delegating), `util/html.ts` (`icon()`, `setHTML()`,
   `insertHTML()`, `parseHTML()`), `util/scripts.ts` (nonce rule). A `responseNonce(res)` helper
   next to them.
3. The sweep, file by file, smallest decision first: the 15 clearings, the text-only writes, the
   icon snippets, then the real markup through the helpers, then `parseFromString` through
   `parseHTML()`. Fetch sites that run scripts pass `responseNonce(res)` (`inputfields/facade.ts`,
   `fields/repeater.ts`, `fields/pagetable.ts`, `fields/files-move.ts`, `classic/lister.js`,
   `classic/screens.js`, `classic/page-save.js` with the document's meta).
4. `classic/page-save.js`: both `document.write` fallbacks replaced (decision 4).
5. `fields/selector.ts`, `fields/texttags.ts`: listeners instead of the attributes.
6. `runtime/scripts/check-sinks.mjs` in `npm run build`.
7. Budgets in `check-css.mjs`, owner's call, proposed: `main.js` 11776 to 12288 B, classic total
   43264 to 44032 B, `runtime.js` 14000 to 14336 B; widget chunks stay at 8 KiB (the helpers
   replace string concatenation, most chunks shrink or stay).
8. `tools/csp-check.js` enforced pass on the native screens; `tools/native-check.js --gate`
   unchanged. `tools/ci.sh` runs the enforced pass (0.21.0).
9. `tests/smoke.php`: built `main.js` contains the policy name and no `document.write`;
   `runtime.js` and the chunks contain no `document.write` / `insertAdjacentHTML(` /
   `parseFromString(` outside the helper (the minified names make this a presence check on the
   built files, the source guard is `check-sinks.mjs`).
10. `docs/contract.md` sections 4.1 (`trusted`, `runScripts` nonce rule), 4.2 (helpers), 4.3
    (no `document.write`); CHANGELOG.

### 0.18.2: docs and the issue

1. `modules/AdminThemeBridge/README.md`: a "Content Security Policy" section: the directives to
   add (`trusted-types bridge`, the nonce in `script-src` with `'strict-dynamic'` or the theme's
   URL), the `nonce()` hook example, the `BridgeCsp` module, the `style-src` note, what legacy
   screens still trip, how to run `tools/csp-check.js`.
2. `PLAN.md`: a "Trusted Types and CSP (inserted 2026-11-01)" section after the multi-select one,
   with the gate: `csp-check.js` enforced pass green on every native screen of the atispro and
   davinci sandboxes.
3. `conformance/README.md`: the enforced run as the third layer; a dated `RESULTS-*.md`.
4. Reply on the issue with the release, the policy name, the hook, and the baseline list of what
   legacy screens still report; ask for the offered test against the real site.

## Consequences

- Sites without a CSP see no change: every helper falls back to the string, `runScripts()` keeps
  its rule only on a page with a nonce.
- Every HTML write in the theme passes one function; a sanitiser or a stricter policy is a local
  change.
- Module authors printing inline scripts on native screens have a documented nonce to use; those
  who do not get the same report-only noise as the legacy stack.
- About 1 KiB more gzip across the scripts, paid for by the budget raise.

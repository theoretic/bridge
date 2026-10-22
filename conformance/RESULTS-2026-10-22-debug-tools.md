# Debug tools under AdminThemeBridge, 2026-10-22

Report: "debug tools are not visible on some pages", without saying which tools. Both were checked:
core's Debug Mode Tools (`wire/templates-admin/debug.inc`, superusers with `$config->debug`) and
TracyDebugger 5.0.72 (Tracy 2.12.x on PHP 8.5).

Setup: the clean sandbox `Z:/home/bridge-sandbox.osp` (core 3.0.274 dev, debug on, TracyDebugger
and ProcessShowcase), served by `php -S` with `tools/router.php`. User `admin` on Bridge 0.9.4,
user `uikit` on AdminThemeUikit for comparison. Headless Chromium (Playwright 1.62), 1280x900,
light and dark schemes, and a 375 px phone. For each screen the probe recorded JS errors, whether
`#debug_toggle` and `#debug` are shown, what clicking the link does, and whether the Tracy bar is
in the viewport and on top (`elementFromPoint`). A panel was then opened from the bar.

## Debug Mode Tools

`native` = no jQuery on the page (Bridge's runtime only); `stack` = legacy stack loaded.

| Screen | Bridge 0.9.4 | Bridge 0.9.5 | Uikit |
|---|---|---|---|
| page tree `page/` (native) | `$ is not defined`; panel open inline (9,004 px); link opens the current page in a dialog | hidden; link opens the panel in a dialog, sections fold | side panel |
| page edit `page/edit/?id=1` (native) | error; panel open (14,598 px); link covered by the View menu (*) | hidden; panel opens (link covered by the View menu, *) | side panel |
| page add, Lister, templates, template edit, fields, field edit, modules, module config (Bridge), users, user edit, roles, logs, log view, profile (native) | error; panel open (9,396 to 20,259 px); link opens the current page in a dialog | hidden; dialog, sections fold | side panel |
| search, module config (Tracy), Showcase, admin 404 (stack) | panel slides open inline (no `panel.js`) | dialog, sections fold | side panel |
| page edit `modal=1`, exception page (500), front end | not shown (no footer / not admin) | same | same |
| in-place save, then the panel | shows the request before the save | shows the saved page's request | full reload |
| phone 375 px | as above | dialog fills the screen | side panel |
| dark scheme | error as above | table text 250/10 (light on dark) | Uikit has no dark scheme |

(*) A separate, older bug: on a page editor with only native fields, the View tab's menu
(`#_ProcessPageEditViewDropdown`) is shown open below the form (`display: block`, no handler binds
it on native pages) and covers the footer link. It is not part of this fix.

## TracyDebugger

| Check | Bridge 0.9.4 | Bridge 0.9.5 | Uikit |
|---|---|---|---|
| bar on all 24 screens (admin, modal, exception, front end) | in view, on top | same | same |
| bar after scrolling a long page | stays fixed in view | same | same |
| bar panels (8 panels, hover) | open, readable, light and dark | same | same |
| Console panel | opens, Ace editor, `echo 6*7;` gives 42 | same | same |
| AJAX rows (page tree, Lister) | `main` + `ajax` | same | same |
| save | in-place save: two `ajax` rows, no redirect row | same (by design) | `redirect` row after the reload |
| Adminer (`setup/adminer/`) | iframe fills the window under the masthead, bar on top | same | same |
| page edit in a modal window | the window's page has its own bar; the page's bar is behind the native dialog's backdrop | same (known difference) | both bars usable (jQuery UI dialog, z-index below Tracy) |
| phone 375 px | bar 414 px wide, starts at x = -39 (cut off) | 365 px, labels hidden, fits | 365 px, fits |
| logged out (login page, front end) | no bar, no debug link (guest) | same | same |

Bridge's z-indexes go up to 200; Tracy uses 20000 (panels) and 30000 (bar), so the bar is on top
everywhere except a native dialog, which is in the top layer.

## Causes and fixes

| Finding | Side | Fix |
|---|---|---|
| `debug.inc`'s inline `$(document).ready()` throws without jQuery, so the panel is not hidden and not an accordion | core's markup on a jQuery-free admin (Bridge) | `_footer.php` prints the panel without that script (`#debug.pw-debug`); `scripts/debug-tools.js` opens it in a dialog and folds the sections on every page |
| the link is `a.pw-panel href='#debug' data-panel-id='debug'`; the runtime opened `?modal=panel&pw_panel=1#debug` | Bridge | `panelUrl()` treats `#…` as no URL |
| on stack pages no `panel.js`, so upstream's fallback slid the panel open inline | Bridge (stack without `panel.js`) | same dialog as native pages |
| the panel kept the pre-save request after an in-place save | Bridge | `page-save.js` copies the new `#debug` |
| Tracy bar labels hidden by `hidden` but shown by Tracy's own `display: inline-block` | Tracy (`Bar/assets/bar.css`, 2.10 and 2.12) | Bridge hides `#tracy-debug-bar .tracy-label[hidden]`; to report upstream (nette/tracy) |
| page's Tracy bar behind a native dialog | Bridge design (`<dialog>.showModal()`, top layer) | none; the window's own bar is there |
| View menu shown open on a native page editor | Bridge, unrelated to debug tools | follow-up |

## Checks after the fix

- probe over the 24 screens as `admin`: no `$ is not defined`, panel hidden until its link, link
  opens it in the dialog on native and stack pages;
- Tracy probe for both users, light and dark: Console, panels, redirect, Adminer, modal and debug
  panel as in the tables;
- phone: Tracy bar fits (x = 10, 365 px) under both themes;
- `tests/smoke.php` (atispro sandbox): the three new checks pass; the one failure at the time,
  "one body MutationObserver", came from another session's uncommitted `uikit-layer.js`;
- budgets: runtime 12276 of 12288 B gzip, theme.css 14648 of 15360, `scripts/debug-tools.js` 631 B.

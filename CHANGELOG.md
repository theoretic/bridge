# Changelog

## AdminThemeBridge 0.11.0: interface scale, display controls, settings per user (2026-10-27)

Asked for by the owner after the audit.

- **Interface scale**: two buttons left of the user menu make the whole admin smaller or larger, in steps from 75 % to 150 %. The scale is the root font size, and the theme's CSS now sizes everything in rem: text, spacing, controls, the masthead, dialogs, tables, the page tree (its icons too). A build step converts the sources' px (`runtime/vite.config.ts`); hairlines, border widths and media queries stay in px. The buttons turn off at either end; on phones (480 px and less) they give way to pinch zoom. Stylesheets of core and other modules that size in px keep their size.
- **The colour scheme switch** moved out of the user menu, next to the scale buttons, as an icon button that names the current scheme.
- **Scale and scheme are kept per user, in each browser**: in `localStorage` under a key the server derives from the user id with the site's secret salt (`AdminThemeBridge::prefsKey()`, an HMAC), so two users of one browser keep their own settings and nothing in the key names the user. They apply before first paint, to dialog windows too, and a change shows at once in other tabs and open dialogs. The login screen uses the last user's settings in that browser. The old browser-wide scheme (`pwScheme`) is taken over once.
- For module authors (`docs/contract.md` 4.0): the length tokens are rem; `ProcessWireAdminTheme.cssLength()` reads one in px; `pw-scale-change` fires on a scale change.
- **Field borders are light again** (after 0.11.0 was tagged, unversioned): text inputs, selects, textareas, the search box, the login fields, selectize and inline editors have the line of the WYSIWYG editors and buttons, as before 0.10.0, which had darkened them to a 3:1 edge (WCAG 1.4.11). Field edges keep their own token, `--pw-input-border`, so a site that wants the stronger edge sets it alone (for example `color-mix(in srgb, var(--foreground) 45%, var(--background))`). The darker muted text from 0.10.0 stays.

theme.css stays within its gzip budget (15,159 of 15,360 B): rem values compress as well as px.

## AdminThemeBridge 0.10.1: the module split by job, shared helpers (2026-10-27)

Fifth release from the 2026-10-27 audit: architecture. No change in behaviour, apart from the page tree fix below.

- **The theme class is split into nine traits** under `lib/` (shell, install health, legacy detection, script classification, inline rewrites, data tables, UIkit layer, components, config); the module file keeps `getModuleInfo()`, the constants, the properties, `init()`, install and uninstall (2,488 lines down to about 500). The class name and every hookable method are unchanged, so hooks such as `AdminThemeBridge::sortableDataTable` keep working. Strings in the traits are translated in their own file (`__('…', __FILE__)`), where the language translator finds them.
- **Runtime helpers in one place**: `util/html.ts` (escaping, six copies before), `util/pw.ts` (`ProcessWire.config` and the admin URL).
- **A field widget or component that fails to load** says so in a translated notice.
- **Page tree**: while a branch is dragged on a page without the legacy stack, branches are no longer cut to the screen height; the rule looked for a class nothing sets.
- **`tools/bootstrap-htaccess.php`**: writes the `.htaccess` for a layout from `bootstrap/` from the installation's own `htaccess.txt`, with every rule pointed at the real site and core directories (`app/`, `vendor/processwire/wire/`) and PHP under `vendor/` blocked. Copied unchanged, upstream's rules name `site/` and `wire/` and protect nothing in such a layout.
- Unused `closeLightbox()` removed.

Left as they are, on purpose: the hover classes the runtime sets in script (upstream's `ui-state-*` classes, which module CSS targets), and the four screen scripts that stay classic scripts rather than runtime chunks.

## AdminThemeBridge 0.10.0: keyboard, screen readers, contrast, motion, print (2026-10-27)

Fourth release from the 2026-10-27 audit: UI and accessibility.

**Seeing**
- **Form fields have a visible edge**: text inputs, selects, textareas, the search box, the login fields, selectize and inline editors are outlined at 3:1 against the page in both schemes (WCAG 1.4.11; it was 1.26:1). Buttons, dividers and table lines keep their light line. Muted text on muted backgrounds reaches 4.5:1.
- **A focus ring on every link** and focusable element that had none (nav, tabs, pager, page tree, dropdown items).
- **Reduced motion** (the system setting) stops transitions, animations and smooth scrolling everywhere, not only the page fade.
- **Phones**: data tables shown as rows use the theme's colours (upstream's light-only greys broke dark mode); page tree actions, repeater controls and field toggles have larger touch targets on touch screens.
- **Print**: every tab and every collapsed field is printed, in light colours throughout; dialogs, the lightbox and open pickers are not.

**Keyboard**
- **Dropdowns**: arrows move between the items of a menu, Escape closes it and returns to its toggle, tabbing out closes it; toggles say whether they are open (`aria-expanded`).
- **Collapsible fields** open and close from their toggle icon (Enter or Space).
- **Repeater item controls** (delete, on/off, clone, settings, insert) and the language-tabs toggle are buttons.
- **Every drag-sorted list** (repeater items, files and images, asmSelect, page autocomplete, page table rows) moves the focused item with Alt+ArrowUp / Alt+ArrowDown.

**Screen readers**
- A skip link to the content; the main navigation, breadcrumbs and pagination are named landmarks; the current section is marked (`aria-current`); the search is a search landmark with a named field.
- Notices, server and client, are a live region (`role=status`); a client-side notice can be closed.
- Icon-only links (page tree, edit next to a crumb) have names; a custom logo names its link; the login fields keep their label as name; the user menu toggle without a profile link is a button.
- Dialogs are named by their title (the frame too); the lightbox, the debug panel and the in-place save's error are translated; the page autocomplete is a combobox that tells which suggestion is active.

**Feedback**
- A field loaded by AJAX shows a spinner while it loads and a notice when it fails; a dialog is dimmed until its page arrives.
- The scheme toggle starts with the configured scheme's label; an invalid custom colour shows an error on the theme's settings instead of turning blue silently.

`tests/smoke.php` checks theme.css against 80 kB raw (was 75 kB); the gzip budget in `runtime/scripts/check-css.mjs` stays the binding one.

Not done: keyboard moving in the page tree (upstream has none either).

## AdminThemeBridge 0.9.11: less work per request and per keystroke (2026-10-27)

Third release from the 2026-10-27 audit: performance.

**Browser**
- **showIf / requiredIf**: a keystroke re-read and re-parsed every rule of the form. Rules are now parsed once per field (again only when the attribute changes), and a change re-checks only the fields whose rules name the changed control (all of them for an event from anything else).
- **New content** (AJAX fields, repeater items, dialogs) is sorted out in one linear pass (it compared every added node with every other), without options and other leaf nodes.
- The character counter updates once per keystroke (it listened to `keyup` as well) and writes only when its text changes.
- The page tree's fit to the screen, the notice band's measurement and the editors' colour sheet read the layout once per pass instead of once per branch, notice or token; the notice check on window resize waits for the next frame.

**Server**
- The script list's versioned URLs are computed once per content of the list, not about eight times per request.
- The build writes `assets/dist/manifest.php` (runtime chunks to preload, the icon font subset, the UIkit classes the theme covers); the head reads it instead of reading and scanning `runtime.js`, `fa.css` and `uikit-covered.json` on every request. It falls back to the files when the manifest is missing or older than `runtime.js`.
- The jQuery and UIkit script verdicts come from one cache query; a component's directory and version are looked up once per class; the breadcrumbs load their pages in one query; the login screen reads the logo once.
- **Browser caching**: the module's `.htaccess` marks its versioned and hashed files `immutable` for a year (Apache with `mod_headers`; the nginx rule is in `docs/install-live.md`).

Not done: loading the theme script (`scripts/main.js`) deferred. Inline scripts in the page and three other head scripts call it while the page is parsed; the gain would be on the first, uncached load only.

## AdminThemeBridge 0.9.10: failures shown, no leftovers, the rest of the audit's bugs (2026-10-27)

Second release from the 2026-10-27 audit.

**Requests that fail**
- **A repeater item that failed to load stayed empty for good**: it now loads again on the next open, and its spinner stops. An add, clone, paste or insert that fails no longer leaves a spinner placeholder in the list.
- **A page table no longer shows a server error page in place of its rows** after a failed reload; the rows stay.
- **The page list select** no longer leaves "Cancel" with no tree when the tree fails to load. **Page autocomplete** stops its spinner on an error.
- In each case the theme's notice band says the request failed, translated.

**Leftovers**
- **The date picker** is in the page only while open, and listens for outside clicks only then (one popup and one document listener per date field stayed behind, for every repeater item and selector row).
- **The autocomplete menu** likewise, with its resize listener.
- **The page tree** has one listener for `pageListRefresh` for all trees, not one per tree that stayed after the tree left (the editor's Children tab, dialogs).
- **Image upload previews** release their object URLs.
- **Repeater, image, file and page table fields** drop their state (observers, sortables) as soon as the field leaves the page, not at the next set-up.

**Server side**
- **Labels in the masthead and footer are translatable**: they were looked up in the module's translations while the translator filed them under the template.
- **Template copies in `/site/templates/AdminThemeBridge/`** find the theme's fonts, built files and preloads (they used their own directory).
- **The version is shown to signed-in users only**, in the footer and in `ProcessWire.config`.
- **The browser title names the product Bridge**, and in a modal window it is escaped. URLs printed into attributes are escaped.
- **Uninstall** removes the theme's cache entries (script verdicts, the cache-repair state).
- `tools/admin-theme-diag.php` reads AdminThemeBoss's unsaved settings as their default (on), as the theme does; a per-instance cache replaces method statics; `bootstrap/` compares paths without case on Windows and documents that `index.config.php` is not read; the dev router refuses `%5C..%5C`; the conformance diff no longer lets fields without an id overwrite each other.
- `_main.php` carries the MPL note for the lines it takes from AdminThemeUikit.

## AdminThemeBridge 0.9.9: every data table sorts, and the first audit fixes (2026-10-27)

From a full audit of the module, the runtime and the tools (bugs, UI, performance, architecture). This release has the table work and the fixes that could lose data or break a page; the rest follows in the next releases.

**Data tables**
- **Every core data table sorts by its headers without a reload**, also the ones core made unsortable: a log's entries, Sessions aside, a field's overrides, template and field tags, a page's redirects, Lister bookmarks, the page search without the Lister. A before-hook on `MarkupAdminDataTable::render` opts them in; `___sortableDataTable()` decides and can be hooked. Left out: the Lister (it sorts on the server by its own header links), InputfieldCheckboxes' table mode (its row order is posted), Sessions (replaced every few seconds), tables without a header or with one row, and third-party tables (their row order may be their value). A header without text (a checkbox or icon column) does not sort.
- **Headers show the order** (an arrow, dim until sorted), take the keyboard (Tab, Enter or Space) and say it to assistive technology (`aria-sort`, `aria-disabled`).
- **Sorting is right for more columns**: numbers, ISO dates (the log viewer's detail line) and text with numeric parts; `data-text` and the hidden keys core prints (`.sort-date`, `.pw-table-sort-value`) win over the visible text; empty cells go last both ways; rows keep their order on ties; colspan and several bodies are handled.
- **A paged table** (a log with more than 100 entries, Roles beyond 100) sorts the rows of its page and says so in the header's title. A table the log pager swaps in by AJAX is set up too.
- `AdminDataTable.sort(table, column, dir)` and `Bridge.tables.sort()`.

**Fixes**
- **A field value that contained `$(document).ready(function() { ` was changed on save** on every native screen: the rewrite of core's inline jQuery calls ran over the whole output, not only its scripts.
- An upload error message is escaped before it is shown.
- Values the runtime changes in code now send a bubbling `change` (`input` for the page name the title fills), so change tracking, the leave warning and `showIf` see them: repeater depth, sort and delete, file sort, page table sort, delete and orphan boxes, "Add new" clearing on page fields, the shift-click range in tables.
- A legacy field loaded by AJAX before the legacy stack arrives is no longer set up natively first and by upstream again after. The selector builder, datetime, page, page name, password, icon, tags and autocomplete widgets stop listening when upstream takes over (two rows per "Add", two calendars).
- Script URLs are mapped to files through the matching `$config->urls`/`$config->paths` pair, so jQuery scripts are recognised in layouts from `bootstrap/` and under `root/wire/` URLs. Verdicts are keyed by size too.
- The module-cache repair stops after five tries, waits twice as long after each, takes a database lock (two superuser requests no longer both rebuild), and tells superusers when it gives up.
- A Process placed directly in `site/modules/` no longer hides every other site script from the legacy check; field module directories are detected without `GLOB_BRACE`; `inputfields.js` and `main.js` are printed once even when a module registered them.
- The runtime's dialog labels are translated in the module's textdomain.

## AdminThemeBridge 0.9.8: the ports keep upstream's request contract (2026-10-26)

Found on a client site: typing a title on Add Page put a whole admin page under the name field. The name check fetched `./exists` without `X-Requested-With`, which jQuery's `$.get` adds, so `admin.php` answered with the full layout. Every port was then checked against the core script it replaces (06d11c1):
- **Add Page**: the name check sends the header and gets the status fragment again. `tools/screens-check.js` A checks that the status is the fragment.
- **Lister in minimal mode** (ProcessTemplate's "pages using this template", the selector's "(show)" window) loaded no results: `#lister_columns` is a hidden input there. Array values in `extraSubmitData` go as `key[]`, as `$.param` sends them.
- **Profile**: the current-password guard never ran under the in-place save, which stops the submit first (the server still refused the change). It now cancels `pw-form-save`.
- **In-place save**: a redirect elsewhere after a save no longer asks about unsaved changes.
- **Datetime**: on a translated admin the picker wrote month and day names in that language, which PHP's date parser cannot read, so the date was lost on save. The value gets English names; the calendar keeps the admin's language.
- **File fields collapsed with AJAX** got a stray empty list and no AJAX upload, sorting or drop after opening; a reloaded file field lost its sorting. Both are set up again.
- **Link dialog** on multi-language sites: the page picker passes the language, so a link inserted from another language's tab gets that language's path.
- **A file dropped outside a field** no longer opens in the browser, and a collapsed upload field opens when files are dragged over it.
- **TextTags**: a tags URL on another host no longer gets `X-Requested-With` (a CORS preflight a plain tags service may refuse), and an older answer never replaces a newer one.
- **Fields loaded with AJAX**: an error answer is not put in the field; an external script in the loaded markup runs before the scripts after it.
- **Smaller**: `Inputfields.reload(field, callback)` runs its callback; the `langTabsDC` cookie has jQuery.cookie's format (no path, secure on https); links in a `.pw-panel` window open in the main window; messages of a dialog that closes itself after saving go to SystemNotifications.

The runtime's gzip budget (`runtime.js` and its index chunk) was raised from 12 kB to 14000 B by the owner (b528b04).

## AdminThemeBridge 0.9.7: notes below a toggle's buttons (2026-10-26)

- **InputfieldToggle and InputfieldRadios** float their button group and wrap it in core's clearfix classes (`pw-clearfix`, `ui-helper-clearfix`). Bridge defined neither: jQuery UI's rule is in the deferred legacy stylesheet and AdminThemeUikit's in its own, so on a page without the legacy stack the field's notes flowed up beside the buttons (AgentTools' config, "Read-only mode"). `02-base.css` now defines both.

## AdminThemeBridge 0.9.6: core dialogs and stray output before the page (2026-10-25)

Found while checking AgentTools (Setup > Agent Tools > Migrations) on a clean sandbox site.
- **Core dialogs threw** on every page with the legacy stack since 0.9.5. Core's `ProcessWire.alert`, `confirm` and `prompt` (`templates-admin/scripts/main.js`) take their UIkit branch whenever `window.UIkit` exists, and the UIkit layer's stand-in is always there; that branch reads `ProcessWire.config.AdminThemeUikit.labels` without checking, and only AdminThemeUikit sets it. AgentTools' "Apply pending migrations" button did nothing. `_head.php` now sets those labels from the theme's own translated OK and Cancel, unless something set them already.
- **Text echoed before `<!DOCTYPE>`** by a module (AgentTools' site-map step after applying migrations, ryancramerdesign/AgentTools#16) left the admin unstyled: the parser opens `<body>` at the first text, `uikit-layer.js` in `<head>` set its scheme class on that body, and the parser then no longer merged the server's `<body class>`, so every `body.AdminThemeBridge` rule was lost. The scheme class now waits until the document is parsed. The stray text still shows, as under AdminThemeUikit.

## AdminThemeBridge 0.9.5: a UIkit layer for modules, fixes from the first user reports (2026-10-22)

Fixes for the first reports from users of the beta, reproduced on a clean sandbox site with the reported modules.
- **Nested navigation flyouts** (level 3 and deeper, e.g. Pages > Tree > a page with children) were drawn inside their parent list: the parent flyout scrolls, and a scroll box clips an absolute child. A flyout inside a flyout is now `position: fixed`, placed beside its item by `fitFlyout()` and placed again when its AJAX items arrive or its parent scrolls; on legacy pages too, where jQuery UI places the submenus. `tools/pagetree-check.js` J.
- **Add New in the content head did nothing** on Setup > Templates and the other list screens whose Add New is a button inside a link with no id. A button inside a link is now copied with its link, as AdminThemeUikit does; a copied button without an id clicks its original by reference. `tools/setup-check.js` C.
- **Debug Mode Tools** (`$config->debug`): core's `debug.inc` ends in a jQuery script that threw on every page without the legacy stack, so the whole panel stayed open below the footer and its link reopened the page in a dialog. `_footer.php` prints the panel without that script, and `scripts/debug-tools.js` opens it in a large dialog and folds its sections, on every page; an in-place save puts the saved page's request into it. If upstream changes the script, the panel is printed as before.
- **TracyDebugger's bar on a phone** no longer runs off the left edge: Bridge hides the labels Tracy marks `[hidden]`, which Tracy's own `.tracy-label` rule overrode. Screen x tool matrix in `conformance/RESULTS-2026-10-22-debug-tools.md`.
- **The View tab's menu** on a page editor without the legacy stack showed open below the form: upstream prints it after the form and names it from the toggle (`data-pw-dropdown`). The native dropdown code follows that name, places the menu under the tab inside the window, and `page-edit.js` hides it at load and after an in-place save. `tools/page-edit-check.js` G.

### A UIkit layer for modules written for AdminThemeUikit (ADR 0017)

Reported by the author of ProcessShowcase: modules that use UIkit looked broken, because AdminThemeUikit prints UIkit on every page and Bridge did not. Its UIkit page said "The active admin theme has not loaded UIkit".
- **The layer, on demand.** Pages that use UIkit get core's `uikit.min.js` and `uikit-icons.min.js`, plus `assets/dist/uikit.css` (32 kB gzip): UIkit 3.25's stylesheet without its Base component, its palette on the theme's tokens (both schemes), in `@layer uikit` so every unlayered sheet wins over it. Pages that do not use it load nothing more. UIkit's inverse rules (`.uk-light`, primary and secondary sections, tiles, cards) come after the theme's compat rules, unlayered; a small sheet (`src/styles/uikit-layer.css`) keeps button variants and media sizing.
- **When.** Setting `uikit` (auto, always, never). In auto mode the reasons are UIkit attributes and `uk-*` classes that `95-uikit-compat.css` does not cover in the rendered content, site scripts that name `UIkit`, UIkit assets a module added, and `$adminTheme->needUikit('Module')`. `uikitReasons()` is hookable. Core's own screens need it nowhere. Tooltips are no reason: `uk-tooltip` text becomes the element's `title` (core's module list, Fluency's translate icons).
- **Later content and late calls.** `scripts/uikit-layer.js` (before every module script): AJAX content with UIkit markup loads the layer, and `window.UIkit` is a stand-in that loads it on first use and replays the call (`UIkit.notification()`, `UIkit.modal.confirm().then()`).
- **AdminThemeUikit's scheme classes.** `<body>` carries `light-theme` or `dark-theme` in step with the scheme. On the layer's pages the tokens and AdminThemeUikit's custom properties also follow the class, so a preview iframe that sets it (ProcessShowcase's) gets the scheme.
- A module's stock `uikit.css` is replaced by the layer, and a module's UIkit script is no longer dropped as another theme's asset.
- Build: `runtime/scripts/build-uikit.mjs` (with `BRIDGE_WIRE`, in `npm run build`), `postcss` as a dev dependency; `check-css.mjs` checks the layer's budget and that every selector in it names UIkit.
- Classic scripts budget: the total for the scripts printed in `<head>` raised from 40 to 42 KiB gzip (40.5 kB used), owner's decision. `scripts/debug-tools.js` is no longer counted in it: `_footer.php` prints it, and only for superusers in debug mode.
- New checks (`tests/smoke.php`): the script test, the markup scan (covered classes, attributes, attribute values, titled tooltips), core's UIkit script is neither another theme's asset nor legacy, and a warning when core's UIkit differs from the layer's.
- ProcessShowcase (bridge-sandbox): every page renders its UIkit parts in both schemes, and its UIkit page compares the admin theme with stock UIkit.

## AdminThemeBridge 0.9.4: notices after a save at the bottom of a long page (2026-10-22)

An in-place save from the Save button at the bottom of a long editor showed its notices at the top of the page, out of view, and the page moved: the scroll was put back by its old position while notices in the flow and fields that set themselves up later grew the page above the button.
- Notices that arrive while their place is scrolled away are fixed just below the sticky masthead (`#notices.pw-notices-fixed`). They stay until closed or timed out, or until the page is scrolled back to the top, where they go back to their place. New `setupNoticeFloat()` and `floatNotices()` in `scripts/main.js`.
- After an in-place save the clicked Save button (or its copy in the head) stays where it was in the window, and is held there for a second while late layout settles, until the user scrolls. At the top of the page the scroll stays at the top and the notices show in their place.

## AdminThemeBridge 0.9.3: script warnings, Fluency and config screens (2026-10-21)

Fixes the script warnings that Gate 1 has counted since 0.8.8 (`conformance/RESULTS-2026-10-20.md`). A warning is a site script deferred with the legacy stack on a screen that stayed native, where it never runs.
- **Fluency** (`fluency.js`, deferred on 62 testfly and 69 txm screens, page editors among them, so its translation buttons were missing). It is vanilla apart from `$(field).trigger('change')` after each translation, and it sets itself up on window load, too early for a stack loaded later. The new hookable map `scriptNeeds()` lists such scripts as URL part => where they need jQuery: `'languages'` (a multi-language Inputfield) or an Inputfield class.
  - Where none of those fields render, the script is printed and runs without the stack (Fluency's admin menu item opens in a modal again).
  - Where one renders, it is a legacy reason (`Script:Fluency/fluency.js`), and the editor saves the classic way like every `Script:` page.
  - On multi-language sites with Fluency, page editors therefore load the stack: 70 of testfly's 125 screens are legacy. `printScripts` still prints a script everywhere.
- **A module's config screen** (ProcessModule `edit?name=X`): a jQuery script from X's own directory is a reason, whenever it was added. AdminOnSteroids (`aos_config.min.js`) and GeneralSettings (`Settings.js`) add theirs at ready and init when they see `?name=X`. That is before ProcessController::execute, so the "scripts the Process added" rule left them deferred by design. The field-module rule (A4) does not apply to them. New `moduleConfigUrl()`.
- **A Process that throws** keeps its reasons. ProcessHannaCode on testfly throws, under Uikit too (`TextformatterHannaCode::extractDefaultCodeAttrs` is missing). Core catches the exception and shows the error, so hookProcessExecute() never ran: no `Process:` reason, and `ProcessHannaCode.js` stayed deferred. `default.php` now calls `settleProcess()`, which records what the after hook would have recorded.
- `Script:` reasons name the module's directory under site/modules (`Script:Fluency/fluency.js`, `Script:AdminOnSteroids/aos_config.min.js`). Before, they named the script's own subdirectory (`scripts/`).
- `docs/contract.md` §3: the three rules and a `scriptNeeds` hook example.
- New checks (`tests/smoke.php`):
  - Fluency is in the map;
  - a map script is printed without its fields and is a reason with a multi-language field;
  - `moduleConfigUrl()` gives the module's directory on its own config screen only;
  - a module's jQuery script added before ProcessModule is a reason there and stays deferred on another module's screen;
  - a Process that threw keeps its `Process:` reason, and `settleProcess()` adds nothing after one that finished.
- Gate 1 on the five affected sandboxes: script warnings
  - testfly 63 to 0;
  - txm 69 to 0;
  - ofsla and paraavis 1 to 0;
  - davinci 116 to 113, only RockMigrations' admin-wide script, deferred on purpose.

  0 differ and 0 failed on each. Checked in the browser on testfly: on a page editor with a multi-language title, the stack loads and "Translate to all languages" shows. On the page tree, there is no jQuery, `fluency.js` is printed, and it runs without errors.

Checked on the atispro sandbox, each in Chromium and Firefox:
- conformance 162 of 163 identical, 0 differ, 0 script warnings
- Gate 2 70/70
- lister 26/26, page-edit 36/36, page-save 48/48, screens 27/27 (Firefox 26), setup 30/30, pagetree 21/21, repeater 35/35, form-save 19/19, image-select 20/20, image-file 34/34
- scheme scan 0 findings, dropdown stress 0 violations, smoke passes

## AdminThemeBridge 0.9.2: audit phase 8, tokens and contrast (2026-10-21)

Last phase of the 2026-10-20 audit.
- **Token layers** (`00-tokens.css`, audit C39), in this order:
  - light base values;
  - variant primaries;
  - dark values;
  - derived tokens (`--primary`, `--ring`, every `--pw-*` alias, every colour mix) declared on `:root`, `[data-pw-scheme]` and `[data-pw-variant]`.

  A custom property is computed where it is declared, so derived values declared on `:root` alone ignored a scheme or variant set on a subtree.
- **Contrast** (C21, re-rated in the audit: Boss's blue and pink stay, ADR 0010):
  - Text on the primary: near-black on cyan (`vibrant`) and `green`, where white was 2.25 and 2.89 to 1 (now 8.8 and 6.8). White stays on blue (3.7), pink (3.8), black and custom colours.
  - Focus ring: `--ring` is now the primary darkened toward the text colour, solid. `--ring-50` keeps its name and holds the same colour; at half opacity it was 1.5 to 2.2 to 1 against the page, now 3.4 or more.
  - Switch off track 1.3 to about 3 to 1 (`--pw-switch-off`).
  - Field toggle icon and language-tab toggle more opaque.
  - An empty language tab is italic in the plain muted colour (was 2.5 to 1).
  - Dark-scheme success and warning labels get dark text (white was 1.7).
- **rem metrics** (C25): font sizes and line heights are in rem, 68 literal px values converted, the same at the default 16px root. A larger browser font size now scales controls, buttons and the notice band (`--pw-notice-row`), not only the headings.
- **Token cleanup** (C29):
  - one status palette, `--pw-status-*` (notices, alerts and jQuery UI states read it, instead of a second hard-coded set in `14-notices.css`);
  - `--pw-notice-gap` and `--pw-notice-row` moved into the tokens;
  - the internal `--pw-text-muted-alt` merged into `--pw-text-muted`;
  - the `--pw-pointer-x` the theme script wrote and nothing read removed.

  Every public `--pw-*` name in `docs/contract.md` §4.0 stays.
- **Vendor versions** (C40) named in the recolouring headers, as checked: CKEditor 4.19.0, TinyMCE 6.8.2, selectize 0.12.4, jsoneditor 10.
- `docs/contract.md`: §4.0 on the new layers and tokens. §7 "Not covered yet" is rewritten (B26): what has been done since it was written, and what is still open (header actions, the rest of upstream's `Inputfields` API, `InputfieldFormNoWidths`). Three doc comments in `main.js` that had drifted from their functions are back above them.
- New checks:
  - `tools/screens-check.js` G: primary text and focus-ring contrast from computed colours, for every variant in both schemes. Text must reach 4.5 to 1 (3.5 for white on blue and pink), the ring 3 to 1. On 0.9.1 cyan and green failed both.
  - `runtime/scripts/check-css.mjs`: derived tokens on the three selectors, and no `var()` of an undeclared token (138 declared, 0 missing).
- Before and after screenshots of the field lab and the page editor in five variants and two schemes (`drafts/screenshots/audit-p8/`, not in the repository). The differences are the button text on cyan and green, the toggles, the switch tracks and the empty language tab.

Checked on the atispro sandbox, each in Chromium and Firefox:
- conformance 162 of 163 identical, 0 differ, 0 script warnings
- Gate 2 70/70
- lister 26/26, page-edit 36/36, page-save 48/48, screens 27/27 (Firefox 26), setup 30/30, pagetree 21/21, repeater 35/35, form-save 19/19, image-select 20/20, image-file 34/34 (upload case skipped)
- scheme scan 0 findings, dropdown stress 0 violations, smoke passes

## AdminThemeBridge 0.9.1: audit phase 7, one hookable native map (2026-10-20)

- **One map of what is native** (`$nativeBase`, `nativeMap()`; audit A19). Seven hand-kept lists and an if-chain are now one table, class => `kind` plus Process details:
  - kinds: `wrapper`, `type`, `field`, `process`;
  - `pageWidget`: Page field widgets;
  - `scripts`: a Process's stand-in scripts;
  - `scriptsAlways`: those scripts print with the stack too;
  - `saveInPlace`: the edit form saves without a reload.
  `isNativeInputfield()`, `isNativeProcess()`, `nativeProcessScripts()` (through the new `processScripts($class, $legacy)`) and `saveInPlaceProcess()` read it.
- **Wrappers by exact class** (ADR 0015 addendum): `InputfieldWrapper`, `Form`, `Fieldset`, `FieldsetOpen`, `FieldsetClose`, `FieldsetTabOpen` and `Markup` are native. Every `instanceof InputfieldWrapper` used to count, so a third-party subclass that adds scripts (`InputfieldSeoNeoPreview extends InputfieldMarkup`, seven sites) was native by inheritance. A subclass is now legacy unless the map or an override says otherwise.
- **Hookable**: `___nativeMap()` (a module adds its classes, see `docs/contract.md` §3), `___isNativeInputfield()`, `___isNativeProcess()`.
- **Per-class override in the settings**: "Native or legacy, per class" (`nativeOverrides`, one `ClassName=native` or `ClassName=legacy` per line) wins over the map, the Page field's widget and `BridgeComponent`. Lines that do not parse are shown as an error on the field. `legacyStack=always` is unchanged.
- ADR 0015 and 0016 addenda, `docs/contract.md` §3.
- New checks (`tests/smoke.php`):
  - `FieldsetOpen` and `FieldsetTabOpen` are native, a subclass of `InputfieldMarkup` is not;
  - a `nativeMap` hook makes a class native;
  - an override wins both ways, for Inputfields and Processes, and reports the lines it ignores;
  - the stand-in scripts per Process equal the 0.9.0 if-chain, with the stack too;
  - the save-in-place screens are unchanged.

- `conformance/run.php`: the script-warning check asks the page's own `legacy` flag whether a screen is native. The printed list it read before never holds the stack's scripts (they are theme assets for the comparison). The counts are unchanged: nothing is deferred on a legacy screen.
- Gate 1 on all nine sandboxes (`conformance/RESULTS-2026-10-20.md`): 0 differ and 0 failed everywhere. The script warnings point at Fluency (`fluency.js`, deferred on 62 and 69 native screens of testfly and txm, so its translation buttons are missing there) and at three module config screens; both are open, see the results file.

Checked on the atispro sandbox, each in Chromium and Firefox:
- conformance 162 of 163 identical, 0 differ
- Gate 2 70/70
- lister 26/26, page-edit 36/36, page-save 48/48, screens 26/26 (Firefox 25), setup 30/30, pagetree 21/21, repeater 35/35, form-save 19/19, image-select 20/20, image-file 34/34 (upload case skipped)
- scheme scan 0 findings, dropdown stress 0 violations, smoke passes

## AdminThemeBridge 0.9.0: audit phase 6, built classic scripts, asset loading (2026-10-20)

- **The theme's classic scripts are built** (`runtime/scripts/build-classic.mjs`, audit B20, C32). Their sources moved to `runtime/src/classic/`; their history up to 0.8.9 stays under the old path (`git log -- modules/AdminThemeBridge/scripts/main.js`), which now holds the built file. `npm run build` minifies them with esbuild into `modules/AdminThemeBridge/scripts/` under the same names, so `_head.php`, the sandboxes' junctions and `nativeProcessScripts()` keep their paths. Each file stays a plain classic script (no bundle wrapper), so its top-level globals stay globals. Source maps go to `runtime/.maps/` (not committed). Together they drop from about 75 kB to 38 kB gzip (`main.js` 20.4 to 10.1 kB). `npm run watch:classic` rebuilds on change.
- **Budgets for them** (`check-css.mjs`): each script has a gzip budget about 15 % over its 0.9.0 size, and all of them together have 40 kB. A file that is not minified (edited in place) fails the build. The CSS check now also catches `@import` and `}&` left in the output.
- **Five scripts are deferred**: `setup.js`, `screens.js`, `link.js`, `image-select.js`, `page-save.js`. Inline core code never calls them while the page parses. The rest stay blocking because inline code needs them at once: `main.js` (stand-ins, `InputfieldSubmitDropdown.init()`), `lister.js` (`ProcessLister.initialized`, Bookmarks), `page-edit.js` and `wire-tabs.js` (the editor's inline init).
- **The runtime is preloaded** (`<link rel=modulepreload>` for `runtime.js` and the chunk it imports, read from `runtime.js`; B21). It was discovered only by `import()` at the end of the body, after `main.js` ran.
- **Font Awesome subsets carry a content hash** (`fa-solid-900-subset.8d4d8a3a.woff2`, `fa-subset.mjs`; C31). A re-cut subset under the same name was served from the browser cache without its new glyphs, so those icons rendered blank. `_head.php` reads the preload name from `fa.css`.
- **Chunks of the previous build stay one more release** (`scripts/prune-chunks.mjs`, Vite `emptyOutDir: false`; B27). A tab left open across a deploy imports its runtime's lazy widget chunks, which `emptyOutDir` had deleted ("field widget failed"). The build keeps the chunks named by its own manifest and by the previous build's list (`assets/dist/chunks.json`), and removes the rest.
- **The real browser baseline** (C30): `cssTarget` is Chrome 111, Safari 16.2, Firefox 121 (`color-mix()`, `:has()`), was Chrome 108, Safari 16, Firefox 110. The README states it.
- **Lighthouse bench in the repository** (`tools/bench/`): `bench.mjs`, `summary.mjs`, `regzip.mjs`, and `switch-theme.php`, which refuses a directory outside `sandbox/` and no longer sets `HTTP_HOST`, a setting that left cached URLs behind in the sandbox. Lighthouse is its own dependency (`cd tools/bench && npm install`). Bridge only, three runs:
  - average score 98 (0.8.4: 97);
  - LCP 854 ms (908);
  - JS per screen 28, 42, 38 and 42 kB gzip (32, 51, 44, 52 at 0.8.3);
  - no full Font Awesome file fetched.
- `tests/smoke.php` reads the classic sources from `runtime/src/classic/` and checks the build: every `scripts/*.js` is the minified build of its source, the head preloads the runtime, the subsets are hashed, the chunk list exists.
- Not in this release:
  - a Geist latin-ext subset (C35: needs the font file from Fontsource, a download);
  - converting the classic scripts to TypeScript and sharing helpers with the runtime (B23, the codebase half). The sources now live next to the runtime, so they can move file by file.

Checked on the atispro sandbox, each in Chromium and Firefox, all on the first run:
- conformance 162 of 163 identical, 0 differ
- Gate 2 70/70
- lister 26/26, page-edit 36/36, page-save 48/48, screens 26/26 (Firefox 25), setup 30/30, pagetree 21/21, repeater 35/35, form-save 19/19, image-select 20/20, image-file 34/34 (upload case skipped)
- scheme scan 0 findings, dropdown stress 0 violations, smoke passes

## AdminThemeBridge 0.8.9: audit phase 5, layout and CSS (2026-10-20)

- **Notices never cover the head buttons** (`setupNotices()`, `body.pw-notices-static`): a single message or warning laid over the notice band covered the breadcrumbs, the title and the copied Save when it wrapped (a phone, a long text, debug prefixes). The theme script now measures each row and puts a list that does not fit into the flow. The band's change animates.
- **Touch opens menus instead of following them**: a tap on a top-bar toggle fired a compatibility `mouseover` (which opened the menu) and then a click that followed the link. On a phone the user menu went straight to the profile, and Logout and the scheme toggle were out of reach. Touch and pen taps now skip the hover: the first tap opens, a second one follows.
- **The top bar becomes the drawer when it does not fit** (`setupNavFit()`, `body.pw-nav-overflow`): with seven or eight sections or at 200 % zoom, items ran under the search box and the user menu. Below 960px the drawer has `100dvh`, wrapping labels and no stray flyouts.
- **Flyouts fit the screen**: a submenu's height is the room below its own top and it opens to the left at the right edge. Arrow Down on a toggle opens its menu at the first item, and focus keeps a flyout open. On legacy pages, upstream's floating menus close on scroll, and below 960px upstream no longer turns the drawer's sections into floating menus.
- **No stacked tabs before the script runs** (`body.pw-init .WireTab`, as AdminThemeUikit's `pw-init.less`), nor button menus as lists.
- **Focus**:
  - the Save split button had no focus ring (a later `box-shadow: none` won); it has one again;
  - "Choose file" shows focus;
  - under Windows high contrast (forced colours), where shadows are not drawn, every focus shows as an outline and pills and switches get borders.
- **Specificity**: `body.AdminThemeBridge a` and `.fa` outranked component rules. Their default colour and size now have no specificity (`:where()`), so breadcrumbs, link buttons (`a.ui-button`, `a.uk-button-primary`) and `.fa-lg`/`.fa-2x` keep their own. Links inside descriptions, notes and notices are underlined. With both logos configured the light scheme showed both; it shows one.
- **Smaller screens and long content**:
  - table headers wrap and a Lister that is still too wide scrolls inside its results;
  - dialogs fill a phone's screen (were 262 / 150 px);
  - head buttons wrap;
  - long titles break;
  - the logo is capped at 40vw;
  - markup tables no longer overflow their card at phone padding (`--pw-field-pad` and `--pw-field-pad-bottom` tokens);
  - the modal Lister holds 60vh, not 100vh, while its results load.
- **Repeater item headers** finally get the theme's padding over upstream's more specific rule, end long labels in an ellipsis, and show their controls on keyboard focus and on touch screens.
- Smaller fixes:
  - `#hash` targets clear the sticky masthead (`scroll-padding-top`);
  - dark `<select>` option lists;
  - stylesheets that arrive in the body (AJAX field markup) move to the same place as head ones, one copy each;
  - the page tree does not clip a dragged item;
  - `[hidden]` and `div.alert p` are scoped to upstream markup;
  - `uk-icon` matches whole names (`link` no longer matches `linkedin`), with no glyph next to Uikit's own SVG;
  - `uk-width-*@m` classes;
  - a print stylesheet (light, no masthead or notices);
  - `<meta name="color-scheme">` and the dark canvas before the stylesheets arrive.
- Not in this release: the per-component file split (C26, C34) and token-level contrast (Phase 8).
- Font Awesome subset re-cut by the build: 310 icons (`fa-exclamation-circle`, used by the runtime's notice since 0.8.7, was missing from the subset). The subset file name carries no version yet, so a browser with the old file cached shows a blank icon there until its cache expires; Phase 6 adds content hashes (C31).
- New checks:
  - `tools/screens-check.js` F, all six of which fail without the new theme script where they test it:
    - a notice that wraps goes into the flow;
    - a touch tap opens the user menu without leaving the page;
    - an overfull top bar becomes the drawer;
    - the Save toggle's focus ring;
    - a focus outline under forced colours (Chromium).
  - `tests/smoke.php`: the new rules are in `theme.css`, the scripts in `main.js`, the colour-scheme meta.
- Before and after screenshots of seven screens at 1280 and 375 px (`drafts/screenshots/audit-p5/`, not in the repository). The only differences are intended: breadcrumbs in their own muted colour, and the user icon at its 18px mobile size.

Checked on the atispro sandbox, each in Chromium and Firefox:
- conformance 162 of 163 identical, 0 differ
- Gate 2 70/70
- lister 26/26, with the layout shift at 0.009. Two first cuts shifted it to 0.454, and the gate caught both: `overflow-x` on the empty results, and hiding every tab panel during `pw-init`.
- page-edit 36/36
- page-save 48/48. Closing upstream menus on any scroll closed them right after an in-place save; now it takes 40px.
- screens 26/26 (Firefox 25: the forced-colours case is Chromium only), setup 30/30, pagetree 21/21, repeater 35/35, form-save 19/19, image-select 20/20, image-file 34/34 (upload case skipped)
- scheme scan 0 findings, dropdown stress 0 violations, smoke passes

## AdminThemeBridge 0.8.8: audit phase 4, PHP theme correctness (2026-10-20)

- **Site scripts are classified by what they run, not by what they mention** (`isJqueryScript()`, `needsJquery()`). Comments no longer count, and a script that checks for jQuery (`window.jQuery`, `typeof jQuery`) runs without it and is printed. The demo's own `ProcessBridgeDemo.js` ("No jQuery." in a comment) was deferred with the stack, so the AJAX button on the native demo page was dead. SeoNeo's guarded script had the same fate. Verdicts are now kept per file and modification time in one WireCache entry, instead of reading every site script (up to 512 kB) on every request. The new setting "Site scripts that never wait for the legacy stack" (`printScripts`, URL parts) prints a script whatever it contains.
- **A field module's script with no legacy Inputfield is a legacy reason** (ADR 0015 §3). A jQuery script from a directory holding an Inputfield or Fieldtype module was taken as that Inputfield's business. When the Fieldtype renders a core native Inputfield (FieldtypeOptionsColor with core Select or Radios), nobody recorded a reason, the script was deferred and the colour swatches never worked. It is now a `Script:` reason unless a legacy Inputfield from the same directory was rendered.
- **Inline jQuery in native markup is a legacy reason** (`Inline:InputfieldMarkup`): a markup field's `<script>` that calls jQuery (PageTableNext's config screen prints `$('#…').iFrameResize()`) threw `$ is not defined`.
- **AdminThemeBoss defaults**: a Boss install whose settings were never saved has "enable" and "activate for all users" on (`AdminThemeBossConfig::getDefaults()`). Bridge read only saved settings, so it neither warned about nor blocked the switch back to Uikit. The same applies in `tools/deploy-local.php` and `tools/sandbox-admin.php`.
- **Navigation like Uikit's**:
  - breadcrumbs are translated and use a Process's `titleMarkup`; none for guests;
  - user menu items keep `id`, `class`, `target`, `data-*` and `on*` (core 3.0.248 API);
  - the name links to the profile only with `profile-edit`.
- **Component Processes by exact class**: a subclass of a BridgeComponent Process is legacy (it may add jQuery), as for Inputfields. A relative component `module` URL resolves against the declaring class's directory.
- **`BridgeComponent` without the theme**: the interface file and the theme's include are guarded with `interface_exists()`. The snippet in `docs/contract.md` (and the demo modules) declares the one-method interface itself when the theme is not installed, instead of a fatal `require_once`.
- Smaller fixes:
  - escaped translated strings in attributes (masthead menu label, demo tabs);
  - translatable footer;
  - `maxWidth` validated (0..4000);
  - `legacyStack` limited to auto/always in the body class;
  - bootstrap errors that name server paths go to the error log, not the page;
  - `tools/deploy-local.php` takes the site directory from the config;
  - `tools/admin-theme-diag.php` handles an empty log;
  - `conformance/run.php` nullable parameter (PHP 8.4);
  - the dead Children-tab hook removed;
  - translated labels for the runtime's dialogs (`config.AdminThemeBridge.labels`).
- **Conformance shows what a matching digest hid**: deferred scripts are recorded apart from printed ones. A deferred site script on a native screen and a script outside `wire/` printed before `inputfields.js` are now reported as `WARN` lines with a count. The `_head.php` comment now states Bridge's order: the shared scripts go after the last core script, which is a superset of Uikit's order.
- New checks:
  - `tests/smoke.php`:
    - the content test (comment, guard, `$` alias);
    - the A4 rule both ways;
    - a subclass of the demo Process is not native;
    - Boss defaults and the interface guard;
    - every string the theme rewrites in core output still occurs in its core file (ProcessTemplate, ProcessField, MarkupAdminDataTable, ProcessPageEdit, LanguageTabs, ProcessPageEditImageSelect).
  - `tools/native-check.js` demo-button: the demo script is printed and its button loads the legacy field.
- `docs/contract.md` §3 (reasons), README (the new setting).

Checked on the atispro sandbox, each in Chromium and Firefox:
- conformance 162 of 163 identical, 0 differ, 0 script warnings
- Gate 2 70/70
- lister 26/26, page-edit 36/36, page-save 48/48, screens 21/21, setup 30/30, pagetree 21/21, repeater 35/35, form-save 19/19, image-select 20/20, image-file 34/34 (upload case skipped)
- scheme scan 0 findings, dropdown stress 0 violations, smoke passes

davinci (Gate 1): 159 of 171 identical, 0 differ, 11 fail identically under both themes (site). The one failure is an `Uncaught ValueError` on a page editor under Uikit only. The 116 warnings are RockMigrations' admin-wide script, deferred on native screens as designed.

## AdminThemeBridge 0.8.7: audit phase 3, who owns the page, placeholders, init once (2026-10-20)

- **AJAX placeholders no longer load the legacy stack** (`legacy.needsStack()`): the theme marks an AJAX-collapsed legacy field `data-bridge-legacy` when it renders, but only its content needs the stack. An in-place save, a repeater item or `Inputfields.reload()` that inserted such a placeholder loaded jQuery, jQuery UI and every core script mid-session and switched the runtime off. Now only the content arriving does.
- **One announcer for legacy content** (`legacy.initElement()`): an AJAX field, a repeater item or a reload with legacy fields got upstream's `reloaded` twice (the runtime's loader and the theme's observer), so field scripts without a guard bound twice. The runtime's loaders now leave legacy fields to the theme. Without jQuery `initElement()` runs the runtime's init and a native `reloaded` per field, which contract 4.3 promised after an in-place save and nothing sent.
- **Repeater items**: `reloaded` comes after the item's scripts ran, as upstream does.
- **Who owns the page** (`ProcessWireAdminTheme.upstream()`): the native dropdowns, the runtime (collapse, dependencies, dialogs), the stand-ins and the Inputfields facade decided by `window.jQuery`. A site module that loads its own jQuery switched all of them off, with no upstream script to take over. Now it takes the theme's legacy flag or upstream's `ProcessWireAdmin`.
- **A late stack no longer doubles the screen scripts** (`ProcessWireAdminTheme.handover`): upstream's `ProcessPageLister.js`, `ProcessPageEdit.js`, `ProcessField.js`, `ProcessLogger.js` … are in the deferred list. Loaded late, they bound the same controls as Bridge's `lister.js`, `page-edit.js`, `setup.js`, `screens.js`, so one Lister refresh posted twice. Those scripts' listeners now end at `pw-legacy-handover`.
- **TextTags with a late stack**: the native control carries the original's classes, as selectize's does, so upstream's `InputfieldTextTags()` tried to build a control from it and threw (`JSON.parse` of a missing `data-opts`). The control is marked `selectized` too. A field saved with tags threw at render (`insertBefore`: the chips went in before the typing input was in the box).
- **One body observer** (`ProcessWireAdminTheme.observe(fn)`): the theme's legacy watch, its page-tree fit and the runtime shared the page with three `MutationObserver`s on `<body>` for the page's lifetime. Now there is one; the legacy watch unregisters once the stack is there.
- **Batched re-init**: the runtime initialised every added node's parent on its own, and once more for each `reloaded` that followed. A repeater item with W fields meant W full rescans plus one per field. Now there is one `Inputfields.init()` per distinct root per batch, and none for a `reloaded` right after an init that covered the field.
- Smaller fixes:
  - selector builder: preview and count per builder, so two on one page no longer suppress each other; an older count answer no longer overwrites a newer one; failed requests clear the spinner.
  - Logs: polling survives a failed request and pauses while the tab is hidden.
  - `Bridge.dialog.open()` on an open dialog tells the first opener it was closed (`abort`).
  - TinyMCE editors are re-created on an OS scheme switch only once none has focus (`pw-scheme-change` `detail.source`: `toggle` or `system`).
  - A component module that fails to load shows a warning notice and dispatches `pw-component-failed`.
  - A dynamic import is retried once after a second: Firefox rejects pending imports while a page is being left.
- **Console errors are counted**: `tools/console-errors.js` collects `console.error` from every page of a check (`IGNORE_ERRORS` honoured), and every harness ends with "no console errors". It found the TextTags and Firefox import cases above.
- New checks:
  - `tools/native-check.js`: placeholder (an inserted AJAX placeholder loads nothing, its content does) and foreign-jquery (a site's own jQuery leaves collapse and dropdowns working).
  - `tools/lister-check.js` M: after a late stack load a refresh posts once.
  - `tools/repeater-check.js` B: each field of a loaded item hears `reloaded` once.
  - `tests/smoke.php`: one body observer, ownership asked of the theme, placeholder rule, hand-over signal in the screen scripts.
- `docs/contract.md` 4.1 and 4.2.

Checked on the atispro sandbox, each in Chromium and Firefox, now with "no console errors" in every harness:
- conformance 162 of 163 identical, 0 differ
- Gate 2 68/68
- lister 26/26, page-edit 36/36, page-save 48/48, screens 21/21, setup 30/30, pagetree 21/21, repeater 35/35, form-save 19/19, image-select 20/20, image-file 34/34 (upload case skipped)
- scheme scan 0 findings, dropdown stress 0 violations, smoke passes

The sandbox's missing upload files (its copy has no `assets/files`) are left out of the console count by the gate (`IGNORE_ERRORS`).

## AdminThemeBridge 0.8.6: audit phase 2, one script runner, stand-ins, Enter guard (2026-10-20)

- **One inline-script runner** (`ProcessWireAdminTheme.runScripts(rootOrScripts, {legacy})`, `runtime/src/util/scripts.ts`): the Lister, the in-place save, AJAX-collapsed fields, repeater items and `Inputfields.reload()` each had their own, differing in what they copied and skipped. Data scripts (`application/json`, `text/x-template`, `ld+json`) no longer run as JavaScript and throw, attributes such as `type=module` are kept, a `src` already on the page is not loaded twice, and `Inputfields.reload()` of a legacy field now waits for the legacy stack as the others did. The Lister runs every inline script of fresh results, as upstream's `.html(data)` does (column and extension markup lost theirs), and the field scripts of refreshed rows.
- **Stand-ins for `Inputfields`, `Bridge` and `AdminDataTable`** on pages without jQuery (`scripts/main.js`, `runtime/src/util/stubs.ts`): the runtime arrives by `import()`, which does not hold up `DOMContentLoaded`, while inline code calls these at once or at `DOMContentLoaded`. The field editor with `?focus=` (the link after a field was added to a template) threw `Inputfields is not defined` and did not focus the field. The theme script now defines a recording stand-in for each global that is still undefined; the runtime, the Inputfields facade and AdminDataTable replace it and replay its calls in order. Calls return `undefined` (the existing `|| fallback` code keeps working); `pwStub` tells a stand-in apart.
- **Enter in a text field no longer saves the page in place** (`scripts/page-save.js`): the in-place save listens in `<head>`, before upstream's and the runtime's Enter guard, and saved the page on Enter in a form with several buttons (an unpublished page's Publish / Save unpublished, users and roles), where upstream only moves the focus to the nearest button. An implicit submission (the focus in a text field, not on the submitter) is now left to the guard.
- Language tabs: the "all languages" toggle no longer calls a `stopPropagation()` that did not stop the field header's collapse (both listen on `document`); collapse skips the toggle itself, as before.
- `docs/contract.md` §4.1 (`runScripts`, the stand-ins) and §4.3 (Enter).
- New checks: `tools/setup-check.js` B `?focus=label` (no page error, the label field focused; on 0.8.5 `Inputfields is not defined`) and the stand-ins replaced; `tools/page-save-check.js` L (Enter in the title of a two-button editor saves nothing and moves the focus to a button, on a legacy and a native editor; on 0.8.5 the page was saved); `tests/smoke.php`: the runner and stand-ins in the theme script, no other runner in the classic scripts and the runtime, the Enter step-aside.

Checked on the atispro sandbox, each in Chromium and Firefox: conformance 162 of 163 identical, 0 differ; Gate 2 62/62; lister 22/22; page-edit 35/35; page-save 47/47; screens 20/20; setup 29/29; pagetree 20/20; repeater 33/33; form-save 18/18; image-select 19/19; image-file 33/33 (upload case skipped, as in 0.8.5); scheme scan 0 findings; dropdown stress 0 violations; smoke passes. With the stand-ins and the Enter step-aside switched off, setup B and page-save L fail as described.

## AdminThemeBridge 0.8.5: audit phase 1, outage and safety paths (2026-10-20)

First phase of the 2026-10-20 audit (bugs, performance, layout, architecture; findings ranked with file:line, fixed in phases).
- **Module info cache repair bounded** (`ready()`, `canRepairModuleCache()`): the 0.8.1 repair ran a full `Modules::refresh()` on every request while the cache was stale, front end and CLI included; if the rebuild that left it stale died (a module running out of memory in it, as StaticPages 0.8.0 does on a module install), it died again on every request. It now runs only for a superuser in the admin, at most once per 10 minutes (WireCache flag set before the rebuild), inside `try/catch(\Throwable)`; other requests log once per interval. The stale state itself stays harmless (`init()` sits the request out).
- **`requires ProcessWire>=3.0.227`** (was 3.0.200): `FilenameArray::urls()` is 3.0.227 and `ModulesInfo::moduleInfoCache()` 3.0.218; on an older core the theme installed and then broke every admin page once selected.
- **Legacy loader survives a missing file** (`scripts/main.js legacy.load()`): one script that failed to load rejected the loader for the session: ready handlers held forever, `pw-legacy-loading` stuck, upstream's admin never initialised, native widgets already stepped aside. Each failure is now a `console.warn` and the rest loads (as a missing file would be with the stack printed upstream); it rejects only if jQuery itself is missing, and then a later call retries. The scripts are appended at once (`async=false` keeps their order), not one after the other's load event. `ProcessWireAdmin.init()` throwing no longer keeps `pw-legacy-loaded` from firing.
- **Lister: core's `ProcessListerScript` payload handled without jQuery** (`scripts/lister.js`): the results carry jQuery code (`$.getScript` chains, `$.extend(config, configAdd)`) whenever the session's record of loaded files was reset, a Lister reset in another tab or a second Lister on the same session. Bridge ran it on pages without jQuery (`$ is not defined`), and found it by a character offset that an output filter dropping attribute quotes shifted by one (`.getScript(`: the page error reported since 0.8.3 on the sandbox, whose OutputTransformer copy was 0.4.2). It is now found by id; with jQuery it runs as upstream; without, its config is merged into `ProcessWire.config` (shallow, as `$.extend`; the theme's own key kept), its stylesheets appended and its scripts added to the deferred legacy list. A failed results request is no longer injected into the page.
- **In-place save never posts twice** (`scripts/page-save.js`, ADR 0013 amended): a response without a redirect is shown as it came (as the other editors already did) instead of posting the form again classically, which saved twice after a 500 or a hook's own answer; a request with no answer at all gets a message, not a second post.
- `tools/sandbox-admin.php` refuses a directory outside `sandbox/` (it drops cache rows and creates superusers).
- New checks: `tools/lister-check.js` L (a reset elsewhere in the session, then a refresh: the payload throws nothing, its config arrives; on the old script it fails with `$ is not defined`) and the login race fix (the check requested `?reset=1` while the page after login was still posting for its results, which made "no page errors" fail at random); `tools/native-check.js` legacy-404 (one core legacy script answers 404 while the stack loads late; on the old loader the stack stayed stuck); `tests/smoke.php`: repair refused under CLI, the 3.0.227 floor, and source checks for the three client fixes.

Checked on the atispro sandbox, rebuilt from the live site (OutputTransformer 0.5.0, StaticPages 0.8.1), each in Chromium and Firefox: conformance 162 of 163 identical, 0 differ (the 163rd fails the same under both themes, a site issue); Gate 2 62/62; lister 22/22; page-edit 35/35; page-save 41/41; screens 20/20; setup 27/27; pagetree 20/20; repeater 33/33; form-save 18/18; image-select 19/19; image-file 33/33 (upload case skipped: atispro's own upload hook, see 0.7.x); scheme scan 0 findings; dropdown stress 0 violations; smoke passes.

## AdminThemeBridge 0.8.4: Font Awesome from small subsets (2026-10-20)

An admin screen fetched about 180–300 kB of Font Awesome fonts (solid 155 kB and regular 25 kB on every screen, brands 116 kB on Modules) for a few dozen icons. Now it is 30–34 kB (all fonts with Geist: 63–74 kB instead of about 244 kB; Lighthouse, atispro sandbox), and the icons render pixel for pixel as before.
- **`runtime/scripts/fa-subset.mjs`, part of `npm run build`** (with `BRIDGE_WIRE` set to core's `wire/`):
  - finds the icons in use: `fa-*` names and `icon` keys and tables in core, Bridge and `BRIDGE_FA_SCAN` trees; raw code points in CSS and JS; core's v4 to v6 name map (`wire/core/Functions/fa.php`); `runtime/fa-icons.txt` and `BRIDGE_FA_ICONS` lists. Icon pickers and name maps (over 150 icons in one file) are skipped as catalogs.
  - writes woff2 subsets (via `subset-font`) and copies of core's full files to `assets/fonts/fa-<version>/`, and `fa.css`: core's `all.min.css` with its `@font-face` rules replaced by rules with explicit `unicode-range`. Each code point keeps the face core would use, from the subset when it holds the glyph, else from the full file.
  - **Why the rules are replaced, not added to:** core's faces have no range, so any character in a Font Awesome element (a space inside `<i class="fa">`) made the browser fetch a full face to look for it. With explicit ranges nothing else fetches a font. The space stays in each family's main subset range, so the line box keeps Font Awesome's metrics: without it icons sat a pixel lower.
- **`_head.php`** prints `fa.css` instead of core's `all.min.css` for the version it was built from (core's stylesheet otherwise), and preloads Geist latin and the solid subset.
- **`runtime/fa-icons.txt`**: icons of the modules, templates, fields and admin pages of ten production sites that core and Bridge do not use (101 names).
- **`tools/fa-icons-site.php <webroot>`** lists a site's database icons for a per-site build; **`tools/fa-coverage.js`** reports the screens that still fetch a full file.
- `check-css.mjs` budgets: `fa.css` 28 kB gzip (25.3), subsets 48 kB (36.3).

Checked on the atispro sandbox: 144 screens, none fetches a full file; 9 screens in both schemes pixel-identical to core's Font Awesome; Gate 2 61/61 in Chromium and Firefox; screens, setup, page tree and page editor checks pass; scheme scan 0 findings in both browsers. `lister-check.js` is 19/20: a page error on the first Lister load after login (`Failed to execute 'appendChild' on 'Node': Unexpected token '.'`) that the 0.8.2 build and core's Font Awesome show as well, so it comes from the sandbox's state, not from this change; open. `fa.css` is 25 kB gzip against core's 21 kB.

## AdminThemeBridge 0.8.3: the Lister loads without layout shift (2026-10-20)

Lighthouse (desktop) gave the Lister 81 against 95+ on the other screens: cumulative layout shift 0.335. Two shifts, both after the first paint:
- **The filters grew** (0.194): the selector builder hid the preview the module renders (the current selector) and showed it again a moment later in `changeAny()`. A preview with a value now stays visible from the start, already in its final `<code>` form; empty or disabled previews still hide (`fields/selector.ts`).
- **The footer jumped** (0.141): the results arrive by AJAX in an empty `#ProcessListerResults`, so the footer sat in the viewport and was pushed down when they landed. While empty, the results div keeps `min-height: 100vh`, so the footer starts below the fold (`styles/41-process.css`).

Result on the atispro sandbox: CLS 0.335 → 0.01, Lighthouse score 81 → 95. `tools/lister-check.js` check K measures the layout shift of a fresh Lister load (Chromium; reported as skipped where the browser has no layout-shift API): 20/20 in Chromium, Firefox 20/20 with K skipped. Gate 2 61/61 in both browsers, smoke passes.

## AdminThemeBridge 0.8.2: AdminThemeBoss "all users" no longer lets Bridge be selected (testfly.me, 2026-10-18)

On testfly.me, selecting Bridge in the profile ended in `Class "SiteIndex" not found` from a site hook. `docs/install-live.md` has the full account.
- **Cause:** AdminThemeBoss with "activate for all users" on. On the next request its `init()` saved the user back to Uikit. That save ran at boot, before any template file, so the site's `Pages::saved` hook ran without the autoloader its prepend file registers. The install warning about this setting is shown once and is easy to miss.
- **While that setting is on, the profile and user editors refuse Bridge:**
  - the user is saved with Uikit, which Boss would have restored anyway, so Boss has nothing to save at boot;
  - an error says why and what to switch off.
  - Tested on the testfly sandbox: with "all users" on, the superuser stays on Uikit and gets the error. With it off, Bridge is saved.
- `bossForcesUikit()` (new, public): the check behind the install warning and the refusal.

## AdminThemeBridge 0.8.1: first live install (atis.pro, 2026-10-17)

The first install on a live site left the admin without its menu, legacy scripts or font. The theme's templates rendered, but none of its set-up ran: no body classes, hooks or jQuery stack. `docs/install-live.md` has the full account and the checklist for the next live installs.
- **Cause:** a site module (StaticPages 0.6.3) ran out of memory in the module cache rebuild that ends an install. The `modules` row stayed and the module info cache had no entry for the theme. The loader then took `autoload` as `true` and initialised the theme at boot, before the page was known. Its `useAsLogin` made it current for every request, and its own set-up, which checks the page, was skipped. Modules > Refresh couldn't repair it: on 3.0.274 it skips the rebuild while no module file changed.
- **The theme repairs this itself:**
  - when it finds itself loaded at boot, it sits that request out (no `useAsLogin` takeover);
  - its new `ready()` forces a full rebuild (`repairModuleCache()`) and logs it to `admin-theme-bridge`;
  - from the next request it loads on admin pages only.
  - Tested on the atispro sandbox: with the cache entry removed, 0.8.0 rendered exactly what atis.pro showed. 0.8.1 renders Uikit on the first request and Bridge with all its set-up from the second.
- **Install warns about AdminThemeBoss "activate for all users":** that setting resets every user's theme to Uikit on each request.
- **`tools/admin-theme-diag.php` (new):** a read-only report of the installed themes, what the loader reads from the module info cache, AdminThemeBoss's settings, users' themes and the cache state. It runs on servers as the web server user.
- **`tools/deploy-local.php`:**
  - forces a full module rebuild before installing;
  - documented for servers too (atis.pro was repaired with it).
- `tests/smoke.php`: the module info cache has the conditional autoload.
- PLAN.md section 2: the core facts on module loading and refresh.

## Unreleased (phase 3, milestones 3.1 to 3.9)

Milestone 3.9, image select, Crop and Variations (`tools/image-select-check.js`: 21/21 in Chromium and Firefox on atispro, and in Chromium on davinci, testfly and sla.events):
- **ProcessPageEditImageSelect native** (`scripts/image-select.js`):
  - native resize handles and crop box in place of jQuery UI resizable and the jQuery Cropper v0.7.8 plugin, in the same markup, so their CSS still applies;
  - the size inputs, alignment, caption, min/max and HiDPI;
  - variations with the native lightbox.
- **Crop and Variations on a native page editor** open the native dialog, so the page stays without jQuery. A crop saved as a copy, or a replace, reloads the field in place (`setupProcessSave()` through `Inputfields.reload()`) and closes the dialog.
- **The rich text editors' image window** is native too. CKEditor's pwimage plugin on a legacy page still drives it through its own jQuery: choose, resize and insert all work.
- Upstream's window globals (`setupProcessSave()`, `closePWImageDialog()` and the others) answer an opener with or without jQuery.
- image-file-check's Crop case now expects the native dialog (it used to expect the stack to load).
- **Gate 3, VersionControl (ofsla sandbox, enabled there for two templates):**
  - its page-editor scripts load the stack;
  - revisions and the History tab work in Chromium and Firefox.
  - Its field revision toggles were lost after a save without reload, because its script binds at document ready. A page with such a module script (`Script:` legacy reason) now saves the classic way.
  - Field modules' own scripts (ColorPicker, PageTableNext) no longer count as `Script:` reasons: their `Inputfield:` reason covers them, and they re-initialise on `reloaded`.

Milestone 3.8, save without reload where possible (`tools/form-save-check.js`: 18/18 in Chromium and Firefox on atispro, and in Chromium on davinci, testfly and sla.events):
- **Saving in place** now covers the field, template and module editors, the profile, and the user, role and permission editors, as well as the page editor, under the same "Save without reload" setting, on pages without jQuery:
  - the screen is swapped in place and set up again;
  - its tab, open fields, scroll and focus stay;
  - a redirect elsewhere is followed, and a response without one is shown, never posted twice;
  - Save + Exit, Delete, Uninstall and Shift+click stay classic.
- **Events** `pw-form-save` (cancelable) and `pw-form-saved`; `saveInPlaceProcess()` on the server.
- `scripts/setup.js` binds its document listeners once, so its set-up can run again after a save.

Milestone 3.7, the remaining core screens (`tools/screens-check.js`: 20/20 in Chromium and Firefox on atispro and davinci):
- **ProcessPageAdd, ProcessProfile, ProcessLogger native** (`scripts/screens.js`):
  - the add form's sibling-name check and Publish buttons;
  - the profile's current-password guard;
  - the log's AJAX filter, pager and polling (global `ProcessLogger`).
- **ProcessPageEditLink native** (`scripts/link.js`): the rich text editors' link window, with the native page picker.
- **ProcessRecentPages, ProcessPageClone, ProcessPageTrash native** (no scripts of their own).
- **Gate 3 audit:**
  - a jQuery script that a site module adds while the Process runs is now a legacy reason (`Script:<dir>/<file>`). Before, BatchChildEditor's UI was left without its script on a native page editor;
  - SettingsFactory, ProcessGeneralSettings, AgentTools, ProcessWireUpgrade and the selector testers load the stack for their Process, without errors.
- `Inputfields` name lookup skips matches outside any Inputfield (the masthead search's `q`).
- ProcessPageEditImageSelect (image insert, Crop, Variations) moves to milestone 3.9.
- **Two more sandboxes**, testfly and sla.events, run the behaviour checks in both browsers:
  - testfly: all six harnesses pass;
  - sla.events: everything passes except its page tables (PageTable isn't installed there), which are skipped;
  - one sla.events Chromium run failed setup-check's Modules part; two reruns passed.

  sla.events' own OutputTransformer strips quotes inside inline scripts on admin pages, under Uikit as well. Its JS errors are site errors.
- Harnesses: page-edit-check takes `ADMIN` and `IGNORE_ERRORS`; repeater-check skips the page table parts where FieldtypePageTable is not installed.

Milestone 3.6, the setup and access screens (`tools/setup-check.js`: 27/27 in Chromium and Firefox):
- **ProcessModule, ProcessField, ProcessTemplate, ProcessUser, ProcessRole, ProcessPermission native** (exact classes): `scripts/setup.js` stands in for their scripts. Modules, Fields, Templates, Users, Roles and Permissions load no jQuery.
  - Tabs on the module lists and the field and template editors.
  - The template editor's field list: column width rows, widths dragged and saved, sorts saved at once, "create a new field" in a dialog with "Close and Add".
  - Column width slider, the role's permission tree, the user's roles, import/export.
- **InputfieldIcon and InputfieldPassword native** (`fields/icon.ts`, `fields/password.ts`): icon search; password strength (upstream's complexify, Unicode classes instead of XRegExp), confirm and mask.
- **asmSelect edit links** open the native dialog with the edit page's buttons. A save writes the field's status and description back into the item (`asmItemUpdated`).
- **The native Inputfields facade** gains `Inputfields.reload()`, `hashAction()` (`#find-<field>`) and `highlight()`. Field names resolve as upstream; a field on another WireTab shows that tab.
- **The native dialog** gains `Bridge.dialog.close()` and the options `onButton` and `moreButtons`.
- Inline jQuery in these screens is rewritten to run without it (`nativeInlineScripts()`).

Fixed: AJAX submenus (Access > Users, Roles, Permissions and other navJSON menus) showed their labels' markup as text, e.g. `<span class='PageListStatusSystemID PageListStatusSystem'>guest</span>`. Core sends labels as entity-encoded HTML, which upstream inserts as is; `loadNavJSON()` escaped them a second time.

Milestone 3.5, the Lister (`tools/lister-check.js`: 19/19 in Chromium and Firefox):
- **ProcessPageLister native** (exact class; ListerPro keeps its script): `scripts/lister.js` keeps the global `ProcessLister` and its API (refreshRow, refreshRows, refreshAll, ...). The Find screen loads no jQuery.
  - Tabs over filters, columns and bookmarks, with refresh and reset as icon tabs.
  - Results by POST after a filter or column change, pager, column sort (reversed on a second click).
  - Row actions and extras, AJAX actions with the row refreshed and its message shown, the ProcessListerScript part and inline scripts.
- **MarkupAdminDataTable native** (`fields/datatable.ts`): sortable columns (tablesorter's classes), mobile labels, shift-click ranges; a `window.AdminDataTable` stand-in. Its inline `initTable($('#id'))` passes the element where jQuery is absent (`hookDataTableRender()`).
- **`Bridge.lightbox(items, index)`** opens the native lightbox, loaded on demand (the Lister's image columns).


Milestone 3.4, the page tree (`tools/pagetree-check.js`: 20/20 in Chromium and Firefox):
- **ProcessPageList native** (`fields/pagelist.ts`, 6 kB), "actions" mode on upstream's markup and JSON endpoint: the Pages screen and the page editor's Children tab load no jQuery.
  - Open and close (the home page closes the rest), remembered open items with their pre-rendered data, hover actions, qty types, More and pagination.
  - Extra actions over AJAX (hide, unhide, publish, lock, trash, ...), with the item updated in place.
  - Move by dragging among the visible items, also into an open item without visible children; order and parent saved, counts adjusted.
  - `pageListRefresh`, `pageListChildrenDone`, `pageMoved` as upstream.
- **`pagelist_open` is written as CSV** (`1-0,1568-0`): the server parses it as a CSV list, so the JSON array upstream's jquery.cookie writes never reopened anything. It is also written when the children arrive, not 250 ms later.
- **Native dialog:** `.pw-modal-longclick` (followed on a click, dialog on a 600 ms press: the tree's Edit and View) and `.pw-modal-dblclick` as in modal.js; before, any `.pw-modal` click opened the dialog.
- Fixture: `/bridge-tree/` with 60 children (pagination, More, moves).
- `tools/page-edit-check.js`: the Children tab now shows its tree without loading jQuery.


Milestone 3.3, Repeater and PageTable (`tools/repeater-check.js`: 33/33 in Chromium and Firefox):
- **InputfieldRepeater and InputfieldPageTable native** (exact class). atispro's real home page (a repeater of native fields) now opens without jQuery.
- **Repeater** (`fields/repeater.ts`, 6.8 kB):
  - item controls, items loaded and added by AJAX, insert before / after, copy / clone / paste through a native choice dialog (`util/choose.ts`, in place of vex);
  - drag sort by the handle, depth by a sideways drag, family-friendly children;
  - min / max items, remembered open items, accordion, family open/close; upstream's events.
- **PageTable** (`fields/pagetable.ts`): add and edit in the native dialog, table reload after a save, row sort, delete marks, double click to edit.
- **Native dialog with modal.js parity** (`elements/pw-dialog.ts`): `data-buttons` in the dialog's footer, `data-autoclose` after a save without errors, `data-close`, `.pw-modal-cancel`, the link's title; `pw-modal-closed` on the link and on document with `abort`; options for scripts (`Bridge.dialog.open(url, size, options)`). Each opening gets a fresh iframe: a reopen right after a close raced the blank page in Firefox.
- `util/sortable.ts` reports the pointer offset (`move`, `stop`).
- Fixture: two repeaters (one with depth 2, min 1, max 5) and a page table whose rows live under their own parent; repeater depth set with `setDepth()` (it is the item name's leading dashes).
- Note for checks on atispro: every save there cleans the site's static cache (about 5 s), so the harnesses wait on states, not times.


Milestone 3.2, File and Image (`tools/image-file-check.js`: atispro 33/33, davinci 38/38, Chromium and Firefox):
- **InputfieldFile and InputfieldImage native** (exact class; subclasses such as third-party image fields stay legacy). The fixture editor with three image fields' worth of content and files loads no jQuery.
  - Shared AJAX upload (`fields/upload.ts`) on upstream's contract: file input, drop on the field; progress rows, server markup placed as upstream places it, errors.
  - Files (`fields/file.ts`): drag sort, delete box (double click: all), tags as the native tag control.
  - Images (`fields/image.ts`, 5.6 kB): list / left / grid modes and the size range, kept in upstream's `InputfieldImage` cookie; edit panel; drag sort; trash; rename; action note; width classes; full-size lightbox (`util/lightbox.ts`, in place of Magnific Popup).
  - Image uploads (`fields/image-upload.ts`, on demand): also a drop between images and a drop on the edit panel's image (replace), browser-side resizing with upstream's PWImageResizer.
  - Focus point and zoom (`fields/image-focus.ts`, on demand) with pointer events.
- **Crop and Variations** open windows that call `parent.jQuery`: on a page without the stack a click loads it first, then upstream's modal opens. The new `pw-legacy-handover` event lets the native File and Image widgets give their fields back to upstream before its ready handlers run.
- **Site scripts written against jQuery are deferred** with the stack (`isJqueryScript()`): RockMigrations' admin script threw `$ is not defined` on every native page of davinci.
- `util/sortable.ts`: a drag threshold (a press that does not move stays a click) and an `enabled` check; the browser's own drag of images and links inside items is blocked during a sort.
- `util/cookie.ts`: cookies in jquery.cookie's format (JSON values), shared with upstream scripts.
- Sandboxes: `vendor/autoload.php` loads the site's Composer packages (`tools/sandbox-site.sh`); the fixture page gets images, a single image and files; the fixture creates its files directory explicitly.
- Found on the way, outside Bridge:
  - atispro's own image upload hook (`site/shared/hooks/pageimage.lqip.php` via `lqipStyle.php`) fails on every image upload: FileCompiler turns `Config::fromArray()` (imported with `use Atispro\Img\Config`) into `\ProcessWire\Config::fromArray()`. It fails the same under every admin theme, so the harness skips the image upload there (`NO_IMAGE_UPLOAD=1`) and runs it on davinci.
  - On davinci, Fluency loads `fluency.bundle.js` from a relative URL (the upstream issue prepared in `docs/upstream/`); the harness ignores its page error there (`IGNORE_ERRORS`).
- Regression: page-edit 35/35, page-save 41/41, Gate 2 61/61 (both browsers), conformance 0 differ (atispro 158 screens, davinci 166), smoke passes.


Phase 3 re-scoped (ADR 0016, owner decision): the core Process screens go native by contract, like the fields. Upstream PHP, hookables and markup stay; the theme stands in for their scripts. Page editor first.

Milestone 3.1, the page editor frame (`tools/page-edit-check.js`: 35/35 in Chromium and Firefox):
- **Native Process status** by exact class (`$nativeProcesses`, `isNativeProcess()`); ProcessPageEdit is the first. A page editor whose fields are all native loads no jQuery; one legacy field still loads the stack, and upstream's scripts then run as before.
- **WireTabs without jQuery** (`scripts/wire-tabs.js`): same options, markup, cookie, `?WireTab=` and `#hash`. jQuery's `wiretabclick` is still sent when jQuery is there, plus a native `pw-wiretabs-change`.
- **Page editor without jQuery** (`scripts/page-edit.js`), standing in for `ProcessPageEdit.js`. Upstream's inline `initPageEditForm()` call falls back to it (`hookPageEditExecute()`). It covers:
  - tabs, Delete with its confirm box, the upload guard;
  - the after-save dropdowns, off while the template is changed;
  - the View menu, the Delete tab hiding the other buttons;
  - the headline following the title.
- **Page name and title native** (runtime `fields/pagename.ts`): the URL preview and sanitizing, and the title filling the name.
- **Children tab:** its page tree stays legacy until the page tree is native (3.4). The field is marked `data-bridge-legacy="ProcessPageList"` (`hookPageEditChildren()`), and the stack loads when the tab opens.
- **Save without reload** works on the native editor too; the tab and the open fields are restored without jQuery.
- **Shared fixes found on the way:**
  - AJAX-loaded field content runs its inline scripts (legacy content once the stack is there).
  - An AJAX tab loads when it opens.
  - A late-loaded stack queues jQuery ready handlers until its last script (upstream ProcessPageList.js calls its plugin before defining it).
  - Head-button copies get their dropdown menu on pages without jQuery.
  - `.pw-panel` links open in the native dialog.
- **Image field:** the Crop, Focus and Variations buttons and the actions select wrap as one flex row with a 12px row gap, so a select that wraps below the buttons no longer touches them; its 3px focus ring is clear. The theme's buttons have no bottom margin, and upstream relied on one. Narrow fields stay centred. A scan for buttons touching a control above or below them found no other case on atispro, txm and davinci (page editors, all tabs, image modes, repeater items, setup screens), at 1400, 900 and 390 px in Chromium and Firefox.
- **Fixtures** (`tools/sandbox-fixture.php`): `/bridge-native/`, a native-only page with a custom tab, and `/bridge-native-parent/` with two children.
- **Budget check:** the runtime is now measured as `runtime.js` plus the chunks it imports. Since the widget split the entry was a stub and its core chunk was checked against the widget budget.
- **Regression:** page-save 41/41, native-check gate 61/61 (both browsers), conformance 158 screens with 0 differ, dropdown stress 0 violations on the native and the legacy editor, smoke passes.

## Phase 2 (milestones 2.1 to 2.4)

Phase 2 complete: Gate 2 passed, `tools/native-check.js --gate` 61/61 in Chromium and Firefox. File, Image, Repeater and PageTable moved to Phase 3 (owner decision): they need a page behind them and are built with the native page editor.

After Gate 2:
- Notices from a page save (in place, or classic: the editor reloaded with `?s=1`) fade out after 10 s (`setupNoticeTimeout()` in `scripts/main.js`). Pointer over them or focus inside pauses the countdown, which resumes with the time left. Notices that include an error stay until closed; other screens keep their notices. The fade (also on close) is skipped under `prefers-reduced-motion`.
- Notices sit in a reserved band below the masthead (`#main` top padding: one notice row and 8px gaps, `--pw-notice-row`, `--pw-notice-gap`), so a single notice appearing or going away no longer moves the page. Their edges follow the container's max width.
- Errors, more than one notice, and an expanded notice group go back into the flow and push the page down, so they never cover the content head buttons (the Save dropdown). Expanding or collapsing a group by hand moves the page; the first row stays put.

Milestone 2.4, third batch (`tools/native-check.js --gate`: 61/61 in Chromium and Firefox):
- **Datetime** (`fields/datetime.ts`, 4.6 kB): the text type's picker without jQuery UI or the timepicker add-on.
  - Modes: on focus, on a button (`a.pw-ui-datepicker-trigger`), and inline.
  - jQuery UI's `dateFormat` tokens for formatting and parsing, with month/year selects and the year range, the button pane, other-month days, and a time row of selects.
  - Names and the first weekday come from ProcessWire's datepicker defaults/options or from `Intl`.
  - Only one popup is open at a time.
  - The "select" type's validation and year-range extension are ported.
  - jQuery UI's datepicker structure CSS (absent on native pages) is in `fields.css`.
  - Not ported: `numberOfMonths` > 1.
- `InputfieldDatetime` is native in all three types.
- **TextTags** (`fields/texttags.ts`, 2.8 kB): a tag control on selectize's DOM, so `fields.css` styles it as before.
  - Both upstream modes: free tags in a delimited input, and a select with a tag list, user tags, `tagsUrl` lookups and the page field's "_" ids.
  - Single and maximum counts, close-after-select, create-on-blur.
  - The first matching tag is highlighted and "Add …" is used only when nothing matches, as selectize does.
  - Remove links, Backspace, arrow keys, drag sorting, and an auto-growing typing input.
  - `InputfieldTextTags` is native, also as a Page field widget.
- **Sorting helper:** an `axis: 'xy'` mode for inline items that wrap, such as chips.
- **Selector** (`fields/selector.ts`, 3.4 kB): the selector builder on its markup and the module's AJAX actions (`opval`, `subfield-opval`, `autocomplete`, `test`):
  - rows, subfields and the names/labels toggle;
  - OR values and OR fields, template-limited field options, quoting, `_custom` groups;
  - the preview and match counter;
  - value autocomplete on the shared menu;
  - value widgets arriving over AJAX are initialised by the registry.
- `InputfieldSelector` is native.

Milestone 2.4, second batch: field widgets loaded on demand (`tools/native-check.js --gate`: 47/47 in Chromium and Firefox):
- **Widget registry** (`runtime/src/fields/registry.ts`):
  - each widget is its own chunk (`assets/dist/chunks/`), imported only when its markup is on the page;
  - each chunk has an 8 kB gzip budget in `check-css.mjs`;
  - a shared pointer-based sorting helper (`runtime/src/util/sortable.ts`) replaces jQuery UI sortable.
- **asmSelect** (`fields/asmselect.ts`, 4.2 kB): a port of upstream's MIT-licensed `jquery.asmselect.js`, keeping its options, markup, classes and `change` detail:
  - pick, sort and remove, with the hidden original select kept in order;
  - parent/child options, the field-list fieldset mode, and deleted-item marking;
  - edit links in the native dialog.

  Not ported: copying status and description back from the edit dialog.
- **Page field** (`fields/page.ts`, 1.4 kB): the "add new" toggle and dependent selects reloaded from `page/search/for`.
- **PageAutocomplete** (`fields/pageautocomplete.ts`, 2.9 kB), on a shared jQuery-UI-free autocomplete menu (`util/autocomplete.ts`, jQuery UI's menu markup and classes):
  - list mode: template clone, sorting, remove or mark deleted, maximum;
  - single-value mode with its clear icon;
  - adding new pages with Enter;
  - status icons, disabled characters, AND words.

  The search box gets room for its status icon, and autocomplete menu items take the whole row (both under upstream's script too).
- **PageListSelect and PageListSelectMultiple** (`fields/pagelistselect.ts`, 2.6 kB): ProcessPageList's "select" mode on its markup and JSON endpoint:
  - the header with the current page (and its path) and a Change/Cancel toggle;
  - the tree from the root page, with a title opening its item and loading its children, and a More link;
  - Select and Unselect setting the value (`change` and `pageSelected`);
  - the multiple variant's sortable, removable list, with chosen pages marked "Selected".
- **vex config:** on pages that defer the legacy stack, the inline vex config that `JqueryUI::useVex()` puts in the head waits for the stack (`deferLegacyInline()`, `legacy.later()`).
- **Native dialogs:** `ProcessWire.alert`, `confirm` and `prompt` exist on native pages as plain browser dialogs; upstream's vex versions replace them when the stack loads.
- **BridgeDemo:** the legacy example field is InputfieldIcon now.
- **Native rules:**
  - `InputfieldAsmSelect` and `InputfieldSelectMultiple` are native;
  - `InputfieldPage` is native when its widget is (Select, Radios, Checkboxes, SelectMultiple, asmSelect, PageAutocomplete, PageListSelect, PageListSelectMultiple);
  - `InputfieldPageAutocomplete`, `InputfieldPageListSelect` and `InputfieldPageListSelectMultiple` are native.
- **Late jQuery:** if the legacy stack arrives later on a native page, upstream's `$.fn.asmSelect` skips selects the runtime built (`legacy.guardNative()`, called after each legacy script).

Milestone 2.4, first batch: fields with scripts of their own (`tools/native-check.js --gate`: 32/32 in Chromium and Firefox; the lab still loads no jQuery):
- **Toggle** (`runtime/src/inputfields/toggle.ts`): the checked classes (`InputfieldToggleChecked`, `InputfieldToggleCurrent`) and click-again-to-deselect in `.InputfieldToggleUseDeselect`. Colours stay with `fields.css`.
- **Checkboxes** (`checkboxes.ts`): shift-click selects or clears a range, dispatching `change` per box. Columns are dropped when labels would wrap.
- **Language tabs** (`langtabs.ts`): upstream's markup and classes with jQuery UI off:
  - tab switching (`LanguageSupportCurrent`, the active li class);
  - the header toggle that shows every language;
  - a second click on the open tab opens that language form-wide, remembered in `langTabsDC`.

  LanguageTabs' inline `setupLanguageTabs($('#form'))` now runs only where jQuery is (`hookFormRender`). Tabs set up natively keep working if the stack arrives later (`data-pw-native`).
- **Native classes:**
  - `InputfieldToggle` and `InputfieldCheckboxes` join the native types;
  - multi-language fields of the native types are native too;
  - on the page editor (legacy) upstream still sets up the tabs, and switching works there.
- **Collapse:** a click on the header's language toggle no longer collapses the field.
- **Size:** `runtime.js` is at 8.3 of 12 kB gzip.

Milestones 2.2 and 2.3 (Gate 2 passed: `tools/native-check.js --gate` 25/25 in Chromium and Firefox; the field lab loads no jQuery):
- **2.3, scriptless core fields native.** The theme treats `InputfieldText`, `Textarea`, `Checkbox`, `Radios`, `Select`, `Integer`, `Float`, `URL`, `Email` and `Name` as native, by exact class.
  - A multi-language field stays legacy while language tabs need `LanguageTabs.js`.
  - Pages whose Process is native (BridgeDemo today, the Phase 3 screens later) render them without jQuery.
  - The upstream page editor still loads the stack for its own sake.
- **Native Text counter** (`runtime/src/inputfields/counter.ts`): `showCount` characters or words, min/max notes, upstream labels; the over-limit part takes the destructive colour.
- **2.2, form behaviours in the runtime** (`runtime/src/inputfields/forms.ts`), with the same classes and events as upstream:
  - change tracking (`InputfieldStateChanged`, `changed`);
  - the leave warning (`InputfieldFormConfirm`, `InputfieldFormSubmitted`);
  - the Enter guard for multi-button forms;
  - invalid controls open their collapsed parents and tab.
- **`window.Inputfields` facade** (`facade.ts`) on pages without jQuery, for the calls core and third-party scripts make; upstream replaces it when the stack loads.
- **BridgeDemo:** the "load a legacy field" example is now `InputfieldPageListSelect`, since Text is native.
- **`tools/native-check.js`:** `PW_STATE=<file>` reuses a saved login, because repeated logins trip ProcessWire's login throttle.
- **Size:** `runtime.js` is at 6.7 of 12 kB gzip.

Milestone 2.1 (groundwork):


- Phase 2 re-scoped (ADR 0015): core fields go native by contract, not through same-named replacement modules. Gate 2 becomes a native field lab.
- Native status is decided per exact class: a subclass of a component is legacy, since it may add jQuery scripts of its own (`isNativeInputfield`, smoke checks).
- AJAX-collapsed legacy fields are marked from `Inputfield::renderReadyHook`. Before, they got no mark, because core only runs the before-render hooks for the placeholder. They no longer count as a legacy need on the page that shows only their placeholder (`isAjaxPlaceholder` mirrors core's condition). Opening one on a native page loads the legacy stack and initialises it: the observer now also catches content inserted into a marked field, and it stops once the stack is on the page (upstream then initialises what it loads).
- `InputfieldSubmitDropdown` stand-in (scripts/main.js): on pages without jQuery the inline `InputfieldSubmitDropdown.init()` that core prints after a button with dropdown items no longer throws. The items open as a native click dropdown and fill the hidden input before submitting.
- Field lab: Setup > Bridge demo > `fields/` lists one field of each Phase 2 core type, with the shared behaviours set up. The demo page also gains an AJAX-collapsed legacy field (InputfieldIcon).
- `tools/native-check.js`: 23 behaviour checks on the lab:
  - collapse (plain and AJAX), showIf/requiredIf and columns;
  - the counter, change tracking, the Enter guard and invalid-open;
  - the leave warning, submit dropdown items and a save round trip.

  `--gate` also requires no jQuery and no legacy reasons. Baseline with upstream jQuery: 23/23 in Chromium and Firefox.
- `runtime.js` gets a gzip budget of 12 kB; it is at 4.9 kB now.

## Unreleased (phase 1, milestones 1.7 Basecoat look and 1.8 owner test pass)

- AdminThemeBridge 0.7.0: Basecoat UI's "vega" look hand-ported onto the own token CSS (ADR 0011); no Basecoat, Tailwind or reset shipped.
  - **Tokens:** shadcn names (`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`, shadows). The `--pw-*` names remain as aliases.
  - **Colours:** the Boss variants and the custom hex feed `--primary`.
  - **Dark scheme:** vega's dark neutrals.
  - **Typography:** sentence case, 14 px controls, 600 headings. Geist self-hosted (variable woff2, latin + cyrillic, 44 kB, OFL) replaces Roboto Condensed; the platform UI font is the fallback. CSS budget 12 kB gzip (11.3 kB used).
  - **Controls:** 36 px inputs and selects with focus rings, shadcn switches, default/outline/ghost buttons, outline image and file buttons, secondary chips.
  - **Surfaces:**
    - Hairline cards with gaps.
    - Popover menus for every dropdown kind, with flyouts aligned to their parent item.
    - Segmented WireTabs and language tabs.
    - Quiet tables, bordered alerts for notices, outline badges for page tree and Lister actions.
    - A calendar-style datepicker, a shadcn dialog and a card login.
  - **Third-party modules:** PageTableNext icon buttons and the Uikit compat classes follow the tokens.
  - Page tree rows keep a fixed line, so the action buttons shown on hover no longer shift the rows below.
  - Gate on nine sandboxes: 0 theme-caused differences.
- Tabs: WireTabs, `<pw-tabs>` and language tabs share one tab design (hairline baseline, top-rounded tabs, the active tab merging into the baseline in its surface colour) instead of the segmented pill bar.
- Notices and SystemNotifications alerts carry a result class next to the upstream one (`pw-notice-success` for messages, `pw-notice-warning`, `pw-notice-error`) and use Basecoat's alert palette: light tint, darker border, dark tinted text, strong icon; dark-scheme variants; debug notices stay neutral.
- Login screen: no masthead; the ProcessWire mark (or the site's logo) is the card title, the "Login" headline stays for screen readers only; name, password and button in one full-width column on the same edges; notices (e.g. a failed login) inside the card, below the mark; borderless full-width card on phones.
- InputfieldFloatRange: the slider and its value box share one centre line with a 12 px gap. The box gets back its left border, and the slider takes the theme look (track `--input`, thumb ringed in the primary), visible in dark mode too. The track fills in the primary up to the thumb in every browser: `setupRangeFill` (scripts/main.js) keeps `--pw-range-fill` on each range input, including values set from the value box without an event.
- Page tree: a branch that would run past the bottom of the screen scrolls like a dropdown menu (thin scrollbar, no frame). `setupTreeFit` (scripts/main.js) fits it to the space below its top when branches open or close and on resize, at least about six rows and at most the screen below the masthead. Only the deepest open branch scrolls, so scroll areas never nest; opening a sub-branch moves the scroll there. (A first version capped branches at the screen height only, which never triggered for a branch starting halfway down.) A branch that does scroll gets `.pw-branch-scrolls`: its scrollbar is on the left, where it also separates the branch from its parents. The branch box reaches 18 px into its indent and pads it back, so the bar sits in the indent, clear of the chevrons (an overlay scrollbar had covered them and swallowed their clicks); with overlay scrollbars the rows keep their usual position.
- CSS budget for `theme.css` raised from 12 to 15 kB gzip (smoke test: 75 kB raw), owner's decision.
- Footer: "based on ProcessWire 3.0.x, colours from AdminThemeBoss", the last linking to the AdminThemeBoss repository (the colour variants are its presets, ADR 0010 and 0011).
- PageAutocomplete: the selected pages are asmSelect rows (same chip, 36 px row, padding, radius, centred handle and remove icon) and are listed below the search input, as asmSelect lists them below its select. Owner's report: they sat above the input, indented, square and cramped.
- asmSelect rows: the remove icon and the status text are centred on the row; upstream pins them to the top and nudges the icon by hand.
- Select chevron: Basecoat's SVG chevron (Lucide chevron-down) in the scheme's muted colour, one data URI per scheme in the `--pw-chevron` token. It replaces the two-gradient drawing, whose arms did not meet (owner's asmSelect report; every single select had it).
- AdminThemeBridge 0.8.0: fields follow the colour scheme (ADR 0014). The owner saw white Tags and CKEditor fields in dark mode.
  - **`fields.css`:** a second stylesheet, 3.3 kB gzip of a 6 kB budget, printed after `theme.css`. It recolours the inside of field modules with the tokens, in both schemes:
    - selectize (TextTags, file and image tags);
    - the image grid, tooltip, edit panel and checkerboard;
    - file rows;
    - InputfieldToggle and InputfieldIcon;
    - the CKEditor skin (toolbar, panels, dialogs, inline editors);
    - TinyMCE's inline editors and dialog buttons;
    - jsoneditor;
    - SeoNeo, FieldtypeImageReference, FieldtypeMatrix, FieldtypeColor, PageTableNext.
  - **AdminThemeUikit's custom properties** map to the tokens, so modules styled with them (Fluency, SeoNeo) follow too. `.ui-widget-content` surfaces become cards.
  - **Editing areas:** CKEditor and TinyMCE iframes get the scheme's colours. CKEditor is rewritten live. TinyMCE uses the shipped `oxide-dark` skin and is re-created on a switch, keeping its text.
  - **Event:** `pw-scheme-change` fires on a live switch.
  - **Stylesheet order:** stylesheets that modules append to `<head>` at runtime are moved in front of the theme sheets, so they no longer win ties.
  - **Tests:**
    - `tools/sandbox-fixture.php` adds a field-zoo page to a sandbox.
    - `tools/scheme-scan.js` lists light backgrounds in dark mode and low-contrast text in both modes, in the page and in editor iframes, after a live switch too.
    - **Results:** findings on atispro went from 87 to 0 in Chromium and Firefox; davinci and tandem-chegem show only colour swatches and the Tracy bar, which are allowlisted.
    - **Regressions:** page-save 41/41 and dropdown stress 0 violations, both browsers; conformance 0 differ.
- Save without reload in the page editor (ADR 0013, `scripts/page-save.js`): Save, Publish and Save + Keep Unpublished post the form with fetch and swap the fresh editor in place (form children, content head, notices), re-running the editor's own initialisation and keeping tab, scroll, opened fields and focus. After-save actions, Delete, template changes, uploads in progress, modal windows and Shift+click keep the classic submit; setting `pageSaveInPlace` (on by default). Events `pw-page-save` (cancelable) and `pw-page-saved`. `tools/page-save-check.js`: 41 checks (title, notices, change tracking, repeated saves, head copy, validation error, CKEditor, image description, repeater add and delete, unpublish and publish, rename, tab kept, dropdowns, classic paths) pass in Firefox and Chromium.
- Upstream race fixed on the way: the form Save button and its head copy share one dropdown menu, and one toggle's 1 s leave timer could close the menu just opened from the other; dropdown menus no longer fade out while the menu or any of its toggles is hovered.
- Dropdown hover reliability (Firefox first, Chromium too), measured with `tools/dropdown-stress.js` (Playwright, random pointer paths):
  - Upstream main.js hid a hover menu the instant the pointer left it, even onto its own toggle (blink), and its toggle mouseleave timer never cancelled, so a path grazing a toggle hid the menu just reopened under a resting pointer. Both handlers are replaced on legacy pages by versions with a grace period that re-check toggle and menu.
  - Flyouts shown by CSS :hover closed instantly on a diagonal path; they now hide after 300 ms (jQuery UI's submenu delay), the hovered branch on top.
  - Top-bar links get a hit area as tall as the masthead; the toggle-to-menu hover bridge no longer overlaps the toggle.
- Masthead: the ProcessWire mark from the installed core (read at runtime, unmodified, not copied into the repository) replaces Bridge's own mark and wordmark (ADR 0012); custom logo settings unchanged.
## Unreleased (phase 1, milestone 1.6: visual layer)

- UI audit after the owner's test on the real sites (2026-10-14):
  - Notices sit in the page flow above the content (no longer over the head buttons); remove and group toggle side by side, the group toggle opens its children without jQuery too.
  - Head buttons: a main button and its dropdown toggle form one button group; the copies keep the originals' jQuery dropdown data.
  - Primary nav uses Uikit's markup (`pw-dropdown`, `pw-has-items`, `pw-has-ajax-items`): dropdowns open on mouseover, nested and AJAX-loaded flyouts work with and without jQuery; long flyouts scroll; the mobile panel gets an explicit height (the masthead's backdrop-filter made it the containing block).
  - Image field: neutral white upload button, thin size slider, no permanent hover overlay, info tooltip no longer clipped.
  - Page tree and Lister: action pills, open/closed carets, quiet move placeholders; pager with visible borders and primary current page.
  - Structural parity with Uikit's `pw-*.less`: unlabeled markup fields no longer hidden, hidden-header fields padded, `InputfieldHidden` and `[hidden]` hidden, submit buttons side by side, border-box inside forms, sized inputs and the datepicker input at their own width, file lists without bullets, Inputfields inside data tables without cards, scrollable autocomplete, read-only forms without buttons, and smaller items (see `runtime/src/styles/20-inputfields.css`).
  - jQuery UI: link colours inside state classes, dialog close button, Font Awesome icons keep their weight under `.ui-priority-secondary`; dark scheme gives native controls `color-scheme: dark`.
  - `95-uikit-compat.css`: the Uikit utility classes third-party modules emit (PageTableNext, Fluency, AgentTools, ...), with Font Awesome glyphs standing in for `uk-icon` (Uikit's JS is not loaded; `uk-tooltip`, `uk-switcher`, `uk-modal` stay inert).
  - CSS budget raised from 8 to 11 kB gzip for the compat layer and the parity rules (11.0 kB now).
- Dropdown pass (owner's second report):
  - Flyout submenus line up with their parent item on all three paths (native `:hover`, jQuery UI menu, upstream navJSON positioning): nested menus have no vertical padding and sit at `top: 0`. Font Awesome chevron for items with children; tighter item padding.
  - Head-button copies are made before `ProcessWireAdmin.init()`, as AdminThemeUikit does, so upstream binds each copied toggle to itself (a later copy inherited the original's 1 s hide timer and closed its menu).
  - Menu pointer follows the toggle (`--pw-pointer-x`), keeps an 8 px gap below it, disappears when the menu flips above its toggle or overlays it on purpose (the View tab menu); an invisible bridge keeps hover menus open across the gap.
  - Live search in the masthead (`setupSearch`, framework-free): ProcessPageSearch's JSON results grouped by type, keyboard navigation; AdminThemeUikit had it in its own script, Bridge had none. The search field no longer widens on focus (it pushed the nav into the user menu).
- AdminThemeBridge 0.6.0: own token-based stylesheet with the AdminThemeBoss look (ADR 0010). `runtime/src/styles/*.css` built by Vite into `assets/dist/theme.css` (7.6 kB gzip, budget 8 kB enforced by `runtime/scripts/check-css.mjs`); Roboto Condensed self-hosted (OFL).
- Settings: colour variant (blue, vibrant, black, pink, green, custom hex), colour scheme (auto, light, dark; user toggle in the user menu, applied before first paint), logo and dark-scheme logo, extended breadcrumbs.
- Control classes per Inputfield type (`pw-input`, `pw-select`, `pw-textarea`, `pw-checkbox`, `pw-radio`, `pw-button`), never on the wrapper; config keys for WireTabs, LanguageTabs (no jQuery UI), data tables, pager, page tree, image buttons, selector, SystemNotifications.
- JqueryUI.css is part of the legacy stack (printed with it or inserted before theme.css by the lazy loader); other admin themes' assets are dropped (AdminThemeBoss loaded its Uikit build on every admin page).
- Login: labels become placeholders through ProcessLogin's skipLabel; centred card.
- Mobile: masthead collapses to a menu panel below 960 px, columns stack below 768 px.
- Runner: `Inputfield_` (nameless field) and theme paths in TemplateFile errors normalised.
- `tests/smoke.php`: theme asset checks.

## Unreleased (phase 1, gate 1)

- Gate 1 passed on nine site sandboxes: 950 screens, 0 theme-caused differences or failures, 46 of 47 local modules covered, browser pass complete (`conformance/RESULTS-2026-10-14.md`).
- `tools/sandbox-site.sh <site> <port>` (generic sandbox builder: rewrites literal `/site/` paths in all their forms, copies web-root helper files, clears compiled files, creates users without save hooks), `tools/gate1.sh` (serves every sandbox, runs the suite on each).
- Runner: a failure identical under both themes is classed `SITE`; JSON endpoints requested with the AJAX header; profile screen normalisation.
- AdminThemeBridge: `inputfieldColumnWidthSpacing = 0`, `InputfieldWrapper useColumnWidth = 2`, so row breaks match Uikit.
- `conformance/modules.txt`: coverage status per module.
- Directory top set (TracyDebugger, RockMigrations, RockFrontend, AdminOnSteroids) on the davinci sandbox via `tools/sandbox-modules.php`; `{admin-process-pages}` screen placeholder renders every module-provided admin screen. 156 screens, 0 theme-caused differences.

## Milestone 1.5

- `conformance/run.php`: HTTP conformance runner (two sandbox logins, screen digests, diff, `--json`), `conformance/README.md`, `conformance/RESULTS-2026-10-14.md`. atispro sandbox: 94 of 95 screens identical, the last one a site bug under both themes.
- AdminThemeBridge 0.5.0: Font Awesome 6.7.2 icon set (`getConfigAdminIcons`), matching Uikit's icon pickers.
- `tools/sandbox-site.sh` rewrites atispro's literal `/site/` paths to the sandbox layout.

## Milestone 1.4

- Contract version 1 (`docs/contract.md`). `getBridgeComponent()` keys `tag`, `module`, `version`; the theme resolves `module` to a URL, writes `data-bridge-module` / `data-bridge-version` on the wrapper and the Process descriptor into `ProcessWire.config.AdminThemeBridge.process`.
- Runtime 1.0.0: `Bridge.components` imports declared modules once (page load, AJAX, dialogs), `pw-component-loaded` event, `Bridge.contract`.
- BridgeDemo: `<pw-text>` reference element (`pw-text.js`), `ProcessBridgeDemo.mjs`.
- AdminThemeBridge 0.4.0.

## Milestone 1.3

- `runtime/` (TypeScript, Vite) builds `modules/AdminThemeBridge/assets/dist/runtime.js` (12.8 kB, committed), imported by `scripts/main.js` on every admin page. On pages without the legacy stack it provides, on upstream markup: collapse/expand with AJAX-collapsed fields, `showIf`/`requiredIf` dependencies (upstream selector syntax), column-width redistribution when a column hides; it goes passive when jQuery arrives. Custom elements `<pw-tabs>` (hash state, keyboard) and `<pw-dialog>` (native dialog + iframe, handles `.pw-modal` links without jQuery UI). `window.Bridge` API.
- Inputfield rows are flex now (equal heights from CSS, no height spacers).
- AdminThemeBridge 0.3.0; demo page shows collapsed, showIf/requiredIf, tabs, dialog.

## Milestone 1.2

- `modules/AdminThemeBridge` 0.2.0: `BridgeComponent` interface; legacy detection (Inputfield render hooks, ProcessController hook) with `data-bridge-component` / `data-bridge-legacy` markers; `legacyStack=auto` default prints the jQuery stack only when needed and hands the deferred URLs to the client; `scripts/main.js` lazy-loads the stack on inserted legacy markup, native dropdown/notice handlers until jQuery exists.
- `modules/BridgeDemo`: `ProcessBridgeDemo` + `InputfieldBridgeText`, the native-page proof and lazy-load fixture (Setup > Bridge demo in the sandbox).
- `docs/contract.md` v0.

## Milestone 1.1

- `modules/AdminThemeBridge` 0.1.0: empty shell. Own page frame (masthead, primary/user nav, breadcrumbs, add-new, notices, content, footer), upstream legacy stack (jQuery, jQuery UI, inputfields.js, main.js) on every page, structural Inputfield CSS, `controller.php` for legacy `site/templates/admin.php`.
- `tools/router.php`: PHP built-in server router for the sandbox; aliases `/wire/` to the layout's wire directory because upstream themes hardcode `root/wire/` URLs.
- `tools/sandbox-admin.php`: installs the theme, creates sandbox superusers `bridge` (AdminThemeBridge) and `uikit` (AdminThemeUikit), neutralises AdminThemeBoss "all users", drops stale WireCache rows. Called from `tools/sandbox-site.sh`.
- `.claude/launch.json`: `bridge-sandbox` server on port 8089.

## Phase 0

- Repository, LICENSE (MIT for own code), ADRs 0001-0009, PLAN.md, CLAUDE.md.
- `bootstrap/Bootstrap.php` + `bootstrap/index.php`: boot ProcessWire from an explicit folder layout (`project.php`) without `ProcessWire::buildConfig()`. Verified on 3.0.274.
- `tools/sandbox-site.sh`: builds a sandbox (atispro site copy as `app/`, upstream `wire/` under `vendor/processwire/`, private DB `atispro_bridge`).
- `tests/smoke.php`: gate 0 checks, 36 passing.
- `conformance/`: upstream pin, module list, screen list.
- `docs/upstream/buildConfig-wireDir.md`: two upstream proposals (`wireDir` and `assetsDir` options; a hook point for extra module directories).

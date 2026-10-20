# Changelog

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

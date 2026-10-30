# Bridge component contract, version 1

What a module must do to run on the Bridge admin shell without the legacy jQuery stack, and
what the shell promises to every module, legacy or not. Milestone 1.4, 2026-10-14. The contract
version is reported as `window.Bridge.contract` and expected in `getBridgeComponent()['version']`.

## 1. Invariants the shell keeps (for every module)

Upstream markup, ids, classes and endpoints are kept byte-compatible (ADR 0003):

- Wrapper markup of every Inputfield is upstream's `InputfieldWrapper` default: `ul.Inputfields > li.Inputfield > label.InputfieldHeader + div.InputfieldContent`, with the classes upstream emits: `Inputfield`, `Inputfield_<name>`, `Inputfield<Type>`, `InputfieldHeader`, `InputfieldContent`, `InputfieldStateCollapsed`, `InputfieldStateRequired`, `InputfieldColumnWidth`, `InputfieldColumnWidthFirst`, `InputfieldStateHidden`, `ui-widget`; the wrapper id is `wrap_Inputfield_<name>`, the input id `Inputfield_<name>`.
- Page frame ids: `#main`, `#content.pw-content`, `#pw-content-head`, `#pw-content-title`, `#pw-content-head-buttons`, `#pw-content-body`, `#pw-masthead`, `#pw-footer`, `#notices.pw-notices`.
- Widget classes handled by the shell or by upstream main.js: `pw-dropdown-toggle` + `pw-dropdown-menu`, `pw-notice-remove`, `pw-head-button`, `pw-modal` (+ `pw-modal-small|large|full`, `data-href`, `data-pw-modal-href`).
- AJAX contracts: `?modal=1`, `?render=JSON`, `renderInputfieldAjax=<id>`, and `X-Requested-With: XMLHttpRequest` makes `$config->ajax` true so the admin returns the Process output without the frame.
- `ProcessWire.config` is the only server-to-client channel (`$config->js()`); the shell adds `ProcessWire.config.AdminThemeBridge`.
- The `li.Inputfield` element is the unit everything addresses. Bridge never wraps it in another element; a component wraps its own content inside `.InputfieldContent`.

## 2. Server side: `BridgeComponent`

```php
interface ProcessWire\BridgeComponent {
	/** @return array ['tag' => string, 'module' => string, 'version' => string] */
	public function getBridgeComponent();
}
```

Defined in `modules/AdminThemeBridge/BridgeComponent.php`. Implementing it declares: this module's markup and behaviour need neither jQuery, jQuery UI, `wire/templates-admin/scripts/inputfields.js` nor `main.js`. Load the interface defensively, so the module depends neither on load order nor on the theme being installed (the theme's own file is guarded the same way, 0.8.8):

```php
// the interface without depending on the theme: its file when the theme is there, else the same
// one-method interface declared here (docs/contract.md 2)
if(!interface_exists("ProcessWire\\BridgeComponent", false)) {
	$bridgeComponentFile = dirname(__DIR__) . '/AdminThemeBridge/BridgeComponent.php';
	if(is_file($bridgeComponentFile)) {
		require_once($bridgeComponentFile);
	} else {
		interface BridgeComponent { public function getBridgeComponent(); }
	}
	unset($bridgeComponentFile);
}
```

| Key | Meaning |
|---|---|
| `tag` | Custom element the component renders inside `.InputfieldContent` (for a Process: a name for diagnostics). `''` when the component renders plain HTML only. |
| `module` | ES module that defines the element. Absolute URL, root-relative path, or a path relative to the module's own directory (`$config->urls->ClassName`). The theme appends `?v=<module version>`. Optional. |
| `version` | Contract version the component targets. Default `'1'`. |

Who is native on a page (`AdminThemeBridge::isNativeInputfield()`, decided per request):

| Kind | Native when |
|---|---|
| Inputfield | its exact class is one of the core types the runtime covers: `InputfieldText`, `Textarea`, `Checkbox`, `Radios`, `Select`, `Integer`, `Float`, `URL`, `Email`, `Name` (milestone 2.3), `Toggle`, `Checkboxes`, `SelectMultiple`, `AsmSelect`, `PageAutocomplete`, `PageListSelect`, `PageListSelectMultiple`, `Datetime`, `TextTags`, `Selector` (2.4), language tabs included; or it is an `InputfieldPage` whose widget is one of these selection types; or its own class declares `getBridgeComponent()` (a subclass of a component is legacy: it may add jQuery scripts; ADR 0015), or it is an `InputfieldWrapper` (Form, Fieldset, Wrapper), or its exact class is one of `InputfieldSubmit`, `InputfieldButton`, `InputfieldHidden`, `InputfieldMarkup` |
| Process | implements `BridgeComponent` |
| anything else | legacy |

Wrapper attributes the theme writes on every rendered `li.Inputfield`, in both theme modes (also on AJAX-collapsed fields, whose placeholder is rendered instead: marked from `renderReadyHook`, not counted as a legacy need until the field is opened):

| Attribute | On | Value |
|---|---|---|
| `data-bridge-component` | native | the `tag`, or the class name when `tag` is empty |
| `data-bridge-module` | native with a `module` | resolved module URL |
| `data-bridge-version` | native components | contract version |
| `data-bridge-legacy` | legacy | the class name |

For the current Process the same descriptor is in `ProcessWire.config.AdminThemeBridge.process` (or `null`).

## 3. Legacy stack policy

`legacyStack` theme setting:

- `auto` (default): the stack is printed in `<head>` only if the request rendered a legacy Inputfield or ran a legacy Process. Otherwise its URLs go to `ProcessWire.config.AdminThemeBridge.legacyScripts` in upstream print order and the client loads them on demand.
- `always`: printed on every page.

"The stack" is every script under `$config->urls->wire` that is in `modules/` (Jquery*, and all core module scripts, which are jQuery-era; `LanguageSupport/LanguageTabs.js` is added to every admin page by a hook) or `templates-admin/scripts/`. Scripts from site modules are printed as registered. Since 0.6.0 the stack also includes the jQuery UI skin `wire/templates-admin/styles/JqueryUI/JqueryUI.css`: printed with it, or listed in `ProcessWire.config.AdminThemeBridge.legacyStyles` and inserted before `link[data-pw-theme]` when the stack loads lazily.

Reasons are reported in `ProcessWire.config.AdminThemeBridge.legacyReasons` as `Inputfield:<Class>` / `Process:<Class>` => count.

Scripts of site and third-party modules print as registered, except those written against jQuery (milestone 3.2, `isJqueryScript()`): a local `.js` file that calls `jQuery` or the `$` alias goes to `legacyScripts` with the stack and runs when the stack loads. RockMigrations, for example, adds one to every admin page; printed on a page without the stack it would throw. The theme's own scripts never count.

A Process is legacy unless it is a `BridgeComponent` (its own class, not a subclass: 0.8.8) or a core Process the theme stands in for, by exact class (ADR 0016; `isNativeProcess()`, the list in 4.4).

What is native is one map (0.9.1, ADR 0015 and 0016 addenda): `AdminThemeBridge::nativeMap()`, class => `kind` (`wrapper`, `type`, `field`, `process`) and, for Processes, `scripts` and `saveInPlace`, all by exact class, wrappers included (a subclass of `InputfieldMarkup` or `InputfieldFieldset` is legacy). A module adds its own classes with a hook:

```php
$wire->addHookAfter('AdminThemeBridge::nativeMap', function(HookEvent $e) {
	$map = $e->return;
	$map['InputfieldMyMarkup'] = array('kind' => 'wrapper');
	$e->return = $map;
});
```

`isNativeInputfield()` and `isNativeProcess()` are hookable too. A site switches a class either way in the theme settings, "Native or legacy, per class" (`nativeOverrides`: `ClassName=native` or `ClassName=legacy`, one per line), which wins over the map and over `BridgeComponent`.

Other reasons (0.8.8): a site or module script that calls jQuery (comments do not count, a script that checks `window.jQuery` / `typeof jQuery` works without it) is deferred with the stack; when a Process adds such a script while it builds the screen, it is a reason (`Script:dir/file.js`), unless it comes from a field module directory one of whose Inputfields is legacy on the page (that Inputfield's reason covers it). An inline `<script>` calling jQuery inside native markup (`InputfieldMarkup` output) is a reason (`Inline:InputfieldMarkup`). The setting "Site scripts that never wait for the legacy stack" (`printScripts`, URL parts) prints a script whatever it contains.

From 0.9.3:
- A module's config screen (ProcessModule `edit?name=X`): a jQuery script from X's own directory is a reason (`Script:dir/file.js`) whenever it was added. Modules add it at init or ready when they see `?name=X`, before the Process runs.
- A Process that throws (core shows its error) keeps the reasons it would have had: itself unless native, and the scripts it added.
- In `Script:<dir>/<file>`, `<dir>` is the module's directory under site/modules (`Script:Fluency/fluency.js`), not the script's own subdirectory.
- `AdminThemeBridge::scriptNeeds()` lists site scripts that call jQuery only for certain fields, URL part => `'languages'` (a multi-language Inputfield) or an Inputfield class name. Such a script is printed where none of those fields render, and is a reason where one does. Fluency's `fluency.js` is in it (`'languages'`). A module adds its own with a hook:

```php
$wire->addHookAfter('AdminThemeBridge::scriptNeeds', function(HookEvent $e) {
	$map = $e->return;
	$map['/MyModule/my-admin.js'] = 'InputfieldMyField';
	$e->return = $map;
});
```

### 3.1 UIkit layer (ADR 0017, from 0.9.5)

Modules written for AdminThemeUikit that use UIkit get it, on the pages that need it: core's `uikit.min.js` and `uikit-icons.min.js` (AdminThemeUikit's directory; Bridge ships no copy) and `assets/dist/uikit.css`, UIkit's stylesheet without its Base component, on the theme's tokens, in `@layer uikit` (every unlayered stylesheet wins over it). Setting `uikit`: `auto` (default), `always`, `never`. In `auto` mode these are reasons:
- `Markup:<name>`: the rendered content has a UIkit attribute (`uk-grid`, `data-uk-modal`, ...) or a `uk-*` class that `95-uikit-compat.css` does not style (`assets/dist/uikit-covered.json`). `uk-tooltip` does not count: the theme script turns its text into the element's `title` (the browser's tooltip).
- `Script:<path>`: a site module script names the `UIkit` global (comments aside; a script that tests `typeof UIkit` or `window.UIkit` first does not count).
- `Asset:<path>`: a module added a UIkit script (kept, no second copy) or a stock UIkit stylesheet (removed: the layer replaces it).
- `Module:<name>`: the module asked, before the page renders:

```php
$adminTheme = $this->wire()->adminTheme;
if($adminTheme && method_exists($adminTheme, 'needUikit')) $adminTheme->needUikit('MyModule');
```

`AdminThemeBridge::uikitReasons(array $reasons)` is hookable (add or remove reasons). The client gets `ProcessWire.config.AdminThemeBridge.uikit`: `loaded`, `mode`, `reasons`, and the URLs to load it from (`css`, `scripts`, `covered`). Where the page did not print it, `window.UIkit` is a stand-in until first use (4.1). Since 0.9.6 every page also gets `ProcessWire.config.AdminThemeUikit.labels` (`ok`, `cancel`) unless a module set it: core's `ProcessWire.alert`, `confirm` and `prompt` read it whenever `window.UIkit` exists, so they open a UIkit modal through the layer.

`<body>` carries AdminThemeUikit's scheme class, `light-theme` or `dark-theme`, in step with `html[data-pw-scheme]`; inside the layer's pages the tokens also follow the class on any element.

## 4. Client side

### 4.1 Theme script `ProcessWireAdminTheme` (scripts/main.js, classic)

The theme's classic scripts (`scripts/*.js`) are built: their sources are `runtime/src/classic/*.js`, minified by `npm run build` (0.9.0). `main.js`, `lister.js`, `page-edit.js` and `wire-tabs.js` are printed blocking in `<head>` (inline core code calls them while the page parses); `setup.js`, `screens.js`, `link.js`, `image-select.js`, `save-wait.js` and `page-save.js` are `defer`red. `runtime.js` and its shared chunk are `modulepreload`ed.

| Member | Meaning |
|---|---|
| `legacy.loaded` | `true` once jQuery, jQuery UI, inputfields.js, main.js are on the page |
| `legacy.load()` | loads the deferred stack once, in order; Promise; calls `ProcessWireAdmin.init()` after; dispatches `pw-legacy-loaded` on `document` |
| `legacy.initElement(el)` | markup that arrived after load: with the stack, `Inputfields.init($(el))` + upstream `reloaded` (`['BridgeLegacyLoad', $el]`) on each field; without it, `Bridge.Inputfields.init(el)` + a native `reloaded` per field (`detail.source`: `BridgeLegacyLoad`). The one announcer of legacy content: the runtime's loaders (AJAX fields, repeater items, `Inputfields.reload()`) leave fields marked `data-bridge-legacy` to it, so upstream's event fires once (0.8.7) |
| `legacy.observe()` | through `observe()`: an inserted `.Inputfield[data-bridge-legacy]` triggers `load()` then `initElement()`. An AJAX placeholder (`.InputfieldContent > .renderInputfieldAjax`) does not count until its content arrives; the watch ends once the stack is there (0.8.7) |
| `legacy.needsStack(li)` | `false` while a marked field is still an AJAX placeholder |
| `upstream()` | `true` once upstream owns the shell: the legacy flag, or upstream's `ProcessWireAdmin` defined. A jQuery a site module loads by itself does not count; the native widgets, the runtime (`Bridge.legacy.loaded()`) and the stand-ins decide by this, not by `window.jQuery` (0.8.7) |
| `observe(fn)` | the one `MutationObserver` on `<body>` (subtree, childList) for the theme and the runtime: `fn(records)` per batch, in registration order, a throw in one does not stop the others; returns a function that unregisters `fn` (0.8.7) |
| `handover.bind(options)` / `handover.over` | the theme's screen scripts (`lister.js`, `page-edit.js`, `setup.js`, `screens.js`) pass their listener options through `bind()`, which adds a signal aborted at `pw-legacy-handover`: upstream's script for the screen arrives with a late stack and handles the same controls from there (0.8.7) |
| `legacy.loadStyle(url)` | inserts a stylesheet before `link[data-pw-theme]`; used by `load()` for `legacyStyles` |
| `scheme.setting()` / `scheme.cycle()` / `scheme.apply()` | colour scheme: `localStorage.pwScheme` (user) over `config.colorScheme` (setting), `auto` follows `prefers-color-scheme`; `a[data-pw-scheme-toggle]` cycles auto, light, dark; a change of the effective scheme dispatches `pw-scheme-change` on `document` (`detail.scheme`: `light` or `dark`; `detail.source`: `toggle` for the user menu, `system` for an OS switch under auto) |
| `editors` | rich-text editing areas in the scheme's colours (ADR 0014): CKEditor 4 iframes get a token stylesheet (live), TinyMCE 6 gets `oxide-dark` and `content_style` at init and is re-created on `pw-scheme-change` (on an OS switch only once no editor has focus: re-creating loses caret and undo history) |
| `InputfieldSubmitDropdown` (global, pages without jQuery) | native stand-in for upstream `InputfieldSubmit/dropdown.js`: same `init(selector, template, required)` call and markup contract (`ul#<id>_dropdown`, `a[data-pw-dropdown-value]`, `data-pw-dropdown-input`, `data-pw-dropdown-submit`), items in a native click dropdown; upstream's script replaces it when the legacy stack loads |
| `uikit.loaded` / `uikit.load()` / `uikit.scan(el)` | the UIkit layer (3.1; `scripts/uikit-layer.js`, printed before every module script): `load()` puts the layer's stylesheet in front of the theme sheets and runs core's UIkit scripts in order, Promise of `window.UIkit`, dispatches `pw-uikit-loaded` on `document`; `scan(el)` loads it when `el` has a UIkit attribute or an uncovered `uk-*` class, and the body observer calls it for every arrival until the layer is there. Until then `window.UIkit` is a stand-in (`pwStandIn` is `true`): any property read or call loads the layer and replays the call; a call returns a stand-in for its result, so chains (`UIkit.modal('#x').show()`) and `await` work, a synchronous return value does not |
| `setupRangeFill()` | keeps `--pw-range-fill` (filled share of the track, `0%`..`100%`) on every `input[type=range]`, updated on any edit in its Inputfield, on `reloaded` and after an in-place save; a component styling a range track can use it |
| `setupTreeFit()` | sets `--pw-branch-max` on the deepest open page-tree branch (`.PageListRoot .PageList` without an open `.PageList` inside): the space from its top to the bottom of the screen, between about six rows and the screen below the masthead; `30-pagelist.css` caps the branch with it |
| `setupNoticeTimeout()` | notices from a page save (`pw-page-saved`, or `ProcessPageEdit` loaded with `?s=1`) are removed after 10 s with the close fade; pointer over `#notices` or focus inside pauses the countdown, leaving resumes it with the time left; notices containing `.NoticeError` / `.pw-notice-error` stay; other screens are untouched |
| `removeNotices(el)` | removes `#notices` with the 150 ms fade used by the close link (no fade under `prefers-reduced-motion`) |
| `pw-legacy-handover` (event on `document`) | sent when a late-loaded stack is complete, before upstream's ready handlers run: native widgets that upstream takes over from here (File, Image) remove their listeners and the controls they added, so upstream initialises the field as if it were fresh |
| `legacy.holdReady()` / `legacy.releaseReady()` | while the stack loads late, jQuery ready handlers are queued (`jQuery.fn.ready`) and run in order after the last script, as when the server prints the stack |
| `copyButtonMenu(wrap, toggle, original)` | without jQuery, a head-button copy's dropdown toggle gets a copy of the original's menu whose items click the original items |
| `WireTabs(target, options)` | native WireTabs (`scripts/wire-tabs.js`, 4.4) |
| `pageEdit.init()` | native page editor (`scripts/page-edit.js`, 4.4) |
| `setupStyleOrder()` | a stylesheet or `<style>` added to `<head>` after the theme sheets is moved in front of `link[data-pw-theme]`, so module styles always precede `theme.css` and `fields.css` |
| `runScripts(rootOrScripts, {legacy})` | runs the inline scripts of markup inserted from HTML (innerHTML, a template, a parsed document), as upstream's jQuery `html()` does: each becomes a live copy with all its attributes, in document order; a script of this page is replaced where it is, one of a parsed document is appended to `<body>`; data types (`application/json`, `text/x-template`, `ld+json`...) stay inert; a `src` already on the page is not loaded again. With `legacy: true` they run after `legacy.load()`. Promise (synchronous without `legacy` or once the stack is there). The one runner of the theme scripts and the runtime (0.8.6) |
| `Inputfields`, `Bridge`, `AdminDataTable` stand-ins (globals, pages without jQuery) | defined by the theme script where the global is still undefined, so inline code that runs before the runtime (the field editor's `?focus=`, a table's `AdminDataTable.initTable()`) works: a call along any property path (`Inputfields.find(x)`, `Bridge.dialog.close()`) is recorded and returns `undefined`; whoever installs the real object (runtime entry, Inputfields facade, AdminDataTable) replays the calls on it in order. `pwStub` is `true` on a stand-in; code that needs a return value waits for `pw-runtime-ready` (0.8.6) |

Native widgets (dropdowns, notice close, head-button clone) are handled without jQuery and step aside the moment upstream owns the page (`upstream()`). The mobile nav toggle (`.pw-nav-toggle`, `body.pw-nav-open`) and the scheme toggle work with or without jQuery.

### 4.0 Theme attributes and tokens (theme.css, 0.7.0)

`<html>` carries `data-pw-variant` (`blue`, `vibrant`, `black`, `pink`, `green`, `custom`), `data-pw-scheme` (`light` or `dark`; set before first paint) and, for `custom`, `style="--pw-primary:#rrggbb"`. `<body>` carries `pw-variant-<v>` and `pw-scheme-<setting>`.

Components may use the tokens instead of fixed colours so they follow variant and scheme: `--pw-primary`, `--pw-primary-hover`, `--pw-primary-bg`, `--pw-primary-20`, `--pw-on-primary`, `--pw-bg`, `--pw-surface`, `--pw-surface-2`, `--pw-line`, `--pw-text`, `--pw-text-muted`, `--pw-h1`, `--pw-input-bg`, `--pw-input-border`, `--pw-radius`, `--pw-radius-m`, `--pw-shadow-card`, `--pw-shadow-dropdown`, `--pw-font`. Names are stable from 0.6.0; values are not. From 0.7.0 the source of truth is the shadcn token set (ADR 0011), and components should prefer it: `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`, `--radius-sm|md|lg|xl`, `--shadow-xs|sm|md|lg`. The `--pw-*` names above alias them.

From 0.9.2:
- Derived tokens (`--primary`, `--ring`, the `--pw-*` aliases, colour mixes) are declared on `:root`, `[data-pw-scheme]` and `[data-pw-variant]`, so an element that sets its own scheme or variant gets values computed for it.
- `--primary-foreground` follows the variant: near-black on the cyan (`vibrant`) and `green` presets, white on the others and on a custom colour.
- `--ring` is the primary darkened toward the text colour, and `--ring-50` is that same solid colour. The name is kept for components; both are at least 3 to 1 against the page.
- Font sizes and line heights are in rem.
- The status palette is `--pw-status-{success,warning,error}-{bg,border,fg,icon}`, used by notices, `--pw-success-bg`, `--pw-warning-bg` and `--pw-danger-bg`.

From 0.11.0, interface scale: each user sets a scale (75 % to 150 %) with the buttons left of the user menu, kept per user in each browser with the colour scheme. It is the root font size (`<html style="font-size: …%">`, set before first paint), and the theme's built CSS sizes everything in rem (16px = 1rem), so lengths follow it; only hairlines (1px and less), border and outline widths and media queries stay in px. A component that wants to scale with the admin sizes in rem (or uses the tokens: `--pw-radius`, `--pw-gutter` and the other lengths are rem now). Script that reads a length token as a number must allow for rem (`ProcessWireAdminTheme.cssLength(name, fallback)` returns px). The scale changes fire `pw-scale-change` on `document` (detail `{ scale }`) and a window `resize`, so layouts measured on resize measure again. Core and module stylesheets in px keep their size.

A second stylesheet, `fields.css` (ADR 0014), follows `theme.css` and recolours field modules whose own CSS hard-codes light colours. It also maps AdminThemeUikit's custom properties to the tokens (`--pw-main-color`, `--pw-main-background`, `--pw-blocks-background`, `--pw-text-color`, `--pw-muted-color`, `--pw-border-color`, `--pw-inputs-background`, `--pw-notes-background`, `--pw-code-background`, `--pw-button-*`, `--pw-alert-*`, …), so a module styled with them follows variant and scheme under Bridge as well. A module that wants to react to a live scheme switch listens for `pw-scheme-change`.

Classes the theme adds to controls (never to `li.Inputfield`): `pw-input`, `pw-select`, `pw-select-asm`, `pw-textarea`, `pw-checkbox`, `pw-radio`, `pw-button`; on content: `pw-controls-text`. Through config keys (`init.php`): `pw-pagination`, `pw-active`, `pw-disabled`, `pw-link*`, `pw-lang-tabs uk-tab` (a hook name for LanguageTabs.js, no Uikit), `pw-alert*`, `pw-table`, `pw-dl`.

### 4.2 Runtime `window.Bridge` (assets/dist/runtime.js, ES module)

Built from `runtime/`, imported by the theme script on every admin page. Dispatches `pw-runtime-ready` on `document`, adds `pw-runtime-ready` to `<body>`; with the legacy stack present or arriving, adds `pw-runtime-passive` and leaves Inputfield behaviours to upstream (checked at event time).

| Member | Meaning |
|---|---|
| `Bridge.contract` | `'1'` |
| `Bridge.Inputfields.init(root)` | collapse toggles, dependencies, column widths and Text counters on upstream `li.Inputfield` markup; idempotent |
| `Bridge.Inputfields.open/close/toggle(li)` | collapse state; an AJAX-collapsed field (`.renderInputfieldAjax`) is fetched with `X-Requested-With` and dispatches `reloaded` |
| `Bridge.Inputfields.evaluate(root)` | re-run `data-show-if` / `data-required-if` (upstream grammar: `,` and, `|` or, operators `= != < > <= >= %= *=`, `.count`) |
| `Bridge.Inputfields.recalcColumns(root)` | give a hidden column's width to its row |
| `Bridge.components.load(url)` | import a component module once; Promise of its default export |
| `Bridge.components.loadFrom(root)` | import every `data-bridge-module` under root |
| `Bridge.components.loaded()` | what was imported, with errors |
| `Bridge.dialog.open(url, size, options)` | native `<dialog>` with an iframe at `url` + `modal=1`; sizes `small`, `medium`, `large`, `full`; options (milestone 3.3): `title`, `buttons` (selector in the window), `autoclose` (true, a selector, or a function of the button and the window's document), `close` (selector), `errors` (what keeps it open after an autoclose save; default `.NoticeError, .ui-state-error`), `source` (receives `pw-modal-closed`), `onLoad(doc)`, `onClose({abort})`. Since 3.6: `onButton(original, doc)` runs before a footer button clicks its original; `moreButtons(doc)` adds buttons of the caller's own; `:visible` in `buttons` works as a filter; a `#hash` in the URL stays after `modal=1`. Opening it while open takes the shared window over: the first opener gets `pw-modal-closed` and `onClose` with `abort: true` (0.8.7) |
| `Bridge.dialog.close(abort?)` | close the shared dialog (3.6) |
| `Bridge.Inputfields.reload(target, {queryString})` | upstream's AJAX reload: `?field=&reloadInputfieldAjax=`, repeater items by `data-page` / `data-fnsx`. The content is swapped, its scripts run, then `reloaded` (3.6) |
| `Bridge.Inputfields.highlight(target)` / `hashAction(hash)` | upstream's `#find-<name>`, `#focus-<name>`, `#highlight-<name>` on load. `focus()` / `find()` show the field's WireTab first. Names resolve as upstream: control name, id, `name[]`, then wrapper ids. A match outside any Inputfield, such as the masthead search's `name=q`, is skipped (3.7) |
| `Bridge.legacy.loaded()` / `load()` | as the theme script's |
| `Bridge.confirm(opts, onOk?, onCancel?)` | the runtime's confirmation dialog (`dialog.pw-ask`, 0.15.0, ADR 0019): `opts` is a title string or `{title, message?, items?, ok?, danger?}` (`ok` is the OK button's text, `danger` the warning look); Promise of true for OK, and the callbacks for classic scripts (they work through the stand-in). Always asks |
| `Bridge.guard(opts, onOk?, onCancel?)` | the same as a risky action's warning (`danger` on): asks only while the theme's "Warn before risky actions" setting is on (`ProcessWire.config.AdminThemeBridge.dangerWarn`), otherwise true at once |

Form behaviours of upstream `inputfields.js`, on pages without the legacy stack (milestone 2.2, ADR 0015):
- change tracking: `change`/`input` on a control in `.InputfieldForm` adds `InputfieldStateChanged` (not inside `.InputfieldIgnoreChanges`); `change` also dispatches `changed`;
- leave warning: `form.InputfieldFormConfirm` with a changed field asks on `beforeunload`, unless submitted (`InputfieldFormSubmitted`);
- Enter guard: with two or more submit buttons, Enter in an `input`/`select` does not submit and focuses the nearest visible submit button;
- invalid controls open their collapsed Inputfields and `<pw-tabs>` panel and get the focus;
- Text counter: `.InputfieldTextLength[data-showCount]` gets `div.InputfieldTextLengthNote` (labels from `ProcessWire.config.InputfieldTextLength`).
- Toggle (2.4): `InputfieldToggleChecked` / `InputfieldToggleCurrent` on the checked option; in `.InputfieldToggleUseDeselect` a click on the current option clears it and dispatches `change`.
- Checkboxes (2.4): shift-click selects a range (a `change` per box); `ul.InputfieldCheckboxesColumns` is dropped when labels would wrap.
- Language tabs (2.4): `.langTabs` get `langTabsInit` and `data-pw-native`, the Inputfield `hasLangTabs`, the content `langTabsContainer`, the header a `span.langTabsToggle`; a tab click moves `LanguageSupportCurrent` (and the configured li class); a click on the open tab opens that language form-wide (`langTabsDC` cookie). The theme runs LanguageTabs' inline `setupLanguageTabs()` only where jQuery is.

Field widgets with scripts of their own are separate chunks loaded on demand (`runtime/src/fields/registry.ts`). Each is found by the markup its upstream script looks for and marks what it initialised. Examples: `select[data-pw-asm]` for asmSelect, `.InputfieldPage[data-pw-page]` for the Page wrapper. When the legacy stack loads later, the theme wraps upstream plugins so they skip marked elements (`ProcessWireAdminTheme.legacy.guardNative()`).

On such pages `ProcessWire.alert/prompt` are plain browser dialogs and `ProcessWire.confirm` is `Bridge.confirm` (0.15.0) until the stack loads, and inline head scripts that configure vex wait for it (`ProcessWireAdminTheme.legacy.later(fn)`).

`window.Inputfields` on such pages is a facade (`Inputfields.native === true`): `inputfield`, `open`, `close`, `toggle`, `isCollapsed`, `hidden`, `focus`, `find`, `changed`, `name`, `label`; targets are elements, jQuery-like lists, selectors or field names. Upstream `inputfields.js` replaces it when the stack loads.

Events (bubbling `CustomEvent`) on `li.Inputfield`: `opened`, `closed`, `reloaded` (`detail.source`), `showIf` (`detail.visible`), `changed`, `pw-files-moved` (0.14.0, on both file fields of a move). On `document`: `pw-runtime-ready`, `pw-legacy-loaded`, `pw-uikit-loaded` (3.1), `pw-component-loaded` (`detail.url`, `detail.module`), `pw-component-failed` (`detail.url`, `detail.error`; also a warning notice, 0.8.7), `pw-modal-opened`, `pw-modal-closed`, `pw-wiretabs-change` (4.4).

AJAX-loaded field content (milestone 3.1): its inline scripts run after insertion, as with upstream's jQuery `html()`; content marked `data-bridge-legacy` runs them once the stack is loaded. A WireTab whose content is AJAX-collapsed (`collapsed10`) loads when its tab opens (`pw-wiretabs-change`), as upstream `inputfields.js` does on `wiretabclick`.

Classes the runtime writes: `InputfieldStateToggle`, `InputfieldStateCollapsed`, `InputfieldStateWasCollapsed`, `InputfieldAjaxLoading`, `InputfieldStateHidden`, `InputfieldStateRequired` + `input.required`.

Custom elements shipped by the runtime (light DOM, Bridge-owned markup):

- `<pw-tabs>` with `<section id data-tab>` children: inserts `ul.pw-tabs-nav[role=tablist]`, reflects the active id in `active` and `location.hash`, arrows/Home/End, dispatches `pw-tabs-change` (`detail.id`).
- `<pw-dialog>`: native `<dialog>` + iframe; `.pw-modal` links open the shared instance when jQuery UI is absent, with upstream modal.js's options (milestone 3.3): `data-buttons` (the window's matching buttons are hidden there, unless `.pw-modal-button-visible`, and shown in the dialog's footer, `.pw-dialog-buttons`; a click clicks the original), `data-autoclose` (such a click closes the dialog when the next page loads without errors; a selector limits it to matching buttons), `data-close` and `.pw-modal-cancel` (close at once), the link's `title`. As modal.js, `.pw-modal-longclick` links are followed on a click and open the dialog on a 600 ms press, `.pw-modal-dblclick` elements open it on a double click (a click on a link inside is followed after 700 ms unless a second one comes). `pw-modal-closed` goes to the opening element (bubbling) and to `document`, `detail.abort` true when dismissed (close button, backdrop, Escape). Each opening gets a fresh iframe. `.pw-panel` links (upstream's slide-in panel, `JqueryUI/panel.js`) open it `large`, with upstream's panel URL (`modal=panel&pw_panel=1`, `2` with `.pw-panel-links`); a URL that already has a `modal` parameter keeps it. An in-page panel (`data-panel-id`, `href='#id'`) is not a URL: the only one core has is the Debug Mode Tools link, which `scripts/debug-tools.js` opens (next paragraph).

Debug Mode Tools (superusers with `$config->debug`, from 0.9.5): `_footer.php` prints core's `debug.inc` without its inline jQuery script (an accordion and panel set-up that threw on pages without the stack), the panel as `#debug.pw-debug` (hidden), and then `scripts/debug-tools.js`. On every page, with or without the stack, the link opens the panel in a `dialog.pw-dialog.pw-dialog-large` (`.pw-dialog-content`), and its sections (`.container > h3`) fold, one open at a time (`.pw-debug-open`). Where a module has loaded `JqueryUI/panel.js` itself (`window.pwPanels`), upstream's slide-in panel opens it instead. An in-place save (4.3) puts the saved page's request into the panel.

Layout: `.Inputfields` is a wrapping flex row; column widths are the server's inline `width:%`; equal heights come from `align-items: stretch`. Upstream's `.maxColHeightSpacer` is hidden.

### 4.3 Save without reload (scripts/page-save.js, ADR 0013)

On `ProcessPageEdit` outside modal windows, a plain Save / Publish / Save + Keep Unpublished is posted with fetch and the editor is swapped in place; other save paths, Shift+click and the setting `pageSaveInPlace = 0` keep the classic submit. Enter in a text field of a form with two or more submit buttons is left to the Enter guard (upstream's, or the runtime's, 4.2), which blocks it: no save (0.8.6). Events on `document`:

| Event | When | `detail` |
|---|---|---|
| `pw-page-save` | before the request; cancelable (cancelling = classic save) | `form`, `submitter` |
| `pw-page-saved` | after the new editor markup is in place and initialised | `url`, `changes`, `errors` |

Other edit forms (milestone 3.8, ADR 0013 addendum) are saved the same way, but only on pages without jQuery:
- the field, template and module editors and the profile (`ProcessFieldEdit`, `ProcessTemplateEdit`, `ModuleEditForm`, `ProcessProfile`, by their Save button);
- users, roles and permissions, which use the editor's form.

How it goes:
- A redirect back to the same screen (same path, same `id` or `name`) swaps `#pw-content-body`, the head and the notices. The screen's set-up (`ProcessWireAdminTheme.setup.init()`, `screens.init()`) runs again, and the tab, open fields, scroll and focus are restored.
- Anything else follows the redirect, or shows the response as it came. It is never posted twice.
- Save + Exit, a checked Delete, Uninstall or Remove, and Shift+click stay classic.

| Event | When | `detail` |
|---|---|---|
| `pw-form-save` | before the request; cancelable (cancelling = classic save) | `form`, `submitter` |
| `pw-form-saved` | after the new screen is in place and set up | `form`, `url`, `errors` |

Field scripts must initialise on `reloaded` (as core fields do), not only on document ready, to survive an in-place save; the swapped form gets `Inputfields.init()` and `reloaded` on every `.Inputfield`. `ProcessWire.config.AdminThemeBridge.pageSave` tells whether the feature is active on the page. The save's notices go away after 10 s unless they include an error (`setupNoticeTimeout()`, 4.1), on both save paths.

#### Save waits for the page's requests (scripts/save-wait.js, 0.12.0)

On the screens above, modal windows and `pageSaveInPlace = 0` included, a click on a save button of `ProcessPageEdit`, `ProcessFieldEdit`, `ProcessTemplateEdit`, `ModuleEditForm` or `ProcessProfile` (or its head copy) while the page still has work on its way is held, and the button is clicked again once all of it is done, so what it adds to the form (an uploaded file's item, a new repeater item, an AJAX-loaded field) is saved too. Pending work:
- an `XMLHttpRequest` or `fetch()` to this screen's path (other paths, such as polling, do not count);
- `body.pw-uploading`, set by upstream's and the runtime's uploads (with their 500 ms tail);
- `.gridImageUploading` in the form: an image still being resized in the browser before its upload.

The click goes through again 400 ms after the last of them. While it waits, `body.pw-save-waiting`, a spinner on the button and its copy, and a status for screen readers (`labels.saveWaiting`). Another click on a save button saves at once, after upstream's upload confirm as before (cancelling it goes back to waiting); a double click counts once. Escape stops waiting without saving. Delete (`submit_delete`) never waits. `ProcessWireAdminTheme.saveWait.claims(button)` tells whether a click on a button is the waiter's (the native `page-edit.js` leaves its upload confirm to it).

### 4.4 Native Process screens (ADR 0016)

A core Process the theme stands in for keeps its upstream PHP, hookables and markup. On a page without the legacy stack the theme prints its stand-in scripts after `scripts/main.js` (`nativeProcessScripts()`); with the stack, upstream's scripts run as before.

| Process | stand-in | for upstream (core 3.0.274) |
|---|---|---|
| `ProcessPageEdit` (3.1) | `scripts/wire-tabs.js`, `scripts/page-edit.js` | `JqueryWireTabs.js`, `ProcessPageEdit.js` |
| `ProcessModule`, `ProcessField`, `ProcessTemplate` (3.6) | `scripts/wire-tabs.js`, `scripts/setup.js` | `ProcessModule.js`, `ProcessField.js`, `ProcessTemplate.js`, `ProcessTemplateFieldCreator.js` |
| `ProcessUser`, `ProcessRole`, `ProcessPermission` (3.6) | `scripts/wire-tabs.js`, `scripts/page-edit.js`, `scripts/lister.js`, `scripts/setup.js` | `ProcessUser.js`, `ProcessRole.js`, `ProcessPageType.js` |
| `ProcessPageAdd`, `ProcessProfile`, `ProcessLogger` (3.7) | `scripts/screens.js` (global `ProcessLogger`) | `ProcessPageAdd.js`, `ProcessProfile.js`, `ProcessLogger.js` |
| `ProcessPageEditLink` (3.7) | `scripts/wire-tabs.js`, `scripts/link.js` | `ProcessPageEditLink.js` |
| `ProcessRecentPages`, `ProcessPageClone`, `ProcessPageTrash` (3.7) | none (no scripts of their own) | none |
| `ProcessPageEditImageSelect` (3.9) | `scripts/image-select.js` (also on a window that loaded the stack) | `ProcessPageEditImageSelect.js`, Cropper v0.7.8, jQuery UI resizable |
| `ProcessPageLister` (3.5) | `scripts/wire-tabs.js`, `scripts/lister.js` (global `ProcessLister`) | `ProcessPageLister.js` |
| `ProcessPageList` (3.4) | runtime `fields/pagelist.ts` (on `div#PageListContainer`, also in the editor's Children tab) | `ProcessPageList.js` ("actions" mode; "select" mode is `fields/pagelistselect.ts`) |

**WireTabs** (`ProcessWireAdminTheme.WireTabs(target, options)`): same options as `$.fn.WireTabs` (`items`, `id`, `rememberTabs`, `requestID`, `cookieName`, `skipRememberTabIDs`, `ulClass`, `ulAttrs`, `liActiveClass`, `aActiveClass`; defaults from `ProcessWire.config.JqueryWireTabs`) and markup (`ul.WireTabs > li > a#_<content id>[href=#<content id>]`, active `a.on`, inactive content `display:none`, the active link id as a class on the target, tooltip attributes for `.WireTabTip` / `data-tooltip`). First tab: `?WireTab=`, then `#<id>` (hash cleared), then the `WireTabs` cookie (`<requestID>-<link id>`), else the first. A link without a `#` href is a plain link. On every change: jQuery `wiretabclick` (new and old content) when jQuery is on the page, and `pw-wiretabs-change` on `document` (`detail.target`, `detail.tab`, `detail.previous`).

**Page editor** (`ProcessWireAdminTheme.pageEdit.init()`): upstream ends the editor with `<script>initPageEditForm();</script>`; the theme rewrites it to call upstream's function when it exists, else this. It runs again after an in-place save. Same behaviour as `initPageEditForm()`: tabs over `#ProcessPageEdit > .Inputfields > .InputfieldWrapper` (`#PageEditTabs`, Delete never remembered); `#submit_delete` posts only with `#delete_page` checked; a submit during an upload (`body.pw-uploading`) asks with the form's `data-uploading`; Save and Publish buttons get the after-save dropdown, switched off while `#template` differs from the page's template (caught on `document`: the select arrives by AJAX); the View link runs its `data-action` (panel, modal) from `#_ProcessPageEditViewDropdown`; the Delete tab hides the other `.InputfieldSubmit` (`pw-hidden-tmp`); `#pw-content-title` follows the title input (current language first), or the name.

**File and Image** (milestone 3.2; runtime `fields/file.ts`, `fields/image.ts`, `fields/image-upload.ts`, `fields/image-focus.ts`, shared `fields/upload.ts`), for exact `InputfieldFile` / `InputfieldImage` (wrappers marked `data-bridge-component`); subclasses keep their own scripts. Same markup and behaviour as upstream `InputfieldFile.js` / `InputfieldImage.js`:
- upload over the same AJAX contract (`InputfieldFileAjax=1`, headers `X-FILENAME`, `X-FIELDNAME`, `X-REPLACENAME`, `X-<CSRF name>`; JSON items `{error, message, markup, replace, overwrite}`), from the file input or a drop; images also between other images (placed there) and on the edit panel's image (replace); `body.pw-uploading` while uploads run; `AjaxUploadDone` on the list; new items get their Inputfields initialised and `reloaded` (`detail.source` `InputfieldFileUpload` / `InputfieldImageUpload`); client resizing with upstream's `PWImageResizer` (loaded alone, it needs no jQuery);
- files: sort by drag (`input.InputfieldFileSort`, `sorted` on the Inputfield), delete box (double click: all), tags as the native tag control (`fields/texttags.ts` `setupTags()`);
- images: modes list / left / grid and the size range in the header, kept in upstream's `InputfieldImage` cookie (`JSON{"<field>":{"size","listSize","mode"}}`, jquery.cookie format, `util/cookie.ts`); edit panel; drag sort (a press that does not move stays a click: `util/sortable.ts` `threshold`); trash (double click: all); rename; action note; focus point and zoom; width classes; full-size view in a native lightbox (`dialog.pw-lightbox`, `util/lightbox.ts`) in place of Magnific Popup;
- Crop and Variations (`.InputfieldImage .pw-modal[data-buttons]`) open in the native dialog; their window, ProcessPageEditImageSelect, is native since milestone 3.9 (`scripts/image-select.js`) and talks to the field without jQuery;
- several items selected (0.14.0, ADR 0018; `util/selection.ts`): Ctrl/Cmd+click, Shift+click, a rubber band (`div.pw-marquee`) from the field's background, Esc, Ctrl+A; a plain click keeps its meaning and clears it. Selected items have `pw-selected`, the field's `.InputfieldContent` `pw-has-selection` and `data-pw-selectable`. A selected item drags its selection along (the lead `data-pw-count`, the others `pw-drag-member` meanwhile; one `sorted`); the delete box or trash of a selected item sets every selected one;
- moves to another file or image field of the same page (0.14.0; `fields/files-move.ts`, `lib/AdminThemeBridgeFiles.php`): dragged out of its list, an item shows a ghost (`div.pw-drag-ghost`), the field under it `pw-drop-ok`, `pw-drop-partial` or `pw-drop-no` (from its upload element's extensions and `.InputfieldFileMaxFiles`), a multi-file target a `li.pw-drop-placeholder`; a collapsed field opens after 600 ms. Anything but a plain move asks first (`dialog.pw-ask.pw-ask-move`; Replace, Swap or Leave for a single-file field holding a file). The move is a POST to the page editor, saved at once: `bridgeFilesMove=1`, `from`, `to`, `ids[]` (item hashes), `index`, `meta` (JSON of unsaved description and tags by hash), `resolve[<hash>]`, the CSRF token; JSON answer `{ok, moved, swapped, errors, message}`. The moved items come from the target's `?field=&reloadInputfieldAjax=` markup; both fields get their sorts renumbered and `pw-files-moved` (`detail`: `from`, `to`, `moved`, `swapped`, `errors`). Accepted is what an upload would be (extensions, maxFiles, image minimum size; maximum with maxReject, else resized). Hookable: `AdminThemeBridge::moveFiles()`, `moveFileAllowed()`, `filesMoved()`.

**Page tree** (milestone 3.4): the same markup as upstream (`.PageListRoot`, `.PageList`, `.PageListItem.PageListID<id>` with `data-numChild` / `data-numTotal`, `a.PageListPage`, `.PageListNumChildren`, `ul.PageListActions > li.PageListAction<cn>`), options from `ProcessWire.config.ProcessPageList` (`openPageIDs` and pre-rendered `openPageData`, `qtyType`, hover actions, labels, pagination classes). Open state goes to the `pagelist_open` cookie as CSV (`id-start,...`, what the server parses; written when children arrive, not 250 ms later); More and the pagination list (`ul[data-pagination]`) load further children; Edit and View are `.pw-modal-longclick` links (click follows, a 600 ms press opens the dialog); Extras shows extra actions, AJAX ones are posted with the container's CSRF token and the item is updated, added or removed; Since 0.16.0 there is no Move action (the server's Move only marks a row movable): a row is dragged by its title, count or note (mouse or pen after 4 px, a press that does not move stays a click; touch after a 400 ms hold; never with Ctrl, Cmd or Shift; the click after a drag is swallowed) among visible items (into an open item's child list, never between an item and its list; empty open items get a placeholder list), posts `id`, `parent_id`, `sort` to `ajaxMoveURL` and adjusts counts; `pageListRefresh` on document (`detail`: page id) reloads that page's list; `pageListChildrenDone` (detail: data) on the container and `pageMoved` on the item. Since 0.14.0 (ADR 0018) rows are selected as file items are (Ctrl/Cmd+click, Shift+click, a rubber band from a row's blank part; `pw-selected`); a row inside a selected row is never selected on its own, the home page never. Dragging a selected row moves them all (`fields/pagelist-move.ts`): one `page/sort/` request per page, in tree order, an empty answer counting as success; a refused page goes back where it was and the messages are alerted once; `pageMoved` on each moved row. A drop where the rows were posts nothing; Esc or a cancelled pointer puts them back. Since 0.14.1, with two or more rows selected the root has `pw-multi-selection`, the rows' own `.PageListActions` are hidden, and adjacent selected rows draw one band. Hovering a selected row shows `ul.PageListActions.pw-group-actions` (`position: fixed`, after the titles of its run, centred on it; links `a[data-cn]`, extras with `data-extra`) built from each row's actions as the server sent them (`fields/pagelist-group.ts`): every action but View, (0.15.2) Edit and (0.16.0) Move, once, with a count when only some rows have it. AJAX extras are posted row by row as a row's own (rows reselected afterwards; Trash confirms); other actions open the rows' URLs in turn in the dialog; AJAX or not is each row's own (0.15.3: Copy is AJAX only for a page without children, so those are posted first, then the others' copy forms open) (`Next page` in its footer; closing it ends the round, then the rows' lists reload). Without jQuery the theme script defines an empty `ProcessPageListInit()` for the inline call of an AJAX-loaded Children tab (the runtime builds that tree when the markup arrives); when the stack loads later, the native tree is removed and upstream builds it again.

**Lister** (milestone 3.5): the global `ProcessLister` keeps upstream's API (`init`, `submit(url)`, `refreshRow(id, message)`, `refreshRows(ids)`, `refreshAll()`, `getPageID(el)`, and `resetTotal`, `clickAfterRefresh`, `refreshRowPageIDs`, `extraSubmitData`; `ProcessLister.native === true`). Results are posted to `./` with `X-Requested-With` (`render_results`, `filters`, `columns[]`, `sort`, `reset_total`, `row_page_id`, extra data); after a load the results get upstream's header markup, Inputfields initialised and `reloaded` (`ProcessPageLister`), `loaded`, `AdminDataTable.init()`, the lightbox for `a.lister-lightbox` (`Bridge.lightbox(items, index)`, loaded on demand), and their scripts run.

**AdminDataTable** (milestone 3.5; runtime `fields/datatable.ts`, on `table.AdminDataTable`): `AdminDataTableSortable` sorts each body on a header click or Enter/Space on a focused header (tablesorter's classes `tablesorter`, `tablesorter-header`, `tablesorter-headerAsc|Desc|UnSorted`, plus `aria-sort`, `tabindex`; `th.sorter-false` excluded, with `aria-disabled`). A cell's key is its `data-text`, else a hidden key (`.pw-table-sort-value`, `.sort-date`), else an ISO date in its `.detail`, else its text; a column sorts as numbers, ISO dates or text (locale, numeric parts), empty cells last, columns counted with colspan. A table next to a `.MarkupPagerNav` sorts its page only and says so (`pw-table-paged`, header title). `AdminDataTableResponsive` gets upstream's mobile labels at 767 px or less, shift-click checks a range and sends `change` from each box it changed. Without jQuery `window.AdminDataTable` offers `init()`, `initTable(el)`, `resize()`, `sort(table, column, dir)`; `Bridge.tables.sort()` does the same from anywhere. Tables swapped in later (a pager's AJAX) are set up by the content observer. The theme rewrites MarkupAdminDataTable's inline `initTable($('#id'))` to pass the element when jQuery is absent (`hookDataTableRender()`). Column resizing (`AdminDataTableResizable`) is not provided.

Since 0.9.9 every data table a core module renders sorts, also those it made unsortable with `setSortable(false)` (`hookDataTableRenderBefore()`); a column whose header has no text gets `sorter-false`. `___sortableDataTable(MarkupAdminDataTable $table, $maker)` decides (hook after to opt a module's table in or out); by default not: tables without a header row or with fewer than two rows or than the `dataTableSortRows` setting (0.17.0, default 10), the Lister's (`ProcessListerTable`, sorted on the server), InputfieldCheckboxes' table mode (`pw-no-select`, its row order is posted), Sessions (replaced every few seconds), and third-party tables, which keep their maker's choice. Since 0.17.0 a table with fewer rows than `dataTableSortRows` (`getDataTableSortRows()`) renders unsortable whoever made it sortable; a paged table counts its page's rows. On a page with the legacy stack upstream's tablesorter sorts the same tables.

**Setup and access screens** (milestone 3.6; `scripts/setup.js`, `ProcessWireAdminTheme.setup`). Each part runs on its Process's body class:
- **Modules:**
  - WireTabs over `#modules_form`, remembered;
  - the section select and its cookie;
  - not-installed links point at their install button;
  - the settings button;
  - "Check for new modules" opens the New tab;
  - the "new" period submits.
- **Fields:**
  - the list filters submit; export ids follow `.checkbox-ids`;
  - the editor gets WireTabs (`FieldEditTabs`, Delete never remembered);
  - `.columnWidthInput` gets an `input[type=range].InputfieldColumnWidthSlider` (a jQuery UI slider upstream);
  - `#asmListItemStatus` is filled from its `data-tpl`;
  - the context select, import/export toggles, view/edit role rules;
  - overrides select-all, and the overrides reload (`Inputfields.reload()`) after a dialog closes.
- **Templates:**
  - the list filters submit;
  - the editor gets WireTabs (`TemplateEditTabs`), the access tab's dependent parts, import/export.
  - The field list (native asmSelect):
    - row classes `rowItem`, `rowStart`, `rowStop`, `rowError` (`ProcessWireAdminTheme.setup.setupRows()`);
    - widths change by dragging `.columnWidth`, with `.columnWidthBar` shown and 5 % rails when every width sits on one. They are saved with `./saveProperty` `property=columnWidth`. A double press opens the field's edit link at `#find-columnWidth`;
    - a sort is saved at once (`property=fieldgroup_fields`);
    - `field-added` is set on an add.
  - The global `ProcessTemplateInitFields()` stays and dispatches `asm-ready` on `#wrap_fieldgroup_fields`.
  - "Create a new field" opens the field editor in the dialog. Once it is saved, `moreButtons` adds "Close and Add" (`data-closeAddLabel`). That button selects the new field in `#fieldgroup_fields` (and a new fieldset's `_END`), and the asmSelect rebuilds.
- **Users:**
  - the guest user's fields are hidden;
  - the guest role is always on;
  - roles outside `ProcessWire.config.ProcessUser.editableRoles` are dimmed, with `notEditableAlert`.
- **Roles:**
  - the permission tree: children follow their parent; `data-alert` and `data-confirm` apply;
  - template permission toggles;
  - the global `ProcessRoleUpdatePermissions(init, checkbox)` stays.
- **Page types:** the template filter submits.
- **Inline jQuery** in these screens' output is rewritten to run either way (`nativeInlineScripts()`):
  - `$(document).ready(...)` for `ProcessTemplateInitFields()` and for the field editor's `?focus=`;
  - the template's Lister iframe `iFrameResize`. Without jQuery the iframe follows its page's height (`ProcessWireAdminTheme.iframeHeight(frame)`).

**Add page, Profile, Logs, link window** (milestone 3.7):
- **Add page** (`scripts/screens.js`):
  - the parent select submits itself, and a predefined parent reloads with it;
  - the form submits once;
  - Publish buttons follow the template's `data-publish`;
  - the name is checked against its siblings (`exists`, 250 ms after typing; `#ProcessPageAddStatus`, `data-dup-note`);
  - `data-nolang` templates hide the language tabs (globals `hideLanguageTabs()` / `unhideLanguageTabs()` when LanguageTabs.js is absent).
  - with `pageAddSkipTemplate` on ("Step 2 if template auto-selected", off by default; `lib/AdminThemeBridgePageAdd.php`), a GET of `page/add/?parent_id=` without `template_id` whose template is known (the only one allowed, or the one every child uses, unless `$config->pageAdd['noSuggestTemplates']` covers the parent) skips the form: before `ProcessPageAdd::buildForm` the theme runs upstream's `processQuickAdd()` with `name_format=untitled-time` and a notice names the template. Not on `ProcessPageType` screens (users) or under a parent with `childNameFormat` (upstream's own quick add).
- **Profile:**
  - remembered passwords are cleared from `autocomplete=off` inputs;
  - a submit that needs the current password, without it, opens and focuses `#_old_pass` (upstream: a vex prompt).
- **Logs:** the global `ProcessLogger` keeps upstream's API (`init`, `submitFilters`, `setupLogEntries`, `paginationClick`, `filterChange`; `ProcessLogger.native`). Entries reload by JSON on a filter, the pager and a 5 s poll (`time`).
- **Link window** (`scripts/link.js`, `ProcessWireAdminTheme.link`; the CKEditor and TinyMCE pwlink plugins read it through the parent's jQuery):
  - the page pickers are the runtime's PageListSelect (`#child_page_id` rooted at the edited page);
  - a chosen page fills the URL (relative per `urlType`) and loads its files;
  - file and anchor selects fill the URL;
  - scheme and `mailto:` are added;
  - external class, rel and target, and the header icon, follow the URL. Like upstream, any URL with a host counts as external;
  - `#link_markup` previews the link;
  - WireTabs `PageEditLinkTabs`.

**Image select, Crop and Variations** (milestone 3.9; `scripts/image-select.js`, `ProcessWireAdminTheme.imageSelect`). Its window is opened by the image field (Crop, Variations) and by the rich text editors' image buttons:
- **Talking to the opener:** upstream's globals keep their names: `enablePWImageDialogButtons()`, `disablePWImageDialogButtons()`, `closePWImageDialog()`, `setupProcessSave(field, fileID, isNew)`, `setupProcessSaveReloaded()`, `refreshPageEditField(field)`.
  - They work with either opener: through its jQuery UI dialog when it has jQuery, else through the native dialog (`Bridge.dialog.close()`, the `pw-dialog` footer) and `Inputfields.reload()`.
  - On a window that loaded the stack, only these globals are replaced, and only when the opener has no jQuery.
- **Resize:** handles in jQuery UI resizable's markup (`.ui-wrapper`, `.ui-resizable-handle.ui-resizable-<dir>`). The aspect ratio is kept, and so are the `width` / `height` attributes and `#input_width` / `#input_height`, which the editors' pwimage plugins insert.
- **Crop:** a crop box in Cropper's markup (`.cropper-container`, `.cropper-crop-box`, `.cropper-face`, `.cropper-line`, `.cropper-point`).
  - Data is in the image's own pixels, in `#crop_x/y/w/h`, both ways; `data-crop` presets it.
  - The dialog's buttons wait while cropping; Cancel brings back the resize handles.
- **The other controls:** alignment, caption, description, min/max, HiDPI, link to larger, fit to window.
- **Variations:** select all, the preview in the native lightbox.
- **Other:** another page's picker (`pageSelected`); Enter never submits.
- **Image field:** Crop and Variations open the native dialog, so the stack no longer loads for them.
- **Inline jQuery:** the window's inline `$(document).ready(function() { setupProcessSave(...) })` is rewritten (`nativeInlineScripts()`).

**Scripts a Process adds** (3.7, Gate 3):
- **Becomes a legacy reason:** a site module's jQuery script added while the Process runs, for example BatchChildEditor's or VersionControl's from a ProcessPageEdit hook. The reason is `Script:<dir>/<file>`.
- **Is not a reason:**
  - a script added before the Process runs, at init or ready on every admin page; it stays deferred with the stack (`isJqueryScript()`);
  - a script from a module directory that holds an `Inputfield*` or `Fieldtype*` module; it belongs to that field, whose `Inputfield:` reason covers it (`isFieldModuleDir()`);
  - the native Process's own script.
- **Classic save:** a page with a `Script:` reason always saves the classic way (`scripts/page-save.js`). Such scripts bind at document ready and would leave a swapped form without their UI.

**Icon and Password** (milestone 3.6; runtime `fields/icon.ts`, `fields/password.ts`; exact classes):
- **InputfieldIcon:**
  - the choice shows in the header icon (`ProcessWire.icon()` with Font Awesome 6);
  - the search runs over its options from three letters; Enter takes the first match.
- **InputfieldPassword:**
  - scoring as upstream's complexify: the same charsets, `data-banMode`, `data-factor`, `data-minlength`. The banlist script is loaded from the deferred stack list when needed;
  - `data-requirements` checked with Unicode property escapes (`\p{L}`, `\p{Lu}`, `\p{Ll}`, `\p{N}`, `\p{P}`/`\p{S}`, `\p{Z}`) in place of XRegExp;
  - the confirm input is enabled for an acceptable password; the match is reported (`p.pass-matches`);
  - the show/hide mask and the old-password lock.

**Repeater and PageTable** (milestone 3.3; runtime `fields/repeater.ts`, `fields/pagetable.ts`), for exact `InputfieldRepeater` / `InputfieldPageTable` (RepeaterMatrix, FieldsetPage and other subclasses keep their scripts):
- repeater: the item header controls upstream adds (drag handle `.InputfieldRepeaterDrag`, `.InputfieldRepeaterItemControls` with trash, on/off toggle, clone, settings, insert after / before, the open/close icon), items loaded by AJAX when opened (`editorUrl?repeater_edit=`), added by AJAX (`repeater_add`, `repeater_clone`, `repeater_not`) or from the template item (`noAjaxAdd`), insert before / after (a placeholder shows where after a second of hover), copy / clone / paste through a choice dialog (`util/choose.ts`, `dialog.pw-ask`, in place of vex) and the `<field>_copy` cookie, drag sort by the handle with depth from a sideways drag (50 px a level, family-friendly children move along), min / max items, `repeaters_open` cookie, accordion, family open/close; events `repeateradd`, `repeaterdelete`, `repeaterundelete`, `repeaterinsert`, `sorted`, `reloaded` / `cloned` (`detail.source`) as upstream; inline scripts of new content run (legacy content after the stack loads);
- page table: Add and Edit open the page editor in the native dialog with the window's submit buttons in the footer, template, parent, Delete and Children hidden there, closing after a save without errors or warnings (not on the add form, not with `data-noclose`), then the table reloads by AJAX (`InputfieldPageTableAdd`, `InputfieldPageTableSort`) keeping rows marked for deletion; row drag sort, double click edits, trash marks, orphans "Select all".

Native fields of the page editor (runtime `fields/pagename.ts`): `InputfieldPageName` (URL preview while typing, sanitized on blur; `ProcessWire.config.InputfieldPageName`), `InputfieldPageTitle` (on `#ProcessPageAdd` the title fills an empty name; `.InputfieldPageTitleCustom` fills its `data-name-field`).

## 5. Writing a component Inputfield

1. Implement `BridgeComponent`; return `tag`, `module` (relative to the module directory is fine), `version: '1'`.
2. In `___render()`, wrap the control in your element inside the upstream content: `<pw-thing …><input id='Inputfield_<name>' name='<name>' …></pw-thing>`. Keep upstream `id` and `name` on the real form control, or provide a hidden `<input id='Inputfield_<name>'>` mirroring the value, so that `processInput()`, dependencies and third-party hooks keep working.
3. Ship the ES module next to the module file. On import it registers the element with `customElements.define` (guard with `customElements.get`). Optional `export default { tag, version }`.
4. Dispatch a bubbling `change` on the control whenever the component changes the value itself; dependencies and the `pw-head-button` logic listen for `change`/`input`.
5. Do not touch `li.Inputfield`, its header, or its classes; the runtime owns collapse and visibility. Read collapse state from the classes if needed; listen for `opened`/`reloaded` to initialise lazily.
6. Do not assume `jQuery`, `Inputfields`, `ProcessWireAdmin` or `ProcessWire.config.<theme>` exist. `ProcessWire.config.<YourClass>` set via `$config->js()` is the way to pass data.
7. Styles: ship a stylesheet via `$config->styles->add()` or inside the element; the shell's base stylesheet styles upstream classes only.
8. Legacy helpers are available on demand: `Bridge.legacy.load().then(…)`, but a component that needs them is not a component yet.

For a Process: implement `BridgeComponent` too; its `module` is imported once per page from `ProcessWire.config.AdminThemeBridge.process`. The Process's own `ClassName.js` (auto-loaded by the core) remains a classic script and must not rely on jQuery.

## 6. Reference implementation

`modules/BridgeDemo/`:

- `InputfieldBridgeText` (`tag: pw-text`, `module: pw-text.js`): upstream `InputfieldText` markup wrapped in `<pw-text>`; the element adds a character counter, trims on blur and dispatches `change`.
- `ProcessBridgeDemo` (`module: ProcessBridgeDemo.mjs`): form of `InputfieldBridgeText` (collapsed, `showIf`, `requiredIf`, column widths), `<pw-tabs>`, a `.pw-modal` link, and a button that fetches a legacy collapsed `InputfieldText` over AJAX to exercise the lazy stack.

Verified 2026-10-14 on the atispro sandbox under Bridge in `auto` mode.

## 7. Not covered yet

Covered since this section was first written: WireTabs on native pages (`scripts/wire-tabs.js`, 4.4); the `pw-modal` options `data-buttons`, `data-autoclose`, `data-close` (4.2, `<pw-dialog>`); `Inputfields.reload()` and the `#find-`, `#focus-`, `#highlight-` hash actions (4.2). Still open (audit 2026-10-20, findings B10 and B12):

- Header actions: `Inputfields.addHeaderAction()` and its `InputfieldHeaderAction` markup are not in the facade. A click inside one does not collapse its field (collapse.ts), but nothing builds them on a native page.
- The rest of upstream's `Inputfields` API that the facade lacks: `init`, `show`, `hide`, `toggleAll`, `startSpinner`, `stopSpinner`, `columnWidth`, `insertBefore` and `insertAfter`, `header`, `content`, `icon`. `toggle(target, open)` ignores `open`.
- The `InputfieldFormNoWidths` mode (column widths off for a whole form).
- `ProcessLister.results` and `.filters` are DOM elements, where upstream has jQuery objects.
- A `<pw-field>` element was dropped (PLAN.md, milestone 1.3 findings): `li.Inputfield` is the contract.

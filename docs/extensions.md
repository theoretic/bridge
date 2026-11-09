# Bridge extensions, contract 0.1

An extension is an ordinary module that changes the Bridge admin only through a published
surface: the theme's hookable methods, a few public methods, its settings, the shell slots, the
runtime's `window.Bridge` and the bubbling DOM events. It declares what it uses in a manifest.
The theme reads the manifest to load the extension's client module and fill its slots; the
contract tests and the compatibility checker read the same manifest.

The extension contract has its own version, `AdminThemeBridge::extensionContract` (`'0.1'`),
apart from the module version and from the component contract (`Bridge.contract`, `'1'`,
`docs/contract.md`). Before 1.0 it may change between minor versions. A component
(`BridgeComponent`) is not an extension; a module may be both.

## 1. What goes where

| Proposal | Where it goes |
|---|---|
| Changes the contract (the surface below, the manifest, the shell's markup contract) | The theme |
| Uses the contract and most sites need it | A bundled extension (ships in `modules/`, uses the surface only) |
| Uses the contract, niche need | A third-party extension |

Weights, lightest first: a setting the theme already has; a declarative manifest (the
`bridge` module info key, no code); a module with PHP and an ES module.

Confinement is a contract, not a sandbox: PHP cannot be confined. An extension reads
ProcessWire as much as it likes (pages, users, roles, permissions) and does not alter
ProcessWire's behaviour outside the admin; in the admin it uses the surface and nothing else,
in particular no `lib/` file of the theme and no theme method missing from section 3.

## 2. The manifest

Either a method, from the interface `ProcessWire\BridgeExtension`
(`modules/AdminThemeBridge/BridgeExtension.php`), or the same array as the module info key
`bridge`. When a module has both, the method wins.

```php
<?php namespace ProcessWire;

// the interface without depending on the theme: its file when the theme is there, else the same
// one-method interface declared here (as modules/BridgeDemo does for BridgeComponent)
if(!interface_exists("ProcessWire\\BridgeExtension", false)) {
	$bridgeExtensionFile = dirname(__DIR__) . '/AdminThemeBridge/BridgeExtension.php';
	if(is_file($bridgeExtensionFile)) {
		require_once($bridgeExtensionFile);
	} else {
		interface BridgeExtension { public function getBridgeExtension(); }
	}
	unset($bridgeExtensionFile);
}

class BridgeHello extends WireData implements Module, BridgeExtension {
	public static function getModuleInfo() {
		return array('title' => 'Hello', 'version' => '0.1.0', 'requires' => 'AdminThemeBridge');
	}
	public function getBridgeExtension() {
		return array(
			'contract' => '^0.1',
			'module' => 'BridgeHello.mjs',
			'hooks' => array('renderBreadcrumbs'),
		);
	}
}
```

Without the interface check, any request that includes the module file while the theme is not
loaded (the command line, a modules refresh from the front end) ends in a fatal error.

| Key | Type | Meaning |
|---|---|---|
| `contract` | string | The contract range it was written for: `^0.1`, `~0.1`, `>=0.1 <1`, `^0.1 \|\| ^1`, `*`. Required |
| `name` | string | Defaults to the module's class name |
| `module` | string | An ES module the admin imports on every page for users who may have the extension. Absolute URLs and root-relative paths are kept; anything else is relative to the module's directory, with `?v=<module version>` |
| `slots` | array | Slot name => name of a public method on the module that returns markup. The extension escapes its own output |
| `hooks` | array | The theme's hookable methods it attaches to, without `___` (section 3) |
| `reads` | array | The theme's public non-hookable methods it calls (section 3) |
| `settings` | array | The theme settings it reads (section 3) |
| `permission` | string | A permission the user needs for the extension to load; empty = every signed-in user |
| `priority` | int | Order among extensions (in one slot, on the client), lower first; default 100, ties by class name |

Discovery: installed modules whose `requires` names `AdminThemeBridge`, or whose module info
has a `bridge` key. The `bridge` key is read from the module info cache: after changing it,
refresh the modules (or raise the module's version). `getBridgeExtension()` is asked on an
instance that may not have run `init()`: return a fixed array, read no config.

The theme gives the client `ProcessWire.config.AdminThemeBridge.extensions` (signed-in users,
the extensions they may have: `name`, `module`, `contract`, `compatible`, `priority`) and
`ProcessWire.config.AdminThemeBridge.extensionContract`. A manifest that throws is logged to
`bridge-extensions` and left out; the admin goes on.

## 3. The surface

The list below is `AdminThemeBridge::extensionSurface()` (hookable), word for word; the smoke
test compares the two, and the `hooks` line with the methods the class declares.

- **contract**: `0.1`
- **hooks**: `install`, `uninstall`, `nonce`, `moveFiles`, `moveFileAllowed`, `filesMoved`, `historyEntry`, `nativeMap`, `isNativeProcess`, `isNativeInputfield`, `scriptNeeds`, `renderBreadcrumbs`, `sortableDataTable`, `uikitReasons`, `extensionSurface`, `drawerNames`, `navCacheKey`
- **reads**: `useLegacyStack`, `componentInfo`, `extensions`, `extensionInfo`, `extensionAllowed`, `cspNonce`, `nonceAttr`, `nonceScriptTag`, `themeAssetUrl`, `getVariant`, `getColorScheme`, `shellLabel`, `getHistorySteps`
- **settings**: `legacyStack`, `uikit`, `maxWidth`, `variant`, `primaryColor`, `colorScheme`, `logoURL`, `logoURLDark`, `extendedBreadcrumbs`, `pageTreeDrawer`, `history`, `historySteps`, `pageSaveInPlace`, `pageAddSkipTemplate`, `dangerWarn`, `userColors`, `dataTableSortRows`, `printScripts`, `nativeOverrides`, `extensionDev`
- **slots**: `head`, `masthead`, `masthead-right`, `user-nav`, `content-head-buttons`, `footer`, `drawer`, `body`
- **events**: `pw-runtime-ready`, `pw-legacy-loaded`, `pw-legacy-handover`, `pw-uikit-loaded`, `pw-component-loaded`, `pw-component-failed`, `pw-modal-opened`, `pw-modal-closed`, `pw-wiretabs-change`, `pw-tab-focus`, `pw-drawer-open`, `pw-drawer-close`, `pw-page-save`, `pw-page-saved`, `pw-form-save`, `pw-form-saved`, `pw-files-moved`, `pw-extension-loaded`, `pw-extensions-ready`, `opened`, `closed`, `reloaded`, `showIf`, `changed`
- **runtime**: `contract`, `version`, `Inputfields`, `components`, `dialog`, `legacy`, `tables`, `pageTree`, `sortable`, `confirm`, `guard`, `extensions`

Hooks attach as anywhere in ProcessWire: `$this->addHookAfter('AdminThemeBridge::renderBreadcrumbs', ...)`.
What each method, event and runtime key does is in `docs/contract.md`. Upstream's own regions
(`AdminTheme::addExtraMarkup()` for `head`, `masthead`, `body`) keep working.

The contract range: `^x.y` keeps the major version (for `0.y`, the minor one), `~x.y` the minor
one; comparisons `>= > <= < =`, all of a space-separated list must hold, `||` separates
alternatives. `AdminThemeBridge::contractSatisfies($range, $version)` and
`contractRangeValid($range)` do the same in PHP.

## 4. Slots

A slot is a named place in the shell that extensions fill through their manifest's `slots`:
slot name => a public method on the module (a hookable `___` method works too). The theme gets
the module (`$modules->get()`, so it is inited), calls the method with the slot name and prints
what it returns. The method returns a string of markup it has escaped itself; `null` or `''`
prints nothing. A slot that nothing fills prints nothing at all, not an empty element.

| Slot | Where it lands | Element per extension |
|---|---|---|
| `head` | In `<head>`, after upstream's `head` extra markup | none, printed as given |
| `masthead` | After the masthead and the notices, after upstream's `masthead` extra markup | `<div>` |
| `masthead-right` | In the masthead's right group, before the display controls | `<div>` |
| `user-nav` | In the user menu, after its links, before the colour picker | `<li>` |
| `content-head-buttons` | In `#pw-content-head-buttons`, after the Add New button | `<div>` |
| `footer` | In `#pw-footer`, after the version line, before the debug panel | `<div>` |
| `drawer` | A drawer of its own: a button beside the logo and a `<dialog class='pw-drawer'>` | the dialog |
| `body` | At the end of `<body>`, after upstream's `body` extra markup, before the scripts | `<div>` |

Each element carries `data-bridge-slot='<slot>'` and `data-bridge-extension='<name>'`. Several
extensions in one slot come in `priority` order. Slots print for signed-in users only, for the
extensions they may have (`permission`) and whose `contract` range takes the theme's; in a
modal window only `head` and `body`. Slots get no CSS of their own: use the `pw-*` classes.

The `drawer` method returns the drawer's body, or an array: `content` (the body), `label`
(the button's and dialog's name, default the extension's name), `icon` (a Font Awesome name
without `fa-`, default `puzzle-piece`). Its drawer is named `ext-` and the extension's name in
lower case (`ext-bridgesample`: `dialog#pw-drawer-ext-bridgesample`); it opens and closes as the
theme's own drawers do and fires the same `pw-drawer-open` / `pw-drawer-close` events.
`AdminThemeBridge::drawerNames()` is hookable: an after hook may drop a drawer.

A method that is missing or throws, or returns something else than a string (an array for
`drawer`), is logged to `bridge-extensions` (`site/assets/logs/bridge-extensions.txt`) and left
out; the page renders without it.

Upstream's own regions keep working: `$adminTheme->addExtraMarkup('head'|'masthead'|'body', $html)`
prints before the slot of the same name.

## 5. Client

The runtime imports each listed extension's `module` (an ES module, as for a component:
`docs/contract.md` 2) through `Bridge.components.load()`: one registry, the same retry, and on a
failure the same `pw-component-failed` event and notice. The extensions code is a chunk of its
own, loaded only on a page whose list is not empty. An extension whose `compatible` is false
(its `contract` range does not take the theme's) is not imported; its slots are not printed
either.

- `Bridge.extensions.list()`: the manifests as the theme sent them (`name`, `module`,
  `contract`, `compatible`, `priority`).
- `Bridge.extensions.loaded()`: per extension `name`, `url` (the module URL imported last, `null`
  without one), `tag` and `version` (the module's default export `{ tag, version }`), `error`
  (the import's error message, `incompatible contract <range>`, or `null`). Empty until the
  extensions chunk has arrived.
- `Bridge.extensions.reload(name)`: imports the module again with a fresh `?v=` and fires
  `pw-extension-loaded` again (the basis of dev mode, section 9). A module defines its custom element
  guarded by `customElements.get()`: a defined element cannot be defined again, so a reload
  runs the module's other code, not a new class.

Events, on `document`: `pw-extension-loaded` (`detail.name`, `detail.module`: the default
export, `null` for an extension without a module) per extension once its module is in, and
`pw-extensions-ready` (`detail.names`) once after all of them, failed ones included. Neither
fires on a page without extensions.

The bus is DOM events, and no other. An extension listens on `document` for the contract's
bubbling events (section 3) and dispatches its own as bubbling `CustomEvent`s named
`pw-<name>-<event>`, `<name>` its name in lower case (`pw-bridgesample-refresh`). It does not
dispatch the theme's events.

## 6. Contract tests

Two harnesses check an extension against a sandbox (`tools/sandbox-site.sh`; the module's
directory placed under the sandbox's site modules, as a junction). `<Module>` is a module class,
or a directory name: then every module in it with a manifest is checked, the others are skipped.
Both print `ok` / `FAIL` lines and exit 1 on a failure.

The commands in this document are written for Git Bash (`VAR=value command`). In PowerShell set
the variable first, `$env:PW = '<playwright-core dir>'; node tools/...`; in cmd, `set PW=<dir>`
on a line of its own, then the command.

```bash
php tools/extension-check.php sandbox/atispro <Module> [--base=http://localhost:8089] [--no-http]
node tools/extension-check.js <playwright-core dir> chromium <Module>    # PHP=<php>, SANDBOX=<root>
php tools/extension-check.php sandbox/atispro --self-test
```

`extension-check.php` installs the module if needed, then checks:

- the manifest: known keys only (section 2), each of its type; `contract` a range that takes
  `extensionContract`; `hooks`, `reads` and `settings` on the surface (section 3; a hook also
  declared by the theme as `___<hook>`); each `slots` entry a slot of section 4 whose method
  exists and returns a string (`drawer`: or an array with `content`); `module` a file that exists;
  `permission` an existing permission; the theme discovers the extension and finds it compatible;
- surface only, by a static scan of every PHP file in the module's directory: each method called
  on the theme (`->adminTheme->x()`, `wire('adminTheme')->x()`, a variable assigned the theme),
  each `AdminThemeBridge::x` and each hook string `'AdminThemeBridge::x'`. Upstream's AdminTheme
  methods are always allowed; the theme's own only when they are on the surface **and** the
  manifest declares them (`hooks` for a hook, `hooks` or `reads` for a call). A path to a theme
  file other than `BridgeExtension.php` / `BridgeComponent.php`, and a file write under
  `paths->wire`, fail too. Each failure names file and line. The scan is a heuristic: a theme
  reached another way (`$event->object` in a hook, a variable passed from elsewhere) is not seen;
  review still matters;
- over HTTP, signed in as the sandbox user `bridge`: the page tree and the module's own screens
  (admin pages running it, its settings) answer 200 without PHP error text; the page tree lists
  the extension in `ProcessWire.config.AdminThemeBridge.extensions` and carries a part of each
  slot it fills;
- the module's own `<Name>.check.php`, if it has one (the scaffold writes it): included with
  `$wire`, `$module` and `check($label, $ok, $detail = '')` at hand.

`extension-check.js` loads the page tree in a browser, signed in as `bridge`: the extension is in
`Bridge.extensions.list()` (compatible) and in `loaded()` without error, `pw-extension-loaded`
fired with its name, each slot it fills has its part in the DOM with its custom elements
defined, `reload()` fires `pw-extension-loaded` again, and `reload()` of an edited copy of the
module (served in its place from a temp file, its exported version literal changed; the module
file is not touched) shows the new version in `loaded()` (section 9); `pw-extensions-ready` fired once, no
jQuery unless the theme recorded legacy reasons, no console errors.

`--self-test` writes a module with four faults into the sandbox (an unknown manifest key, a hook
the theme does not have, a call to a theme method off the surface, an include of a `lib/` file),
expects exactly those four failures, and removes the module again.

## 7. Bundled extensions

The modules in `modules/` that use the theme declare themselves; `tools/extension-check.php`
passes on each (section 6).

| Module | Manifest | Uses |
|---|---|---|
| `BridgeCsp` (Bridge CSP) | the `bridge` module info key: no code, and no `requires` of the theme | hooks `nonce` (gives the theme the request's nonce), reads `useLegacyStack` (enforce or report only per screen); the client gets no module |
| `ProcessBridgeDemo` (directory `BridgeDemo`) | `getBridgeExtension()`; also a `BridgeComponent` | reads `nonceAttr` (its csp/ screen); `module` `ProcessBridgeDemo.mjs`, imported on every admin page for users with `page-edit`; no slots |
| `BridgeSample` | `getBridgeExtension()`, generated by the scaffold | six slots (`masthead-right`, `user-nav`, `content-head-buttons`, `footer`, `drawer`, `body`) and `BridgeSample.mjs`; the fixture of the contract tests |
| `BridgeAdminAccessControl` (Bridge admin access control) | the `bridge` module info key: no code, and no `requires` of the theme | hooks `navCacheKey` (a change of the rules shows in a signed-in user's menu on the next request), `drawerNames` (no page tree drawer with Pages denied); enforcement is on the core's seams ([access-control.md](access-control.md)); no slots, the client gets no module |

`InputfieldBridgeText` (in `BridgeDemo`) is a component, not an extension.

## 8. Compatibility

`tools/extension-compat.php` tells which extensions break on a given Bridge, without booting
anything and without writing anything: it reads PHP as tokens (`token_get_all`), so it can run
over any site's modules.

```bash
php tools/extension-compat.php [--bridge=<Bridge checkout or AdminThemeBridge dir>] [--surface=<json>] [--verbose] [<dir>...]
php tools/extension-compat.php                                       # this checkout's modules/ and sandboxes
php tools/extension-compat.php path/to/site/modules                  # a site's modules against this checkout
php tools/extension-compat.php --bridge=path/to/other/bridge modules # this checkout's extensions against another Bridge
php tools/extension-compat.php --verbose path/to/site/modules        # also list the skipped modules, and why
```

- **The target** is a Bridge (default: this checkout): the `extensionContract` constant of
  `AdminThemeBridge.module.php` and the surface (section 3) from
  `assets/dist/extension-surface.json`, which the runtime build writes from the theme's source
  (`runtime/scripts/manifest.mjs`; the smoke test compares it with `extensionSurface()`).
  `--surface=<json>` gives both instead (`contract` and the lists). A Bridge without the constant
  has no extension contract: every extension is incompatible with it.
- **The extensions** are the modules under the directories (default: `modules/` and each
  `sandbox/<site>/app/modules/`) whose manifest can be read from the source: the literal array
  `getBridgeExtension()` returns when the class implements `BridgeExtension`, otherwise the
  `bridge` key of the module info (`getModuleInfo()`, `<Name>.info.php` or `<Name>.info.json`).
  Modules with neither are skipped and only counted (`--verbose` lists them).
- **Discovery** follows ProcessWire's own rule, `ModulesFiles::findModuleFiles()`
  (`wire/core/Modules/ModulesFiles.php:87–169`, 3.0.274): hidden files and directories are
  skipped (:131–134); every directory of a scanned directory is entered, and below it only a
  directory that holds `<DirName>.module` or `<DirName>.module.php` (:137), at any depth; a module
  file is `<Name>.module` or `<Name>.module.php`, the name being the part before the first dot
  (:142–145); the info files are read beside it. So a stray copy kept in a directory that is not
  a module (`<Module>/legacy/…`) is not seen at all. A module found twice counts once, where it
  was found first; a directory's own module files come before its subdirectories, so a copy in a
  module-named subdirectory is the one reported as found twice, never the module itself.
  ProcessWire walks a directory in file-system order and loads modules with an autoload order
  first; the checker walks in sorted order and knows neither that order nor a copy an admin
  chose for a duplicate (`ModulesDuplicates`).
- **Per extension**: the `contract` range takes the target's contract (the theme's own
  `contractSatisfies()`); `hooks`, `reads`, `settings` and `slots` are on the target's surface;
  the `module` file exists; the theme would discover the extension (by the interface it also needs
  `requires AdminThemeBridge` or a `bridge` info key). A manifest built at run time (not a literal
  array) cannot be checked and counts as incompatible.

It prints a table (extension, version, directory, contract, result, problems) and a summary.
With `--verbose` it also lists, between the two, every module it skipped with its directory and
the reason: `no manifest`, `empty bridge info key`, `getBridgeExtension() returns an empty array`,
`found twice, counted in <dir>` or `the theme itself` (the last two are not in the summary's
count). Without it the output is the table and the summary only.
Exit code: the number of incompatible extensions (at most 254); 255 when the target or the
`--surface` file cannot be read. The contract tests (section 6) check far more, but need a
sandbox; this checker needs only the files.

## 9. Dev mode

Two pieces, both for working on an extension's client module against a sandbox or a local site.

- **The setting** *Extension development* (`extensionDev`, the theme's settings, Features; off by
  default). While it is on, and only for a superuser, the `module` URL of an extension
  (`extensionInfo()`) and of a component (`componentInfo()`) whose file lies under the site
  modules ends in `?v=<file time>` (the file's modification time, 10 digits) instead of
  `?v=<module version>`: an edited `.mjs` is fetched fresh on the next page load, without a
  cache clear or a version bump. Core modules and other URLs keep the module version; with the
  setting off nothing changes. Leave it off on a live site.
- **The watcher** `tools/extension-dev.js` opens the admin's page tree in a browser (Playwright,
  signed in as the sandbox user `bridge`), watches the module's directory and, when a file in it
  changes, calls `Bridge.extensions.reload(<name>)` for each extension whose module lies in that
  directory. The page stays; the module is imported again with a fresh `?v=` and
  `pw-extension-loaded` fires again. Each reload prints one line with the extension's error or
  exported version; the page's console errors are printed too. A changed PHP file is only
  reported: PHP takes a page load. Ctrl+C (or closing the browser) stops it.

```bash
PW=<playwright-core dir> node tools/extension-dev.js modules/BridgeSample [admin url]   # HEADLESS=1 for no window; SANDBOX=, PROBE_PASS= as for the harnesses
```

What a reload does not do: it is not hot module replacement. A custom element, once defined, stays
the class it was (`customElements.define()` cannot redefine a tag), so the module's other code runs
again but an edited element class takes a page load; state the old module kept is not carried over;
a stylesheet the module injects is the module's own business on `pw-extension-loaded`. Real HMR
would need a dev server and a bundler contract with extensions, which the extension model leaves out
on purpose (no build step shared between Bridge and an extension).

## 10. Scaffold

`tools/scaffold-extension.php` writes the skeleton of a new extension:

```bash
php tools/scaffold-extension.php <Name> [--dir=modules] [--slots=footer,user-nav] [--module]
```

Into `<dir>/<Name>/` (a directory that exists is refused): `<Name>.module.php` (module info with
`requires AdminThemeBridge`, the interface check of section 2, a manifest with `contract ^0.1`,
one method per slot returning escaped markup, an empty settings screen), with `--module`
`<Name>.mjs` (defines `<pw-<name in lower case>>` guarded by `customElements.get()`, exports
`{ tag, version }`), `<Name>.check.php` (one check per slot, run by `extension-check.php`) and a
`README.md`. `--slots` takes the slot names of section 4. It boots nothing, and the output depends
on the arguments only: `modules/BridgeSample` is its output for
`BridgeSample --slots=masthead-right,user-nav,content-head-buttons,footer,drawer,body --module`,
and the smoke test generates it again and compares the two byte for byte.

Then: place the directory under a sandbox's site modules (a junction), install it
(`php tools/sandbox-modules.php sandbox/<site> <Name>`, or Modules > Refresh and Install), run the
contract tests (section 6) and the dev watcher (section 9) while working on it.

## 11. Not in contract 0.1

- **Access control as part of the contract.** It exists as the fourth bundled extension,
  `BridgeAdminAccessControl` (section 7, [access-control.md](access-control.md)), built through
  this kit: rules that narrow the core's own per-template access by branch and by main menu. It is
  an ordinary module, not a feature of contract 0.1, and there is still no declarative way to hide
  a slot or a menu item. Hiding is not security: enforcement belongs on the server.
- **Middleware, endpoint registration, response shaping.** Bridge is an admin theme on upstream's
  URLs and JSON contracts, not an API layer: upstream's Process modules and hooks are the request
  pipeline, and an extension uses them as any module does. There is no `$bridge` facade object;
  the facade is the surface of section 3, which the contract tests hold an extension to.
- **More declarative weight.** The `bridge` info key declares what a module uses; hiding,
  renaming or reordering menu items without code is not part of 0.1.
- **Hot module replacement** (section 9), and a directory or registry of extensions.

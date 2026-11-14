# Bridge extensions, contract 1.0

An extension is an ordinary module that changes the Bridge admin only through a published
surface: the theme's hookable methods, a few public methods, its settings, the shell slots, the
runtime's `window.Bridge` and the bubbling DOM events. It declares what it uses in a manifest.
The theme reads the manifest to load the extension's client module and fill its slots; the
contract tests and the compatibility checker read the same manifest.

The extension contract has its own version, `AdminThemeBridge::extensionContract` (`'1.0'`),
apart from the module version and from the component contract (`Bridge.contract`, `'1'`,
`docs/contract.md`). Contract 1.0 is frozen for 1.x: entries may be added in a minor version of
the theme, none is removed or changed before 2.0 ([ADR 0024](decisions/0024-the-1-0-compatibility-promise.md)).
A component (`BridgeComponent`) is not an extension; a module may be both.

The theme honours more than its current contract: `AdminThemeBridge::extensionContracts`
(`'0.1'`, `'0.2'`, `'1.0'`, the surface's `contracts`) lists every contract version it serves,
the current one last. 0.2 only added to 0.1 (the manifest keys `styles` and `tokens`, the surface
keys `contracts` and `tokens`, the read `extensionStyles`), and 1.0 is 0.2's surface, frozen
(one read taken off, six documented names listed; section 3), so 0.1 and 0.2 are still honoured
and a manifest written for `^0.1` or `^0.2` keeps working. An extension is compatible when its
`contract` range takes any of the listed versions (`AdminThemeBridge::contractCompatible()`). A
contract that removes or changes something drops the older versions from the list (ADR 0022).

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
			'contract' => '^0.2 || ^1.0',
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
| `contract` | string | The contract range it was written for: `^0.2 \|\| ^1.0`, `^1.0`, `^0.2`, `~0.1`, `>=0.1 <1`, `^0.1 \|\| ^1`, `*`. Required. The extension is compatible when the range takes any version of the surface's `contracts` (section 3) |
| `name` | string | Defaults to the module's class name |
| `module` | string | An ES module the admin imports on every page for users who may have the extension. Absolute URLs and root-relative paths keep their place; anything else is relative to the module's directory. Every one gets `?v=<module version>` unless it has a query already (dev mode, for a file under the site modules: its file time, section 9) |
| `styles` | array | Stylesheets (since 0.2). A relative entry is relative to the module's directory, with `?v=<module version>` (dev mode: the file time, section 9); absolute URLs and root-relative paths are printed as given, without `?v=` (unlike `module`). The theme prints them in `<head>` after `theme.css` and `fields.css`, with the CSP nonce, one `<link rel='stylesheet' data-bridge-styles='<name>'>` each; the style-order code keeps them there. Also in modal windows; for signed-in users only, for the extensions they may have and whose `contract` the theme honours. A site's own copy of `_head.php` needs one loop for them (section 12) |
| `tokens` | array | The theme's CSS custom properties its stylesheets read or set (since 0.2), each a name of the surface's `tokens` (section 3); the contract tests compare them with the `styles` files |
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
`bridge-extensions` and left out; the admin goes on. `AdminThemeBridge::extensionStyles()`
lists the stylesheets the request prints (`extension`, `url`, by priority).

## 3. The surface

The list below is `AdminThemeBridge::extensionSurface()` (hookable), word for word; the smoke
test compares the two, and the `hooks` line with the methods the class declares.

- **contract**: `1.0`
- **contracts**: `0.1`, `0.2`, `1.0`
- **hooks**: `install`, `uninstall`, `nonce`, `moveFiles`, `moveFileAllowed`, `filesMoved`, `historyEntry`, `nativeMap`, `isNativeProcess`, `isNativeInputfield`, `scriptNeeds`, `renderBreadcrumbs`, `sortableDataTable`, `uikitReasons`, `extensionSurface`, `drawerNames`, `navCacheKey`, `tokenOverrides`, `appearance`, `adminTitle`, `faviconUrl`
- **reads**: `useLegacyStack`, `componentInfo`, `extensions`, `extensionInfo`, `extensionAllowed`, `extensionStyles`, `cspNonce`, `nonceAttr`, `nonceScriptTag`, `getVariant`, `getColorScheme`, `shellLabel`, `getHistorySteps`, `tokenCss`, `getLabelSize`, `getControlHeight`, `isLoginScreen`, `renderAdminTitle`
- **settings**: `legacyStack`, `uikit`, `maxWidth`, `variant`, `primaryColor`, `colorScheme`, `logoURL`, `logoURLDark`, `extendedBreadcrumbs`, `pageTreeDrawer`, `history`, `historySteps`, `pageSaveInPlace`, `pageAddSkipTemplate`, `dangerWarn`, `userColors`, `dataTableSortRows`, `printScripts`, `nativeOverrides`, `extensionDev`, `labelSize`, `controlHeight`
- **slots**: `head`, `masthead`, `masthead-right`, `user-nav`, `content-head-buttons`, `footer`, `drawer`, `body`
- **tokens**: `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`, `--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--pw-primary`, `--pw-primary-hover`, `--pw-primary-bg`, `--pw-primary-20`, `--pw-on-primary`, `--pw-bg`, `--pw-surface`, `--pw-surface-2`, `--pw-line`, `--pw-text`, `--pw-text-muted`, `--pw-h1`, `--pw-input-bg`, `--pw-input-border`, `--pw-radius`, `--pw-radius-m`, `--pw-shadow-card`, `--pw-shadow-dropdown`, `--pw-font`, `--pw-font-size`, `--pw-line-height`, `--pw-gutter`, `--pw-field-pad`, `--pw-field-pad-bottom`, `--pw-z-notices`, `--pw-z-popup`, `--pw-z-masthead`, `--pw-z-drawer`, `--pw-z-dropdown`, `--pw-z-picker`, `--pw-z-overlay`, `--pw-status-success-bg`, `--pw-status-success-border`, `--pw-status-success-fg`, `--pw-status-success-icon`, `--pw-status-warning-bg`, `--pw-status-warning-border`, `--pw-status-warning-fg`, `--pw-status-warning-icon`, `--pw-status-error-bg`, `--pw-status-error-border`, `--pw-status-error-fg`, `--pw-status-error-icon`, `--pw-success-bg`, `--pw-warning-bg`, `--pw-danger-bg`, `--pw-label-size`, `--pw-control-height`, `--pw-login-bg`, `--pw-range-fill`, `--pw-branch-max`, `--pw-item-bg`
- **events**: `pw-runtime-ready`, `pw-legacy-loaded`, `pw-legacy-handover`, `pw-uikit-loaded`, `pw-component-loaded`, `pw-component-failed`, `pw-modal-opened`, `pw-modal-closed`, `pw-wiretabs-change`, `pw-tab-focus`, `pw-drawer-open`, `pw-drawer-close`, `pw-page-save`, `pw-page-saved`, `pw-form-save`, `pw-form-saved`, `pw-files-moved`, `pw-extension-loaded`, `pw-extensions-ready`, `opened`, `closed`, `reloaded`, `showIf`, `changed`, `pw-scheme-change`, `pw-variant-change`, `pw-scale-change`, `pw-tabs-change`
- **runtime**: `contract`, `version`, `Inputfields`, `components`, `dialog`, `legacy`, `tables`, `pageTree`, `sortable`, `confirm`, `guard`, `extensions`

`contracts` are the contract versions the theme honours, the current one (`contract`) last: a
manifest range that takes any of them is compatible. `tokens` are the theme's CSS custom
properties an extension's stylesheets may read or set (`runtime/src/styles/00-tokens.css`,
`docs/contract.md` 4.0). Their names are stable within the contract; their values are not (they
follow the variant, the scheme, the interface scale and the theme's design). Two of them are set
by the theme's script on the element they describe (`docs/contract.md` 4.1): `--pw-range-fill`
on each `input[type=range]` (`setupRangeFill()`), `--pw-branch-max` on the deepest open page-tree
branch (`setupTreeFit()`); `00-tokens.css` declares the values where no script set one. Any other custom
property the theme declares, the `--pw-` names not listed here among them, is internal and may
change or go in any release. The contract tests fail a stylesheet that uses a name the built
`theme.css` declares off the surface (`--pw-tiny`, `--pw-masthead-h`, `--ring-50`, ...; section
6). They do not read `fields.css`: a name only it declares passes the scan, upstream's
AdminThemeUikit names it maps (`docs/contract.md` 4.0) and internal ones such as
`--pw-input-radius` alike, so do not take a pass as proof that such a name is public.

Hooks attach as anywhere in ProcessWire: `$this->addHookAfter('AdminThemeBridge::renderBreadcrumbs', ...)`.
What each method, event and runtime key does is in `docs/contract.md`. Upstream's own regions
(`AdminTheme::addExtraMarkup()` for `head`, `masthead`, `body`) keep working.

Entries that no other section describes:

| Entry | What it is |
|---|---|
| hook `renderBreadcrumbs()` | The breadcrumb markup above the content: `<nav class='pw-breadcrumbs-nav'>` around `<ul class='pw-breadcrumbs'>`, one `<li>` per crumb. Empty in a modal, for a guest and on a screen without crumbs; with `extendedBreadcrumbs` also empty on the page tree and, outside the page editor, with fewer than two crumbs. A hook after may wrap or replace the markup |
| read `extensionAllowed($info)` | Whether the current user may have the extension of an `extensionInfo()` array: true without a `permission`, else whether the user has it (a superuser has every permission) |
| read `nonceScriptTag($openTag)` | The `<script>` open tag with this request's CSP nonce added, unless the tag has a `nonce` attribute already or there is no nonce (then as given); the `<script>` counterpart of `nonceAttr()` (`docs/contract.md` 2.1) |
| read `getVariant()` | The colour preset in use: the user's own (user menu) over the site's, one of `red` (1.1.0), `blue`, `vibrant`, `black`, `pink`, `green`, `custom` (the `data-pw-variant` values, `docs/contract.md` 4.0) |
| read `getColorScheme()` | The colour scheme setting in effect, after `appearance()` (section 13): `auto`, `light` or `dark`; not the user's choice in the browser |
| read `shellLabel($key)` | A translated label of the shell templates (`_main.php`, `_masthead.php`, `_footer.php`, so a site's copy of them too); an unknown key comes back as given. Keys may be added, none renamed or removed in 1.x: `lang`, `menu`, `mainNav`, `breadcrumbs`, `skip`, `search`, `home`, `pagination`, `display`, `smaller`, `larger`, `resetScale`, `basedOn`, `coloursFrom` |
| read `getHistorySteps()` | The most entries the visit history keeps: the `historySteps` setting when it is 1 to 10000, else 100 |
| setting `extendedBreadcrumbs` | Features > Extended breadcrumbs (on by default): the page tree link and an edit link per editable crumb, the crumbs hidden on the page tree and, outside the page editor, with fewer than two (`renderBreadcrumbs()` above) |

Contract 1.0 (theme 1.0.0) is 0.2's surface, frozen, with the rulings of
[docs/surface-1.0.md](surface-1.0.md) applied: the read `themeAssetUrl` is off the surface (it
stays a method of the theme, internal: the theme's file names are not part of the contract), and
the lists now name what the docs already promised: the events `pw-scheme-change`,
`pw-variant-change`, `pw-scale-change`, `pw-tabs-change` (`docs/contract.md` 4.0 to 4.2) and the
tokens `--pw-range-fill`, `--pw-branch-max`. No manifest key and no surface key changed, so a
manifest written for `^0.1` or `^0.2` is still compatible and gets the same surface; only one that
declares the read `themeAssetUrl` is reported by the contract tests and the compatibility
checker. A new extension declares `^0.2 || ^1.0` (the scaffold writes it): it then also loads on
a 0.29 or 0.30 theme, which honours 0.2.

The contract range: `^x.y` keeps the major version (for `0.y`, the minor one), `~x.y` the minor
one; comparisons `>= > <= < =`, all of a space-separated list must hold, `||` separates
alternatives. `AdminThemeBridge::contractSatisfies($range, $version)` and
`contractRangeValid($range)` do the same in PHP; `contractCompatible($range)` is true when the
range takes any version of `contracts`.

The surface grew within contract 0.2 in theme 0.30.0, as it did in 0.28.0 (`navCacheKey`): only
entries were added to four lists, no manifest key and no surface key, so the contract stayed 0.2
(ADR 0023). The additions are the appearance seams of section 13: hooks `tokenOverrides`,
`appearance`, `adminTitle`, `faviconUrl`; reads `tokenCss`, `getLabelSize`, `getControlHeight`,
`isLoginScreen`, `renderAdminTitle`; settings `labelSize`, `controlHeight`; tokens
`--pw-label-size`, `--pw-control-height`, `--pw-login-bg`. A contract range cannot tell a 0.30.0
theme from an older one, so an extension that needs them also declares
`'requires' => 'AdminThemeBridge>=0.30.0'`; the compatibility checker reports a hook, read,
setting or token that an older surface lacks.

What of this surface 1.x keeps, what it does not cover, and how an entry is added or deprecated:
[ADR 0024](decisions/0024-the-1-0-compatibility-promise.md), with every entry's status in
[docs/surface-1.0.md](surface-1.0.md).

## 4. Slots

A slot is a named place in the shell that extensions fill through their manifest's `slots`:
slot name => a public method on the module (a hookable `___` method works too). The theme gets
the module (`$modules->get()`, so it is inited), calls the method with the slot name and prints
what it returns. The method returns a string of markup it has escaped itself; `null` or `''`
prints nothing. A slot that nothing fills prints nothing at all, not an empty element.

| Slot | Where it lands | Element per extension |
|---|---|---|
| `head` | In `<head>`, after upstream's `head` extra markup (and after the `styles` links) | none, printed as given |
| `masthead` | After the masthead and the notices, after upstream's `masthead` extra markup | `<div>` |
| `masthead-right` | In the masthead's right group, before the display controls | `<div>` |
| `user-nav` | In the user menu, after its links, before the colour picker | `<li>` |
| `content-head-buttons` | In `#pw-content-head-buttons`, after the Add New button | `<div>` |
| `footer` | In `#pw-footer`, after the version line, before the debug panel | `<div>` |
| `drawer` | A drawer of its own: a button beside the logo and a `<dialog class='pw-drawer'>` | the dialog |
| `body` | At the end of `<body>`, after upstream's `body` extra markup, before the scripts | `<div>` |

Each element carries `data-bridge-slot='<slot>'` and `data-bridge-extension='<name>'`. Several
extensions in one slot come in `priority` order. Slots print for signed-in users only, for the
extensions they may have (`permission`) and whose `contract` range takes one of the theme's
`contracts`; in a modal window only `head` and `body`. Slots get no CSS of their own: use the
`pw-*` classes.

Below 768 px the masthead has little room: an extension's `masthead-right` part is cut with an
ellipsis at 96 px wide (`max-width: 96px; overflow: hidden; white-space: nowrap`), and it may
shrink further when the masthead needs the space. Keep it to an icon or a short word. Whatever
the part draws outside its box (a dropdown under a button, a badge, a focus ring) is cut too:
open a popup in a `<dialog>` or with `position: fixed`.

A stylesheet an extension prints in the `head` slot (a `<link rel=stylesheet>` or a `<style>`)
is moved in front of `theme.css` by the theme's style-order code, as a stylesheet a field script
adds at run time is (the theme's sheets must win over module styles, `docs/contract.md` 4.0): it
loses every cascade tie with the theme. To come after the theme's sheets, declare the
stylesheet in the manifest's `styles` (section 2, section 12).

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
(its `contract` range takes none of the theme's `contracts`) is not imported; its slots and
its `styles` are not printed either.

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

A third-party extension stays installed in a sandbox only while its checks run (the bundled set's
smoke pins). `tools/sandbox-extension.php` links its directory in (a junction on Windows) and
installs its modules with a manifest; `--remove` uninstalls them and removes the link only. A
module the extension requires that is not an extension itself (an Inputfield, a Fieldtype) goes in
first with `--dependency`, which installs every module of its directory, and comes out last; a
directory refused for having no manifest leaves no link behind (0.30.1). The command takes no
variable, so it reads the same in Git Bash and PowerShell:

```bash
php tools/sandbox-extension.php sandbox/atispro <dependency dir> --dependency
php tools/sandbox-extension.php sandbox/atispro <extension dir> [--remove]
```

The commands in this document are written for Git Bash (`VAR=value command`). In PowerShell set
the variable first, `$env:PW = '<playwright-core dir>'; node tools/...`; in cmd, `set PW=<dir>`
on a line of its own, then the command.

```bash
php tools/extension-check.php sandbox/atispro <Module> [--base=http://localhost:8089] [--no-http]
node tools/extension-check.js <playwright-core dir> chromium <Module>    # PHP=<php>, SANDBOX=<root>
php tools/extension-check.php sandbox/atispro --self-test
```

`extension-check.php` installs the module if needed, then checks:

- the manifest: known keys only (section 2), each of its type; `contract` a range that takes one
  of the theme's `contracts` (`contractCompatible()`); `hooks`, `reads` and `settings` on the
  surface (section 3; a hook also declared by the theme as `___<hook>`); each `slots` entry a slot
  of section 4 whose method exists and returns a string (`drawer`: or an array with `content`);
  `module` a file that exists; each relative or root-relative `styles` entry a file that exists
  (absolute URLs are noted, not checked); each `tokens` entry a `--` name of the surface's
  `tokens`; `permission` an existing permission; the theme discovers the extension and finds it
  compatible;
- the stylesheets, by a scan of each relative `styles` file for `var(--x` and `--x:` (comments
  left out): a token of the surface that the manifest's `tokens` do not declare fails, and so does
  a name the theme's built `theme.css` declares that is not on the surface (an internal token).
  Names the theme does not declare pass: the extension's own, and upstream's AdminThemeUikit
  names that `fields.css` maps (`--pw-inputs-background`, ...). Each failure names file and line.
  Like the PHP scan below, this is a heuristic, not a CSS parser;
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
  slot it fills; each stylesheet of `styles` is linked once (`data-bridge-styles`) after
  `fields.css` on the page tree, and linked in a modal window (`page/?modal=1`);
- the module's own `<Name>.check.php`, if it has one (the scaffold writes it): included with
  `$wire`, `$module` and `check($label, $ok, $detail = '')` at hand.

`extension-check.js` loads the page tree in a browser, signed in as `bridge`: the extension is in
`Bridge.extensions.list()` (compatible) and in `loaded()` without error, `pw-extension-loaded`
fired with its name, each slot it fills has its part in the DOM with its custom elements
defined, `reload()` fires `pw-extension-loaded` again, and `reload()` of an edited copy of the
module (served in its place from a temp file, its exported version literal changed; the module
file is not touched) shows the new version in `loaded()` (section 9); each stylesheet of `styles`
is linked once in `<head>`, after `link[data-pw-fields]`, and loaded, and stays after it when a
`<style>` is injected into `<head>` (the field-script case: the injected one goes before
`link[data-pw-theme]`), and is linked in a modal window; `pw-extensions-ready` fired once, no
jQuery unless the theme recorded legacy reasons, no console errors.

`--self-test` writes a module with six faults into the sandbox (an unknown manifest key, a hook
the theme does not have, a call to a theme method off the surface, an include of a `lib/` file,
a token that is not on the surface, a `styles` file that does not exist), expects exactly those
six failures, and removes the module again.

## 7. Bundled extensions

The modules in `modules/` that use the theme declare themselves; `tools/extension-check.php`
passes on each (section 6).

| Module | Manifest | Uses |
|---|---|---|
| `BridgeCsp` (Bridge CSP) | the `bridge` module info key: no code, and no `requires` of the theme | hooks `nonce` (gives the theme the request's nonce), reads `useLegacyStack` (enforce or report only per screen); the client gets no module |
| `ProcessBridgeDemo` (directory `BridgeDemo`) | `getBridgeExtension()`; also a `BridgeComponent` | reads `nonceAttr` (its csp/ screen); `module` `ProcessBridgeDemo.mjs`, imported on every admin page for users with `page-edit`; no slots |
| `BridgeSample` | `getBridgeExtension()`, generated by the scaffold (contract `^0.2 \|\| ^1.0`) | six slots (`masthead-right`, `user-nav`, `content-head-buttons`, `footer`, `drawer`, `body`), `BridgeSample.mjs`, and `styles` `BridgeSample.css` (one rule on its own element) with `tokens` `--muted-foreground`; the fixture of the contract tests |
| `BridgeAdminAccessControl` (Bridge admin access control) | the `bridge` module info key: no code, and no `requires` of the theme | hooks `navCacheKey` (a change of the rules shows in a signed-in user's menu on the next request), `drawerNames` (no page tree drawer with Pages denied); enforcement is on the core's seams ([access-control.md](access-control.md)); no slots, the client gets no module |

`InputfieldBridgeText` (in `BridgeDemo`) is a component, not an extension. The other three
manifests stay at `^0.1` on purpose: they show that a manifest written for 0.1 keeps working on
1.0.

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
  `--surface=<json>` gives both instead (`contract` and the lists). The contract versions the
  target honours are the surface's `contracts`; a surface without them (a 0.1 surface, a
  hand-written file) honours its `contract` alone. A Bridge without the constant has no extension
  contract: every extension is incompatible with it.
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
- **Per extension**: the `contract` range takes one of the target's `contracts` (the theme's own
  `contractSatisfies()`; otherwise the problem reads `contract <range> takes none of <list>`);
  `hooks`, `reads`, `settings`, `slots` and `tokens` are on the target's surface; the `module`
  file and each relative `styles` file exist; the theme would discover the extension (by the interface it also needs
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
  default). While it is on, and only for a superuser, the `module` URL and the relative `styles`
  URLs of an extension (`extensionInfo()`) and the `module` URL of a component (`componentInfo()`)
  whose file lies under the site modules end in `?v=<file time>` (the file's modification time, 10 digits) instead of
  `?v=<module version>`: an edited `.mjs` or `.css` is fetched fresh on the next page load, without a
  cache clear or a version bump. Core modules and other URLs keep the module version; with the
  setting off nothing changes. Leave it off on a live site.
- **The watcher** `tools/extension-dev.js` opens the admin's page tree in a browser (Playwright,
  signed in as the sandbox user `bridge`), watches the module's directory and, when a file in it
  changes, calls `Bridge.extensions.reload(<name>)` for each extension whose module lies in that
  directory. The page stays; the module is imported again with a fresh `?v=` and
  `pw-extension-loaded` fires again. Each reload prints one line with the extension's error or
  exported version; the page's console errors are printed too. A changed `.css` file takes no
  module reload: the watcher sets a fresh `?v=` on the `href` of every `link[data-bridge-styles]`
  whose path ends with that file (the extension's `styles`), so the browser loads the stylesheet
  again in place, and prints one line. A changed PHP file is only reported: PHP takes a page load.
  Ctrl+C (or closing the browser) stops it.

```bash
PW=<playwright-core dir> node tools/extension-dev.js modules/BridgeSample [admin url]   # HEADLESS=1 for no window; SANDBOX=, PROBE_PASS= as for the harnesses
```

What a reload does not do: it is not hot module replacement. A custom element, once defined, stays
the class it was (`customElements.define()` cannot redefine a tag), so the module's other code runs
again but an edited element class takes a page load; state the old module kept is not carried over;
a stylesheet the module injects itself is the module's own business on `pw-extension-loaded`
(declare it in `styles` instead). Real HMR
would need a dev server and a bundler contract with extensions, which the extension model leaves out
on purpose (no build step shared between Bridge and an extension).

## 10. Scaffold

`tools/scaffold-extension.php` writes the skeleton of a new extension:

```bash
php tools/scaffold-extension.php <Name> [--dir=modules] [--slots=footer,user-nav] [--module] [--styles]
```

Into `<dir>/<Name>/` (a directory that exists is refused): `<Name>.module.php` (module info with
`requires AdminThemeBridge`, the interface check of section 2, a manifest with `contract ^0.2 || ^1.0`,
one method per slot returning escaped markup, an empty settings screen), with `--module`
`<Name>.mjs` (defines `<pw-<name in lower case>>` guarded by `customElements.get()`, exports
`{ tag, version }`), with `--styles` `<Name>.css` (a comment header and one rule,
`pw-<name in lower case>[data-slot] { color: var(--muted-foreground); }`, and in the manifest
`styles` `<Name>.css` and `tokens` `--muted-foreground`), `<Name>.check.php` (one check per slot,
and one that the stylesheet is there; run by `extension-check.php`) and a `README.md`. `--slots`
takes the slot names of section 4. It boots nothing, and the output depends on the arguments
only: `modules/BridgeSample` is its output for
`BridgeSample --slots=masthead-right,user-nav,content-head-buttons,footer,drawer,body --module --styles`,
and the smoke test generates it again and compares the two byte for byte.

Then: place the directory under a sandbox's site modules (a junction), install it
(`php tools/sandbox-modules.php sandbox/<site> <Name>`, or Modules > Refresh and Install), run the
contract tests (section 6) and the dev watcher (section 9) while working on it.

## 11. Not in contract 1.0

- **Access control as part of the contract.** It exists as the fourth bundled extension,
  `BridgeAdminAccessControl` (section 7, [access-control.md](access-control.md)), built through
  this kit: rules that narrow the core's own per-template access by branch and by main menu. It is
  an ordinary module, not a feature of the contract, and there is still no declarative way to hide
  a slot or a menu item. Hiding is not security: enforcement belongs on the server.
- **Middleware, endpoint registration, response shaping.** Bridge is an admin theme on upstream's
  URLs and JSON contracts, not an API layer: upstream's Process modules and hooks are the request
  pipeline, and an extension uses them as any module does. There is no `$bridge` facade object;
  the facade is the surface of section 3, which the contract tests hold an extension to.
- **More declarative weight.** The `bridge` info key declares what a module uses; hiding,
  renaming or reordering menu items without code is not part of 1.0.
- **Hot module replacement** (section 9), and a directory or registry of extensions.
- **Stylesheets and slots on the login screen.** Extension stylesheets, like the slots, still
  print for signed-in users only (section 12). Since theme 0.30.0 the login screen is reached
  through the four appearance hookables instead: its logo, background, heading, favicon and
  palette (section 13).

## 12. Styling extensions

An extension whose job is the admin's look (spacing, typography, colours of field modules)
needs two things from the contract, both since 0.2:

- **Its stylesheets after the theme's.** Declare them in the manifest's `styles` (section 2). The
  theme prints one `<link rel='stylesheet' data-bridge-styles='<name>'>` per entry in `<head>`,
  right after `theme.css` and `fields.css` and before the `head` slot, with the request's CSP
  nonce when there is one (`BridgeCsp`), in the normal and the modal layout alike, so the extension wins
  cascade ties with the theme without raising its selectors' weight. The theme's style-order
  code leaves these links where they are, also when a field script adds a stylesheet of its own
  later (that one goes in front of `theme.css`). A stylesheet printed in the `head` slot, or
  injected by the client module, has none of this (section 4). `data-pw-keep`, which the theme
  puts on its own inline styles, is internal and not part of the contract: it may change, and
  the contract tests know nothing of it.
- **The tokens it reads and sets, declared.** List them in the manifest's `tokens`; each must be
  on the surface (section 3). The contract tests scan the stylesheets: a surface token used but
  not declared fails, and so does an internal token the built `theme.css` declares (one only
  `fields.css` declares passes the scan, section 3). The compatibility checker
  reports an extension whose declared token a newer Bridge no longer has. Since 0.2 the surface
  includes the theme's metric tokens `--pw-font-size`, `--pw-line-height`, `--pw-field-pad` and
  `--pw-field-pad-bottom` (with `--pw-gutter`, public before): typography and field spacing
  cannot be restyled without them. Their names are stable; their values are not, so set them
  rather than compute from today's numbers.

The stylesheets print for signed-in users only, as the slots do, for the extensions they may have
(`permission`) and whose `contract` the theme honours: the login screen gets none of them (its
logo, colours and heading come through the appearance seams, section 13). `modules/BridgeSample` (section 7, scaffolded with `--styles`) is the smallest working
example.

A site's own copy of `_head.php` (in `/site/templates/AdminThemeBridge/`) that still builds the
head from `headPlan()` prints no extension stylesheets: `headPlan()`'s array is unchanged and has
no entry for them (the theme's own `_head.php` reads `assetPlan()`). Such a copy adds one loop
over `AdminThemeBridge::extensionStyles()` right after its `fields.css` link:

```php
foreach($adminTheme->extensionStyles() as $style) {
	echo "\n\t<link type='text/css' href='" . $sanitizer->entities($style['url']) . "' rel='stylesheet' data-bridge-styles='" .
		$sanitizer->entities($style['extension']) . "'" . $adminTheme->nonceAttr() . " />";
}
```

## 13. Appearance seams

Since theme 0.30.0 an extension can set the admin's look for the whole site (colours, logo,
title, favicon, label size, control height) through four hookable methods, on every page and in
every layout: the normal one, modal windows and the login screen, which extension stylesheets
and slots do not reach (section 11). The manifest lists the hooks in `hooks` and the reads in
`reads`, and the module declares `'requires' => 'AdminThemeBridge>=0.30.0'` (section 3). The
theme's own settings stay where they are: an extension overrides them in effect, never in
storage (ADR 0023).

### appearance()

Returns the Appearance settings in effect, by default the stored ones: an array with the keys
`variant`, `primaryColor`, `colorScheme`, `logoURL`, `logoURLDark`, `maxWidth`, `labelSize`,
`controlHeight`, raw values. A hook after it changes the keys it wants. Every reader validates
what it gets as it does a stored value: an unknown `variant`, or `custom` without a `#rrggbb`
`primaryColor`, gives `blue`; `colorScheme` other than `auto`, `light`, `dark` gives `auto`;
`maxWidth` is held to 0..4000; `labelSize` (rem) outside 0.75..1.25 gives 0.875, `controlHeight`
(rem) outside 1.75..3.5 gives 2.25 (both a number rounded to 4 decimals, anything else gives the
default). A key the hook removes, or a return that is not an array, leaves the stored value. A
logo URL without `//` is relative to the site root. The method is asked on every read, never
cached, so a hook may answer otherwise on the login screen (`isLoginScreen()`, a read).

What it sets is the site's colour. A user's own colour (the theme's `userColors` setting, the
picker in the user menu) stays above it, and "Site default" in the picker returns to the
extension's. The theme's configuration screen keeps showing and saving the stored values, and
puts a note on each field an extension overrides, with the value in effect.

```php
$this->addHookAfter('AdminThemeBridge::appearance', function(HookEvent $event) {
	$values = $event->return;
	$values['variant'] = 'custom';
	$values['primaryColor'] = '#aa3300';
	$values['logoURL'] = 'site/assets/MyExtension/logo.svg?v=3';
	if($event->object->isLoginScreen()) $values['logoURL'] = 'site/assets/MyExtension/login-logo.svg?v=3';
	$event->return = $values;
});
```

### tokenOverrides()

Returns site-wide values for the surface's tokens in three groups of name => value:
`array('all' => array(), 'light' => array(), 'dark' => array())`. By default `all` carries
`--pw-label-size` and `--pw-control-height` when the settings `labelSize` and `controlHeight` are
not at 0.875 and 2.25 (rem, so the interface scale applies; printed with trailing zeros trimmed,
`1rem`, `2.75rem`). A hook adds to `$event->return`
rather than replacing it.

`tokenCss()` (a read) checks every entry: it keeps one whose name is on the surface's `tokens`
and whose value is a string of 1 to 300 characters out of letters, digits, space and
`# % ( ) , . / _ ? = + -`, and drops the others without a message. So nothing can end the
declaration, the rule or the style element: a value with `;`, `}`, `<`, a quote, a backslash, a
colon or `!important` is dropped, and so is a URL with a scheme (`https:`, `data:`); give a
root-relative path instead. Since 0.30.1 a value with a `url(` whose path is not root-relative
(`url(//host/x)`, `url(x.png)`) is dropped as well, so the admin never asks another host for a
file. The theme prints what is left as one
`<style data-pw-keep data-pw-tokens>` with the request's CSP nonce, after `fields.css` and
before the extension stylesheets, in every layout, and prints nothing when nothing is left. The
groups go on these selectors, in this order:

| Group | Selector |
|---|---|
| `all` | `:root:root` |
| `light` | `:root:not([data-pw-scheme=dark]),body.light-theme` |
| `dark` | `:root[data-pw-scheme=dark],body.dark-theme` |

Their weight (0,2,0) beats the theme's own declarations (0,1,0) wherever they stand, and a light
value never reaches the dark scheme. The `body` selectors are for pages with the UIkit layer (the
login screen among them): its `uikit.css` declares the scheme colours again on AdminThemeUikit's
classes `.light-theme` and `.dark-theme`, which the layer puts on `<body>` with the scheme of
`<html>`, and (0,1,1) beats them there. Below the root and the body nothing is set: an element with its own
`data-pw-scheme` (a preview pane, say) gets the theme's colour values for that scheme again,
because `00-tokens.css` declares the scheme colours on `[data-pw-scheme]`; a token the theme
declares on `:root` alone (`--radius`, `--pw-label-size`, ...) is inherited with the override.
For the accent colour use `appearance()` (`variant` `custom`, `primaryColor`): the derived tokens
(`--ring`, `--pw-primary-hover`, the `--pw-*` aliases) follow it, and the user's own colour
stays above it.

```php
$this->addHookAfter('AdminThemeBridge::tokenOverrides', function(HookEvent $event) {
	$groups = $event->return;
	$groups['all']['--radius'] = '.25rem';
	$groups['light']['--background'] = '#fafaf7';
	$groups['dark']['--background'] = '#101014';
	$groups['light']['--pw-login-bg'] = 'url(/site/assets/MyExtension/login-bg.jpg?v=3) center / cover no-repeat #f5f5f5';
	$event->return = $groups;
});
```

### adminTitle($place)

The admin's own name for one place, by default `''` (the place stays as it is). Places:
`browser` takes the place of `Bridge` in the browser title (only its default form,
"Page • Bridge • host": a custom `$adminTheme->browserTitle` stays as it is); `masthead` prints
`<span class='pw-admin-title'>` after the logo inside the masthead's home link (hidden below
768 px); `login` prints the same span after the logo in the login card's title. The value is
plain text: the theme trims and escapes it, and a return that is not a string or number counts
as empty. `renderAdminTitle($place)` (a read) gives the span, or `''`.

```php
$this->addHookAfter('AdminThemeBridge::adminTitle', function(HookEvent $event) {
	if(in_array($event->arguments(0), array('browser', 'login'), true)) $event->return = 'Acme admin';
});
```

### faviconUrl()

The admin's favicon, by default `''`: no icon link. When not empty the theme prints
`<link rel='icon' href='…' />` right after `<title>`, in every layout. A URL without `//` is
relative to the site root (the root URL goes in front, as for the logo URLs).

```php
$this->addHookAfter('AdminThemeBridge::faviconUrl', function(HookEvent $event) {
	$event->return = 'site/assets/MyExtension/favicon.png?v=3';
});
```

### Saving a theme setting

An extension's own settings screen may store a theme setting that is on the surface's
`settings` (`labelSize` and `controlHeight`, say) in the theme's configuration:

```php
$this->wire()->modules->saveConfig('AdminThemeBridge', 'labelSize', 0.9375); // rem, 15px at 100 %
```

This changes the stored value, which the theme's screen shows; the core keeps the other keys.
Keep a value within the setting's range (`labelSize` 0.75..1.25, `controlHeight` 1.75..3.5, both
in rem): the theme falls back to the default otherwise.

### A site's own `_head.php`

A site's own copy of `_head.php` (section 12) prints neither the token style nor the favicon.
Such a copy adds the favicon line right after its `<title>`:

```php
$favicon = trim((string) $adminTheme->faviconUrl());
if($favicon !== '') echo "\t<link rel='icon' href='" . $sanitizer->entities(strpos($favicon, '//') === false ? $config->urls->root . ltrim($favicon, '/') : $favicon) . "' />\n";
```

and the token style right after its `fields.css` link (before the loop of section 12):

```php
$tokenCss = $adminTheme->tokenCss();
if($tokenCss !== '') echo "\n\t<style data-pw-keep data-pw-tokens" . $adminTheme->nonceAttr() . ">$tokenCss</style>";
```

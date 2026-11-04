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
- **hooks**: `install`, `uninstall`, `nonce`, `moveFiles`, `moveFileAllowed`, `filesMoved`, `historyEntry`, `nativeMap`, `isNativeProcess`, `isNativeInputfield`, `scriptNeeds`, `renderBreadcrumbs`, `sortableDataTable`, `uikitReasons`, `extensionSurface`
- **reads**: `useLegacyStack`, `componentInfo`, `extensions`, `extensionInfo`, `extensionAllowed`, `cspNonce`, `nonceAttr`, `nonceScriptTag`, `themeAssetUrl`, `getVariant`, `getColorScheme`, `shellLabel`, `getHistorySteps`
- **settings**: `legacyStack`, `uikit`, `maxWidth`, `variant`, `primaryColor`, `colorScheme`, `logoURL`, `logoURLDark`, `extendedBreadcrumbs`, `pageTreeDrawer`, `history`, `historySteps`, `pageSaveInPlace`, `pageAddSkipTemplate`, `dangerWarn`, `userColors`, `dataTableSortRows`, `printScripts`, `nativeOverrides`
- **slots**: none yet
- **events**: `pw-runtime-ready`, `pw-legacy-loaded`, `pw-legacy-handover`, `pw-uikit-loaded`, `pw-component-loaded`, `pw-component-failed`, `pw-modal-opened`, `pw-modal-closed`, `pw-wiretabs-change`, `pw-tab-focus`, `pw-drawer-open`, `pw-drawer-close`, `pw-page-save`, `pw-page-saved`, `pw-form-save`, `pw-form-saved`, `pw-files-moved`, `opened`, `closed`, `reloaded`, `showIf`, `changed`
- **runtime**: `contract`, `version`, `Inputfields`, `components`, `dialog`, `legacy`, `tables`, `pageTree`, `sortable`, `confirm`, `guard`

Hooks attach as anywhere in ProcessWire: `$this->addHookAfter('AdminThemeBridge::renderBreadcrumbs', ...)`.
What each method, event and runtime key does is in `docs/contract.md`. Upstream's own regions
(`AdminTheme::addExtraMarkup()` for `head`, `masthead`, `body`) keep working.

The contract range: `^x.y` keeps the major version (for `0.y`, the minor one), `~x.y` the minor
one; comparisons `>= > <= < =`, all of a space-separated list must hold, `||` separates
alternatives. `AdminThemeBridge::contractSatisfies($range, $version)` and
`contractRangeValid($range)` do the same in PHP.

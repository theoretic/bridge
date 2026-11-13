<?php namespace ProcessWire;

/**
 * Scaffold for a Bridge extension (extension contract 1.0, docs/extensions.md)
 *
 * Usage: php tools/scaffold-extension.php <Name> [--dir=modules] [--slots=footer,user-nav] [--module] [--styles]
 *
 * Writes <dir>/<Name>/:
 *   <Name>.module.php  the module: info with `requires AdminThemeBridge`, the defensive interface
 *                      include, the manifest (`contract ^0.2 || ^1.0`), one method per slot, a config stub
 *   <Name>.mjs         with --module: the client module, registers <pw-<name>> and exports { tag, version }
 *   <Name>.css         with --styles: the extension's stylesheet (manifest `styles`, linked after the
 *                      theme's sheets), one rule on <pw-<name>> reading the token it declares (`tokens`)
 *   <Name>.check.php   the extension's own checks, run by tools/extension-check.php: one per slot
 *   README.md          how to install it and run the contract tests on it
 *
 * Refuses a directory that exists. Boots nothing; the output depends on the arguments only (the
 * smoke test regenerates modules/BridgeSample and compares it with the committed copy).
 *
 * Original work, MIT.
 */

// the slots of contract 1.0: AdminThemeBridge::slotTags() (a smoke line keeps the two equal)
const BRIDGE_SCAFFOLD_SLOTS = array('head', 'masthead', 'masthead-right', 'user-nav', 'content-head-buttons', 'footer', 'drawer', 'body');

function bridgeScaffoldFail($message) {
	fwrite(STDERR, "scaffold-extension: $message\n");
	exit(1);
}

$name = '';
$dir = 'modules';
$slots = array();
$withModule = false;
$withStyles = false;
foreach(array_slice($argv, 1) as $arg) {
	if(strpos($arg, '--dir=') === 0) {
		$dir = substr($arg, 6);
	} else if(strpos($arg, '--slots=') === 0) {
		$slots = array_values(array_filter(array_map('trim', explode(',', substr($arg, 8))), 'strlen'));
	} else if($arg === '--module') {
		$withModule = true;
	} else if($arg === '--styles') {
		$withStyles = true;
	} else if(strpos($arg, '--') === 0) {
		bridgeScaffoldFail("unknown option $arg");
	} else if($name === '') {
		$name = $arg;
	} else {
		bridgeScaffoldFail("one name only ($arg)");
	}
}
if($name === '') {
	exit("Usage: php tools/scaffold-extension.php <Name> [--dir=modules] [--slots=footer,user-nav] [--module] [--styles]\n"
		. "Slots: " . implode(', ', BRIDGE_SCAFFOLD_SLOTS) . "\n");
}
if(!preg_match('/^[A-Z][A-Za-z0-9]{2,}$/', $name)) bridgeScaffoldFail("the name is a module class name: a capital letter, then letters and digits ($name)");
foreach($slots as $s) {
	if(!in_array($s, BRIDGE_SCAFFOLD_SLOTS, true)) bridgeScaffoldFail("unknown slot $s (" . implode(', ', BRIDGE_SCAFFOLD_SLOTS) . ")");
}
if(count(array_unique($slots)) !== count($slots)) bridgeScaffoldFail('a slot is named twice');
$target = rtrim(str_replace('\\', '/', $dir), '/') . '/' . $name;
if(file_exists($target)) bridgeScaffoldFail("$target exists: the scaffold writes new directories only");

$lower = strtolower($name);
$tag = "pw-$lower";
$command = "php tools/scaffold-extension.php $name" . (count($slots) ? ' --slots=' . implode(',', $slots) : '') . ($withModule ? ' --module' : '') . ($withStyles ? ' --styles' : '');

// the slot method's name: slotFooter, slotUserNav, ...
$method = function($slot) {
	return 'slot' . str_replace(' ', '', ucwords(str_replace('-', ' ', $slot)));
};

$files = array();

// --- the module ---
$slotLines = array();
foreach($slots as $s) $slotLines[] = "\t\t\t\t'$s' => '" . $method($s) . "',";
$manifest = "\t\treturn array(\n\t\t\t'contract' => '^0.2 || ^1.0',\n";
if($withModule) $manifest .= "\t\t\t'module' => '$name.mjs',\n";
if($withStyles) $manifest .= "\t\t\t'styles' => array('$name.css'),\n\t\t\t'tokens' => array('--muted-foreground'),\n";
$manifest .= count($slots) ? "\t\t\t'slots' => array(\n" . implode("\n", $slotLines) . "\n\t\t\t),\n" : "\t\t\t'slots' => array(),\n";
$manifest .= "\t\t);\n";

$methods = '';
foreach($slots as $s) {
	$m = $method($s);
	if($s === 'head') {
		$body = "\t\treturn \"<meta name='$lower' content='\" . \$this->wire()->sanitizer->entities(\$slot) . \"'>\";\n";
		$doc = "The `head` slot: markup for <head>, printed as given";
	} else if($s === 'drawer') {
		$body = "\t\t\$sanitizer = \$this->wire()->sanitizer;\n"
			. "\t\treturn array(\n"
			. "\t\t\t'content' => \"<$tag data-slot='drawer'><p>\" . \$sanitizer->entities(\$this->_('Drawer of the extension.')) . \"</p></$tag>\",\n"
			. "\t\t\t'label' => \$this->_('$name'),\n"
			. "\t\t\t'icon' => 'puzzle-piece',\n"
			. "\t\t);\n";
		$doc = "The `drawer` slot: the drawer's body, its label and icon (a button beside the logo opens it)";
	} else {
		$body = "\t\treturn \"<$tag data-slot='\" . \$this->wire()->sanitizer->entities(\$slot) . \"'>\" . \$this->wire()->sanitizer->entities(\$this->_('$name')) . \"</$tag>\";\n";
		$doc = "The `$s` slot (docs/extensions.md 4); the theme wraps it in an element of its own";
	}
	$methods .= "\n\t/**\n\t * $doc\n\t *\n\t * @param string \$slot The slot's name\n\t * @return " . ($s === 'drawer' ? 'array' : 'string') . "\n\t *\n\t */\n"
		. "\tpublic function $m(\$slot) {\n$body\t}\n";
}

$files["$name.module.php"] = <<<PHP
<?php namespace ProcessWire;

// the interface without depending on the theme: its file when the theme is there, else the same
// one-method interface declared here (docs/extensions.md 2)
if(!interface_exists("ProcessWire\\\\BridgeExtension", false)) {
	\$bridgeExtensionFile = dirname(__DIR__) . '/AdminThemeBridge/BridgeExtension.php';
	if(is_file(\$bridgeExtensionFile)) {
		require_once(\$bridgeExtensionFile);
	} else {
		interface BridgeExtension { public function getBridgeExtension(); }
	}
	unset(\$bridgeExtensionFile);
}

/**
 * $name
 *
 * A Bridge extension (extension contract 1.0, docs/extensions.md): a module that fills the admin
 * shell's slots through its manifest and uses only the theme's published surface.
 *
 * Generated by: $command
 *
 * MIT.
 */
class $name extends WireData implements Module, ConfigurableModule, BridgeExtension {

	public static function getModuleInfo() {
		return array(
			'title' => '$name',
			'version' => '0.1.0',
			'summary' => 'A Bridge extension.',
			'requires' => 'AdminThemeBridge',
		);
	}

	/**
	 * The manifest (docs/extensions.md 2): a fixed array; asked before init(), reads no config
	 *
	 * @return array
	 *
	 */
	public function getBridgeExtension() {
$manifest	}
$methods
	/**
	 * Settings of the extension: none yet
	 *
	 * @param InputfieldWrapper \$inputfields
	 *
	 */
	public function getModuleConfigInputfields(InputfieldWrapper \$inputfields) {
	}
}

PHP;

// --- the client module ---
if($withModule) {
	$files["$name.mjs"] = <<<JS
/**
 * $name: the extension's client module (docs/extensions.md 5), imported by the Bridge runtime
 * for users who may have the extension. Defines <$tag>, the element its slot markup uses; guarded,
 * because Bridge.extensions.reload() imports the module again.
 *
 * MIT.
 */
const tag = '$tag';
const version = '0.1.0';

if (!customElements.get(tag)) {
	customElements.define(tag, class extends HTMLElement {
		connectedCallback() {
			this.setAttribute('data-ready', '');
		}
	});
}

// the runtime's contract events arrive on document; the extension's own are pw-$lower-<event>
document.addEventListener('pw-runtime-ready', () => {
	document.documentElement.setAttribute('data-$lower', version);
}, { once: true });
if (document.body && document.body.classList.contains('pw-runtime-ready')) document.documentElement.setAttribute('data-$lower', version);

export default { tag, version };

JS;
}

// --- the stylesheet ---
if($withStyles) {
	$files["$name.css"] = <<<CSS
/**
 * $name: the extension's stylesheet (docs/extensions.md), named in the manifest's `styles`. The
 * theme links it after its own sheets, so it wins cascade ties with them. Every theme token it
 * reads is declared in the manifest's `tokens` (tools/extension-check.php checks both).
 *
 * MIT.
 */
{$tag}[data-slot] { color: var(--muted-foreground); }

CSS;
}

// --- the extension's own checks ---
$checkLines = '';
foreach($slots as $s) {
	$m = $method($s);
	if($s === 'drawer') {
		$checkLines .= "\$out = \$module->$m('$s');\n"
			. "check('$name: slot $s returns content, label and icon', is_array(\$out) && strpos((string) (\$out['content'] ?? ''), '<$tag') !== false && (\$out['label'] ?? '') !== '' && (\$out['icon'] ?? '') !== '');\n";
	} else if($s === 'head') {
		$checkLines .= "check('$name: slot $s returns its meta tag', \$module->$m('$s') === \"<meta name='$lower' content='$s'>\");\n";
	} else {
		$checkLines .= "check('$name: slot $s returns its element', strpos((string) \$module->$m('$s'), \"<$tag data-slot='$s'>\") === 0);\n";
	}
}
if($withStyles) $checkLines .= "check('$name: its stylesheet $name.css is there', is_file(__DIR__ . '/$name.css'));\n";
if($checkLines === '') $checkLines = "// no slots declared: nothing of its own to check\n";
$files["$name.check.php"] = <<<PHP
<?php namespace ProcessWire;

/**
 * $name: the extension's own checks, run by tools/extension-check.php after the contract tests.
 * Included with the sandbox booted: \$wire, \$module (the module, got with \$modules->get()) and
 * check(\$label, \$ok, \$detail = '') are there. One line per declared slot; add your own.
 */

/** @var Wire \$module */
$checkLines
PHP;

// --- README ---
$slotList = count($slots) ? implode(', ', array_map(function($s) { return "`$s`"; }, $slots)) : 'none';
$files['README.md'] = <<<MD
# $name

A Bridge extension (extension contract 1.0): a ProcessWire module that uses the published
surface of the admin theme AdminThemeBridge. See `docs/extensions.md` in Bridge.

Generated by `$command`.

- Slots: $slotList
- Client module:
MD;
$files['README.md'] .= ($withModule ? "`$name.mjs` (defines `<$tag>`)" : 'none') . "\n"
	. '- Stylesheet: ' . ($withStyles ? "`$name.css` (manifest `styles`, linked after the theme's sheets; reads `--muted-foreground`, declared in `tokens`)" : 'none') . "\n" . <<<MD

## Install

Copy (or junction) the directory to `site/modules/$name/`, then Modules > Refresh and install
it. It requires AdminThemeBridge. The slots show for signed-in users whose admin theme is Bridge.

## Contract tests

From a Bridge checkout, against a sandbox (`tools/sandbox-site.sh`) with the module under
`app/modules/$name/`:

```
php tools/extension-check.php sandbox/<site> $name
node tools/extension-check.js <path to playwright-core> chromium $name
php tools/extension-compat.php
```

`$name.check.php` holds the extension's own checks; `extension-check.php` runs it.

MD;

if(!is_dir($dir)) bridgeScaffoldFail("no directory $dir");
if(!mkdir($target)) bridgeScaffoldFail("cannot create $target");
foreach($files as $file => $content) {
	file_put_contents("$target/$file", str_replace("\r\n", "\n", $content));
	echo "wrote $target/$file\n";
}

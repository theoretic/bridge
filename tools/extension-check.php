<?php namespace ProcessWire;

/**
 * Contract tests of a Bridge extension (docs/extensions.md, extension contract 0.1): the checks any
 * extension runs against a sandbox to show that it is well-formed and uses only the published
 * surface (AdminThemeBridge::extensionSurface()).
 *
 * Usage:
 *   php tools/extension-check.php <sandbox root> <Module|directory> [--base=http://localhost:8089] [--no-http]
 *   php tools/extension-check.php <sandbox root> <Module|directory> --json
 *   php tools/extension-check.php <sandbox root> --self-test
 *
 * <Module> is a module class; a directory name under the sandbox's site modules checks every module
 * in it that declares a manifest (BridgeDemo: ProcessBridgeDemo; InputfieldBridgeText is skipped).
 * Modules not installed yet are installed (as tools/sandbox-modules.php does). Then, per extension:
 *
 *  - the manifest: known keys only, each of its type; `contract` a readable range that takes the
 *    theme's extensionContract; `hooks`, `reads`, `settings` on the surface (hooks also by
 *    reflection: the theme declares `___<hook>`); `slots` known slots whose methods exist and
 *    return a string (`drawer`: a string or an array with `content`); `module` a file that exists;
 *    `permission` an existing permission; the theme discovers the extension, compatible;
 *  - surface only, a static scan (token_get_all) of every PHP file in the module's directory: calls
 *    on the theme (`->adminTheme->x()`, `wire('adminTheme')->x()`, a variable assigned the theme,
 *    `$adminTheme`), static uses `AdminThemeBridge::x`, hook strings `'AdminThemeBridge::x'`.
 *    Upstream's AdminTheme methods are always allowed; the theme's own methods only when on the
 *    surface and declared in the manifest (`hooks` or `reads`). A file of the theme referenced by
 *    path (other than BridgeExtension.php and BridgeComponent.php), and a write to `paths->wire`,
 *    are failures too. Each failure names file:line. The scan is a heuristic: a theme reached
 *    through another way (a hook's `$event->object`, a variable of another scope) is not seen;
 *  - over HTTP, as the sandbox user `bridge` (.credentials): the page tree and the module's own
 *    admin screens (admin pages running its Process, its config screen) answer 200 without PHP
 *    error text or the login form; the page tree carries the extension in
 *    ProcessWire.config.AdminThemeBridge.extensions and a part of each slot it fills;
 *  - the module's own `<Name>.check.php`, if any, with `$wire`, `$module` and `check()`.
 *
 * --no-http leaves out the HTTP part. --json prints the extensions as the browser harness needs
 * them (tools/extension-check.js) and checks nothing. --self-test writes a deliberately bad
 * extension (BridgeCheckBad) into the sandbox, installs it, runs the checks on it in a child
 * process, expects exactly the four failures it was built with, then uninstalls and removes it.
 *
 * Exit code: 0 when every check passes, 1 when one fails, 2 when the root is not a sandbox on its
 * own database copy (tools/lib/sandbox-guard.php).
 *
 * Original work, MIT.
 */

$args = array();
$base = '';
$http = true;
$json = false;
$selfTest = false;
foreach(array_slice($argv, 1) as $arg) {
	if(strpos($arg, '--base=') === 0) $base = rtrim(substr($arg, 7), '/');
	else if($arg === '--no-http') $http = false;
	else if($arg === '--json') $json = true;
	else if($arg === '--self-test') $selfTest = true;
	else $args[] = $arg;
}
$target = $args[1] ?? '';
if(!isset($args[0]) || ($target === '' && !$selfTest)) {
	exit("Usage: php tools/extension-check.php <sandbox root> <Module|directory> [--base=URL] [--no-http] [--json]\n" .
		"       php tools/extension-check.php <sandbox root> --self-test\n");
}
require __DIR__ . '/lib/sandbox-guard.php';
$root = bridgeSandboxRoot($args[0]);

$fails = 0;
function check($label, $ok, $detail = '') {
	global $fails, $json;
	if(!$ok) $fails++;
	if($json) return;
	echo ($ok ? 'ok   ' : 'FAIL ') . $label . ($detail !== '' && !$ok ? "  [$detail]" : '') . "\n";
}
function note($text) {
	global $json;
	if(!$json) echo "$text\n";
}

if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;
ob_start();
include "$root/index.php";
ob_end_clean();
bridgeSandboxBooted($config, $root);
/** @var ProcessWire $wire */
/** @var Config $config */
/** @var Modules $modules */
/** @var Pages $pages */

if($selfTest) exit(extensionSelfTest($root, $wire));

$modules->refresh();
/** @var AdminThemeBridge $theme */
$theme = $modules->get('AdminThemeBridge');
if(!$theme instanceof AdminThemeBridge) {
	check('AdminThemeBridge is installed on the sandbox', false);
	exit(1);
}

// ---------------------------------------------------------------------------------------------
// the modules to check
// ---------------------------------------------------------------------------------------------

$siteModules = rtrim(str_replace('\\', '/', $config->paths->siteModules), '/') . '/';
$names = array();
$dir = '';
$dirMode = false;
if(preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $target) && $modules->getModuleFile($target, array('fast' => false))) {
	$names[] = $target;
	$dir = str_replace('\\', '/', dirname((string) $modules->getModuleFile($target, array('fast' => false))));
} else if(is_dir($siteModules . $target)) {
	$dirMode = true;
	$dir = rtrim($siteModules . $target, '/');
	foreach(array_merge(glob("$dir/*.module.php") ?: array(), glob("$dir/*.module") ?: array()) as $file) {
		$names[] = preg_replace('/\.module(\.php)?$/', '', basename($file));
	}
	sort($names);
}
if(!count($names)) {
	check("$target: a module or a directory under the sandbox's site modules", false, "put it in $siteModules (a junction, as tools/sandbox-site.sh makes)");
	exit(1);
}

// install what is not installed yet; twice, so a module required by another of the list goes first
for($round = 0; $round < 2; $round++) {
	foreach($names as $name) {
		if($modules->isInstalled($name) || !$modules->isInstallable($name)) continue;
		try {
			$modules->install($name);
			if(!$json) note("     $name installed");
		} catch(\Throwable $e) {
			if($round) check("$name installs", false, $e->getMessage());
		}
	}
	$modules->refresh();
}

$extensions = $theme->extensions();
$surface = $theme->extensionSurface();
$slotTags = $theme->slotTags();

/**
 * The manifest a module gives, as it gives it (null: none)
 *
 * @param Modules $modules
 * @param string $name
 * @return array|null
 *
 */
function rawManifest(Modules $modules, $name) {
	$class = $modules->getModuleClass($name, true);
	if(!$class || !class_exists($class, false)) $modules->includeModule($name);
	$class = $modules->getModuleClass($name, true);
	if($class && class_exists($class) && is_subclass_of($class, __NAMESPACE__ . '\\BridgeExtension')) {
		$module = $modules->get($name);
		if($module instanceof BridgeExtension) {
			$manifest = $module->getBridgeExtension();
			return is_array($manifest) ? $manifest : array('(not an array)' => gettype($manifest));
		}
	}
	$info = $modules->getModuleInfoVerbose($name, array('noCache' => true));
	return isset($info['bridge']) && is_array($info['bridge']) && count($info['bridge']) ? $info['bridge'] : null;
}

$checked = array();
foreach($names as $name) {
	if(!$modules->isInstalled($name)) {
		check("$name is installed", false, 'not installable: check its requirements');
		continue;
	}
	$manifest = rawManifest($modules, $name);
	if($manifest === null) {
		if($dirMode) note("skip $name: no manifest (not an extension)");
		else check("$name declares a manifest (getBridgeExtension() or a 'bridge' module info key)", false, 'no manifest');
		continue;
	}
	$checked[$name] = $manifest;
}
if($dirMode && !count($checked)) check("$target: a module of the directory declares a manifest", false, 'no manifest in ' . implode(', ', $names));

if($json) {
	$out = array();
	foreach($checked as $name => $manifest) {
		$info = $theme->extensionInfo($name, $manifest);
		$module = $modules->get($name);
		$filled = array();
		foreach($info['slots'] as $slot => $method) {
			try {
				$part = $module->$method($slot);
			} catch(\Throwable $e) {
				$part = '';
			}
			$content = is_array($part) ? ($part['content'] ?? '') : $part;
			$filled[$slot] = is_string($content) && trim($content) !== '';
		}
		$out[] = array('name' => $info['name'], 'class' => $name, 'module' => $info['module'], 'compatible' => $info['compatible'], 'slots' => $filled);
	}
	echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n";
	exit($fails ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------
// the manifest
// ---------------------------------------------------------------------------------------------

$themeClass = new \ReflectionClass($theme);
$parentClass = $themeClass->getParentClass();
$lower = function(array $list) { return array_map('strtolower', $list); };
$publicMethods = function(\ReflectionClass $class) {
	$out = array();
	foreach($class->getMethods(\ReflectionMethod::IS_PUBLIC) as $m) $out[] = strtolower($m->getName());
	return $out;
};
$themeMethods = $publicMethods($themeClass);
$upstreamMethods = $publicMethods($parentClass);
// upstream's hookables are called and hooked without ___
foreach($upstreamMethods as $m) if(strpos($m, '___') === 0) $upstreamMethods[] = substr($m, 3);
$upstreamConstants = array_map('strtolower', array_keys($parentClass->getConstants()));

$known = array('name', 'contract', 'module', 'slots', 'hooks', 'reads', 'settings', 'permission', 'priority');
$declaredUses = array();
foreach($checked as $name => $manifest) {
	note("\n== $name");
	$info = $theme->extensionInfo($name, $manifest);
	$ext = $info['name'];
	foreach(array_diff(array_keys($manifest), $known) as $key) {
		check("$ext: manifest key '$key' is a key of the contract", false, 'known: ' . implode(', ', $known));
	}
	if(isset($manifest['name'])) check("$ext: name is a non-empty string", is_string($manifest['name']) && $manifest['name'] !== '');
	$contract = $manifest['contract'] ?? null;
	if(!is_string($contract) || !AdminThemeBridge::contractRangeValid($contract)) {
		check("$ext: contract is a range the theme can read (e.g. '^0.1')", false, var_export($contract, true));
	} else {
		check("$ext: contract '$contract' takes the theme's extension contract " . AdminThemeBridge::extensionContract,
			AdminThemeBridge::contractSatisfies($contract, AdminThemeBridge::extensionContract));
	}
	foreach(array('hooks', 'reads', 'settings') as $key) {
		if(!isset($manifest[$key])) continue;
		$list = $manifest[$key];
		$typed = is_array($list) && count(array_filter($list, function($v) { return !is_string($v) || $v === ''; })) === 0;
		check("$ext: $key is a list of names", $typed, json_encode($list));
		if(!$typed) continue;
		foreach($list as $item) {
			$on = in_array($item, $surface[$key], true);
			if($key === 'hooks') {
				check("$ext: hooks '$item' is a hookable of the theme's surface", $on && $themeClass->hasMethod("___$item"),
					$on ? "the theme declares no ___$item()" : 'not in extensionSurface()[hooks]');
			} else if($key === 'reads') {
				check("$ext: reads '$item' is a public method of the theme's surface", $on && in_array(strtolower($item), $themeMethods, true),
					$on ? 'the theme has no public method of that name' : 'not in extensionSurface()[reads]');
			} else {
				check("$ext: settings '$item' is a setting of the theme's surface", $on, 'not in extensionSurface()[settings]');
			}
		}
	}
	if(isset($manifest['permission'])) {
		$perm = $manifest['permission'];
		$exists = is_string($perm) && $perm !== '' && $wire->permissions->get("name=" . $wire->sanitizer->pageName($perm))->id;
		check("$ext: permission '" . (is_string($perm) ? $perm : gettype($perm)) . "' exists", (bool) $exists);
	}
	if(isset($manifest['priority'])) check("$ext: priority is an integer", is_int($manifest['priority']) || (is_string($manifest['priority']) && ctype_digit($manifest['priority'])), var_export($manifest['priority'], true));

	// module: a file that exists (absolute URLs are not checked)
	if(isset($manifest['module'])) {
		$url = $info['module'];
		if(!is_string($manifest['module']) || $manifest['module'] === '') {
			check("$ext: module is a non-empty string", false, var_export($manifest['module'], true));
		} else if(strpos($url, '://') !== false) {
			note("     $ext: module is an absolute URL, not checked ($url)");
		} else {
			$path = parse_url($url, PHP_URL_PATH);
			$rootUrl = $config->urls->root;
			$file = strpos($path, $rootUrl) === 0 ? $config->paths->root . substr($path, strlen($rootUrl)) : '';
			check("$ext: module $url is a file", $file !== '' && is_file($file), $file !== '' ? $file : 'not under the site root');
		}
	}

	// slots: known, methods there, the right type back
	$module = $modules->get($name);
	if(isset($manifest['slots'])) {
		if(!is_array($manifest['slots'])) check("$ext: slots is an array slot => method", false, gettype($manifest['slots']));
		foreach((array) $manifest['slots'] as $slot => $method) {
			if(!is_string($slot) || !array_key_exists($slot, $slotTags)) {
				check("$ext: slot '$slot' is a slot of the contract", false, 'known: ' . implode(', ', array_keys($slotTags)));
				continue;
			}
			if(!is_string($method) || $method === '' || (!method_exists($module, $method) && !method_exists($module, "___$method"))) {
				check("$ext: slot $slot names a method of the module", false, var_export($method, true));
				continue;
			}
			try {
				$out = $module->$method($slot);
				$ok = is_string($out) || $out === null || ($slot === 'drawer' && is_array($out) && is_string($out['content'] ?? null));
				check("$ext: slot $slot: $method() returns " . ($slot === 'drawer' ? 'a string or an array with content' : 'a string'), $ok, gettype($out));
			} catch(\Throwable $e) {
				check("$ext: slot $slot: $method() runs", false, get_class($e) . ': ' . $e->getMessage());
			}
		}
	}

	// the theme's view of it
	check("$ext: the theme discovers it (AdminThemeBridge::extensions())", isset($extensions[$ext]) && $extensions[$ext]['class'] === $name);
	check("$ext: the theme finds it compatible", !empty($extensions[$ext]['compatible']));
	foreach(array('hooks', 'reads') as $key) {
		foreach($info[$key] as $item) $declaredUses[strtolower($item)] = true;
	}
}

// ---------------------------------------------------------------------------------------------
// surface only: static scan of the directory's PHP
// ---------------------------------------------------------------------------------------------

/**
 * The PHP files of a module directory (vendor/ and node_modules/ left out)
 *
 * @param string $dir
 * @return array
 *
 */
function extensionPhpFiles($dir) {
	$out = array();
	$it = new \RecursiveIteratorIterator(new \RecursiveCallbackFilterIterator(
		new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
		function($file) { return !($file->isDir() && in_array($file->getFilename(), array('vendor', 'node_modules', '.git'), true)); }
	));
	foreach($it as $file) {
		if($file->isFile() && preg_match('/\.(php|module|inc)$/', $file->getFilename())) $out[] = str_replace('\\', '/', $file->getPathname());
	}
	sort($out);
	return $out;
}

/**
 * The theme uses of one PHP file: list of ['kind' => call|static|const|hook|file|wire, 'name', 'line']
 *
 * @param string $file
 * @return array
 *
 */
function extensionScan($file) {
	$raw = token_get_all((string) file_get_contents($file));
	$t = array();
	$line = 1;
	foreach($raw as $tok) {
		if(is_array($tok)) {
			$line = $tok[2];
			if(in_array($tok[0], array(T_WHITESPACE, T_COMMENT, T_DOC_COMMENT), true)) continue;
			$t[] = array($tok[0], $tok[1], $tok[2]);
		} else {
			$t[] = array($tok, $tok, $line);
		}
	}
	$n = count($t);
	$is = function($i, $id, $text = null) use($t, $n) {
		return $i >= 0 && $i < $n && $t[$i][0] === $id && ($text === null || strcasecmp($t[$i][1], $text) === 0);
	};
	$arrow = function($i) use($t, $n) {
		return $i >= 0 && $i < $n && in_array($t[$i][0], array(T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR), true);
	};
	$literal = function($i) use($t, $n) {
		return $i >= 0 && $i < $n && $t[$i][0] === T_CONSTANT_ENCAPSED_STRING ? substr($t[$i][1], 1, -1) : null;
	};
	$isThemeClass = function($i) use($t, $n) {
		if($i < 0 || $i >= $n || !in_array($t[$i][0], array(T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED), true)) return false;
		$parts = explode('\\', $t[$i][1]);
		return end($parts) === 'AdminThemeBridge';
	};
	// does a theme reference end at token $i? (->adminTheme, wire('adminTheme'), get('AdminThemeBridge'))
	$themeEnd = function($i) use($t, $is, $arrow, $literal) {
		if($is($i, T_STRING, 'adminTheme') && $arrow($i - 1)) return true;
		if($is($i, ')') && $is($i - 2, '(')) {
			$lit = $literal($i - 1);
			if($lit === 'adminTheme' || $lit === 'AdminThemeBridge') return true;
		}
		return false;
	};
	// pass 1: variables assigned the theme (by name, for the whole file)
	$aliases = array('$adminTheme' => true);
	for($i = 0; $i < $n; $i++) {
		if($t[$i][0] !== T_VARIABLE || !$is($i + 1, '=')) continue;
		$j = $i + 2;
		while($j < $n && $t[$j][0] !== ';') $j++;
		if($themeEnd($j - 1)) $aliases[$t[$i][1]] = true;
	}
	$uses = array();
	$writes = array('file_put_contents', 'fopen', 'unlink', 'rename', 'copy', 'mkdir', 'rmdir', 'touch', 'wiremkdir', 'wirermdir', 'wirecopy', 'wirerenamefile', 'wirechmod');
	$statementStart = 0;
	for($i = 0; $i < $n; $i++) {
		$id = $t[$i][0];
		$text = $t[$i][1];
		if($id === ';' || $id === '{' || $id === '}') $statementStart = $i + 1;
		// a call on the theme
		if($arrow($i) && $is($i + 1, T_STRING) && $is($i + 2, '(')) {
			$recv = $i - 1;
			$onTheme = $themeEnd($recv) || ($recv >= 0 && $t[$recv][0] === T_VARIABLE && isset($aliases[$t[$recv][1]]));
			if($onTheme) $uses[] = array('kind' => 'call', 'name' => $t[$i + 1][1], 'line' => $t[$i + 1][2]);
		}
		// AdminThemeBridge::x
		if($isThemeClass($i) && $is($i + 1, T_DOUBLE_COLON) && $is($i + 2, T_STRING)) {
			$uses[] = array('kind' => $is($i + 3, '(') ? 'static' : 'const', 'name' => $t[$i + 2][1], 'line' => $t[$i + 2][2]);
		}
		if($id === T_CONSTANT_ENCAPSED_STRING || $id === T_ENCAPSED_AND_WHITESPACE) {
			$value = $id === T_CONSTANT_ENCAPSED_STRING ? substr($text, 1, -1) : $text;
			// a hook string
			if(preg_match('/^(?:\\\\*ProcessWire\\\\+)?AdminThemeBridge::(?:___)?([A-Za-z_]\w*)/', $value, $m)) {
				$uses[] = array('kind' => 'hook', 'name' => $m[1], 'line' => $t[$i][2]);
			}
			// a file of the theme by path
			if(preg_match('~AdminThemeBridge/([^\'"\s]*)~', $value, $m) && !in_array($m[1], array('BridgeExtension.php', 'BridgeComponent.php'), true)) {
				$uses[] = array('kind' => 'file', 'name' => 'AdminThemeBridge/' . $m[1], 'line' => $t[$i][2]);
			}
		}
		// a write under paths->wire, in the same statement as a file function
		if($is($i, T_STRING, 'wire') && $arrow($i - 1) && $is($i - 2, T_STRING, 'paths')) {
			$j = $statementStart;
			$end = $i;
			while($end < $n && !in_array($t[$end][0], array(';', '{', '}'), true)) $end++;
			for(; $j < $end; $j++) {
				if($t[$j][0] === T_STRING && in_array(strtolower($t[$j][1]), $writes, true) && $is($j + 1, '(')) {
					$uses[] = array('kind' => 'wire', 'name' => $t[$j][1], 'line' => $t[$i][2]);
					break;
				}
			}
		}
	}
	return $uses;
}

if(count($checked)) {
	$label = $dirMode ? $target : implode(', ', array_keys($checked));
	note("\n== $label: surface only (" . str_replace($siteModules, '', $dir) . '/)');
	$hooksS = $lower($surface['hooks']);
	$readsS = $lower($surface['reads']);
	$files = extensionPhpFiles($dir);
	$count = 0;
	$found = 0;
	foreach($files as $file) {
		$rel = str_replace(rtrim($siteModules, '/') . '/', '', $file);
		foreach(extensionScan($file) as $use) {
			$count++;
			$name = $use['name'];
			$key = strtolower(preg_replace('/^___/', '', $name));
			$where = "$rel:$use[line]";
			$problem = '';
			switch($use['kind']) {
				case 'call':
				case 'static':
					$what = ($use['kind'] === 'static' ? 'AdminThemeBridge::' : 'the theme\'s ') . "$name()";
					if(in_array($key, $hooksS, true) || in_array($key, $readsS, true)) {
						if(!isset($declaredUses[$key])) $problem = "$what is on the surface, but the manifest declares it in neither hooks nor reads";
					} else if(in_array($key, $upstreamMethods, true)) {
						// upstream's AdminTheme API
					} else if(in_array($key, $themeMethods, true) || $themeClass->hasMethod($name)) {
						$problem = "$what is not on the surface (extensionSurface())";
					} else {
						$problem = "$what is not a method of the theme";
					}
					break;
				case 'const':
					if($key !== 'class' && $key !== 'extensioncontract' && !in_array($key, $upstreamConstants, true)) {
						$problem = "AdminThemeBridge::$name is not on the surface (only extensionContract is)";
					}
					break;
				case 'hook':
					if(in_array($key, $hooksS, true)) {
						if(!extensionDeclaresHook($checked, $theme, $key)) {
							$problem = "hooks AdminThemeBridge::$name, which the manifest's hooks do not declare";
						}
					} else if(!in_array('___' . $key, $upstreamMethods, true)) {
						$problem = "hooks AdminThemeBridge::$name, not a hookable of the surface";
					}
					break;
				case 'file':
					$problem = "references the theme's file $name (only BridgeExtension.php and BridgeComponent.php may be included)";
					break;
				case 'wire':
					$problem = "$name() on a path under paths->wire: wire/ is never written";
					break;
			}
			if($problem !== '') {
				$found++;
				check("surface only: $where $problem", false);
			}
		}
	}
	if(!$found) check("surface only: " . count($files) . " PHP file(s), $count theme use(s), all on the surface and declared", true);
}

/**
 * Does one of the manifests declare this hook in `hooks`?
 *
 * @param array $checked name => raw manifest
 * @param AdminThemeBridge $theme
 * @param string $hook Lower case
 * @return bool
 *
 */
function extensionDeclaresHook(array $checked, AdminThemeBridge $theme, $hook) {
	foreach($checked as $name => $manifest) {
		$info = $theme->extensionInfo($name, $manifest);
		if(in_array($hook, array_map('strtolower', $info['hooks']), true)) return true;
	}
	return false;
}

// ---------------------------------------------------------------------------------------------
// over HTTP, as the bridge user
// ---------------------------------------------------------------------------------------------

class ExtensionCheckClient {
	public $base;
	public $cookies;
	public function __construct($base) {
		$this->base = $base;
		$this->cookies = tempnam(sys_get_temp_dir(), 'bridge-ext-');
	}
	public function __destruct() {
		if(is_file($this->cookies)) @unlink($this->cookies);
	}
	public function request($url, ?array $post = null) {
		$ch = curl_init($this->base . $url);
		curl_setopt_array($ch, array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_FOLLOWLOCATION => true,
			CURLOPT_MAXREDIRS => 5,
			CURLOPT_COOKIEJAR => $this->cookies,
			CURLOPT_COOKIEFILE => $this->cookies,
			CURLOPT_TIMEOUT => 60,
			CURLOPT_HTTPHEADER => array('Accept: text/html'),
		));
		if($post !== null) {
			curl_setopt($ch, CURLOPT_POST, true);
			curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post));
		}
		$body = curl_exec($ch);
		$status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
		$error = curl_error($ch);
		unset($ch);
		return array('status' => $status, 'body' => (string) $body, 'error' => $error);
	}
	public function login($adminUrl, $name, $pass) {
		$r = $this->request($adminUrl);
		if($r['status'] !== 200) return "login page HTTP $r[status]" . ($r['error'] !== '' ? " ($r[error])" : '');
		$post = array();
		if(preg_match_all('~<input[^>]+type=.?hidden[^>]*>~i', $r['body'], $m)) {
			foreach($m[0] as $tag) {
				if(!preg_match('~name=["\']?([^"\'\s>]+)~', $tag, $nm)) continue;
				if(preg_match('~value=(["\'])(.*?)\1~', $tag, $vv)) $v = html_entity_decode($vv[2], ENT_QUOTES);
				else if(preg_match('~value=([^"\'\s>]+)~', $tag, $vv)) $v = html_entity_decode($vv[1], ENT_QUOTES);
				else $v = '';
				$post[$nm[1]] = $v;
			}
		}
		$post['login_name'] = $name;
		$post['login_pass'] = $pass;
		$post['login_submit'] = 'Login';
		$r = $this->request($adminUrl, $post);
		if(strpos($r['body'], 'ProcessLoginForm') !== false) return "login rejected for $name (HTTP $r[status])";
		return '';
	}
}

if($http && count($checked)) {
	$creds = array();
	$credFile = "$root/.credentials";
	foreach(is_file($credFile) ? file($credFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : array() as $line) {
		if(strpos($line, 'base=') === 0 && $base === '') $base = rtrim(trim(substr($line, 5)), '/');
		else if(preg_match('/^([a-z0-9_-]+):(.+)$/i', $line, $m)) $creds[$m[1]] = $m[2];
	}
	if($base === '') $base = 'http://localhost:8089';
	$adminUrl = $config->urls->admin;
	note("\n== over HTTP as bridge, $base (--no-http leaves this out)");
	$client = new ExtensionCheckClient($base);
	$err = empty($creds['bridge']) ? "no bridge user in $credFile" : $client->login($adminUrl, 'bridge', $creds['bridge']);
	check("log in as bridge at $base$adminUrl", $err === '', $err);
	if($err === '') {
		$screens = array($adminUrl . 'page/' => 'the page tree');
		$adminPage = $pages->get($config->adminRootPageID);
		foreach($checked as $name => $manifest) {
			$id = $modules->getModuleID($name);
			foreach($pages->find("has_parent=$adminPage, process=$id, include=all") as $p) {
				if(strpos($p->path, '/trash/') === false) $screens[$p->url] = "$name's admin page";
			}
			if($modules->isConfigurable($name)) $screens[$adminUrl . 'module/edit?name=' . rawurlencode($name)] = "$name's settings";
		}
		foreach($screens as $url => $what) {
			$r = $client->request($url);
			$problems = array();
			if($r['status'] !== 200) $problems[] = "HTTP $r[status]";
			if(preg_match('~(Fatal error|Uncaught [A-Za-z\\\\]*(Error|Exception)|Internal Server Error|<b>(Warning|Notice|Deprecated)</b>:)~', $r['body'], $m)) $problems[] = $m[1];
			if(preg_match('~<input\b[^>]*\bname=["\']?login_name\b~i', $r['body'])) $problems[] = 'the login form came back';
			check("$what ($url): HTTP 200, no PHP error, signed in", !count($problems), implode('; ', $problems));
			if($url !== $adminUrl . 'page/' || count($problems)) continue;
			foreach($checked as $name => $manifest) {
				$info = $theme->extensionInfo($name, $manifest);
				$ext = $info['name'];
				$entity = $wire->sanitizer->entities($ext);
				check("$ext: in ProcessWire.config.AdminThemeBridge.extensions on the page tree", strpos($r['body'], '"name":' . json_encode($ext, JSON_UNESCAPED_SLASHES)) !== false);
				$module = $modules->get($name);
				foreach($info['slots'] as $slot => $method) {
					if(!isset($slotTags[$slot]) || $slot === 'head') continue; // head parts carry no wrapper
					try {
						$part = $module->$method($slot);
					} catch(\Throwable $e) {
						$part = '';
					}
					$content = is_array($part) ? ($part['content'] ?? '') : $part;
					if(!is_string($content) || trim($content) === '') continue; // nothing to print
					check("$ext: slot $slot has its part on the page tree", strpos($r['body'], "data-bridge-slot='$slot' data-bridge-extension='$entity'") !== false);
				}
			}
		}
	}
}

// ---------------------------------------------------------------------------------------------
// the module's own checks
// ---------------------------------------------------------------------------------------------

/**
 * Include an extension's <Name>.check.php with $wire, $module and check() at hand
 *
 * @param string $file
 * @param ProcessWire $wire
 * @param Module $module
 *
 */
function extensionOwnChecks($file, $wire, $module) {
	include $file;
}

foreach($checked as $name => $manifest) {
	$file = $dir . "/$name.check.php";
	if(!is_file($file)) continue;
	note("\n== $name.check.php");
	try {
		extensionOwnChecks($file, $wire, $modules->get($name));
	} catch(\Throwable $e) {
		check("$name.check.php runs", false, get_class($e) . ': ' . $e->getMessage());
	}
}

note($fails ? "\n$fails FAILED" : "\nall passed");
exit($fails ? 1 : 0);

// ---------------------------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------------------------

/**
 * Write BridgeCheckBad into the sandbox, install it, check it in a child process, expect its four
 * failures, uninstall and remove it
 *
 * @param string $root
 * @param ProcessWire $wire
 * @return int Exit code
 *
 */
function extensionSelfTest($root, ProcessWire $wire) {
	$modules = $wire->modules;
	$name = 'BridgeCheckBad';
	$dir = $wire->config->paths->siteModules . $name;
	if(is_dir($dir) || $modules->isInstalled($name)) {
		check("self-test: $dir is free", false, 'left from an earlier run? uninstall and remove it');
		return 1;
	}
	$code = <<<'PHP'
<?php namespace ProcessWire;

if(!interface_exists("ProcessWire\\BridgeExtension", false)) {
	$file = dirname(__DIR__) . '/AdminThemeBridge/BridgeExtension.php';
	if(is_file($file)) require_once($file); else { interface BridgeExtension { public function getBridgeExtension(); } }
	unset($file);
}

// written by tools/extension-check.php --self-test, removed after it: an extension with four faults
class BridgeCheckBad extends WireData implements Module, BridgeExtension {
	public static function getModuleInfo() {
		return array('title' => 'BridgeCheckBad', 'version' => '0.0.1', 'summary' => 'Self-test of tools/extension-check.php', 'requires' => 'AdminThemeBridge');
	}
	public function getBridgeExtension() {
		// faults 1 and 2: a key the contract does not know, a hook the theme does not have
		return array('contract' => '^0.1', 'hooks' => array('noSuchHook'), 'colour' => 'red');
	}
	public function never() {
		// fault 3: a theme method that is not on the surface
		$parts = $this->wire()->adminTheme->slotParts('footer');
		// fault 4: a file of the theme's lib/
		if(false) include_once(dirname(__DIR__) . '/AdminThemeBridge/lib/AdminThemeBridgeCsp.php');
		return $parts;
	}
}
PHP;
	$expected = array(
		"manifest key 'colour' is a key of the contract",
		"hooks 'noSuchHook' is a hookable of the theme's surface",
		"the theme's slotParts() is not on the surface",
		"references the theme's file AdminThemeBridge/lib/AdminThemeBridgeCsp.php",
	);
	$out = '';
	$exit = -1;
	try {
		wireMkdir($dir);
		file_put_contents("$dir/$name.module.php", $code);
		$modules->refresh();
		$modules->install($name);
		$cmd = array(PHP_BINARY, __FILE__, $root, $name, '--no-http');
		$proc = proc_open($cmd, array(1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes);
		$out = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
		fclose($pipes[1]);
		fclose($pipes[2]);
		$exit = proc_close($proc);
	} catch(\Throwable $e) {
		check('self-test: BridgeCheckBad written and installed', false, $e->getMessage());
	}
	try {
		if($modules->isInstalled($name)) $modules->uninstall($name);
	} catch(\Throwable $e) {
		check('self-test: BridgeCheckBad uninstalled', false, $e->getMessage());
	}
	if(is_dir($dir)) wireRmdir($dir, true);
	$modules->refresh();
	echo "--- child: php tools/extension-check.php <sandbox> $name --no-http (exit $exit)\n$out---\n";
	$failLines = array_values(array_filter(explode("\n", $out), function($l) { return strpos($l, 'FAIL ') === 0; }));
	check('self-test: the child exits 1', $exit === 1, "exit $exit");
	foreach($expected as $text) {
		$hit = count(array_filter($failLines, function($l) use($text) { return strpos($l, $text) !== false; }));
		check("self-test: one FAIL line: $text", $hit === 1, "$hit lines");
	}
	check('self-test: exactly four FAIL lines', count($failLines) === 4, count($failLines) . ' lines');
	check('self-test: BridgeCheckBad removed and uninstalled', !is_dir($dir) && !$modules->isInstalled($name));
	global $fails;
	echo $fails ? "\n$fails FAILED\n" : "\nall passed\n";
	return $fails ? 1 : 0;
}

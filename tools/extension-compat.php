<?php namespace ProcessWire;

/**
 * Compatibility checker of Bridge extensions (docs/extensions.md 8, extension contract 0.1): which
 * extensions in the given directories break on a given Bridge.
 *
 * Usage:
 *   php tools/extension-compat.php [--bridge=<Bridge checkout or AdminThemeBridge dir>] [--surface=<json>] [--verbose] [<dir>...]
 *
 * Reads, without booting anything and without writing anything:
 *
 *  - the target: the `extensionContract` constant of AdminThemeBridge.module.php (by token) and
 *    the surface from its assets/dist/extension-surface.json (written by the runtime build,
 *    runtime/scripts/manifest.mjs). Default target: this checkout. --surface=<json> gives both
 *    instead (`contract` and the lists of AdminThemeBridge::extensionSurface()); a Bridge without
 *    the constant has no extension contract, and every extension is incompatible with it;
 *  - the extensions: every module under the directories (default: this checkout's modules/ and,
 *    when present, sandbox/<site>/app/modules/), by static parsing (token_get_all) of
 *    `<Name>.module(.php)`, `<Name>.info.php` and `<Name>.info.json`: the manifest is the literal
 *    array getBridgeExtension() returns when the class implements BridgeExtension, otherwise the
 *    module info's `bridge` key. Modules with neither are skipped. A module found twice (the
 *    sandboxes junction this checkout's modules) counts once, where it was found first.
 *
 * Per extension, against the target: the `contract` range takes the target's contract
 * (AdminThemeBridge::contractSatisfies(), the same code as the theme's); `hooks`, `reads` and
 * `settings` are on the target's surface; `slots` are slots of the target; the `module` file
 * exists; the theme would discover it (an extension by the interface also needs `requires
 * AdminThemeBridge` or a `bridge` info key). A manifest that is not a literal array (built at run
 * time) cannot be checked and is reported as incompatible.
 *
 * Prints a table and a summary; --verbose also lists, between the two, the modules skipped as not
 * extensions with the reason (no manifest, an empty manifest, found twice, the theme itself).
 * Exit code: the number of incompatible extensions (at most 254);
 * 255 when the target or the --surface file cannot be read.
 *
 * Original work, MIT.
 */

// one implementation of the contract ranges: the theme's own (static methods of the trait)
require_once dirname(__DIR__) . '/modules/AdminThemeBridge/lib/AdminThemeBridgeExtensions.php';
class BridgeCompatRanges { use AdminThemeBridgeExtensions; const extensionContract = ''; }

/** A value the static reader cannot know (an expression, a call, a variable) */
final class BridgeCompatDynamic {}

function bridgeCompatFail($message) {
	fwrite(STDERR, "extension-compat: $message\n");
	exit(255);
}

$repo = dirname(__DIR__);
$bridgeArg = '';
$surfaceArg = '';
$verbose = false;
$dirs = array();
foreach(array_slice($argv, 1) as $arg) {
	if(strpos($arg, '--bridge=') === 0) $bridgeArg = substr($arg, 9);
	else if(strpos($arg, '--surface=') === 0) $surfaceArg = substr($arg, 10);
	else if($arg === '--verbose') $verbose = true;
	else if($arg === '-h' || $arg === '--help') {
		echo "Usage: php tools/extension-compat.php [--bridge=<Bridge checkout or AdminThemeBridge dir>] [--surface=<json>] [--verbose] [<dir>...]\n";
		echo "  --verbose  also list the modules skipped as not extensions, and why\n";
		exit(0);
	} else if(strpos($arg, '--') === 0) bridgeCompatFail("unknown option $arg");
	else $dirs[] = $arg;
}
if(!count($dirs)) {
	$dirs[] = "$repo/modules";
	foreach(glob("$repo/sandbox/*/app/modules", GLOB_ONLYDIR) ?: array() as $dir) $dirs[] = $dir;
}
foreach($dirs as $dir) {
	if(!is_dir($dir)) bridgeCompatFail("not a directory: $dir");
}

// ---- reading PHP without running it

function bridgeCompatTokens($file) {
	$out = array();
	foreach(token_get_all((string) @file_get_contents($file)) as $t) {
		if(is_array($t) && in_array($t[0], array(T_WHITESPACE, T_COMMENT, T_DOC_COMMENT, T_OPEN_TAG), true)) continue;
		$out[] = $t;
	}
	return $out;
}

function bridgeCompatIs($t, $what) {
	return is_array($t) ? $t[0] === $what : $t === $what;
}

/** Skip an expression up to the next `,` `;` `=>` or closing bracket of the current level */
function bridgeCompatSkip(array $t, &$i) {
	$depth = 0;
	for($n = count($t); $i < $n; $i++) {
		$tok = $t[$i];
		if(is_array($tok)) {
			if(in_array($tok[0], array(T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES), true)) $depth++;
			else if($tok[0] === T_DOUBLE_ARROW && !$depth) return;
			continue;
		}
		if($tok === '(' || $tok === '[' || $tok === '{') $depth++;
		else if($tok === ')' || $tok === ']' || $tok === '}') {
			if(!$depth) return;
			$depth--;
		} else if(($tok === ',' || $tok === ';') && !$depth) return;
	}
}

/** A literal value at $i (string, number, bool, null, array), or a BridgeCompatDynamic */
function bridgeCompatValue(array $t, &$i) {
	$tok = $t[$i] ?? null;
	$value = null;
	$known = true;
	if(bridgeCompatIs($tok, T_ARRAY) && ($t[$i + 1] ?? null) === '(') {
		$i += 2;
		$value = bridgeCompatList($t, $i, ')');
	} else if($tok === '[') {
		$i++;
		$value = bridgeCompatList($t, $i, ']');
	} else if(bridgeCompatIs($tok, T_CONSTANT_ENCAPSED_STRING)) {
		$raw = substr($tok[1], 1, -1);
		if($tok[1][0] === "'") $value = str_replace(array("\\\\", "\\'"), array("\\", "'"), $raw);
		else if(strpos($raw, '$') === false) $value = stripcslashes($raw);
		else $known = false;
		$i++;
	} else if(bridgeCompatIs($tok, T_LNUMBER)) {
		$value = (int) $tok[1];
		$i++;
	} else if(bridgeCompatIs($tok, T_DNUMBER)) {
		$value = (float) $tok[1];
		$i++;
	} else if(bridgeCompatIs($tok, T_STRING) && in_array(strtolower($tok[1]), array('true', 'false', 'null'), true)) {
		$value = array('true' => true, 'false' => false, 'null' => null)[strtolower($tok[1])];
		$i++;
	} else {
		$known = false;
	}
	$next = $t[$i] ?? ';';
	if(!$known || !(in_array($next, array(',', ')', ']', ';'), true) || bridgeCompatIs($next, T_DOUBLE_ARROW))) {
		bridgeCompatSkip($t, $i);
		return new BridgeCompatDynamic();
	}
	return $value;
}

/** The elements of an array literal from $i up to $close; $i ends after $close */
function bridgeCompatList(array $t, &$i, $close) {
	$out = array();
	$n = count($t);
	while($i < $n && $t[$i] !== $close) {
		$first = bridgeCompatValue($t, $i);
		if(bridgeCompatIs($t[$i] ?? null, T_DOUBLE_ARROW)) {
			$i++;
			$value = bridgeCompatValue($t, $i);
			if(is_string($first) || is_int($first)) $out[$first] = $value;
		} else {
			$out[] = $first;
		}
		if(($t[$i] ?? null) === ',') $i++;
		else if(($t[$i] ?? null) !== $close) return new BridgeCompatDynamic();
	}
	$i++;
	return $out;
}

/** [first, last] token index of a function's body, or null */
function bridgeCompatFunction(array $t, $name) {
	foreach($t as $j => $tok) {
		if(!bridgeCompatIs($tok, T_FUNCTION)) continue;
		$k = $j + 1;
		if(($t[$k] ?? null) === '&') $k++;
		if(!bridgeCompatIs($t[$k] ?? null, T_STRING) || strcasecmp($t[$k][1], $name) !== 0) continue;
		for($n = count($t); $k < $n && $t[$k] !== '{' && $t[$k] !== ';'; $k++);
		if(($t[$k] ?? null) !== '{') continue; // a declaration without a body (the defensive interface)
		$depth = 0;
		for($e = $k; $e < $n; $e++) {
			if($t[$e] === '{' || bridgeCompatIs($t[$e], T_CURLY_OPEN) || bridgeCompatIs($t[$e], T_DOLLAR_OPEN_CURLY_BRACES)) $depth++;
			else if($t[$e] === '}' && !--$depth) return array($k + 1, $e - 1);
		}
		return null;
	}
	return null;
}

/** The value of a literal key ('bridge' => ...) between two token indexes, or null when absent */
function bridgeCompatKey(array $t, $key, $from = 0, $to = null) {
	$to = $to === null ? count($t) - 1 : $to;
	for($i = $from; $i < $to; $i++) {
		if(bridgeCompatIs($t[$i], T_CONSTANT_ENCAPSED_STRING) && substr($t[$i][1], 1, -1) === $key && bridgeCompatIs($t[$i + 1] ?? null, T_DOUBLE_ARROW)) {
			$i += 2;
			return array(bridgeCompatValue($t, $i));
		}
	}
	return null;
}

/** Does the class $name (or the file's first class) implement BridgeExtension? */
function bridgeCompatImplements(array $t, $name) {
	$first = null;
	foreach($t as $j => $tok) {
		if(!bridgeCompatIs($tok, T_CLASS) || bridgeCompatIs($t[$j - 1] ?? null, T_DOUBLE_COLON)) continue;
		if(!bridgeCompatIs($t[$j + 1] ?? null, T_STRING)) continue;
		$implements = false;
		for($k = $j + 2, $n = count($t); $k < $n && $t[$k] !== '{'; $k++) {
			if(bridgeCompatIs($t[$k], T_IMPLEMENTS)) $implements = true;
			else if($implements && is_array($t[$k]) && preg_match('/(^|\\\\)BridgeExtension$/', $t[$k][1])) $implements = 'yes';
		}
		$result = $implements === 'yes';
		if(strcasecmp($t[$j + 1][1], $name) === 0) return $result;
		if($first === null) $first = $result;
	}
	return (bool) $first;
}

// ---- the target

if($surfaceArg !== '') {
	$data = json_decode((string) @file_get_contents($surfaceArg), true);
	if(!is_array($data) || !isset($data['contract']) || !is_string($data['contract'])) bridgeCompatFail("$surfaceArg: not a surface JSON with a `contract`");
	$targetLabel = $surfaceArg;
} else {
	$base = $bridgeArg !== '' ? rtrim($bridgeArg, '/\\') : $repo;
	$themeDir = is_file("$base/modules/AdminThemeBridge/AdminThemeBridge.module.php") ? "$base/modules/AdminThemeBridge" : $base;
	$themeFile = "$themeDir/AdminThemeBridge.module.php";
	if(!is_file($themeFile)) bridgeCompatFail("no AdminThemeBridge.module.php in $base or $base/modules/AdminThemeBridge");
	$targetLabel = $themeDir;
	$t = bridgeCompatTokens($themeFile);
	$data = array('contract' => '');
	foreach($t as $j => $tok) {
		if(bridgeCompatIs($tok, T_CONST) && bridgeCompatIs($t[$j + 1] ?? null, T_STRING) && $t[$j + 1][1] === 'extensionContract' && ($t[$j + 2] ?? null) === '=') {
			$k = $j + 3;
			$value = bridgeCompatValue($t, $k);
			if(!is_string($value)) bridgeCompatFail("$themeFile: extensionContract is not a literal string");
			$data['contract'] = $value;
			break;
		}
	}
	if($data['contract'] !== '') {
		$json = "$themeDir/assets/dist/extension-surface.json";
		$surface = json_decode((string) @file_get_contents($json), true);
		if(!is_array($surface)) bridgeCompatFail("$json is missing or not JSON (the runtime build writes it: cd runtime && npm run build)");
		if(($surface['contract'] ?? '') !== $data['contract']) bridgeCompatFail("$json is for contract " . json_encode($surface['contract'] ?? null) . ", the module says {$data['contract']}: rebuild");
		$data = $surface;
	}
}
$target = array('contract' => (string) $data['contract']);
foreach(array('hooks', 'reads', 'settings', 'slots') as $key) {
	$target[$key] = isset($data[$key]) && is_array($data[$key]) ? array_values(array_filter($data[$key], 'is_string')) : array();
}

// ---- the extensions

$modules = array();
$notCounted = array(); // skipped, not counted in the summary: array(name, dir, reason)
$walk = function($dir, $depth) use(&$walk, &$modules, &$notCounted) {
	$names = @scandir($dir) ?: array();
	sort($names);
	$found = array();
	foreach($names as $entry) {
		if($entry === '' || $entry[0] === '.' || $entry === 'node_modules') continue;
		$path = "$dir/$entry";
		if(is_dir($path)) {
			if($depth < 4) $walk($path, $depth + 1);
		} else if(preg_match('/^([A-Za-z_]\w*)\.(module|module\.php|info\.php|info\.json)$/', $entry, $m)) {
			$kind = $m[2] === 'module.php' ? 'module' : str_replace('.', '_', $m[2]);
			$found[$m[1]][$kind] = $path;
		}
	}
	foreach($found as $name => $files) {
		if($name === 'AdminThemeBridge') {
			$notCounted[] = array($name, $dir, 'the theme itself');
			continue;
		}
		if(isset($modules[$name])) {
			$notCounted[] = array($name, $dir, 'found twice, counted in ' . $modules[$name]['dir']);
			continue;
		}
		$modules[$name] = $files + array('dir' => $dir);
	}
};
foreach($dirs as $dir) $walk(rtrim(str_replace('\\', '/', $dir), '/'), 0);

$rows = array();
$skipped = 0;
$skippedList = array(); // array(name, dir, reason)
foreach($modules as $name => $files) {
	$tokens = isset($files['module']) ? bridgeCompatTokens($files['module']) : array();
	$info = array();
	// module info: the info file, else getModuleInfo()
	$infoKey = function($key) use($files, $tokens) {
		if(isset($files['info_json'])) {
			$json = json_decode((string) @file_get_contents($files['info_json']), true);
			if(is_array($json) && array_key_exists($key, $json)) return array($json[$key]);
		}
		if(isset($files['info_php'])) {
			$found = bridgeCompatKey(bridgeCompatTokens($files['info_php']), $key);
			if($found !== null) return $found;
		}
		$body = bridgeCompatFunction($tokens, 'getModuleInfo');
		return $body ? bridgeCompatKey($tokens, $key, $body[0], $body[1]) : null;
	};
	$declared = $infoKey('bridge');
	$declared = $declared === null ? null : $declared[0];
	$implements = $tokens && bridgeCompatImplements($tokens, $name);
	$manifest = null;
	$problems = array();
	if($implements) {
		$body = bridgeCompatFunction($tokens, 'getBridgeExtension');
		$manifest = new BridgeCompatDynamic();
		if($body) {
			for($i = $body[0]; $i <= $body[1]; $i++) {
				if(bridgeCompatIs($tokens[$i], T_RETURN)) {
					$i++;
					$manifest = bridgeCompatValue($tokens, $i);
					break;
				}
			}
		}
		$requires = $infoKey('requires');
		$requires = $requires === null ? array() : $requires[0];
		if(!$requires instanceof BridgeCompatDynamic && empty($declared)) {
			$names = array();
			foreach(is_array($requires) ? $requires : preg_split('/\s*,\s*/', (string) $requires) as $r) {
				if(is_string($r) && preg_match('/^\s*(\w+)/', $r, $m)) $names[] = $m[1];
			}
			if(!in_array('AdminThemeBridge', $names, true)) $problems[] = 'not discovered: implements BridgeExtension, but neither requires AdminThemeBridge nor has a bridge info key';
		}
	} else if(!empty($declared)) {
		$manifest = $declared;
	}
	if($manifest === null || $manifest === array()) {
		$skipped++;
		if($implements) $reason = 'getBridgeExtension() returns an empty array';
		else if($declared !== null) $reason = 'empty bridge info key';
		else $reason = 'no manifest';
		$skippedList[] = array($name, $files['dir'], $reason);
		continue;
	}
	$version = $infoKey('version');
	$version = $version !== null && (is_string($version[0]) || is_int($version[0])) ? (string) $version[0] : '';
	$row = array('module' => $name, 'version' => $version, 'dir' => $files['dir'], 'contract' => '');
	if(!is_array($manifest)) {
		$problems[] = 'manifest not readable statically (not a literal array)';
	} else {
		$contract = $manifest['contract'] ?? '';
		$row['contract'] = is_string($contract) ? $contract : '?';
		if($contract instanceof BridgeCompatDynamic) $problems[] = 'contract not readable statically';
		else if(!is_string($contract) || trim($contract) === '') $problems[] = 'no contract range';
		else if(!BridgeCompatRanges::contractRangeValid($contract)) $problems[] = "contract '$contract' is not a readable range";
		else if($target['contract'] === '') $problems[] = 'the target has no extension contract';
		else if(!BridgeCompatRanges::contractSatisfies(trim($contract), $target['contract'])) $problems[] = "contract $contract does not take {$target['contract']}";
		// against a Bridge without an extension contract the surface lists say nothing more
		foreach($target['contract'] === '' ? array() : array('hooks', 'reads', 'settings', 'slots') as $key) {
			$list = $manifest[$key] ?? array();
			if($list instanceof BridgeCompatDynamic) { $problems[] = "$key not readable statically"; continue; }
			$missing = array();
			foreach((array) $list as $slot => $item) {
				if($key === 'slots') $item = $slot; // slot name => method
				if($item instanceof BridgeCompatDynamic) $problems[] = "$key not readable statically";
				else if(is_string($item) && $item !== '' && !in_array($item, $target[$key], true)) $missing[] = $item;
			}
			if(count($missing)) $problems[] = "$key " . implode(', ', $missing) . ' not on the target surface';
		}
		$module = $manifest['module'] ?? '';
		if($module instanceof BridgeCompatDynamic) $problems[] = 'module not readable statically';
		else if(is_string($module) && $module !== '' && $module[0] !== '/' && strpos($module, '://') === false) {
			$file = preg_replace('/[?#].*$/', '', $module);
			if(!is_file($files['dir'] . '/' . $file)) $problems[] = "module file $file missing";
		}
	}
	$row['problems'] = array_values(array_unique($problems));
	$rows[] = $row;
}

// ---- the report

$repoSlash = str_replace('\\', '/', $repo) . '/';
$short = function($path) use($repoSlash) {
	$path = str_replace('\\', '/', $path);
	return strpos($path, $repoSlash) === 0 ? substr($path, strlen($repoSlash)) : $path;
};
echo 'target: ' . $short($targetLabel) . ' (extension contract ' . ($target['contract'] === '' ? 'none' : $target['contract']) . ")\n\n";
$table = array(array('Extension', 'Version', 'Directory', 'Contract', 'Result', 'Problems'));
$bad = 0;
foreach($rows as $row) {
	$ok = !count($row['problems']);
	if(!$ok) $bad++;
	$table[] = array($row['module'], $row['version'], $short($row['dir']), $row['contract'], $ok ? 'ok' : 'INCOMPATIBLE', implode('; ', $row['problems']));
}
$widths = array();
foreach($table as $line) foreach($line as $c => $cell) $widths[$c] = max($widths[$c] ?? 0, strlen($cell));
foreach(count($rows) ? $table : array() as $r => $line) {
	$cells = array();
	foreach($line as $c => $cell) $cells[] = $c === count($line) - 1 ? $cell : str_pad($cell, $widths[$c]);
	echo rtrim(implode('  ', $cells)) . "\n";
	if(!$r) {
		$rule = array();
		foreach($line as $c => $cell) $rule[] = str_repeat('-', $c === count($line) - 1 ? strlen($cell) : $widths[$c]);
		echo implode('  ', $rule) . "\n";
	}
}
if($verbose) {
	// the skipped modules: no manifest first, in the order found, then the ones not counted
	$list = array_merge($skippedList, $notCounted);
	$lines = array(array('Skipped', 'Directory', 'Reason'));
	foreach($list as $item) $lines[] = array($item[0], $short($item[1]), str_replace($repoSlash, '', str_replace('\\', '/', $item[2])));
	$w = array();
	foreach($lines as $line) foreach($line as $c => $cell) $w[$c] = max($w[$c] ?? 0, strlen($cell));
	if(count($rows)) echo "\n";
	if(!count($list)) echo "no modules skipped\n";
	foreach(count($list) ? $lines : array() as $r => $line) {
		echo rtrim(str_pad($line[0], $w[0]) . '  ' . str_pad($line[1], $w[1]) . '  ' . $line[2]) . "\n";
		if(!$r) echo str_repeat('-', $w[0]) . '  ' . str_repeat('-', $w[1]) . '  ' . str_repeat('-', strlen($line[2])) . "\n";
	}
}
echo (count($rows) || $verbose ? "\n" : '') . count($rows) . ' extension' . (count($rows) === 1 ? '' : 's') . ", $bad incompatible";
echo $skipped ? " ($skipped module" . ($skipped === 1 ? '' : 's') . " without a manifest skipped)\n" : "\n";
exit(min($bad, 254));

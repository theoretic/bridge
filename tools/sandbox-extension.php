<?php namespace ProcessWire;

/**
 * Puts an outside extension into a sandbox and takes it out again (0.30.0), so that a
 * third-party extension is installed only while its checks run (the bundled set's smoke pins).
 *
 * Usage: php tools/sandbox-extension.php /path/to/sandbox/root /path/to/ModuleDir [--dependency] [--remove]
 *
 * Add: links <sandbox>/app/modules/<basename of the directory> to the directory (Windows: a
 * junction, `mklink /J`; elsewhere a symlink), refuses when that path exists and is not a link
 * to the same directory, refreshes the modules and installs every module of the directory that
 * declares a manifest (getBridgeExtension() or a `bridge` module info key), as
 * tools/sandbox-modules.php does. Idempotent. When the add fails and nothing of the directory is
 * installed, a link this run made is removed again (0.30.1): a refused directory leaves nothing.
 *
 * --dependency (0.30.1): the directory is something an extension requires that is not an
 * extension itself (an Inputfield, a Fieldtype): every module of it is installed, manifest or
 * not. Put it in before the extension; take it out (--remove) after the extension.
 *
 * --remove: uninstalls those modules when installed, then removes the link only (never what it
 * points to; nothing is deleted recursively) and refreshes. Idempotent. The link stays while one
 * of its modules is still installed.
 *
 * The directory itself is only read: no file of it is written or deleted.
 * Exit 0 when done, 1 on a failure (add: a module not installed; --remove: a module still
 * installed or the link still there), 2 when the root is not a sandbox (lib/sandbox-guard.php).
 *
 * Original work, MIT.
 */

$args = array_slice($argv, 1);
$remove = in_array('--remove', $args, true);
$dependency = in_array('--dependency', $args, true);
$args = array_values(array_filter($args, function($a) { return $a !== '--remove' && $a !== '--dependency'; }));
if(count($args) !== 2) {
	exit("Usage: php tools/sandbox-extension.php /path/to/sandbox/root /path/to/ModuleDir [--dependency] [--remove]\n");
}
// a sandbox on its own database copy only (audit SE5)
require __DIR__ . '/lib/sandbox-guard.php';
$root = bridgeSandboxRoot($args[0]);

/**
 * Print a failure and stop with exit code 1
 *
 * @param string $message
 *
 */
function sandboxExtensionFail($message) {
	echo "FAIL $message\n";
	exit(1);
}

$home = realpath($args[1]);
if($home === false || !is_dir($home)) sandboxExtensionFail("'{$args[1]}' is not a directory");
$home = str_replace('\\', '/', $home);
$base = basename($home);
if(!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $base)) sandboxExtensionFail("'$base' is not a module directory name");
if(strpos(bridgeSandboxNorm($home) . '/', bridgeSandboxNorm(realpath($root)) . '/') === 0) {
	sandboxExtensionFail("the directory is inside the sandbox; give the extension's own home");
}

if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;
include "$root/index.php";
bridgeSandboxBooted($config, $root);
/** @var Modules $modules */
/** @var Config $config */

$windows = DIRECTORY_SEPARATOR === '\\';
$link = rtrim(str_replace('\\', '/', $config->paths->siteModules), '/') . '/' . $base;

/**
 * Is $path a link (symlink, or a junction on Windows) rather than a plain directory or file?
 *
 * PHP's is_link() does not see a junction; readlink() gives a junction's target and a plain
 * directory's own path.
 *
 * @param string $path
 * @return bool
 *
 */
function sandboxExtensionIsLink($path) {
	if(is_link($path)) return true;
	if(DIRECTORY_SEPARATOR !== '\\' || !file_exists($path)) return false;
	$target = @readlink($path);
	$self = realpath(dirname($path));
	return $target !== false && $self !== false && bridgeSandboxNorm($target) !== bridgeSandboxNorm($self . '/' . basename($path));
}

/**
 * Does $path link to $home?
 *
 * @param string $path
 * @param string $home
 * @return bool
 *
 */
function sandboxExtensionLinksTo($path, $home) {
	if(!sandboxExtensionIsLink($path)) return false;
	$real = realpath($path);
	return $real !== false && bridgeSandboxNorm($real) === bridgeSandboxNorm($home);
}

/**
 * The module class names of the directory (its *.module.php and *.module files)
 *
 * @param string $dir
 * @return array
 *
 */
function sandboxExtensionNames($dir) {
	$names = array();
	foreach(array_merge(glob("$dir/*.module.php") ?: array(), glob("$dir/*.module") ?: array()) as $file) {
		$names[] = preg_replace('/\.module(\.php)?$/', '', basename($file));
	}
	sort($names);
	return array_values(array_unique($names));
}

/**
 * Is the module $name the one in $home (its file under that directory)?
 *
 * @param Modules $modules
 * @param string $name
 * @param string $home
 * @return bool
 *
 */
function sandboxExtensionOwns(Modules $modules, $name, $home) {
	$file = (string) $modules->getModuleFile($name, array('fast' => false));
	if($file === '') return false;
	$dir = realpath(dirname($file));
	return $dir !== false && bridgeSandboxNorm($dir) === bridgeSandboxNorm($home);
}

/**
 * Does the module declare a Bridge extension manifest? (as the theme's extensionManifest() asks)
 *
 * @param Modules $modules
 * @param string $name
 * @return bool
 *
 */
function sandboxExtensionHasManifest(Modules $modules, $name) {
	$info = $modules->getModuleInfoVerbose($name, array('noCache' => true));
	if(!empty($info['bridge']) && is_array($info['bridge'])) return true;
	$class = $modules->getModuleClass($name, true);
	if(!$class || !class_exists($class, false)) {
		$modules->includeModule($name);
		$class = $modules->getModuleClass($name, true);
	}
	if(!$class || !class_exists($class) || !is_subclass_of($class, __NAMESPACE__ . '\\BridgeExtension')) return false;
	$module = $modules->getModule($name, array('noInit' => true, 'noCache' => true, 'noPermissionCheck' => true, 'noInstall' => true, 'noThrow' => true));
	if(!$module instanceof BridgeExtension) return false;
	$manifest = $module->getBridgeExtension();
	return is_array($manifest) && count($manifest) > 0;
}

$names = sandboxExtensionNames($home);
if(!count($names)) sandboxExtensionFail("no *.module.php or *.module file in $home");
$failed = 0;

if($remove) {
	if(!file_exists($link) && !sandboxExtensionIsLink($link)) {
		echo "ok   app/modules/$base not there\n";
		foreach($names as $name) {
			// a module of this name installed from the vanished link: its file is gone
			if(!$modules->isInstalled($name)) continue;
			$file = (string) $modules->getModuleFile($name, array('fast' => false));
			if($file === '' || !is_file($file)) {
				echo "FAIL $name is installed without its files (restore the link and run --remove again)\n";
				$failed++;
			}
		}
		exit($failed ? 1 : 0);
	}
	if(!sandboxExtensionLinksTo($link, $home)) {
		sandboxExtensionFail("app/modules/$base is not a link to $home; left as it is");
	}
	$ours = array();
	foreach($names as $name) {
		if(!$modules->isInstalled($name)) continue;
		if(!sandboxExtensionOwns($modules, $name, $home)) {
			echo "note $name is installed from another directory; left as it is\n";
			continue;
		}
		$ours[] = $name;
	}
	// twice, so a module another of the list requires goes last
	for($round = 0; $round < 2; $round++) {
		foreach($ours as $name) {
			if(!$modules->isInstalled($name)) continue;
			try {
				$modules->uninstall($name);
				echo "ok   $name uninstalled\n";
			} catch(\Throwable $e) {
				if($round) echo "FAIL $name uninstall threw: " . $e->getMessage() . "\n";
			}
		}
		$modules->refresh();
	}
	foreach($ours as $name) {
		if($modules->isInstalled($name)) {
			echo "FAIL $name is still installed\n";
			$failed++;
		}
	}
	if($failed) sandboxExtensionFail("app/modules/$base kept: a module of it is still installed");
	// the link only: rmdir() removes a junction without touching its target; unlink() a symlink
	$ok = $windows ? @rmdir($link) : @unlink($link);
	clearstatcache();
	if(!$ok || file_exists($link) || sandboxExtensionIsLink($link)) {
		sandboxExtensionFail("app/modules/$base could not be removed");
	}
	echo "ok   app/modules/$base removed (the link only)\n";
	$modules->refresh();
	exit(0);
}

// add
$created = false;
if(file_exists($link) || sandboxExtensionIsLink($link)) {
	if(!sandboxExtensionLinksTo($link, $home)) {
		sandboxExtensionFail("app/modules/$base exists and is not a link to $home; refused, nothing written");
	}
	echo "ok   app/modules/$base already links to $home\n";
} else {
	if($windows) {
		if(strpos($link . $home, '"') !== false) sandboxExtensionFail("a path contains a quote");
		$cmd = 'cmd /c mklink /J "' . str_replace('/', '\\', $link) . '" "' . str_replace('/', '\\', $home) . '"';
		exec($cmd . ' 2>&1', $out, $code);
		$ok = $code === 0;
	} else {
		$ok = @symlink($home, $link);
	}
	clearstatcache();
	if(!$ok || !sandboxExtensionLinksTo($link, $home)) sandboxExtensionFail("could not link app/modules/$base to $home");
	$created = true;
	echo "ok   app/modules/$base -> $home\n";
}

$modules->refresh();
$wanted = array();
foreach($names as $name) {
	if($modules->isInstalled($name) && !sandboxExtensionOwns($modules, $name, $home)) {
		echo "FAIL $name is already installed from another directory\n";
		$failed++;
		continue;
	}
	if(!$dependency && !sandboxExtensionHasManifest($modules, $name)) {
		echo "skip $name: no manifest (not an extension)\n";
		continue;
	}
	$wanted[] = $name;
}
if(!count($wanted) && !$failed) {
	echo "FAIL no module of $base declares a manifest (a dependency that is not an extension: --dependency)\n";
	$failed++;
}
// twice, so a module required by another of the list goes first
for($round = 0; $round < 2; $round++) {
	foreach($wanted as $name) {
		if($modules->isInstalled($name)) {
			if(!$round) echo "ok   $name already installed\n";
			continue;
		}
		if(!$modules->isInstallable($name)) {
			if($round) echo "FAIL $name not installable (check its requirements)\n";
			continue;
		}
		try {
			$modules->install($name);
			echo "ok   $name installed\n";
		} catch(\Throwable $e) {
			if($round) echo "FAIL $name install threw: " . $e->getMessage() . "\n";
		}
	}
	$modules->refresh();
}
foreach($wanted as $name) {
	if(!$modules->isInstalled($name)) $failed++;
}
// a failed add that installed nothing from the directory takes back the link it made (0.30.1)
if($failed && $created) {
	$installed = array_filter($names, function($name) use($modules, $home) {
		return $modules->isInstalled($name) && sandboxExtensionOwns($modules, $name, $home);
	});
	if(!count($installed)) {
		$ok = $windows ? @rmdir($link) : @unlink($link);
		clearstatcache();
		if($ok && !file_exists($link) && !sandboxExtensionIsLink($link)) {
			echo "ok   app/modules/$base removed again (nothing of it installed)\n";
			$modules->refresh();
		} else {
			echo "FAIL app/modules/$base could not be removed again\n";
		}
	}
}
exit($failed ? 1 : 0);

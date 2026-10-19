<?php namespace ProcessWire;

/**
 * Installs modules into a sandbox (after their directories were placed under app/modules/),
 * so that the conformance suite can render their admin screens.
 *
 * Usage: php tools/sandbox-modules.php /path/to/sandbox/root ModuleA ModuleB ...
 * Idempotent: already installed modules are reported and skipped. Modules whose install throws
 * are reported and skipped (the sandbox stays usable). Exit code 1 if any requested module is
 * not installed at the end.
 */

$root = rtrim(str_replace('\\', '/', $argv[1] ?? ''), '/');
$names = array_slice($argv, 2);
if(!is_file("$root/index.php") || !is_file("$root/project.php") || !count($names)) {
	exit("Usage: php tools/sandbox-modules.php /path/to/sandbox/root ModuleA ModuleB ...\n");
}

if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;
include "$root/index.php";
/** @var Modules $modules */
/** @var Config $config */

$modules->refresh();
$missing = 0;
foreach($names as $name) {
	if($modules->isInstalled($name)) {
		echo "ok   $name already installed\n";
		continue;
	}
	if(!$modules->isInstallable($name)) {
		$dir = $config->paths->siteModules . $name;
		echo "FAIL $name not installable (" . (is_dir($dir) ? "directory present, check requirements" : "no app/modules/$name") . ")\n";
		$missing++;
		continue;
	}
	try {
		$modules->install($name);
		echo "ok   $name installed\n";
	} catch(\Throwable $e) {
		echo "FAIL $name install threw: " . $e->getMessage() . "\n";
		$missing++;
		continue;
	}
	if(!$modules->isInstalled($name)) {
		echo "FAIL $name still not installed after install()\n";
		$missing++;
	}
}
exit($missing ? 1 : 0);

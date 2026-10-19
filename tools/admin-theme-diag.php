<?php namespace ProcessWire;

/**
 * Read-only report: why an admin theme is (or is not) the current one on a site.
 *
 * Usage: php tools/admin-theme-diag.php /path/to/webroot [username]
 * On a server, run it as the web server user from a directory that user can read:
 *   sudo -u www-data php /tmp/admin-theme-diag.php /var/www/site/htdocs admin
 *
 * Prints the installed admin themes (autoload as the loader sees it, flags, file),
 * AdminThemeBoss's settings, $config->defaultAdminTheme, every user's admin_theme, and the
 * module cache state that decides when AdminThemeBridge loads. Changes nothing itself, but on a
 * site where Bridge's module cache is stale, booting lets Bridge 0.8.1+ rebuild it (reported below).
 * docs/install-live.md explains each line.
 */

$started = time();
$root = rtrim(str_replace('\\', '/', $argv[1] ?? ''), '/');
$userName = $argv[2] ?? 'guest';
if(!is_file("$root/index.php")) exit("Usage: php admin-theme-diag.php /path/to/webroot [username]\n");

// PW renders nothing for a script that includes index.php unless these point at index.php
$_SERVER['SCRIPT_FILENAME'] = "$root/index.php";
$_SERVER['SCRIPT_NAME'] = '/index.php';
if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;
include "$root/index.php";
/** @var Modules $modules */
/** @var Users $users */
/** @var Config $config */
/** @var Fields $fields */
/** @var Sanitizer $sanitizer */

echo "ProcessWire " . $config->version . "\n";
echo "config->defaultAdminTheme: " . var_export($config->defaultAdminTheme, true) . "\n";
echo "  (a theme that becomes current overwrites this at runtime, so after boot it can name that theme)\n";
echo "field admin_theme: " . (($f = $fields->get('admin_theme')) ? "id $f->id, type $f->type" : 'MISSING') . "\n\n";

echo "Admin theme modules (autoload = what the loader reads from the module info cache):\n";
foreach($modules->findByPrefix('AdminTheme', false) as $name) {
	$cached = $modules->info->moduleInfoCache($name, 'autoload');
	printf("  %-22s installed=%s id=%s version=%s autoload=%s flags=%s file=%s\n",
		$name,
		$modules->isInstalled($name) ? 'yes' : 'no',
		$modules->getModuleID($name) ?: '-',
		$modules->getModuleInfoProperty($name, 'versionStr') ?: '?',
		$cached === null ? 'NOT-IN-CACHE(loaded at boot)' : var_export($cached, true),
		var_export($modules->getFlags($name), true),
		str_replace($root, '', (string) $modules->getModuleFile($name))
	);
}

echo "\nAdminThemeBoss config:\n";
if($modules->isInstalled('AdminThemeBoss')) {
	$boss = $modules->getConfig('AdminThemeBoss');
	foreach(array('enablemodule', 'allusers') as $k) echo "  $k = " . var_export($boss[$k] ?? null, true) . "\n";
	if(!empty($boss['enablemodule']) && !empty($boss['allusers'])) echo "  -> allusers sets every user's admin_theme to Uikit on each request\n";
} else {
	echo "  not installed\n";
}

if($modules->isInstalled('AdminThemeBridge')) {
	$bridgeConfig = $modules->getConfig('AdminThemeBridge');
	echo "\nAdminThemeBridge useAsLogin = " . var_export($bridgeConfig['useAsLogin'] ?? null, true) . "\n";
}

echo "\nUsers' admin_theme (raw value as stored):\n";
foreach($users->find('include=all, check_access=0') as $u) {
	$u->of(false);
	echo "  " . str_pad($u->name, 20) . var_export($u->getUnformatted('admin_theme'), true) . "\n";
}

echo "\nWhich theme AdminTheme::init() picks for '$userName':\n";
$u = $users->get('name=' . $sanitizer->pageName($userName));
$t = $u->id ? (string) $u->getUnformatted('admin_theme') : '';
if($t) {
	echo "  user's admin_theme = $t -> that theme, if it is installed and loads on admin pages\n";
} else {
	echo "  no admin_theme on the user -> config->defaultAdminTheme\n";
}

echo "\nModule cache:\n";
$snapshot = $modules->getCache('moduleFileSnapshot');
echo "  file snapshot: " . (is_array($snapshot) ? count($snapshot) . " files (Modules > Refresh rebuilds only when a module file changes)" : 'none') . "\n";
if($modules->isInstalled('AdminThemeBridge')) {
	$bridge = $modules->getModule('AdminThemeBridge', array('noInit' => true, 'noPermissionCheck' => true));
	$stale = method_exists($bridge, 'moduleCacheIsStale') ? $bridge->moduleCacheIsStale() : null;
	echo "  AdminThemeBridge cache stale: " . var_export($stale, true) . ($stale ? " -> the theme loads at boot; see docs/install-live.md" : '') . "\n";
}
$logFile = $config->paths->logs . 'admin-theme-bridge.txt';
$last = is_file($logFile) ? trim((string) array_slice(file($logFile), -1)[0]) : '';
if(strpos($last, 'Loaded at boot') !== false && strtotime(substr($last, 0, 19)) >= $started) {
	echo "  this run found the cache stale and rebuilt it (Bridge loaded at boot); the lines above show the repaired state\n";
}

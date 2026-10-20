<?php namespace ProcessWire;

/**
 * Deployment helper: installs AdminThemeBridge on a real site (locally after
 * site/modules/AdminThemeBridge was junctioned to this repository, on a server after the copy was
 * uploaded) and selects it for one user. Server: run it as the web server user, see
 * docs/install-live.md.
 *
 * Usage: php tools/deploy-local.php /path/to/site/webroot [username]
 *
 * What it changes in the site's database:
 *  - rebuilds the module info cache in full, then installs AdminThemeBridge (module registry);
 *  - if AdminThemeBoss has "activate for all users" on, switches it off (that setting rewrites
 *    every user's admin theme to Uikit on every request, so no other theme can be selected);
 *  - sets the given user's admin_theme to AdminThemeBridge (or, without a username, only reports).
 * Everything is reversible from the admin: Profile > Admin Theme, and the AdminThemeBoss config.
 */

$root = rtrim(str_replace('\\', '/', $argv[1] ?? ''), '/');
$userName = $argv[2] ?? '';
if(!is_file("$root/index.php")) exit("Usage: php tools/deploy-local.php /path/to/site/webroot [username]\n");
if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;
include "$root/index.php";
// the site directory from the config (site/, site-name/ or a bootstrap layout's app/)
if(!is_dir($config->paths->siteModules . 'AdminThemeBridge')) exit("FAIL {$config->paths->siteModules}AdminThemeBridge is missing (create the junction first)\n");
/** @var Modules $modules */
/** @var Users $users */
/** @var Config $config */

// a full rebuild: refresh() returns early while no module file changed (PLAN.md section 2), so a
// half-finished earlier install would keep a module info cache without the theme
$modules->saveCache('moduleFileSnapshot', array());
$modules->refresh();
if($modules->isInstalled('AdminThemeBridge')) {
	echo "ok   AdminThemeBridge installed (" . $modules->getModuleInfoProperty('AdminThemeBridge', 'version') . ")\n";
} else if($modules->isInstallable('AdminThemeBridge')) {
	$modules->install('AdminThemeBridge');
	echo "ok   AdminThemeBridge installed now\n";
} else {
	exit("FAIL AdminThemeBridge not installable\n");
}

if($modules->isInstalled('AdminThemeBoss')) {
	$boss = (array) $modules->getConfig('AdminThemeBoss');
	// never saved = Boss's default, which is on (AdminThemeBossConfig::getDefaults())
	if(!array_key_exists('allusers', $boss) || !empty($boss['allusers'])) {
		$boss['allusers'] = 0;
		$modules->saveConfig('AdminThemeBoss', $boss);
		echo "note AdminThemeBoss 'activate for all users' switched OFF (it forced Uikit on every user); re-enable in Modules > AdminThemeBoss to undo\n";
	}
}

if($userName) {
	$u = $users->get("name=" . $users->wire()->sanitizer->pageName($userName));
	if(!$u->id) exit("FAIL user $userName not found\n");
	$u->of(false);
	$u->admin_theme = 'AdminThemeBridge';
	$users->save($u, array('noHooks' => true));
	echo "ok   user $userName now uses AdminThemeBridge (switch back in Profile > Admin Theme)\n";
}

echo "admin: " . $config->urls->admin . "\n";

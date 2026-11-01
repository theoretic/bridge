<?php namespace ProcessWire;
// sandbox only: php switch-theme.php <sandbox root> <AdminThemeX> [uikit themeName]
//               php switch-theme.php <sandbox root> restore
// sets the "uikit" sandbox user's admin theme and AdminThemeUikit's style (blank = original),
// installing the theme when needed (bench.mjs runs it before each theme). The first switch keeps
// what was there in <sandbox root>/.bench-restore.json; `restore` puts it back (audit BG9)
// a sandbox on its own database copy only (audit SE5)
require dirname(__DIR__) . '/lib/sandbox-guard.php';
if(!isset($argv[1])) exit("sandbox root only\n");
$root = bridgeSandboxRoot($argv[1]);
$theme = $argv[2] ?? 'AdminThemeUikit';
$style = $argv[3] ?? '';
$keep = "$root/.bench-restore.json";
if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;
include "$root/index.php";
bridgeSandboxBooted($config, $root);
$u = $users->get('uikit');
if($theme === 'restore') {
	if(!is_file($keep)) exit("nothing to restore\n");
	$was = json_decode((string) file_get_contents($keep), true);
	$t = (string) $was['theme'];
	$theme = (ctype_digit($t) ? $modules->getModuleName((int) $t) : $t) ?: 'AdminThemeUikit';
	$style = (string) $was['style'];
	unlink($keep);
} else if(!is_file($keep)) {
	file_put_contents($keep, json_encode(array('theme' => (string) $u->admin_theme, 'style' => (string) $modules->getConfig('AdminThemeUikit', 'themeName'))));
}
if(!$modules->isInstalled($theme)) { $modules->install($theme); echo "installed $theme\n"; }
$modules->saveConfig('AdminThemeUikit', 'themeName', $style);
$u->of(false);
$u->admin_theme = $modules->getModuleID($theme);
$u->save('admin_theme');
$u = $users->get('uikit');
echo "uikit user theme: " . $u->admin_theme . " | Uikit themeName: '" . $modules->getConfig('AdminThemeUikit', 'themeName') . "'\n";

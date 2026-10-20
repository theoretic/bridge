<?php namespace ProcessWire;
// sandbox only: php switch-theme.php <sandbox root> <AdminThemeX> [uikit themeName]
// sets the "uikit" sandbox user's admin theme and AdminThemeUikit's style (blank = original),
// installing the theme when needed (bench.mjs runs it before each theme)
$root = rtrim(str_replace('\\', '/', $argv[1] ?? ''), '/');
if(strpos($root, '/sandbox/') === false || !is_file("$root/index.php")) exit("sandbox root only\n");
$theme = $argv[2] ?? 'AdminThemeUikit';
$style = $argv[3] ?? '';
if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;
include "$root/index.php";
if(!$modules->isInstalled($theme)) { $modules->install($theme); echo "installed $theme\n"; }
$modules->saveConfig('AdminThemeUikit', 'themeName', $style);
$u = $users->get('uikit');
$u->of(false);
$u->admin_theme = $modules->getModuleID($theme);
$u->save('admin_theme');
$u = $users->get('uikit');
echo "uikit user theme: " . $u->admin_theme . " | Uikit themeName: '" . $modules->getConfig('AdminThemeUikit', 'themeName') . "'\n";

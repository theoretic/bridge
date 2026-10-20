<?php namespace ProcessWire;

/**
 * Icon names a site uses that no code scan sees (tools/fa-icons-site.php): the icons of its
 * installed modules (admin navigation), templates and fields, as stored in its database.
 * Read-only. One name per line on stdout, for the Font Awesome subset build:
 *
 *   php tools/fa-icons-site.php /path/to/webroot > site-icons.txt
 *   BRIDGE_WIRE=/path/to/wire BRIDGE_FA_ICONS=site-icons.txt BRIDGE_FA_SCAN=/path/to/webroot/site/modules \
 *     npm --prefix runtime run build
 *
 * BRIDGE_FA_ICONS takes several files separated by the platform's path delimiter.
 *
 */

if(empty($argv[1]) || !is_file(rtrim($argv[1], '/\\') . '/index.php')) {
	fwrite(STDERR, "usage: php tools/fa-icons-site.php <webroot>\n");
	exit(1);
}
$root = rtrim(str_replace('\\', '/', $argv[1]), '/');
// some sites read DOCUMENT_ROOT in config or hooks; a CLI boot has none
if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;
include "$root/index.php";

$icons = array();
$add = function($icon) use(&$icons) {
	$icon = preg_replace('/^(fa-)+/', '', trim((string) $icon));
	if($icon !== '' && preg_match('/^[a-z0-9-]+$/', $icon)) $icons[$icon] = true;
};
foreach($modules as $module) {
	$name = $module->className();
	if(!$modules->isInstalled($name)) continue;
	$add($modules->getModuleInfoProperty($name, 'icon'));
}
foreach($templates as $template) $add($template->getIcon());
foreach($fields as $field) $add($field->getIcon());
// admin pages (the navigation): their own icon or their Process module's
foreach($pages->find('template=admin, include=all') as $p) $add($p->getIcon());

ksort($icons);
echo implode("\n", array_keys($icons)) . "\n";

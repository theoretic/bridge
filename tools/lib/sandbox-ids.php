<?php namespace ProcessWire;

/**
 * Prints the ids of the fixture pages the browser checks drive (tools/sandbox-fixture.php), as
 * shell assignments for tools/ci.sh: NATIVE_ID (/bridge-native/), FIXTURE_ID (/bridge-fixture/),
 * PARENT_ID (/bridge-native-parent/), TREE_ID (/bridge-tree/), NESTING_ID (/bridge-nesting/),
 * AUTO_ID (/bridge-autocomplete/), CUSTOM_MENU_ID (bridge-custom-menu under the admin root),
 * ADD_TEMPLATE_ID (the template of the first child of /bridge-native-parent/, bridge_native: what
 * tools/screens-check.js passes to Add Page, so that no quick add creates a page).
 * A page that is missing prints nothing; the check that needs it then uses its own default.
 * Reads only. Boots the sandbox behind tools/lib/sandbox-guard.php.
 *
 * Usage: php tools/lib/sandbox-ids.php /path/to/sandbox/root
 *
 * Original work, MIT.
 */

require __DIR__ . '/sandbox-guard.php';
$root = bridgeSandboxRoot($argv[1] ?? '');
if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;
ob_start();
include "$root/index.php";
ob_end_clean();
/** @var Config $config */
/** @var ProcessWire $wire */
bridgeSandboxBooted($config, $root);
$pages = wire('pages');
foreach(array('NATIVE_ID' => '/bridge-native/', 'FIXTURE_ID' => '/bridge-fixture/', 'PARENT_ID' => '/bridge-native-parent/',
	'TREE_ID' => '/bridge-tree/', 'NESTING_ID' => '/bridge-nesting/', 'AUTO_ID' => '/bridge-autocomplete/') as $name => $path) {
	$page = $pages->get("path=$path, include=all");
	if($page->id) echo "$name={$page->id}\n";
}
$page = $pages->get('path=/bridge-native-parent/, include=all');
$child = $page->id ? $page->child('include=all') : null;
if($child && $child->id) echo "ADD_TEMPLATE_ID={$child->template->id}
";
$page = $pages->get($config->adminRootPageID)->child('name=bridge-custom-menu, include=all');
if($page->id) echo "CUSTOM_MENU_ID={$page->id}\n";

<?php namespace ProcessWire;

/**
 * Prints the ids of the fixture pages the browser checks drive (tools/sandbox-fixture.php), as
 * shell assignments for tools/ci.sh: NATIVE_ID (/bridge-native/), FIXTURE_ID (/bridge-fixture/),
 * PARENT_ID (/bridge-native-parent/), TREE_ID (/bridge-tree/), NESTING_ID (/bridge-nesting/).
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
	'TREE_ID' => '/bridge-tree/', 'NESTING_ID' => '/bridge-nesting/') as $name => $path) {
	$page = $pages->get("path=$path, include=all");
	if($page->id) echo "$name={$page->id}\n";
}

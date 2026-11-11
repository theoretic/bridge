<?php namespace ProcessWire;

/**
 * Lists, and with --delete permanently deletes, the blank pages a failed Add Page check can leave
 * on a sandbox: direct children of /bridge-native-parent/ named `untitled-…`, template
 * bridge_native, unpublished, with an empty title (every language). Nothing else is selected:
 * child-a, child-b and the trash are never touched.
 *
 * Usage: php tools/sandbox-clean.php /path/to/sandbox/root [--delete]
 *
 *   (no flag)   list the pages (id, name, created, created user); writes nothing
 *   --delete    delete them with $pages->delete() (not the trash) and print each id
 *
 * Exit: 0 done, 1 usage, 2 not a sandbox (tools/lib/sandbox-guard.php; nothing booted or written).
 *
 * Original work, MIT.
 */

$usage = "Usage: php tools/sandbox-clean.php /path/to/sandbox/root [--delete]\n";
$args = array_slice($argv, 1);
$delete = false;
$rootArg = '';
foreach($args as $arg) {
	if($arg === '--delete') {
		$delete = true;
	} else if($rootArg === '' && strpos($arg, '--') !== 0) {
		$rootArg = $arg;
	} else {
		fwrite(STDERR, "unknown argument '$arg'\n$usage");
		exit(1);
	}
}
if($rootArg === '') {
	fwrite(STDERR, $usage);
	exit(1);
}

// a sandbox on its own database copy only (audit SE5)
require __DIR__ . '/lib/sandbox-guard.php';
$root = bridgeSandboxRoot($rootArg);

if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;
ob_start();
include "$root/index.php";
ob_end_clean();
/** @var Config $config */
/** @var ProcessWire $wire */
bridgeSandboxBooted($config, $root);
$pages = wire('pages');

$parent = $pages->get('path=/bridge-native-parent/, include=all');
if(!$parent->id) {
	echo "no /bridge-native-parent/ on this sandbox: 0 pages\n";
	exit(0);
}

/**
 * Is the page's title empty in every language?
 *
 * @param Page $page
 * @return bool
 *
 */
function sandboxCleanTitleEmpty(Page $page) {
	$title = $page->getUnformatted('title');
	if($title instanceof LanguagesPageFieldValue) {
		foreach($page->wire()->languages as $language) {
			if(trim((string) $title->getLanguageValue($language)) !== '') return false;
		}
		return true;
	}
	return trim((string) $title) === '';
}

$found = array();
foreach($pages->find("parent_id=$parent->id, template=bridge_native, include=all") as $page) {
	if(strpos($page->name, 'untitled-') !== 0) continue;
	if(!$page->hasStatus(Page::statusUnpublished)) continue;
	if($page->isTrash()) continue;
	if(!sandboxCleanTitleEmpty($page)) continue;
	$found[] = $page;
}

echo count($found) . " page(s) under /bridge-native-parent/ (id $parent->id)" . ($delete ? ', deleting' : '') . "\n";
foreach($found as $page) {
	if($delete) {
		$id = $page->id;
		$pages->delete($page);
		echo "deleted $id\n";
	} else {
		echo "$page->id\t$page->name\t" . date('Y-m-d H:i:s', $page->created) . "\t" . $page->createdUser->name . "\n";
	}
}

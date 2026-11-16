<?php namespace ProcessWire;

/**
 * Entry point required by wire/core/admin.php: $adminTheme->path() . 'default.php'
 *
 * FileCompiler=0
 */

if(!defined("PROCESSWIRE")) die();

/** @var AdminThemeBridge $adminTheme */
/** @var string $content */

// the module was upgraded during this request and the older class is still loaded (templateApi):
// say so instead of calling methods it lacks; the next request loads the new class. The link goes
// to Modules > Refresh, not back to this URL, which may be the download that did the upgrade.
if(!defined(get_class($adminTheme) . '::templateApi') || constant(get_class($adminTheme) . '::templateApi') < 1) {
	$reloadUrl = $adminTheme->wire()->sanitizer->entities($adminTheme->wire()->config->urls->admin . 'module/?reset=1');
	$reloadText = __('Bridge has just been updated. Continue to the Modules page.');
	echo "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Bridge</title></head>" .
		"<body><p><a href='$reloadUrl'>" .
		$adminTheme->wire()->sanitizer->entities($reloadText) . "</a></p></body></html>";
	return;
}

if(!isset($content)) $content = '';
// a Process that threw keeps its legacy reasons (before anything asks useLegacyStack())
$adminTheme->settleProcess();
$layout = $adminTheme->isModal ? 'modal' : '';

$adminTheme->includeFile('_main.php', array(
	'layout' => $layout,
	'content' => &$content,
));

<?php namespace ProcessWire;

/**
 * Entry point required by wire/core/admin.php: $adminTheme->path() . 'default.php'
 *
 * FileCompiler=0
 */

if(!defined("PROCESSWIRE")) die();

/** @var AdminThemeBridge $adminTheme */
/** @var string $content */

if(!isset($content)) $content = '';
// a Process that threw keeps its legacy reasons (before anything asks useLegacyStack())
$adminTheme->settleProcess();
$layout = $adminTheme->isModal ? 'modal' : '';

$adminTheme->includeFile('_main.php', array(
	'layout' => $layout,
	'content' => &$content,
));

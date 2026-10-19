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
$layout = $adminTheme->isModal ? 'modal' : '';

$adminTheme->includeFile('_main.php', array(
	'layout' => $layout,
	'content' => &$content,
));

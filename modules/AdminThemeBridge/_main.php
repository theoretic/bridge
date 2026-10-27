<?php namespace ProcessWire;

/**
 * Page frame for AdminThemeBridge
 *
 * The extra-markup call and the headline check below are taken from AdminThemeUikit's _main.php
 * (ProcessWire 3.0.274, Mozilla Public License 2.0, https://processwire.com), modified: the rest
 * of this file is Bridge's own.
 *
 * FileCompiler=0
 */

if(!defined("PROCESSWIRE")) die();

/** @var Config $config */
/** @var AdminThemeBridge $adminTheme */
/** @var User $user */
/** @var Notices $notices */
/** @var Page $page */
/** @var string $layout */
/** @var string $content */

$adminTheme->renderExtraMarkup('x'); // forces the extra markup cache, as upstream does
// UIkit markup in the page (ADR 0017), before the head decides what to print
$adminTheme->scanUikitMarkup($content);
$headline = $adminTheme->getHeadline();
$headlinePos = strpos($content, "$headline</h1>");
if($headlinePos && $headlinePos > 500) $headline = '';

?><!DOCTYPE html>
<html class="pw" lang="<?php echo $adminTheme->_('en'); ?>"<?php echo $adminTheme->renderHtmlAttributes(); ?>>
<head>
	<?php
	$adminTheme->includeFile('_head.php', array('layout' => $layout));
	echo $adminTheme->deferLegacyInline($adminTheme->renderExtraMarkup('head'));
	?>
</head>
<body class='<?php echo $adminTheme->getBodyClass(); ?>'>

	<?php
	if($layout === 'modal') {
		echo $adminTheme->renderNotices($notices);
	} else {
		$adminTheme->includeFile('_masthead.php');
	}

	$adminTheme->includeFile('_content.php', array(
		'headline' => $headline,
		'content' => &$content,
		'layout' => $layout,
	));

	if($layout !== 'modal') $adminTheme->includeFile('_footer.php');

	echo $adminTheme->renderExtraMarkup('body');
	$adminTheme->includeFile('_body-scripts.php', array('layout' => $layout));
	?>

</body>
</html><?php

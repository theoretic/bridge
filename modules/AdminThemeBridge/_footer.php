<?php namespace ProcessWire;

/**
 * Footer, with the upstream debug panel for superusers in debug mode
 *
 * FileCompiler=0
 */

if(!defined("PROCESSWIRE")) die();

/** @var Config $config */
/** @var AdminThemeBridge $adminTheme */

?>
<footer id='pw-footer' class='pw-footer'>
	<div class='pw-container'>
		<p>
			<span>Bridge <?php echo $adminTheme->version; ?></span>
			<?php if($adminTheme->isLoggedIn): ?>
			<small><?php
				echo sprintf($adminTheme->_('based on ProcessWire %s'), $config->versionName . '<!--v' . $config->systemVersion . '-->') . ', ' .
					sprintf($adminTheme->_('colours from %s'), "<a href='https://github.com/noelboss/AdminThemeBoss' target='_blank' rel='noopener'>AdminThemeBoss</a>");
			?></small>
			<?php endif; ?>
		</p>
		<?php
		if($adminTheme->isSuperuser && $config->debug) {
			include($config->paths->wire . 'templates-admin/debug.inc');
		}
		?>
	</div>
	<?php echo $adminTheme->renderExtraMarkup('footer'); ?>
</footer>

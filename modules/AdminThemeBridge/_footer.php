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
			<?php // the version for signed-in users only, as upstream themes do (audit B9) ?>
			<span>Bridge<?php if($adminTheme->isLoggedIn) echo ' ' . $adminTheme->wire()->sanitizer->entities($adminTheme->version); ?></span>
			<?php if($adminTheme->isLoggedIn): ?>
			<small><?php
				echo sprintf($adminTheme->shellLabel('basedOn'), $config->versionName . '<!--v' . $config->systemVersion . '-->') . ', ' .
					sprintf($adminTheme->shellLabel('coloursFrom'), "<a href='https://github.com/noelboss/AdminThemeBoss' target='_blank' rel='noopener'>AdminThemeBoss</a>");
			?></small>
			<?php endif; ?>
		</p>
		<?php
		if($adminTheme->isSuperuser && $config->debug) {
			// upstream's panel without its inline script, a jQuery $(document).ready() that threw where
			// the legacy stack is not loaded and left the whole panel open below the footer;
			// scripts/debug-tools.js opens it in a dialog and folds its sections on every page
			// (#debug.pw-debug). Should upstream change that script, the panel stays as it is
			ob_start();
			include($config->paths->wire . 'templates-admin/debug.inc');
			$debugTools = (string) ob_get_clean();
			$debugNative = preg_replace('~<script\b[^>]*>\s*\$\(document\)\.ready\(function\(\)\s*\{\s*var \$debug\b.*?</script>~s', '', $debugTools, 1, $debugStripped);
			if($debugStripped && is_string($debugNative)) {
				$debugScript = 'scripts/debug-tools.js';
				$debugTools = str_replace('<div id="debug">', '<div id="debug" class="pw-debug">', $debugNative) .
					"<script src='" . $adminTheme->url() . $debugScript . '?v=' . (is_file($adminTheme->path() . $debugScript) ? filemtime($adminTheme->path() . $debugScript) : $adminTheme->version) . "'></script>";
			}
			echo $debugTools;
		}
		?>
	</div>
	<?php echo $adminTheme->renderExtraMarkup('footer'); ?>
</footer>

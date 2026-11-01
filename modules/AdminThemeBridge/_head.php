<?php namespace ProcessWire;

/**
 * <head> contents: styles and scripts
 *
 * Prints AdminThemeBridge::assetPlan() (lib/AdminThemeBridgeHead.php, audit AR1): which assets,
 * in which order, deferred or not, is decided there; this file escapes and prints.
 *
 * FileCompiler=0
 */

if(!defined("PROCESSWIRE")) die();

/** @var Config $config */
/** @var AdminThemeBridge $adminTheme */
/** @var string $layout */

$plan = $adminTheme->assetPlan($layout);
// the request's Content-Security-Policy nonce (ADR 0020): on every <style>, <script> and
// modulepreload link below, and in the meta the scripts read it from; nothing without one
$nonce = $adminTheme->nonceAttr();
// URLs printed into attributes are escaped (audit B10)
$sanitizer = $adminTheme->wire()->sanitizer;
$attr = function($url) use($sanitizer) { return $sanitizer->entities((string) $url); };

?>
	<?php echo $adminTheme->cspMeta(); ?>
	<meta http-equiv="content-type" content="text/html; charset=utf-8" />
	<meta name="robots" content="noindex, nofollow" />
	<meta name="google" content="notranslate" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta name="color-scheme" content="light dark">
	<?php
	// the canvas colour before the stylesheets arrive: no white flash in the dark scheme, and
	// "auto" without JavaScript follows the system (audit C36; same values as 00-tokens.css)
	?>
	<style data-pw-keep<?php echo $nonce; ?>>
		html[data-pw-scheme=dark] { background: #0a0a0a; }
		@media (prefers-color-scheme: dark) { html:not([data-pw-scheme=light]) { background: #0a0a0a; } }
	</style>

	<title><?php echo $adminTheme->getBrowserTitle(); ?></title>

	<script<?php echo $nonce; ?>>
		<?php echo $adminTheme->getHeadJS(); ?>
		// colour scheme and scale before first paint: the user's choice in this browser (localStorage,
		// under the user's key; the last user's on the login screen) over the setting; auto follows
		// the operating system. scripts/main.js (prefs, scheme, scale) keeps both in sync afterwards.
		(function(d) {
			var c = ProcessWire.config.AdminThemeBridge || {}, p = null;
			try {
				p = JSON.parse(localStorage.getItem(c.prefsKey || 'pwPrefs.last') || 'null');
				if(!p) p = { scheme: localStorage.getItem('pwScheme') };
			} catch(e) {}
			p = p || {};
			var s = p.scheme;
			if(s !== 'light' && s !== 'dark' && s !== 'auto') s = c.colorScheme || 'auto';
			if(s === 'auto') s = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
			d.setAttribute('data-pw-scheme', s);
			var z = parseFloat(p.scale);
			if(z >= 0.75 && z <= 1.5 && z !== 1) d.style.fontSize = (z * 100) + '%';
		})(document.documentElement);
	</script>
<?php
foreach($plan->fontPreloads as $font) echo "\n\t<link rel='preload' href='" . $attr($font) . "' as='font' type='font/woff2' crossorigin />";
foreach($plan->styles as $file) echo "\n\t<link type='text/css' href='" . $attr($file) . "' rel='stylesheet' />";
if($plan->uikitCss) echo "\n\t<link type='text/css' href='" . $attr($plan->uikitCss) . "' rel='stylesheet' data-pw-uikit />";
echo "\n\t<link type='text/css' href='" . $attr($plan->themeCss) . "' rel='stylesheet' data-pw-theme />";
echo "\n\t<link type='text/css' href='" . $attr($plan->fieldsCss) . "' rel='stylesheet' data-pw-fields />";
if($plan->maxWidth) echo "\n\t<style data-pw-keep$nonce>.pw-container, #notices { max-width:" . (int) $plan->maxWidth . "px; }</style>";
foreach($plan->modulePreloads as $url) echo "\n\t<link rel='modulepreload' href='" . $attr($url) . "'$nonce />";
foreach($plan->scripts as $script) {
	echo "\n\t<script type='text/javascript' src='" . $attr($script['url']) . "'" . ($script['defer'] ? ' defer' : '') . "$nonce></script>";
}
echo "\n";

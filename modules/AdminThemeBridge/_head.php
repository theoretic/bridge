<?php namespace ProcessWire;

/**
 * <head> contents: styles and scripts
 *
 * Script order mirrors upstream so legacy Inputfield scripts find the same globals:
 * JqueryCore and JqueryUI (registered by wire/core/admin.php) are already in $config->scripts,
 * then inputfields.js and main.js from wire/templates-admin, then module scripts, then the
 * theme's own script. In auto mode without legacy needs, the legacy part is not printed but
 * handed to the client in ProcessWire.config.AdminThemeBridge.legacyScripts, in order.
 *
 * FileCompiler=0
 */

if(!defined("PROCESSWIRE")) die();

/** @var Config $config */
/** @var AdminThemeBridge $adminTheme */
/** @var string $layout */

// what to print, in which order, and the client config: AdminThemeBridge::headPlan()
// (lib/AdminThemeBridgeHead.php, audit PA1)
extract($adminTheme->headPlan($layout));

?>
	<meta http-equiv="content-type" content="text/html; charset=utf-8" />
	<meta name="robots" content="noindex, nofollow" />
	<meta name="google" content="notranslate" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta name="color-scheme" content="light dark">
	<?php
	// the canvas colour before the stylesheets arrive: no white flash in the dark scheme, and
	// "auto" without JavaScript follows the system (audit C36; same values as 00-tokens.css)
	?>
	<style data-pw-keep>
		html[data-pw-scheme=dark] { background: #0a0a0a; }
		@media (prefers-color-scheme: dark) { html:not([data-pw-scheme=light]) { background: #0a0a0a; } }
	</style>

	<title><?php echo $adminTheme->getBrowserTitle(); ?></title>

	<script>
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
// the fonts every screen paints with, fetched alongside the stylesheets instead of after them
// (same URLs as theme.css and fa.css ask for, crossorigin as font requests are)
$preloads = array('assets/fonts/geist-latin-wght-normal.woff2');
// the solid subset's name carries a content hash (fa-subset.mjs): from the build's manifest, else
// read from fa.css, whose @font-face rules come first (audit PP2)
$fontPreloads = $adminTheme->manifest('fontPreloads');
if(is_array($fontPreloads) && $iconVersion && !empty($fontPreloads[$iconVersion])) {
	$preloads[] = $fontPreloads[$iconVersion];
} else if(!empty($faCss) && is_file($themeDir . $faCss)) {
	$faHead = (string) file_get_contents($themeDir . $faCss, false, null, 0, 16384);
	if(preg_match('/url\((fa-solid-900-subset(?:\.[0-9a-f]+)?\.woff2)\)/', $faHead, $m)) $preloads[] = dirname($faCss) . '/' . $m[1];
}
// URLs printed into attributes are escaped (audit B10)
$sanitizer = $adminTheme->wire()->sanitizer;
$attr = function($url) use($sanitizer) { return $sanitizer->entities((string) $url); };
foreach($preloads as $font) {
	if(is_file($themeDir . $font)) echo "\n\t<link rel='preload' href='" . $attr($themeUrl . $font) . "' as='font' type='font/woff2' crossorigin />";
}
foreach($adminTheme->assetUrls($styles) as $file) {
	if($adminTheme->isOtherThemeAsset($file)) continue;
	echo "\n\t<link type='text/css' href='" . $attr($file) . "' rel='stylesheet' />";
}
// the UIkit layer is one cascade layer (@layer uikit): every unlayered stylesheet wins over it
if($useUikit) echo "\n\t<link type='text/css' href='" . $attr($uikitCss) . "' rel='stylesheet' data-pw-uikit />";
echo "\n\t<link type='text/css' href='" . $attr($themeCss) . "' rel='stylesheet' data-pw-theme />";
echo "\n\t<link type='text/css' href='" . $attr($fieldsCss) . "' rel='stylesheet' data-pw-fields />";
if($adminTheme->maxWidth) {
	echo "\n\t<style data-pw-keep>.pw-container, #notices { max-width:" . (int) $adminTheme->maxWidth . "px; }</style>";
}
// the runtime module and the chunk it imports statically, fetched while the page parses instead
// of after main.js imports it at the end of the body (audit B21, C32); same URL as that import()
$runtimeFile = $themeDir . 'assets/dist/runtime.js';
if(is_file($runtimeFile)) {
	echo "\n\t<link rel='modulepreload' href='" . $attr($bridgeJs['runtimeUrl']) . "' />";
	$chunks = $adminTheme->manifest('runtimeChunks');
	if(!is_array($chunks)) {
		$chunks = preg_match_all('~from\s*["\']\./(chunks/[\w.-]+\.js)["\']~', (string) file_get_contents($runtimeFile), $m) ? array_unique($m[1]) : array();
	}
	foreach($chunks as $chunk) echo "\n\t<link rel='modulepreload' href='" . $attr("{$themeUrl}assets/dist/$chunk") . "' />";
}
// theme scripts that no inline code calls while the page parses run deferred (in order, before
// DOMContentLoaded); main.js (stand-ins, InputfieldSubmitDropdown), lister.js
// (ProcessLister.initialized), page-edit.js and wire-tabs.js (the editor's inline init) do not
$deferrable = array('scripts/setup.js', 'scripts/screens.js', 'scripts/link.js', 'scripts/image-select.js', 'scripts/page-save.js');
foreach($printScripts as $file) {
	if($adminTheme->isOtherThemeAsset($file)) continue;
	$defer = '';
	if(strpos($file, $themeUrl) === 0) {
		$rel = preg_replace('/\?.*$/', '', substr($file, strlen($themeUrl)));
		if(in_array($rel, $deferrable, true)) $defer = ' defer';
	}
	echo "\n\t<script type='text/javascript' src='" . $attr($file) . "'$defer></script>";
}
echo "\n";

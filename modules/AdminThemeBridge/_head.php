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

$version = $config->version;
$themeVersion = $adminTheme->version;
// cache busting for the theme's own built files: their modification time, so a new build reaches
// browsers at once (the stored module version only changes after a modules refresh)
$themeAssetVersion = function($file) use($themeVersion) {
	$path = __DIR__ . '/' . $file;
	return is_file($path) ? (string) filemtime($path) : (string) $themeVersion;
};
$wireUrl = $config->urls->wire;
$themeUrl = $adminTheme->url();
$styles = $config->styles;
$scripts = $config->scripts;
$adminIcons = $config->adminIcons;
$iconVersion = empty($adminIcons['version']) ? '' : $adminIcons['version'];
$ext = $config->debug ? "js" : "min.js";

$styles->prepend($wireUrl . "templates-admin/styles/AdminTheme.css?v=$version");
if($iconVersion && version_compare($iconVersion, '6.0.0', '>=')) {
	$styles->append($wireUrl . "templates-admin/styles/font-awesome-$iconVersion/css/all.min.css");
	$styles->append($wireUrl . "templates-admin/styles/font-awesome-$iconVersion/css/v4-shims.min.css");
} else {
	$styles->append($wireUrl . "templates-admin/styles/font-awesome/css/font-awesome.min.css?v=$version");
}
// assets of other admin themes: AdminThemeBoss (a Uikit add-on) appends its full Uikit build on
// every admin request whatever theme is current; drop anything from another AdminTheme module
foreach(array($styles, $scripts) as $list) {
	foreach($list->urls() as $url) {
		if($adminTheme->isOtherThemeAsset($url)) {
			$list->remove(preg_replace('/\?.*$/', '', $url));
			$list->remove($url);
		}
	}
}
// theme stylesheet: printed last, outside $config->styles, so module styles never follow it
$themeCss = $themeUrl . "assets/dist/theme.css?v=" . $themeAssetVersion('assets/dist/theme.css');
// field stylesheet (ADR 0014): recolours the field modules' own CSS, so it follows theme.css
$fieldsCss = $themeUrl . "assets/dist/fields.css?v=" . $themeAssetVersion('assets/dist/fields.css');
// the jQuery UI skin belongs to the legacy stack: printed with it, or loaded with it on demand
$jqueryUiCss = $wireUrl . "templates-admin/styles/JqueryUI/JqueryUI.css?v=$version";
$legacyStyles = array();
if($adminTheme->useLegacyStack()) {
	$styles->append($jqueryUiCss);
} else {
	$legacyStyles[] = $jqueryUiCss;
}

// the two shared admin scripts belong to the legacy stack; register them in upstream position
// (after the Jquery modules, before module scripts would be too late: they are already there,
// so insert right after the last Jquery module script)
$legacyShared = array(
	$wireUrl . "templates-admin/scripts/inputfields.$ext?v=$version",
	$wireUrl . "templates-admin/scripts/main.$ext?v=$version",
);
$ordered = array();
foreach($scripts->urls() as $url) {
	$ordered[] = $url;
}
$lastJquery = -1;
foreach($ordered as $i => $url) {
	if($adminTheme->isLegacyScript($url)) $lastJquery = $i;
}
array_splice($ordered, $lastJquery + 1, 0, $legacyShared);

$split = $adminTheme->getScriptUrls($ordered);
$printScripts = $split['print'];
$printScripts[] = $themeUrl . "scripts/main.js?v=" . $themeAssetVersion('scripts/main.js');
// save without reload (ADR 0013; other edit forms since milestone 3.8), never in modal windows
$pageSave = $adminTheme->pageSaveInPlace && $layout !== 'modal' && !$this->wire()->input->get('modal')
	&& $adminTheme->saveInPlaceProcess($this->wire()->process);
// stand-ins for the current Process's scripts on a page without the legacy stack (ADR 0016)
foreach($adminTheme->nativeProcessScripts() as $file) $printScripts[] = $themeUrl . "$file?v=" . $themeAssetVersion($file);
if($pageSave) $printScripts[] = $themeUrl . "scripts/page-save.js?v=" . $themeAssetVersion('scripts/page-save.js');

$bridgeJs = $config->js('AdminThemeBridge');
if(!is_array($bridgeJs)) $bridgeJs = array();
$bridgeJs['legacy'] = $adminTheme->useLegacyStack();
$bridgeJs['legacyScripts'] = $split['deferred'];
$bridgeJs['legacyStyles'] = $legacyStyles;
$bridgeJs['colorScheme'] = $adminTheme->getColorScheme();
$bridgeJs['variant'] = $adminTheme->getVariant();
$bridgeJs['legacyReasons'] = $adminTheme->getLegacyReasons();
$bridgeJs['pageSave'] = $pageSave;
$bridgeJs['runtimeUrl'] = $themeUrl . "assets/dist/runtime.js?v=" . $themeAssetVersion('assets/dist/runtime.js');
$process = $this->wire()->process;
$bridgeJs['process'] = $process instanceof BridgeComponent ? $adminTheme->componentInfo($process) : null;
$config->js('AdminThemeBridge', $bridgeJs);

?>
	<meta http-equiv="content-type" content="text/html; charset=utf-8" />
	<meta name="robots" content="noindex, nofollow" />
	<meta name="google" content="notranslate" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0">

	<title><?php echo $adminTheme->getBrowserTitle(); ?></title>

	<script>
		<?php echo $adminTheme->getHeadJS(); ?>
		// colour scheme before first paint: the user's choice (localStorage) over the setting;
		// auto follows the operating system. scripts/main.js keeps it in sync afterwards.
		(function(d) {
			var s = null;
			try { s = localStorage.getItem('pwScheme'); } catch(e) {}
			if(s !== 'light' && s !== 'dark' && s !== 'auto') s = (ProcessWire.config.AdminThemeBridge || {}).colorScheme || 'auto';
			if(s === 'auto') s = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
			d.setAttribute('data-pw-scheme', s);
		})(document.documentElement);
	</script>
<?php
foreach($styles->urls() as $file) {
	if($adminTheme->isOtherThemeAsset($file)) continue;
	echo "\n\t<link type='text/css' href='$file' rel='stylesheet' />";
}
echo "\n\t<link type='text/css' href='$themeCss' rel='stylesheet' data-pw-theme />";
echo "\n\t<link type='text/css' href='$fieldsCss' rel='stylesheet' data-pw-fields />";
if($adminTheme->maxWidth) {
	echo "\n\t<style data-pw-keep>.pw-container, #notices { max-width:" . (int) $adminTheme->maxWidth . "px; }</style>";
}
foreach($printScripts as $file) {
	if($adminTheme->isOtherThemeAsset($file)) continue;
	echo "\n\t<script type='text/javascript' src='$file'></script>";
}
echo "\n";

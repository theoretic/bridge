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
// the theme's own directory, also when this template is a copy in /site/templates/AdminThemeBridge/
// (AdminThemeFramework::includeFile() looks there first; audit B3)
$themeDir = $adminTheme->path();
$themeAssetVersion = function($file) use($themeVersion, $themeDir) {
	$path = $themeDir . $file;
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
	// core's all.min.css with its fonts split (runtime/scripts/fa-subset.mjs): icons in common use
	// come from small subsets, the rest from the full files, nothing else fetches a font; built for
	// one Font Awesome version, so any other version gets core's stylesheet
	$faCss = "assets/fonts/fa-$iconVersion/fa.css";
	if(is_file($themeDir . $faCss)) {
		$styles->append($themeUrl . "$faCss?v=" . $themeAssetVersion($faCss));
	} else {
		$styles->append($wireUrl . "templates-admin/styles/font-awesome-$iconVersion/css/all.min.css");
	}
	$styles->append($wireUrl . "templates-admin/styles/font-awesome-$iconVersion/css/v4-shims.min.css");
} else {
	$styles->append($wireUrl . "templates-admin/styles/font-awesome/css/font-awesome.min.css?v=$version");
}
// what asks for UIkit (ADR 0017): module UIkit scripts and stylesheets, scripts naming UIkit
$adminTheme->settleUikitAssets();
// assets of other admin themes: AdminThemeBoss (a Uikit add-on) appends its full Uikit build on
// every admin request whatever theme is current; drop anything from another AdminTheme module
foreach(array($styles, $scripts) as $list) {
	foreach($adminTheme->assetUrls($list) as $url) {
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

// the two shared admin scripts belong to the legacy stack. AdminThemeUikit appends them after
// every registered script; Bridge puts them right after the last core script under wire/, so a
// site script registered later still loads after inputfields.js and main.js and a module script
// that core loads early keeps its place (the order conformance/run.php checks: inputfields.js
// before every script outside wire/)
$legacyShared = array(
	$wireUrl . "templates-admin/scripts/inputfields.$ext?v=$version",
	$wireUrl . "templates-admin/scripts/main.$ext?v=$version",
);
$ordered = array();
$sharedPaths = array();
foreach(array('inputfields', 'main') as $name) foreach(array('js', 'min.js') as $e) {
	$sharedPaths[] = $wireUrl . "templates-admin/scripts/$name.$e";
}
foreach($adminTheme->assetUrls($scripts) as $url) {
	// a module that registered either shared script itself does not get it twice (audit B8)
	if(in_array(preg_replace('/[?#].*$/', '', (string) $url), $sharedPaths, true)) continue;
	$ordered[] = $url;
}
$lastJquery = -1;
foreach($ordered as $i => $url) {
	if($adminTheme->isLegacyScript($url)) $lastJquery = $i;
}
array_splice($ordered, $lastJquery + 1, 0, $legacyShared);
// the UIkit layer (ADR 0017), right after the shared scripts and before every module script: the
// stand-in (scripts/uikit-layer.js: window.UIkit until UIkit loads, AdminThemeUikit's scheme
// classes) and, where the page needs it, core's UIkit (a module's own copy counts: no second one)
$useUikit = $adminTheme->useUikit();
$uikitScripts = $adminTheme->uikitScripts($ordered);
$uikitCss = $themeUrl . "assets/dist/uikit.css?v=" . $themeAssetVersion('assets/dist/uikit.css');
$uikitLayer = array($themeUrl . "scripts/uikit-layer.js?v=" . $themeAssetVersion('scripts/uikit-layer.js'));
array_splice($ordered, $lastJquery + 1 + count($legacyShared), 0, $useUikit ? array_merge($uikitLayer, $uikitScripts) : $uikitLayer);

$split = $adminTheme->getScriptUrls($ordered);
$adminTheme->saveScriptVerdicts();
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
// the UIkit layer (ADR 0017): printed, or the URLs the theme script loads it from on demand
$bridgeJs['uikit'] = array(
	'loaded' => $useUikit,
	'mode' => (string) $adminTheme->get('uikit'),
	'reasons' => $adminTheme->getUikitReasons(),
	'css' => $uikitCss,
	'scripts' => $useUikit ? array() : $uikitScripts,
	'covered' => $themeUrl . "assets/dist/uikit-covered.json?v=" . $themeAssetVersion('assets/dist/uikit-covered.json'),
);
// translated labels for the runtime's own dialogs and tables (util/labels.ts)
$bridgeJs['labels'] = $adminTheme->runtimeLabels();
// core's ProcessWire.alert/confirm/prompt (templates-admin/scripts/main.js) take the UIkit route
// whenever window.UIkit exists, the layer's stand-in included, and read AdminThemeUikit's labels
// there without checking for them: without these every dialog throws
$uikitJs = $config->js('AdminThemeUikit');
if(!is_array($uikitJs)) $uikitJs = array();
if(empty($uikitJs['labels'])) {
	$uikitJs['labels'] = array('ok' => $bridgeJs['labels']['ok'], 'cancel' => $bridgeJs['labels']['cancel']);
	$config->js('AdminThemeUikit', $uikitJs);
}
$bridgeJs['runtimeUrl'] = $themeUrl . "assets/dist/runtime.js?v=" . $themeAssetVersion('assets/dist/runtime.js');
$process = $this->wire()->process;
$bridgeJs['process'] = $process instanceof BridgeComponent ? $adminTheme->componentInfo($process) : null;
$config->js('AdminThemeBridge', $bridgeJs);

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

<?php namespace ProcessWire;

/**
 * AdminThemeBridge: the head's asset plan (audit PA1, AR1)
 *
 * Part of the AdminThemeBridge class, split by job into traits; `$this` is the theme. Constants
 * and properties stay in AdminThemeBridge.module.php.
 *
 * assetPlan() is what _head.php prints: an AdminThemeBridgeAssetPlan with every decision made.
 * It is built in steps, each its own method: the stylesheets (headStyles()), the scripts and their
 * order (headScripts()), the client's config (headClientConfig()), then what only the printing
 * needs (preloads, deferred scripts). headPlan() returns the first three as an array, as before
 * 0.21.0, for copies of _head.php in /site/templates/AdminThemeBridge/.
 *
 */
trait AdminThemeBridgeHead {

	/**
	 * Everything the head prints, decided (audit AR1)
	 *
	 * @param string $layout The page layout ('modal' or '')
	 * @return AdminThemeBridgeAssetPlan
	 *
	 */
	public function assetPlan($layout) {
		$head = $this->headPlan($layout);
		$plan = new AdminThemeBridgeAssetPlan();
		$themeDir = $head['themeDir'];
		$themeUrl = $head['themeUrl'];

		// the fonts every screen paints with, fetched alongside the stylesheets instead of after them
		// (same URLs as theme.css and fa.css ask for); the solid subset's name carries a content hash
		// (fa-subset.mjs): from the build's manifest, else read from fa.css, whose @font-face rules
		// come first (audit PP2)
		$fonts = array('assets/fonts/geist-latin-wght-normal.woff2');
		$fontPreloads = $this->manifest('fontPreloads');
		$iconVersion = $head['iconVersion'];
		if(is_array($fontPreloads) && $iconVersion && !empty($fontPreloads[$iconVersion])) {
			$fonts[] = $fontPreloads[$iconVersion];
		} else if(!empty($head['faCss']) && is_file($themeDir . $head['faCss'])) {
			$faHead = (string) file_get_contents($themeDir . $head['faCss'], false, null, 0, 16384);
			if(preg_match('/url\((fa-solid-900-subset(?:\.[0-9a-f]+)?\.woff2)\)/', $faHead, $m)) $fonts[] = dirname($head['faCss']) . '/' . $m[1];
		}
		foreach($fonts as $font) {
			if(is_file($themeDir . $font)) $plan->fontPreloads[] = $themeUrl . $font;
		}

		foreach($this->assetUrls($head['styles']) as $file) {
			if(!$this->isOtherThemeAsset($file)) $plan->styles[] = $file;
		}
		// the UIkit layer is one cascade layer (@layer uikit): every unlayered stylesheet wins over it
		if($head['useUikit']) $plan->uikitCss = $head['uikitCss'];
		$plan->themeCss = $head['themeCss'];
		$plan->fieldsCss = $head['fieldsCss'];
		$plan->maxWidth = (int) $this->getMaxWidth();

		// the runtime module and the chunk it imports statically, fetched while the page parses instead
		// of after main.js imports it at the end of the body (audit B21, C32); same URL as that import()
		$runtimeFile = $themeDir . 'assets/dist/runtime.js';
		if(is_file($runtimeFile)) {
			$plan->modulePreloads[] = $head['bridgeJs']['runtimeUrl'];
			$chunks = $this->manifest('runtimeChunks');
			if(!is_array($chunks)) {
				$chunks = preg_match_all('~from\s*["\']\./(chunks/[\w.-]+\.js)["\']~', (string) file_get_contents($runtimeFile), $m) ? array_unique($m[1]) : array();
			}
			foreach($chunks as $chunk) $plan->modulePreloads[] = "{$themeUrl}assets/dist/$chunk";
		}

		// theme scripts that no inline code calls while the page parses run deferred (in order, before
		// DOMContentLoaded): $deferrableScripts
		foreach($head['printScripts'] as $file) {
			if($this->isOtherThemeAsset($file)) continue;
			$defer = false;
			if(strpos($file, $themeUrl) === 0) $defer = in_array(self::stripQuery(substr($file, strlen($themeUrl))), $this->deferrableScripts, true);
			$plan->scripts[] = array('url' => $file, 'defer' => $defer);
		}
		$plan->client = $head['bridgeJs'];
		return $plan;
	}

	/**
	 * The head's styles, scripts and client config, as an array (before 0.21.0 _head.php extract()ed
	 * it; assetPlan() builds on it)
	 *
	 * Script order mirrors upstream so legacy Inputfield scripts find the same globals: JqueryCore
	 * and JqueryUI (registered by wire/core/admin.php) are already in $config->scripts, then
	 * inputfields.js and main.js from wire/templates-admin, then module scripts, then the theme's
	 * own script. In auto mode without legacy needs, the legacy part is not printed but handed to
	 * the client in ProcessWire.config.AdminThemeBridge.legacyScripts, in order.
	 *
	 * @param string $layout The page layout ('modal' or '')
	 * @return array themeDir, themeUrl, iconVersion, faCss, styles, useUikit, uikitCss, themeCss,
	 *   fieldsCss, printScripts, bridgeJs
	 *
	 */
	public function headPlan($layout) {
		$styles = $this->headStyles();
		// assets of other admin themes: AdminThemeBoss (a Uikit add-on) appends its full Uikit build on
		// every admin request whatever theme is current; drop anything from another AdminTheme module
		$config = $this->wire()->config;
		foreach(array($config->styles, $config->scripts) as $list) {
			foreach($this->assetUrls($list) as $url) {
				if($this->isOtherThemeAsset($url)) {
					$list->remove(self::stripQuery($url));
					$list->remove($url);
				}
			}
		}
		$scripts = $this->headScripts($layout);
		$bridgeJs = $this->headClientConfig($styles['legacyStyles'], $scripts);
		return array(
			'themeDir' => $this->path(),
			'themeUrl' => $this->url(),
			'iconVersion' => $styles['iconVersion'],
			'faCss' => $styles['faCss'],
			'styles' => $config->styles,
			'useUikit' => $scripts['useUikit'],
			'uikitCss' => $scripts['uikitCss'],
			'themeCss' => $this->themeAssetUrl('assets/dist/theme.css'),
			'fieldsCss' => $this->themeAssetUrl('assets/dist/fields.css'),
			'printScripts' => $scripts['print'],
			'bridgeJs' => $bridgeJs,
		);
	}

	/**
	 * A built file of the theme with its cache buster: its modification time, so a new build reaches
	 * browsers at once (the stored module version only changes after a modules refresh). The theme's
	 * own directory, also when the templates are a copy in /site/templates/AdminThemeBridge/
	 * (AdminThemeFramework::includeFile() looks there first; audit B3)
	 *
	 * @param string $file Path relative to the theme's directory
	 * @return string
	 *
	 */
	public function themeAssetUrl($file) {
		$path = $this->path() . $file;
		return $this->url() . $file . '?v=' . (is_file($path) ? (string) filemtime($path) : (string) $this->version);
	}

	/**
	 * Core's and the icons' stylesheets into $config->styles, the UIkit settling, the jQuery UI skin
	 *
	 * @return array iconVersion, faCss (the subset stylesheet's path in the theme, or ''), legacyStyles
	 *   (what loads with a late legacy stack)
	 *
	 */
	protected function headStyles() {
		$config = $this->wire()->config;
		$version = $config->version;
		$wireUrl = $config->urls->wire;
		$styles = $config->styles;
		$adminIcons = $config->adminIcons;
		$iconVersion = empty($adminIcons['version']) ? '' : $adminIcons['version'];
		$faCss = '';
		$styles->prepend($wireUrl . "templates-admin/styles/AdminTheme.css?v=$version");
		if($iconVersion && version_compare($iconVersion, '6.0.0', '>=')) {
			// core's all.min.css with its fonts split (runtime/scripts/fa-subset.mjs): icons in common use
			// come from small subsets, the rest from the full files, nothing else fetches a font; built for
			// one Font Awesome version, so any other version gets core's stylesheet
			$faCss = "assets/fonts/fa-$iconVersion/fa.css";
			if(is_file($this->path() . $faCss)) {
				$styles->append($this->themeAssetUrl($faCss));
			} else {
				$styles->append($wireUrl . "templates-admin/styles/font-awesome-$iconVersion/css/all.min.css");
			}
			$styles->append($wireUrl . "templates-admin/styles/font-awesome-$iconVersion/css/v4-shims.min.css");
		} else {
			$styles->append($wireUrl . "templates-admin/styles/font-awesome/css/font-awesome.min.css?v=$version");
		}
		// what asks for UIkit (ADR 0017): module UIkit scripts and stylesheets, scripts naming UIkit
		$this->settleUikitAssets();
		// the jQuery UI skin belongs to the legacy stack: printed with it, or loaded with it on demand
		$jqueryUiCss = $wireUrl . "templates-admin/styles/JqueryUI/JqueryUI.css?v=$version";
		$legacyStyles = array();
		if($this->useLegacyStack()) {
			$styles->append($jqueryUiCss);
		} else {
			$legacyStyles[] = $jqueryUiCss;
		}
		return array('iconVersion' => $iconVersion, 'faCss' => $faCss, 'legacyStyles' => $legacyStyles);
	}

	/**
	 * The scripts in print order, the ones handed to a late legacy stack, the UIkit layer
	 *
	 * @param string $layout
	 * @return array print, deferred (legacy, loaded on demand), useUikit, uikitScripts, uikitCss,
	 *   pageSave (the in-place save is on)
	 *
	 */
	protected function headScripts($layout) {
		$config = $this->wire()->config;
		$version = $config->version;
		$wireUrl = $config->urls->wire;
		$ext = $config->debug ? "js" : "min.js";
		// the two shared admin scripts belong to the legacy stack. AdminThemeUikit appends them after
		// every registered script; Bridge puts them right after the last core script under wire/, so a
		// site script registered later still loads after inputfields.js and main.js and a module script
		// that core loads early keeps its place (the order conformance/run.php checks: inputfields.js
		// before every script outside wire/)
		$legacyShared = array(
			$wireUrl . "templates-admin/scripts/inputfields.$ext?v=$version",
			$wireUrl . "templates-admin/scripts/main.$ext?v=$version",
		);
		$sharedPaths = array();
		foreach(array('inputfields', 'main') as $name) foreach(array('js', 'min.js') as $e) {
			$sharedPaths[] = $wireUrl . "templates-admin/scripts/$name.$e";
		}
		$ordered = array();
		foreach($this->assetUrls($config->scripts) as $url) {
			// a module that registered either shared script itself does not get it twice (audit B8)
			if(in_array(self::stripQuery((string) $url), $sharedPaths, true)) continue;
			$ordered[] = $url;
		}
		$lastJquery = -1;
		foreach($ordered as $i => $url) {
			if($this->isLegacyScript($url)) $lastJquery = $i;
		}
		array_splice($ordered, $lastJquery + 1, 0, $legacyShared);
		// the UIkit layer (ADR 0017), right after the shared scripts and before every module script: the
		// stand-in (scripts/uikit-layer.js: window.UIkit until UIkit loads, AdminThemeUikit's scheme
		// classes) and, where the page needs it, core's UIkit (a module's own copy counts: no second one)
		$useUikit = $this->useUikit();
		$uikitScripts = $this->uikitScripts($ordered);
		$uikitLayer = array($this->themeAssetUrl('scripts/uikit-layer.js'));
		array_splice($ordered, $lastJquery + 1 + count($legacyShared), 0, $useUikit ? array_merge($uikitLayer, $uikitScripts) : $uikitLayer);

		$split = $this->getScriptUrls($ordered);
		$this->saveScriptVerdicts();
		$print = $split['print'];
		$print[] = $this->themeAssetUrl('scripts/main.js');
		$process = $this->wire()->process;
		// save without reload (ADR 0013; other edit forms since milestone 3.8), never in modal windows
		$pageSave = $this->pageSaveInPlace && $layout !== 'modal' && !$this->wire()->input->get('modal')
			&& $this->saveInPlaceProcess($process);
		// stand-ins for the current Process's scripts on a page without the legacy stack (ADR 0016)
		foreach($this->nativeProcessScripts() as $file) $print[] = $this->themeAssetUrl($file);
		// a save waits for the uploads and other requests to the screen, whatever the in-place
		// setting, modal windows included
		if($this->saveInPlaceProcess($process)) $print[] = $this->themeAssetUrl('scripts/save-wait.js');
		if($pageSave) $print[] = $this->themeAssetUrl('scripts/page-save.js');
		return array(
			'print' => $print,
			'deferred' => $split['deferred'],
			'useUikit' => $useUikit,
			'uikitScripts' => $uikitScripts,
			'uikitCss' => $this->themeAssetUrl('assets/dist/uikit.css'),
			'pageSave' => $pageSave,
		);
	}

	/**
	 * ProcessWire.config.AdminThemeBridge (and the AdminThemeUikit labels core's dialogs read), set
	 * on $config->js
	 *
	 * @param array $legacyStyles
	 * @param array $scripts headScripts()
	 * @return array What was set
	 *
	 */
	protected function headClientConfig(array $legacyStyles, array $scripts) {
		$config = $this->wire()->config;
		$bridgeJs = $config->js('AdminThemeBridge');
		if(!is_array($bridgeJs)) $bridgeJs = array();
		$bridgeJs['legacy'] = $this->useLegacyStack();
		$bridgeJs['legacyScripts'] = $scripts['deferred'];
		$bridgeJs['legacyStyles'] = $legacyStyles;
		$bridgeJs['colorScheme'] = $this->getColorScheme();
		$bridgeJs['variant'] = $this->getVariant();
		// the site's colour, which "Site default" in the user menu goes back to (0.22.0)
		$bridgeJs['site'] = array('variant' => $this->siteVariant(), 'primary' => $this->sitePrimaryColor());
		$bridgeJs['legacyReasons'] = $this->getLegacyReasons();
		$bridgeJs['pageSave'] = $scripts['pageSave'];
		// risky action warnings (ADR 0019); a rename only warns when no path history keeps the old URL
		$bridgeJs['dangerWarn'] = (bool) $this->dangerWarn;
		$bridgeJs['pathHistory'] = $this->wire()->modules->isInstalled('PagePathHistory');
		// the UIkit layer (ADR 0017): printed, or the URLs the theme script loads it from on demand
		$bridgeJs['uikit'] = array(
			'loaded' => $scripts['useUikit'],
			'mode' => (string) $this->get('uikit'),
			'reasons' => $this->getUikitReasons(),
			'css' => $scripts['uikitCss'],
			'scripts' => $scripts['useUikit'] ? array() : $scripts['uikitScripts'],
			'covered' => $this->themeAssetUrl('assets/dist/uikit-covered.json'),
		);
		// translated labels for the runtime's own dialogs and tables (util/labels.ts)
		$bridgeJs['labels'] = $this->sessionLabels();
		// core's ProcessWire.alert/confirm/prompt (templates-admin/scripts/main.js) take the UIkit route
		// whenever window.UIkit exists, the layer's stand-in included, and read AdminThemeUikit's labels
		// there without checking for them: without these every dialog throws
		$uikitJs = $config->js('AdminThemeUikit');
		if(!is_array($uikitJs)) $uikitJs = array();
		if(empty($uikitJs['labels'])) {
			$uikitJs['labels'] = array('ok' => $bridgeJs['labels']['ok'], 'cancel' => $bridgeJs['labels']['cancel']);
			$config->js('AdminThemeUikit', $uikitJs);
		}
		$bridgeJs['runtimeUrl'] = $this->themeAssetUrl('assets/dist/runtime.js');
		$process = $this->wire()->process;
		$bridgeJs['process'] = $process instanceof BridgeComponent ? $this->componentInfo($process) : null;
		$config->js('AdminThemeBridge', $bridgeJs);
		return $bridgeJs;
	}
}

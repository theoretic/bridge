<?php namespace ProcessWire;

/**
 * AdminThemeBridge: the head's asset plan (audit PA1)
 *
 * Part of the AdminThemeBridge class, split by job into traits; `$this` is the theme. _head.php
 * calls headPlan() and only prints what it returns.
 *
 */
trait AdminThemeBridgeHead {

	/**
	 * Decide the head's stylesheets and scripts and the client's config: which assets are printed,
	 * in which order, which wait for the legacy stack, the UIkit layer, the in-place save, and
	 * ProcessWire.config.AdminThemeBridge. Moved from _head.php unchanged in behaviour.
	 *
	 * Script order mirrors upstream so legacy Inputfield scripts find the same globals: JqueryCore
	 * and JqueryUI (registered by wire/core/admin.php) are already in $config->scripts, then
	 * inputfields.js and main.js from wire/templates-admin, then module scripts, then the theme's
	 * own script. In auto mode without legacy needs, the legacy part is not printed but handed to
	 * the client in ProcessWire.config.AdminThemeBridge.legacyScripts, in order.
	 *
	 * @param string $layout The page layout ('modal' or '')
	 * @return array What _head.php prints: themeDir, themeUrl, iconVersion, faCss, styles,
	 *   useUikit, uikitCss, themeCss, fieldsCss, printScripts, bridgeJs
	 *
	 */
	public function headPlan($layout) {
		$config = $this->wire()->config;
		$faCss = '';
		$version = $config->version;
		$themeVersion = $this->version;
		// cache busting for the theme's own built files: their modification time, so a new build reaches
		// browsers at once (the stored module version only changes after a modules refresh)
		// the theme's own directory, also when this template is a copy in /site/templates/AdminThemeBridge/
		// (AdminThemeFramework::includeFile() looks there first; audit B3)
		$themeDir = $this->path();
		$themeAssetVersion = function($file) use($themeVersion, $themeDir) {
			$path = $themeDir . $file;
			return is_file($path) ? (string) filemtime($path) : (string) $themeVersion;
		};
		$wireUrl = $config->urls->wire;
		$themeUrl = $this->url();
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
		$this->settleUikitAssets();
		// assets of other admin themes: AdminThemeBoss (a Uikit add-on) appends its full Uikit build on
		// every admin request whatever theme is current; drop anything from another AdminTheme module
		foreach(array($styles, $scripts) as $list) {
			foreach($this->assetUrls($list) as $url) {
				if($this->isOtherThemeAsset($url)) {
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
		if($this->useLegacyStack()) {
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
		foreach($this->assetUrls($scripts) as $url) {
			// a module that registered either shared script itself does not get it twice (audit B8)
			if(in_array(preg_replace('/[?#].*$/', '', (string) $url), $sharedPaths, true)) continue;
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
		$uikitCss = $themeUrl . "assets/dist/uikit.css?v=" . $themeAssetVersion('assets/dist/uikit.css');
		$uikitLayer = array($themeUrl . "scripts/uikit-layer.js?v=" . $themeAssetVersion('scripts/uikit-layer.js'));
		array_splice($ordered, $lastJquery + 1 + count($legacyShared), 0, $useUikit ? array_merge($uikitLayer, $uikitScripts) : $uikitLayer);

		$split = $this->getScriptUrls($ordered);
		$this->saveScriptVerdicts();
		$printScripts = $split['print'];
		$printScripts[] = $themeUrl . "scripts/main.js?v=" . $themeAssetVersion('scripts/main.js');
		// save without reload (ADR 0013; other edit forms since milestone 3.8), never in modal windows
		$pageSave = $this->pageSaveInPlace && $layout !== 'modal' && !$this->wire()->input->get('modal')
			&& $this->saveInPlaceProcess($this->wire()->process);
		// stand-ins for the current Process's scripts on a page without the legacy stack (ADR 0016)
		foreach($this->nativeProcessScripts() as $file) $printScripts[] = $themeUrl . "$file?v=" . $themeAssetVersion($file);
		// a save waits for the uploads and other requests to the screen, whatever the in-place
		// setting, modal windows included
		if($this->saveInPlaceProcess($this->wire()->process)) $printScripts[] = $themeUrl . "scripts/save-wait.js?v=" . $themeAssetVersion('scripts/save-wait.js');
		if($pageSave) $printScripts[] = $themeUrl . "scripts/page-save.js?v=" . $themeAssetVersion('scripts/page-save.js');

		$bridgeJs = $config->js('AdminThemeBridge');
		if(!is_array($bridgeJs)) $bridgeJs = array();
		$bridgeJs['legacy'] = $this->useLegacyStack();
		$bridgeJs['legacyScripts'] = $split['deferred'];
		$bridgeJs['legacyStyles'] = $legacyStyles;
		$bridgeJs['colorScheme'] = $this->getColorScheme();
		$bridgeJs['variant'] = $this->getVariant();
		$bridgeJs['legacyReasons'] = $this->getLegacyReasons();
		$bridgeJs['pageSave'] = $pageSave;
		// the UIkit layer (ADR 0017): printed, or the URLs the theme script loads it from on demand
		$bridgeJs['uikit'] = array(
			'loaded' => $useUikit,
			'mode' => (string) $this->get('uikit'),
			'reasons' => $this->getUikitReasons(),
			'css' => $uikitCss,
			'scripts' => $useUikit ? array() : $uikitScripts,
			'covered' => $themeUrl . "assets/dist/uikit-covered.json?v=" . $themeAssetVersion('assets/dist/uikit-covered.json'),
		);
		// translated labels for the runtime's own dialogs and tables (util/labels.ts)
		$bridgeJs['labels'] = $this->runtimeLabels();
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
		$bridgeJs['process'] = $process instanceof BridgeComponent ? $this->componentInfo($process) : null;
		$config->js('AdminThemeBridge', $bridgeJs);

		return array(
			'themeDir' => $themeDir,
			'themeUrl' => $themeUrl,
			'iconVersion' => $iconVersion,
			'faCss' => $faCss,
			'styles' => $styles,
			'useUikit' => $useUikit,
			'uikitCss' => $uikitCss,
			'themeCss' => $themeCss,
			'fieldsCss' => $fieldsCss,
			'printScripts' => $printScripts,
			'bridgeJs' => $bridgeJs,
		);
	}
}

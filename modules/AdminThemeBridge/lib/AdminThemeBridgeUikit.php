<?php namespace ProcessWire;

/**
 * AdminThemeBridge: The UIkit layer (ADR 0017): what needs UIkit, its assets and verdicts
 *
 * Part of the AdminThemeBridge class, split by job into traits (audit PA1); `$this` is the theme.
 * Constants and properties stay in AdminThemeBridge.module.php.
 *
 */
trait AdminThemeBridgeUikit {

	/**
	 * Is this the UIkit script (uikit.js, uikit-icons.js, minified or not), from anywhere?
	 *
	 * @param string $url
	 * @return bool
	 *
	 */
	public static function isUikitScript($url) {
		return (bool) preg_match('~/uikit(?:-icons)?(?:\.min)?\.js(?:[?#]|$)~i', (string) $url);
	}

	/**
	 * Is this a stock UIkit stylesheet (uikit.css, uikit-rtl.css, minified or not)?
	 *
	 * @param string $url
	 * @return bool
	 *
	 */
	public static function isUikitStyle($url) {
		return (bool) preg_match('~/uikit(?:-rtl)?(?:\.min)?\.css(?:[?#]|$)~i', (string) $url);
	}

	/**
	 * Ask for the UIkit layer on this request (ADR 0017): UIkit's script and the theme's UIkit
	 * stylesheet. For modules written for AdminThemeUikit: `if(method_exists($adminTheme,
	 * 'needUikit')) $adminTheme->needUikit('MyModule');` before the page is rendered.
	 *
	 * @param string $reason 'Module:Name', or as the theme records them: 'Markup:uk-grid',
	 * 'Script:path', 'Asset:url'
	 *
	 */
	public function needUikit($reason) {
		$reason = (string) $reason;
		if(strpos($reason, ':') === false) $reason = "Module:$reason";
		if(!isset($this->uikitReasons[$reason])) $this->uikitReasons[$reason] = 0;
		$this->uikitReasons[$reason]++;
	}

	/**
	 * The uk-* classes the theme's own compat rules style (95-uikit-compat.css, listed by the
	 * build in assets/dist/uikit-covered.json): markup that uses only these needs no layer
	 *
	 * @return array class => true
	 *
	 */
	public function getUikitCovered() {
		if($this->uikitCovered === null) $this->uikitCovered = $this->uikitCoveredList('classes');
		return $this->uikitCovered;
	}

	/**
	 * The uk-icon names the theme's own compat rules draw with a Font Awesome glyph
	 * (95-uikit-compat.css, listed by the build in assets/dist/uikit-covered.json)
	 *
	 * @return array name => true
	 *
	 */
	public function getUikitIcons() {
		if($this->uikitIcons === null) $this->uikitIcons = $this->uikitCoveredList('icons');
		return $this->uikitIcons;
	}

	/**
	 * One list of the build's covered UIkit names, from the manifest or uikit-covered.json
	 *
	 * @param string $key 'classes' or 'icons'
	 * @return array name => true
	 *
	 */
	protected function uikitCoveredList($key) {
		$list = $this->manifest($key === 'icons' ? 'uikitIcons' : 'uikitCovered');
		if(!is_array($list)) {
			$file = $this->path() . 'assets/dist/uikit-covered.json';
			$data = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
			// before 0.26.0 the file was the flat class list
			if(is_array($data) && isset($data[0])) $data = array('classes' => $data);
			$list = is_array($data) && isset($data[$key]) ? $data[$key] : null;
		}
		return is_array($list) ? array_fill_keys($list, true) : array();
	}

	/**
	 * Does the compat file draw this uk-icon value? The forms its rules match: "NAME",
	 * "icon: NAME", "icon: NAME; ..." and "NAME; ..." (UIkit's own parser is more lenient: any
	 * other spelling is drawn by UIkit only, so it stays a reason)
	 *
	 * @param string|null $value The uk-icon or data-uk-icon attribute's value
	 * @return bool
	 *
	 */
	public function isUikitIconCovered($value) {
		if(!is_string($value) || !preg_match('~^(?:icon: )?([\w-]+)(?:;|$)~', $value, $m)) return false;
		$icons = $this->getUikitIcons();
		return isset($icons[$m[1]]);
	}

	/**
	 * Record what in this markup needs the UIkit layer: a UIkit attribute (uk-grid,
	 * data-uk-modal: UIkit's JS components; not uk-tooltip, not a uk-icon getUikitIcons() has)
	 * or a uk-* class that getUikitCovered() lacks
	 *
	 * @param string $html
	 *
	 */
	public function scanUikitMarkup($html) {
		if(!is_string($html) || stripos($html, 'uk-') === false) return;
		if(!preg_match_all('~<[a-z][a-z0-9-]*\s[^>]*uk-[^>]*>~i', $html, $tags)) return;
		$covered = $this->getUikitCovered();
		foreach($tags[0] as $tag) {
			// attribute names, with the attribute values out of the way
			$bare = preg_replace('~=\s*(?:"[^"]*"|\'[^\']*\'|[^\s>]+)~', '', $tag);
			if(preg_match_all('~\s((?:data-)?uk-[a-z][a-z0-9-]*)(?=[\s/>])~i', $bare, $m)) {
				foreach($m[1] as $attr) {
					$attr = strtolower($attr);
					$name = strpos($attr, 'data-') === 0 ? substr($attr, 5) : $attr;
					// a tooltip is no reason: the theme script gives it the browser's own (its text
					// as the title; core's module list: data-uk-tooltip on elements with a title,
					// Fluency's translate icons)
					if($name === 'uk-tooltip') continue;
					// nor an icon the compat rules draw (PageTableNext's rows: uk-icon="icon:
					// chevron-right; ratio: 1"); the theme script copies data-uk-icon to uk-icon
					if($name === 'uk-icon' && $this->isUikitIconCovered($this->tagAttribute($tag, $attr))) continue;
					$this->needUikit("Markup:$name");
				}
			}
			if(!preg_match('~\sclass\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))~i', $tag, $c)) continue;
			$classes = implode(' ', array_slice($c, 1));
			if(!preg_match_all('~(?<![\w-])uk-[\w@-]+~', $classes, $m)) continue;
			foreach($m[0] as $class) {
				if(!isset($covered[$class])) $this->needUikit("Markup:$class");
			}
		}
	}

	/**
	 * One attribute's value in an HTML start tag, as written (no entity decoding)
	 *
	 * @param string $tag
	 * @param string $name Lowercase attribute name
	 * @return string|null Null when the tag has no such attribute, '' for a bare one
	 *
	 */
	protected function tagAttribute($tag, $name) {
		// attribute by attribute, so a name inside another attribute's value never matches
		if(!preg_match_all('~\s([^\s"\'=/>]+)(?:\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s"\'>]+)))?~', $tag, $a, PREG_SET_ORDER)) return null;
		foreach($a as $attr) {
			if(strtolower($attr[1]) === $name) return implode('', array_slice($attr, 2));
		}
		return null;
	}

	/**
	 * Scripts and stylesheets that ask for UIkit (ADR 0017), once the page is rendered: a UIkit
	 * script a module added (kept: Bridge then adds no second copy), a stock UIkit stylesheet a
	 * module added (removed: the layer takes its place), and site module scripts that name the
	 * UIkit global (isUikitUser()) and are printed on this request: one deferred with the legacy
	 * stack (RockMigrations' admin-wide jQuery script) is no reason, since it does not run here,
	 * and where a late stack runs it the stand-in loads UIkit on its first call. Called by
	 * _head.php before anything is printed.
	 *
	 */
	public function settleUikitAssets() {
		$config = $this->wire()->config;
		foreach($this->assetUrls($config->styles) as $url) {
			$url = (string) $url;
			if(!self::isUikitStyle($url)) continue;
			// another admin theme's full build (AdminThemeBoss, on every page) is not a request
			if(!$this->isOtherThemeAsset($url)) $this->needUikit('Asset:' . $this->siteRelative($url));
			$config->styles->remove(preg_replace('/\?.*$/', '', $url));
			$config->styles->remove($url);
		}
		foreach($this->assetUrls($config->scripts) as $url) {
			$url = (string) $url;
			if(self::isUikitScript($url)) {
				$this->needUikit('Asset:' . $this->siteRelative($url));
			} else if($this->isUikitUser($url) && ($this->useLegacyStack() || !$this->isDeferredScript($url))) {
				$this->needUikit('Script:' . $this->siteRelative($url));
			}
		}
		$this->saveUikitVerdicts();
	}

	/**
	 * A URL's path below the site root, without query (for reasons)
	 *
	 * @param string $url
	 * @return string
	 *
	 */
	protected function siteRelative($url) {
		$path = self::stripQuery($url);
		$root = $this->wire()->config->urls->root;
		return strpos($path, $root) === 0 ? substr($path, strlen($root)) : $path;
	}

	/**
	 * Is this a site or third-party module script that names the UIkit global?
	 *
	 * Decided from the file's content, as isJqueryScript() does for jQuery: local root-relative
	 * .js URLs outside wire/ and this theme, comments out. A script that checks for UIkit first
	 * (`typeof UIkit`, `window.UIkit`) works without it (and finds the stand-in, which loads UIkit
	 * on first use). Verdicts are kept per file and modification time in WireCache.
	 *
	 * @param string $url
	 * @return bool
	 *
	 */
	public function isUikitUser($url) {
		$path = self::localScriptPath($url);
		if($path === '' || strpos($path, $this->url()) === 0 || strpos($path, $this->wire()->config->urls->wire) === 0) return false;
		return $this->scriptVerdict($path, 'uikit');
	}

	/**
	 * Does this script source name the UIkit global? (isUikitUser())
	 *
	 * @param string $js
	 * @return bool
	 *
	 */
	public static function needsUikit($js) {
		$js = self::stripJsComments($js);
		// a pattern that failed: assume it does (the layer loads, nothing breaks; audit BG1)
		if($js === null) return true;
		$checks = preg_match('/\bwindow\.UIkit\b|\btypeof\s+(window\.)?UIkit\b|[\'"]UIkit[\'"]\s+in\s+window/', $js);
		if($checks === false) return true;
		if($checks) return false;
		return preg_match('/\bUIkit\b/', $js) !== 0;
	}

	/**
	 * Keep new isUikitUser() verdicts (the newest per file)
	 *
	 */
	protected function saveUikitVerdicts() {
		if(!$this->uikitVerdictsChanged || !is_array($this->uikitVerdicts)) return;
		$this->uikitVerdictsChanged = false;
		$this->wire()->cache->save(self::uikitVerdictsCache, $this->pruneVerdicts($this->uikitVerdicts), WireCache::expireNever);
	}

	/**
	 * The reasons for the UIkit layer on this request: hook after to add or remove some, e.g.
	 * `$wire->addHookAfter('AdminThemeBridge::uikitReasons', function($e) { $r = $e->return;
	 * unset($r['Markup:uk-margin-large-top']); $e->return = $r; });`
	 *
	 * @param array $reasons reason => count
	 * @return array
	 *
	 */
	public function ___uikitReasons(array $reasons) {
		return $reasons;
	}

	/**
	 * Does this request print the UIkit layer? Decided once, when the head asks: the setting
	 * (`uikit`: auto, always, never) and in auto mode the reasons after uikitReasons()
	 *
	 * @return bool
	 *
	 */
	public function useUikit() {
		if($this->uikitDecided !== null) return $this->uikitDecided;
		$mode = $this->get('uikit');
		if($mode === self::uikitNever) return $this->uikitDecided = false;
		$reasons = $this->uikitReasons($this->uikitReasons);
		$this->uikitReasons = is_array($reasons) ? $reasons : array();
		if($mode === self::uikitAlways) return $this->uikitDecided = true;
		return $this->uikitDecided = count($this->uikitReasons) > 0;
	}

	/**
	 * Reasons recorded for the UIkit layer (after uikitReasons() once useUikit() ran)
	 *
	 * @return array
	 *
	 */
	public function getUikitReasons() {
		return $this->uikitReasons;
	}

	/**
	 * Core's UIkit scripts (AdminThemeUikit's directory; Bridge ships no copy), minus those a
	 * module already added (its own copy counts)
	 *
	 * @param array $present script URLs already on the page
	 * @return array
	 *
	 */
	public function uikitScripts(array $present = array()) {
		$config = $this->wire()->config;
		$have = array('uikit' => false, 'uikit-icons' => false);
		foreach($present as $url) {
			if(preg_match('~/(uikit(?:-icons)?)(?:\.min)?\.js(?:[?#]|$)~i', (string) $url, $m)) $have[strtolower($m[1])] = true;
		}
		$dir = 'modules/AdminTheme/AdminThemeUikit/uikit/dist/js/';
		$out = array();
		foreach($have as $name => $there) {
			if($there || !is_file($config->paths->wire . "$dir$name.min.js")) continue;
			$out[] = $config->urls->wire . "$dir$name.min.js?v=" . $config->version;
		}
		return $out;
	}

	/**
	 * UIkit version of core's script (AdminThemeUikit's directory), '' when there is none
	 *
	 * @return string
	 *
	 */
	public function coreUikitVersion() {
		$file = $this->wire()->config->paths->wire . 'modules/AdminTheme/AdminThemeUikit/uikit/dist/js/uikit.min.js';
		if(!is_file($file)) return '';
		$head = (string) file_get_contents($file, false, null, 0, 200);
		return preg_match('/UIkit (\d+\.\d+\.\d+)/', $head, $m) ? $m[1] : '';
	}
}

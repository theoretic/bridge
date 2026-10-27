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
		if($this->uikitCovered === null) {
			$list = $this->manifest('uikitCovered');
			if(!is_array($list)) {
				$file = $this->path() . 'assets/dist/uikit-covered.json';
				$list = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
			}
			$this->uikitCovered = is_array($list) ? array_fill_keys($list, true) : array();
		}
		return $this->uikitCovered;
	}

	/**
	 * Record what in this markup needs the UIkit layer: a UIkit attribute (uk-grid,
	 * data-uk-modal: UIkit's JS components; not uk-tooltip) or a uk-* class that
	 * getUikitCovered() lacks
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
			if(preg_match_all('~\s(?:data-)?(uk-[a-z][a-z0-9-]*)(?=[\s/>])~i', $bare, $m)) {
				foreach($m[1] as $name) {
					$name = strtolower($name);
					// a tooltip is no reason: the theme script gives it the browser's own (its text
					// as the title; core's module list: data-uk-tooltip on elements with a title,
					// Fluency's translate icons)
					if($name === 'uk-tooltip') continue;
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
	 * Scripts and stylesheets that ask for UIkit (ADR 0017), once the page is rendered: a UIkit
	 * script a module added (kept: Bridge then adds no second copy), a stock UIkit stylesheet a
	 * module added (removed: the layer takes its place), and site module scripts that name the
	 * UIkit global (isUikitUser()). Called by _head.php before anything is printed.
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
			} else if($this->isUikitUser($url)) {
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
		$path = preg_replace('/[?#].*$/', '', (string) $url);
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
		$config = $this->wire()->config;
		$path = preg_replace('/[?#].*$/', '', (string) $url);
		if(strpos($path, '/') !== 0 || strpos($path, '//') === 0 || substr($path, -3) !== '.js') return false;
		if(strpos($path, $this->url()) === 0 || strpos($path, $config->urls->wire) === 0) return false;
		$file = $this->urlToFile($path);
		if($file === '') return false;
		$key = $file . '|' . filemtime($file) . '|' . filesize($file);
		if($this->uikitVerdicts === null) $this->loadVerdicts();
		if(!isset($this->uikitVerdicts[$key])) {
			$this->uikitVerdicts[$key] = self::needsUikit((string) file_get_contents($file, false, null, 0, 512 * 1024));
			$this->uikitVerdictsChanged = true;
		}
		return (bool) $this->uikitVerdicts[$key];
	}

	/**
	 * Does this script source name the UIkit global? (isUikitUser())
	 *
	 * @param string $js
	 * @return bool
	 *
	 */
	public static function needsUikit($js) {
		$js = preg_replace('~/\*.*?\*/~s', '', $js);
		$js = (string) preg_replace('~(^|[^:\'"\\\\])//[^\n]*~m', '$1', (string) $js);
		if(preg_match('/\bwindow\.UIkit\b|\btypeof\s+(window\.)?UIkit\b|[\'"]UIkit[\'"]\s+in\s+window/', $js)) return false;
		return (bool) preg_match('/\bUIkit\b/', $js);
	}

	/**
	 * Keep new isUikitUser() verdicts (the newest per file)
	 *
	 */
	protected function saveUikitVerdicts() {
		if(!$this->uikitVerdictsChanged || !is_array($this->uikitVerdicts)) return;
		$this->uikitVerdictsChanged = false;
		$byFile = array();
		foreach($this->uikitVerdicts as $key => $verdict) {
			$byFile[substr($key, 0, strrpos($key, '|'))] = array($key, $verdict);
		}
		$keep = array();
		foreach($byFile as $entry) $keep[$entry[0]] = $entry[1];
		$this->wire()->cache->save(self::uikitVerdictsCache, $keep, WireCache::expireNever);
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
		if($mode === self::legacyAlways) return $this->uikitDecided = true;
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

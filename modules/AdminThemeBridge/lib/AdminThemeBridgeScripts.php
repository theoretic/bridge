<?php namespace ProcessWire;

/**
 * AdminThemeBridge: Script classification: legacy, jQuery and UIkit verdicts, URLs to files, asset lists
 *
 * Part of the AdminThemeBridge class, split by job into traits (audit PA1); `$this` is the theme.
 * Constants and properties stay in AdminThemeBridge.module.php.
 *
 */
trait AdminThemeBridgeScripts {

	/**
	 * Is a file under a directory? Also through a link (`__FILE__` and backtraces give the
	 * resolved path, $config->paths the linked one: local sites have wire/ as a junction), and
	 * without regard to case on Windows.
	 *
	 * @param string $file
	 * @param string $dir
	 * @return bool
	 *
	 */
	public function isUnder($file, $dir) {
		if($file === '' || $dir === '') return false;
		$norm = function($path) {
			$path = rtrim(str_replace('\\', '/', $path), '/') . '/';
			return DIRECTORY_SEPARATOR === '\\' ? strtolower($path) : $path;
		};
		$file = $norm($file);
		$real = realpath($dir);
		foreach(array_unique(array($dir, $real === false ? $dir : $real)) as $d) {
			if(strpos($file, $norm($d)) === 0) return true;
		}
		return false;
	}

	/**
	 * Is this script URL part of the legacy stack?
	 *
	 * Every script under wire/: the Jquery* modules, the two shared admin scripts, and every core
	 * module script (all written against jQuery; some, like LanguageSupport's LanguageTabs.js,
	 * are added on every admin page by hooks). Scripts outside wire/ (site modules, components)
	 * are printed as they are: on a legacy page the stack precedes them in order; on a native
	 * page, by construction, only components added scripts.
	 *
	 * @param string $url
	 * @return bool
	 *
	 */
	public function isLegacyScript($url) {
		// core's UIkit (AdminThemeUikit's directory) needs no jQuery: the UIkit layer prints it
		if(self::isUikitScript($url)) return false;
		$config = $this->wire()->config;
		$wireUrl = $config->urls->wire;
		// a module that builds `root . 'wire/...'` points at the same core (tools/router.php serves it)
		if(strpos($url, $wireUrl) !== 0) $wireUrl = $config->urls->root . 'wire/';
		if(strpos($url, $wireUrl) !== 0) return false;
		$rel = substr($url, strlen($wireUrl));
		return strpos($rel, 'modules/') === 0 || strpos($rel, 'templates-admin/scripts/') === 0;
	}

	/**
	 * Is this a site or third-party module script written against jQuery? (milestone 3.2)
	 *
	 * Such a script, printed on a page without the legacy stack, throws ("$ is not defined"):
	 * RockMigrations adds one to every admin page. It is deferred with the stack instead, and runs
	 * when (if) the stack loads, as core module scripts do. Decided from the file's content (a
	 * jQuery call or the $ alias), for local root-relative .js URLs only; the theme's own scripts
	 * never count. Comments do not count ("No jQuery."), and a script that checks for jQuery
	 * (`window.jQuery`, `typeof jQuery`) works without it and is printed (audit A3). URLs that
	 * contain one of the lines of the printScripts setting are always printed, and so are the
	 * scriptNeeds() scripts on a page without the stack (getScriptUrls()). Verdicts are kept per
	 * file and modification time in one WireCache entry (A14).
	 *
	 * @param string $url
	 * @return bool
	 *
	 */
	public function isJqueryScript($url) {
		$path = self::localScriptPath($url);
		if($path === '' || strpos($path, $this->url()) === 0) return false;
		foreach($this->printScriptsList() as $needle) if(strpos($path, $needle) !== false) return false;
		return $this->scriptVerdict($path, 'jquery');
	}

	/**
	 * A URL without its query string and fragment (audit AR2)
	 *
	 * @param string $url
	 * @return string
	 *
	 */
	public static function stripQuery($url) {
		return (string) preg_replace('/[?#].*$/', '', (string) $url);
	}

	/**
	 * The path of a local root-relative .js URL, '' for anything else (isJqueryScript(), isUikitUser())
	 *
	 * @param string $url
	 * @return string
	 *
	 */
	public static function localScriptPath($url) {
		$path = self::stripQuery($url);
		return strpos($path, '/') !== 0 || strpos($path, '//') === 0 || substr($path, -3) !== '.js' ? '' : $path;
	}

	/**
	 * Does the script at this local path need jQuery ('jquery', needsJquery()) or name UIkit
	 * ('uikit', needsUikit())? One path for both (audit AR2): the file's source, comments out, the
	 * verdict kept per file, modification time and size in WireCache (A14)
	 *
	 * @param string $path localScriptPath()
	 * @param string $kind 'jquery' or 'uikit'
	 * @return bool
	 *
	 */
	protected function scriptVerdict($path, $kind) {
		$file = $this->urlToFile($path);
		if($file === '') return false;
		$key = $file . '|' . filemtime($file) . '|' . filesize($file);
		if($this->jqueryVerdicts === null || $this->uikitVerdicts === null) $this->loadVerdicts();
		$jquery = $kind === 'jquery';
		$known = $jquery ? $this->jqueryVerdicts : $this->uikitVerdicts;
		if(isset($known[$key])) return (bool) $known[$key];
		$source = (string) file_get_contents($file, false, null, 0, 512 * 1024);
		$verdict = $jquery ? self::needsJquery($source) : self::needsUikit($source);
		// a pattern that failed (backtrack limit) answers "needs it" for this request only: a
		// verdict kept forever must come from a complete scan (audit BG1)
		if(preg_last_error() !== PREG_NO_ERROR) return $verdict;
		if($jquery) {
			$this->jqueryVerdicts[$key] = $verdict;
			$this->jqueryVerdictsChanged = true;
		} else {
			$this->uikitVerdicts[$key] = $verdict;
			$this->uikitVerdictsChanged = true;
		}
		return $verdict;
	}

	/**
	 * $list->urls(), once per content of the list (audit PP1): core's versionUrls() reads the
	 * file time of each asset in some modes, and the theme asks for the script list about eight
	 * times per request
	 *
	 * @param FilenameArray $list
	 * @return array
	 *
	 */
	public function assetUrls(FilenameArray $list) {
		$raw = '';
		foreach($list as $file) $raw .= "
" . $file;
		$key = spl_object_id($list) . ':' . md5($raw);
		if(!isset($this->urlsMemo[$key])) $this->urlsMemo[$key] = $list->urls();
		return $this->urlsMemo[$key];
	}

	/**
	 * The file a local root-relative URL serves, or '' (audit B6)
	 *
	 * Through the most specific of $config->urls / $config->paths that the URL starts with, not as
	 * root + path: a layout from bootstrap/ may serve site modules, templates or assets from
	 * elsewhere than under the root (Bootstrap.php `urls`), and a module may build `root . 'wire/'`
	 * URLs for a core that lives in vendor/.
	 *
	 * @param string $url
	 * @return string
	 *
	 */
	public function urlToFile($url) {
		$config = $this->wire()->config;
		$path = rawurldecode((string) self::stripQuery($url));
		if(strpos($path, '/') !== 0 || strpos($path, '//') === 0 || strpos($path, '..') !== false) return '';
		if(isset($this->urlFiles[$path])) return $this->urlFiles[$path];
		// the URL/path pairs once per request, longest first (audit PF1: rebuilt and sorted per call)
		if($this->urlPairs === null) {
			$pairs = array();
			foreach(array('siteModules', 'modules', 'adminTemplates', 'templates', 'assets', 'site', 'wire', 'root') as $key) {
				$u = (string) $config->urls->get($key);
				$p = (string) $config->paths->get($key);
				if($u !== '' && $p !== '' && strpos($u, '/') === 0) $pairs[$u] = $p;
			}
			$alias = $config->urls->root . 'wire/';
			if(!isset($pairs[$alias])) $pairs[$alias] = $config->paths->wire;
			uksort($pairs, function($a, $b) { return strlen($b) - strlen($a); });
			$this->urlPairs = $pairs;
		}
		return $this->urlFiles[$path] = $this->urlFileFor($path);
	}

	/**
	 * urlToFile() for a clean path, without the memo
	 *
	 * @param string $path
	 * @return string
	 *
	 */
	protected function urlFileFor($path) {
		foreach($this->urlPairs as $u => $p) {
			if(strpos($path, $u) !== 0) continue;
			$file = $p . substr($path, strlen($u));
			if(is_file($file)) return $file;
		}
		return '';
	}

	/**
	 * Both verdict caches (jQuery, UIkit) in one WireCache query, not one each (audit PP3)
	 *
	 */
	protected function loadVerdicts() {
		$both = $this->wire()->cache->get(array(self::jqueryVerdictsCache, self::uikitVerdictsCache));
		if(!is_array($both)) $both = array();
		if($this->jqueryVerdicts === null) $this->jqueryVerdicts = (array) ($both[self::jqueryVerdictsCache] ?? array());
		if($this->uikitVerdicts === null) $this->uikitVerdicts = (array) ($both[self::uikitVerdictsCache] ?? array());
	}

	/**
	 * Does this script source call jQuery? (isJqueryScript())
	 *
	 * @param string $js
	 * @return bool
	 *
	 */
	public static function needsJquery($js) {
		$js = self::stripJsComments($js);
		// a pattern that failed: assume it does (the stack loads, nothing breaks); preg_last_error()
		// tells isJqueryScript() not to keep the verdict (audit BG1)
		if($js === null) return true;
		// a script that asks whether jQuery is there runs without it
		$checks = preg_match('/\bwindow\.jQuery\b|\btypeof\s+(window\.)?jQuery\b|[\'"]jQuery[\'"]\s+in\s+window/', $js);
		if($checks === false) return true;
		if($checks) return false;
		return preg_match('/\bjQuery\b|(?<![\w$])\$\s*\(|(?<![\w$])\$\.\w/', $js) !== 0;
	}

	/**
	 * A script source without its comments (a // inside a string such as 'http://' is left alone:
	 * a : or quote before it), for needsJquery() and needsUikit()
	 *
	 * @param string $js
	 * @return string|null Null when a pattern failed (preg_last_error() says why)
	 *
	 */
	public static function stripJsComments($js) {
		$js = preg_replace('~/\*.*?\*/~s', '', (string) $js);
		if($js === null) return null;
		return preg_replace('~(^|[^:\'"\\\\])//[^\n]*~m', '$1', $js);
	}

	/**
	 * The printScripts setting as a list (one URL part per line)
	 *
	 * @return array
	 *
	 */
	protected function printScriptsList() {
		if($this->printScriptsList === null) $this->printScriptsList = array_values(array_filter(array_map('trim', preg_split('/\r?\n/', (string) $this->get('printScripts')))));
		return $this->printScriptsList;
	}

	/**
	 * Keep new isJqueryScript() verdicts for later requests (called once the head is printed)
	 *
	 */
	public function saveScriptVerdicts() {
		if(!$this->jqueryVerdictsChanged || !is_array($this->jqueryVerdicts)) return;
		$this->jqueryVerdictsChanged = false;
		$this->wire()->cache->save(self::jqueryVerdictsCache, $this->pruneVerdicts($this->jqueryVerdicts), WireCache::expireNever);
	}

	/**
	 * Verdicts worth keeping (audit B13): the newest per file, and none for a file that is gone.
	 * Keys are `file|mtime|size`; the file is everything before the first `|`.
	 *
	 * @param array $verdicts key => bool
	 * @return array
	 *
	 */
	protected function pruneVerdicts(array $verdicts) {
		$byFile = array();
		foreach($verdicts as $key => $verdict) {
			$file = substr($key, 0, (int) strpos($key, '|'));
			$byFile[$file] = array($key, $verdict); // later entries are newer
		}
		$keep = array();
		foreach($byFile as $file => $entry) {
			if($file !== '' && is_file($file)) $keep[$entry[0]] = $entry[1];
		}
		return $keep;
	}
}

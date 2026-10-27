<?php namespace ProcessWire;

/**
 * Bridge bootstrap: builds a ProcessWire Config from an explicit folder layout.
 *
 * Stands in for ProcessWire::buildConfig() when wire/, site/ or assets/ are not where the
 * upstream bootstrap expects them. It follows the same steps as the upstream method
 * (wire/core/ProcessWire.php, checked against 3.0.274) so the resulting Config is
 * indistinguishable to the core; only the source of the paths differs.
 *
 * Original work, MIT (see LICENSE at the repository root).
 *
 * Layout keys (all paths absolute, forward slashes, trailing slash optional):
 *
 *  - root         Directory that holds index.php and is served as the web root. Required.
 *  - wire         The upstream wire/ directory. Default {root}/wire/
 *  - site         The site directory holding config.php. Default {root}/site/
 *  - assets       Default {site}/assets/
 *  - templates    Default {site}/templates/
 *  - siteModules  Default {site}/modules/
 *  - classes      Default {site}/classes/
 *  - sessions     Default {assets}/sessions/
 *  - urls         Array of URL overrides keyed like $config->urls, for any path that is not
 *                 under root (served from elsewhere) or that is aliased by the web server.
 *  - rootURL      As the $rootURL argument of ProcessWire::buildConfig(): null to detect,
 *                 '/sub/' for a subdirectory, 'https://host/sub/' to force scheme and host.
 *
 * Known limits against upstream 3.0.274 (see docs/upstream/):
 *  - Extra module directories cannot be registered here: ProcessWire::load() calls
 *    Modules::addPath() and Modules::init() back to back with no hook between them.
 *  - Paths outside the web root have no URL unless `urls` names one; the core will still
 *    try to serve wire/ assets (admin scripts, module JS) from $config->urls->wire.
 *  - Upstream's htaccess.txt names site/ and wire/: write the layout's .htaccess with
 *    tools/bootstrap-htaccess.php, which points its rules at the real directories.
 *  - Upstream's index.config.php (several sites on one installation) is not read: one layout
 *    file is one site.
 */
class BridgeBootstrap {

	const version = '0.1.0';

	/**
	 * Build the Config for the given layout.
	 *
	 * @param array $layout
	 * @return Config
	 * @throws \RuntimeException
	 *
	 */
	public static function buildConfig(array $layout) {

		$rootPath = rtrim(self::dir($layout['root'] ?? ''), '/');
		if(!$rootPath || !is_dir($rootPath)) {
			throw new \RuntimeException('Bridge bootstrap: layout[root] must be an existing directory');
		}

		$wirePath = self::dir($layout['wire'] ?? "$rootPath/wire/");
		$sitePath = self::dir($layout['site'] ?? "$rootPath/site/");
		$assetsPath = self::dir($layout['assets'] ?? "{$sitePath}assets/");
		$templatesPath = self::dir($layout['templates'] ?? "{$sitePath}templates/");
		$siteModulesPath = self::dir($layout['siteModules'] ?? "{$sitePath}modules/");
		$classesPath = self::dir($layout['classes'] ?? "{$sitePath}classes/");
		$sessionsPath = self::dir($layout['sessions'] ?? "{$assetsPath}sessions/");

		if(!is_file("{$wirePath}core/ProcessWire.php")) {
			throw new \RuntimeException("Bridge bootstrap: no ProcessWire core at {$wirePath}core/");
		}
		if(!is_file("{$sitePath}config.php")) {
			throw new \RuntimeException("Bridge bootstrap: no config.php in site directory $sitePath");
		}
		if(!class_exists("\\ProcessWire\\ProcessWire", false)) {
			require_once("{$wirePath}core/ProcessWire.php");
		}

		$paths = array(
			'wire' => $wirePath,
			'site' => $sitePath,
			'modules' => "{$wirePath}modules/",
			'siteModules' => $siteModulesPath,
			'core' => "{$wirePath}core/",
			'assets' => $assetsPath,
			'cache' => "{$assetsPath}cache/",
			'backups' => "{$assetsPath}backups/",
			'logs' => "{$assetsPath}logs/",
			'files' => "{$assetsPath}files/",
			'tmp' => "{$assetsPath}tmp/",
			'templates' => $templatesPath,
			'fieldTemplates' => "{$templatesPath}fields/",
			'adminTemplates' => "{$wirePath}templates-admin/",
			'markupRegions' => "{$assetsPath}markup-regions/",
		);

		// --- root URL, host and scheme: same rules as upstream -------------------------------

		$rootURL = $layout['rootURL'] ?? null;
		$httpHost = '';
		$scheme = '';
		$cfg = array('dbName' => '');

		if($rootURL && strpos($rootURL, '://')) {
			list($scheme, $httpHost) = explode('://', $rootURL);
			if(strpos($httpHost, '/')) {
				list($httpHost, $rootURL) = explode('/', $httpHost, 2);
				$rootURL = "/$rootURL";
			} else {
				$rootURL = '/';
			}
			$scheme = strtolower($scheme);
			$httpHost = strtolower($httpHost);
		}

		$_rootURL = $rootURL;
		if(is_null($rootURL)) $rootURL = '/';

		if(isset($_SERVER['HTTP_HOST'])) {
			if(is_null($_rootURL)) $rootURL = rtrim(dirname($_SERVER['SCRIPT_NAME']), "/\\") . '/';
			$realScriptFile = empty($_SERVER['SCRIPT_FILENAME']) ? '' : realpath($_SERVER['SCRIPT_FILENAME']);
			$realIndexFile = realpath($rootPath . "/index.php");
			$sf = empty($realScriptFile) ? '' : dirname($realScriptFile);
			$f = dirname($realIndexFile);
			if($sf && $sf != $f && strpos($sf, $f) === 0) {
				$x = rtrim(substr($sf, strlen($f)), '/');
				if(is_null($_rootURL)) $rootURL = substr($rootURL, 0, strlen($rootURL) - strlen($x));
			}
			$cfg['internal'] = strtolower((string) $realIndexFile) == strtolower((string) $realScriptFile);
		} else {
			$cfg['internal'] = false;
		}

		// --- URLs: relative to root where the path is under root, overridable otherwise ------

		$urls = array();
		$warnings = array();
		$urlOverrides = isset($layout['urls']) && is_array($layout['urls']) ? $layout['urls'] : array();
		foreach($paths as $key => $path) {
			if(isset($urlOverrides[$key])) {
				$urls[$key] = $urlOverrides[$key];
			} else if(self::under($path, $rootPath . '/')) {
				$urls[$key] = substr($path, strlen($rootPath) + 1);
			} else {
				// no URL can serve this path; keep the upstream-shaped relative name so that
				// string operations on $config->urls->$key still behave, and record the gap
				$urls[$key] = basename($path) . '/';
				$warnings[$key] = $path;
			}
		}

		$cfg['urls'] = new Paths($rootURL);
		$cfg['urls']->data($urls, true);

		$cfg['paths'] = new Paths($rootPath . '/');
		$cfg['paths']->data($paths, true);
		$cfg['paths']->data('sessions', $sessionsPath);
		$cfg['paths']->data('classes', $classesPath);

		$cfg['styles'] = new FilenameArray();
		$cfg['scripts'] = new FilenameArray();

		$config = new Config();
		$config->setTrackChanges(false);
		$config->data($cfg, true);

		/** @noinspection PhpIncludeInspection */
		require("{$wirePath}config.php");

		$configFile = $sitePath . "config.php";
		$configFileDev = $sitePath . "config-dev.php";
		if(is_file($configFileDev)) {
			/** @noinspection PhpIncludeInspection */
			@require($configFileDev);
		} else if(is_file($configFile)) {
			/** @noinspection PhpIncludeInspection */
			@require($configFile);
		}

		if($httpHost) {
			$config->httpHost = $httpHost;
			if(!in_array($httpHost, $config->httpHosts)) $config->httpHosts[] = $httpHost;
		}
		if($scheme) $config->https = ($scheme === 'https');

		$config->bridgeLayout = $layout;
		$config->bridgeLayoutWarnings = $warnings;

		return $config;
	}

	/**
	 * Is a path under a directory (both normalised by dir())?
	 *
	 * @param string $path
	 * @param string $dir
	 * @return bool
	 *
	 */
	public static function under($path, $dir) {
		// Windows paths differ in case only (d:/site vs D:/site) and are the same directory (B14)
		if(DIRECTORY_SEPARATOR === '\\') return stripos($path, $dir) === 0;
		return strpos($path, $dir) === 0;
	}

	/**
	 * Normalise a directory path: forward slashes, one trailing slash.
	 *
	 * @param string $path
	 * @return string Empty string when $path is empty
	 *
	 */
	public static function dir($path) {
		$path = trim((string) $path);
		if($path === '') return '';
		if(DIRECTORY_SEPARATOR != '/') $path = str_replace(DIRECTORY_SEPARATOR, '/', $path);
		return rtrim($path, '/') . '/';
	}
}

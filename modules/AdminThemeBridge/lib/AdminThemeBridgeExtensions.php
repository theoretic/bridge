<?php namespace ProcessWire;

/**
 * AdminThemeBridge: Extensions (BridgeExtension, docs/extensions.md, 0.27.0)
 *
 * Discovery of the modules that declare a manifest, the normalised manifest, the published
 * surface they may use, and the extension contract's version ranges.
 *
 * Part of the AdminThemeBridge class, split by job into traits (audit PA1); `$this` is the theme.
 * Constants and properties stay in AdminThemeBridge.module.php.
 *
 */
trait AdminThemeBridgeExtensions {

	/**
	 * Installed modules that declare a Bridge extension manifest, normalised (extensionInfo())
	 *
	 * Candidates come from the module info cache, no module loaded: those whose `requires` names
	 * AdminThemeBridge and those with a `bridge` info key. Of those, a module whose class
	 * implements BridgeExtension is asked for its manifest (on an instance that may not have run
	 * init(); one already loaded is used as it is), the others give their `bridge` info key.
	 * A module that throws is logged (bridge-extensions) and left out. Once per request.
	 *
	 * @return array name => manifest, by priority, then name
	 *
	 */
	public function extensions() {
		if($this->extensionsList !== null) return $this->extensionsList;
		$this->extensionsList = array();
		$modules = $this->wire()->modules;
		$found = array();
		foreach($modules->info->getModuleInfoAll() as $info) {
			$name = isset($info['name']) ? (string) $info['name'] : '';
			if($name === '' || $name === 'AdminThemeBridge') continue;
			$requires = isset($info['requiresVersions']) ? array_keys((array) $info['requiresVersions']) : (array) ($info['requires'] ?? array());
			$declared = !empty($info['bridge']) && is_array($info['bridge']);
			if(!$declared && !in_array('AdminThemeBridge', $requires, true)) continue;
			try {
				$manifest = $this->extensionManifest($name, $declared ? $info['bridge'] : null);
				if($manifest === null) continue;
				$found[$name] = $this->extensionInfo($name, $manifest);
			} catch(\Throwable $e) {
				$this->extensionError($name, $e);
			}
		}
		uasort($found, function($a, $b) {
			return $a['priority'] === $b['priority'] ? strcmp($a['class'], $b['class']) : $a['priority'] - $b['priority'];
		});
		foreach($found as $info) $this->extensionsList[$info['name']] = $info;
		return $this->extensionsList;
	}

	/**
	 * The raw manifest of a module: getBridgeExtension() when its class implements the
	 * interface, otherwise the given `bridge` info key
	 *
	 * @param string $name Module class name
	 * @param array|null $declared Its `bridge` module info key, if any
	 * @return array|null Null when the module is no extension
	 *
	 */
	protected function extensionManifest($name, $declared = null) {
		$modules = $this->wire()->modules;
		$class = $modules->getModuleClass($name, true);
		if(!$class || !class_exists($class, false)) {
			$modules->includeModule($name);
			$class = $modules->getModuleClass($name, true);
		}
		if($class && class_exists($class) && is_subclass_of($class, __NAMESPACE__ . '\\BridgeExtension')) {
			// noCache: an instance made here, without init(), is not kept for the real use
			$module = $modules->getModule($name, array('noInit' => true, 'noCache' => true, 'noPermissionCheck' => true, 'noInstall' => true, 'noThrow' => true));
			if($module instanceof BridgeExtension) {
				$manifest = $module->getBridgeExtension();
				return is_array($manifest) ? $manifest : array();
			}
		}
		return $declared;
	}

	/**
	 * Normalised manifest of an extension
	 *
	 * `module` is resolved as componentInfo() resolves a component's: absolute URLs and
	 * root-relative paths are kept, anything else is relative to the module's own directory,
	 * with `?v=<module version>` (in dev mode `?v=<file time>`: extensionDevVersion()). Keys the
	 * contract does not know are kept apart in `unknown`
	 * (the contract tests fail on them; the theme ignores them).
	 *
	 * @param string $name Module class name
	 * @param array $manifest As the module gave it
	 * @return array Keys: name, class, contract, compatible, module, slots, hooks, reads, settings,
	 *  permission, priority, unknown
	 *
	 */
	public function extensionInfo($name, array $manifest) {
		$known = array('name', 'contract', 'module', 'slots', 'hooks', 'reads', 'settings', 'permission', 'priority');
		$list = function($value) {
			$out = array();
			foreach((array) $value as $item) {
				if(is_string($item) && $item !== '') $out[] = $item;
			}
			return array_values(array_unique($out));
		};
		$slots = array();
		foreach((array) ($manifest['slots'] ?? array()) as $slot => $method) {
			if(is_string($slot) && is_string($method) && $method !== '') $slots[$slot] = $method;
		}
		$contract = isset($manifest['contract']) && is_string($manifest['contract']) ? trim($manifest['contract']) : '';
		$url = isset($manifest['module']) && is_string($manifest['module']) ? $manifest['module'] : '';
		if($url !== '' && strpos($url, '/') !== 0 && strpos($url, '://') === false) {
			$url = (string) $this->wire()->config->urls($name) . $url;
		}
		$dev = $url !== '' && strpos($url, '?') === false ? $this->extensionDevVersion($url) : '';
		if($dev !== '') {
			$url .= '?v=' . $dev;
		} else if($url !== '' && strpos($url, '?') === false) {
			$version = (string) $this->wire()->modules->getModuleInfoProperty($name, 'version');
			if($version !== '') $url .= '?v=' . rawurlencode($version);
		}
		return array(
			'name' => isset($manifest['name']) && is_string($manifest['name']) && $manifest['name'] !== '' ? $manifest['name'] : $name,
			'class' => $name,
			'contract' => $contract,
			'compatible' => $contract !== '' && self::contractSatisfies($contract, self::extensionContract),
			'module' => $url,
			'slots' => $slots,
			'hooks' => $list($manifest['hooks'] ?? array()),
			'reads' => $list($manifest['reads'] ?? array()),
			'settings' => $list($manifest['settings'] ?? array()),
			'permission' => isset($manifest['permission']) && is_string($manifest['permission']) ? $manifest['permission'] : '',
			'priority' => isset($manifest['priority']) && is_numeric($manifest['priority']) ? (int) $manifest['priority'] : 100,
			'unknown' => array_values(array_diff(array_keys($manifest), $known)),
		);
	}

	/**
	 * Dev mode: the `?v=` of a client module's URL while extensions are being developed
	 *
	 * With the setting `extensionDev` on (Features > Extension development) and a superuser signed
	 * in, a module URL under the site modules gets its file's modification time instead of the
	 * module version, so an edited `.mjs` is fetched fresh on the next page load without a cache
	 * clear or a version bump (docs/extensions.md 9). Never for core modules or other URLs.
	 *
	 * @param string $url Module URL without a query
	 * @return string The file time (10 digits), or '' when dev mode does not apply
	 *
	 */
	protected function extensionDevVersion($url) {
		if(!$this->get('extensionDev')) return '';
		$user = $this->wire()->user;
		if(!$user || !$user->isSuperuser()) return '';
		$config = $this->wire()->config;
		$base = (string) $config->urls->siteModules;
		if($base === '' || strpos($url, $base) !== 0) return '';
		if(!array_key_exists($url, $this->extensionDevTimes)) {
			$rel = substr($url, strlen($base));
			$file = $config->paths->siteModules . $rel;
			$this->extensionDevTimes[$url] = $rel !== '' && strpos($rel, '..') === false && is_file($file) ? (string) filemtime($file) : '';
		}
		return $this->extensionDevTimes[$url];
	}

	/**
	 * May the current user have this extension? (its `permission`, if any; superusers always)
	 *
	 * @param array $info extensionInfo()
	 * @return bool
	 *
	 */
	public function extensionAllowed(array $info) {
		if($info['permission'] === '') return true;
		return $this->wire()->user->hasPermission($info['permission']);
	}

	/**
	 * ProcessWire.config.AdminThemeBridge.extensions (init.php): the manifests the client loads
	 *
	 * Signed-in users only (as `version`), and only the extensions the user may have.
	 *
	 * @return array List of ['name', 'module', 'contract', 'compatible', 'priority']
	 *
	 */
	public function extensionsClientConfig() {
		$out = array();
		if(!$this->wire()->user->isLoggedin()) return $out;
		foreach($this->extensions() as $info) {
			if(!$this->extensionAllowed($info)) continue;
			$out[] = array(
				'name' => $info['name'],
				'module' => $info['module'],
				'contract' => $info['contract'],
				'compatible' => $info['compatible'],
				'priority' => $info['priority'],
			);
		}
		return $out;
	}

	/**
	 * Log an extension's failure (site/assets/logs/bridge-extensions.txt); the admin goes on
	 *
	 * @param string $name
	 * @param \Throwable|string $e
	 *
	 */
	protected function extensionError($name, $e) {
		$text = $e instanceof \Throwable ? get_class($e) . ': ' . $e->getMessage() : (string) $e;
		$this->wire()->log->save('bridge-extensions', "$name: $text");
	}

	/**
	 * The shell slots of contract 0.1 (docs/extensions.md 4): name => the element that wraps each
	 * extension's part ('' = none: `head` takes head markup as it is, `drawer` gets a dialog of
	 * its own, renderDrawers())
	 *
	 * @return array
	 *
	 */
	public function slotTags() {
		return array(
			'head' => '',
			'masthead' => 'div',
			'masthead-right' => 'div',
			'user-nav' => 'li',
			'content-head-buttons' => 'div',
			'footer' => 'div',
			'drawer' => '',
			'body' => 'div',
		);
	}

	/**
	 * The parts extensions give a slot on this request, by priority: extension name => output
	 *
	 * Signed-in users only, the extensions they may have (extensionAllowed()) and whose contract
	 * range takes this theme's; in a modal window only `head` and `body`. Each declaring extension's
	 * module is got (and inited) and its slot method called with the slot name. Output that is not a
	 * string (for `drawer`: nor an array) is left out; a method that is missing or throws is logged
	 * (bridge-extensions) and left out. Asked once per slot and request.
	 *
	 * @param string $name Slot name (slotTags())
	 * @return array
	 *
	 */
	public function slotParts($name) {
		$name = (string) $name;
		if(isset($this->slotPartsCache[$name])) return $this->slotPartsCache[$name];
		$parts = array();
		$tags = $this->slotTags();
		$modal = $this->isModal || $this->wire()->input->get('modal');
		if(array_key_exists($name, $tags) && $this->isLoggedIn && (!$modal || $name === 'head' || $name === 'body')) {
			foreach($this->extensions() as $info) {
				if(!isset($info['slots'][$name]) || !$info['compatible'] || !$this->extensionAllowed($info)) continue;
				$method = $info['slots'][$name];
				try {
					$module = $this->extensionModule($info['class']);
					if(!$module) continue;
					if(!method_exists($module, $method) && !method_exists($module, "___$method")) {
						$this->extensionError($info['name'], "slot $name: no method $method()");
						continue;
					}
					$out = $module->$method($name);
				} catch(\Throwable $e) {
					$this->extensionError($info['name'], $e);
					continue;
				}
				if(is_string($out) || ($name === 'drawer' && is_array($out))) {
					$parts[$info['name']] = $out;
				} else if($out !== null) {
					$this->extensionError($info['name'], "slot $name: $method() returned " . gettype($out));
				}
			}
		}
		$this->slotPartsCache[$name] = $parts;
		return $parts;
	}

	/**
	 * A slot's markup: each extension's part in its own element, data-bridge-slot and
	 * data-bridge-extension on it; '' when nothing fills the slot (no empty wrappers)
	 *
	 * The parts are printed as the extensions give them: an extension escapes its own output.
	 * Not for `drawer` (renderDrawers() prints extension drawers).
	 *
	 * @param string $name Slot name (slotTags())
	 * @return string
	 *
	 */
	public function renderSlot($name) {
		$tags = $this->slotTags();
		if(!isset($tags[$name]) || $name === 'drawer') return '';
		$sanitizer = $this->wire()->sanitizer;
		$tag = $tags[$name];
		$out = '';
		foreach($this->slotParts($name) as $extension => $part) {
			if(trim($part) === '') continue;
			$out .= $tag === '' ? $part :
				"<$tag data-bridge-slot='" . $sanitizer->entities($name) . "' data-bridge-extension='" . $sanitizer->entities($extension) . "'>$part</$tag>";
		}
		return $out;
	}

	/**
	 * Drawers extensions fill (the `drawer` slot), by priority: drawer name ('ext-' and the
	 * extension's name in lower case) => ['extension', 'label', 'icon', 'content']
	 *
	 * The slot method returns the drawer's body markup, or an array with `content` and optionally
	 * `label` (default: the extension's name) and `icon` (a Font Awesome name, default puzzle-piece).
	 * An empty body gives no drawer.
	 *
	 * @return array
	 *
	 */
	public function extensionDrawers() {
		$out = array();
		foreach($this->slotParts('drawer') as $extension => $part) {
			$part = is_array($part) ? $part : array('content' => $part);
			$content = isset($part['content']) && is_string($part['content']) ? $part['content'] : '';
			if(trim($content) === '') continue;
			$key = 'ext-' . trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($extension)), '-');
			if($key === 'ext-' || isset($out[$key])) continue;
			$label = isset($part['label']) && is_string($part['label']) && $part['label'] !== '' ? $part['label'] : $extension;
			$icon = isset($part['icon']) && is_string($part['icon']) && preg_match('/^[a-z0-9-]+$/', $part['icon']) ? $part['icon'] : 'puzzle-piece';
			$out[$key] = array('extension' => $extension, 'label' => $label, 'icon' => $icon, 'content' => $content);
		}
		return $out;
	}

	/**
	 * An extension's module instance for its slot methods (got once per request; null when the
	 * module cannot be had)
	 *
	 * @param string $class
	 * @return Module|null
	 *
	 */
	protected function extensionModule($class) {
		if(!array_key_exists($class, $this->extensionModules)) {
			$module = $this->wire()->modules->get($class);
			$this->extensionModules[$class] = is_object($module) ? $module : false;
		}
		return $this->extensionModules[$class] ?: null;
	}

	/**
	 * The published surface of the extension contract (docs/extensions.md 3)
	 *
	 * What an extension may use and nothing else: the theme's hookable methods (without `___`),
	 * its public non-hookable methods (`reads`), its settings, the shell slots, the client
	 * events and the `window.Bridge` keys. The contract tests and the compatibility checker
	 * compare manifests with it. Hookable: a later theme or an extension may add to it.
	 *
	 * @return array Keys: contract, hooks, reads, settings, slots, events, runtime
	 *
	 */
	public function ___extensionSurface() {
		return array(
			'contract' => self::extensionContract,
			// every ___ method the class declares (smoke compares by reflection)
			'hooks' => array(
				'install', 'uninstall', 'nonce', 'moveFiles', 'moveFileAllowed', 'filesMoved', 'historyEntry',
				'nativeMap', 'isNativeProcess', 'isNativeInputfield', 'scriptNeeds', 'renderBreadcrumbs',
				'sortableDataTable', 'uikitReasons', 'extensionSurface', 'drawerNames', 'navCacheKey',
			),
			'reads' => array(
				'useLegacyStack', 'componentInfo', 'extensions', 'extensionInfo', 'extensionAllowed', 'cspNonce', 'nonceAttr',
				'nonceScriptTag', 'themeAssetUrl', 'getVariant', 'getColorScheme', 'shellLabel', 'getHistorySteps',
			),
			// the keys __construct() sets (smoke compares with the source)
			'settings' => array(
				'legacyStack', 'uikit', 'maxWidth', 'variant', 'primaryColor', 'colorScheme', 'logoURL', 'logoURLDark',
				'extendedBreadcrumbs', 'pageTreeDrawer', 'history', 'historySteps', 'pageSaveInPlace', 'pageAddSkipTemplate',
				'dangerWarn', 'userColors', 'dataTableSortRows', 'printScripts', 'nativeOverrides', 'extensionDev',
			),
			// the shell slots (slotTags())
			'slots' => array_keys($this->slotTags()),
			'events' => array(
				'pw-runtime-ready', 'pw-legacy-loaded', 'pw-legacy-handover', 'pw-uikit-loaded', 'pw-component-loaded',
				'pw-component-failed', 'pw-modal-opened', 'pw-modal-closed', 'pw-wiretabs-change', 'pw-tab-focus',
				'pw-drawer-open', 'pw-drawer-close', 'pw-page-save', 'pw-page-saved', 'pw-form-save', 'pw-form-saved',
				'pw-files-moved', 'pw-extension-loaded', 'pw-extensions-ready', 'opened', 'closed', 'reloaded', 'showIf',
				'changed',
			),
			'runtime' => array(
				'contract', 'version', 'Inputfields', 'components', 'dialog', 'legacy', 'tables', 'pageTree', 'sortable',
				'confirm', 'guard', 'extensions',
			),
		);
	}

	/**
	 * Does a version satisfy a contract range?
	 *
	 * Ranges: `*`, an exact version, `^x.y` (same major; for major 0 the same minor), `~x.y` (same
	 * minor), comparisons `>= > <= < =`, several separated by spaces (all must hold) and
	 * alternatives separated by `||`. Versions are 1 to 3 numbers; missing parts are 0.
	 *
	 * @param string $range
	 * @param string $version
	 * @return bool False also for a range that cannot be read (contractRangeValid())
	 *
	 */
	public static function contractSatisfies($range, $version) {
		$v = self::contractVersion($version);
		if($v === null) return false;
		foreach(explode('||', (string) $range) as $alt) {
			$parts = preg_split('/\s+/', trim($alt), -1, PREG_SPLIT_NO_EMPTY);
			if(!count($parts)) return false;
			$ok = true;
			foreach($parts as $part) {
				$test = self::contractTest($part, $v);
				if($test === null) return false;
				if(!$test) $ok = false;
			}
			if($ok) return true;
		}
		return false;
	}

	/**
	 * Can contractSatisfies() read this range?
	 *
	 * @param string $range
	 * @return bool
	 *
	 */
	public static function contractRangeValid($range) {
		if(!is_string($range) || trim($range) === '') return false;
		foreach(explode('||', $range) as $alt) {
			$parts = preg_split('/\s+/', trim($alt), -1, PREG_SPLIT_NO_EMPTY);
			if(!count($parts)) return false;
			foreach($parts as $part) {
				if(self::contractTest($part, array(0, 0, 0)) === null) return false;
			}
		}
		return true;
	}

	/**
	 * A version as three integers, or null
	 *
	 * @param string $version
	 * @return array|null
	 *
	 */
	protected static function contractVersion($version) {
		if(!preg_match('/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/', trim((string) $version), $m)) return null;
		return array((int) $m[1], (int) ($m[2] ?? 0), (int) ($m[3] ?? 0));
	}

	/**
	 * One comparator of a range against a version
	 *
	 * @param string $part
	 * @param array $v contractVersion()
	 * @return bool|null Null when the comparator cannot be read
	 *
	 */
	protected static function contractTest($part, array $v) {
		if($part === '*') return true;
		if(!preg_match('/^(\^|~|>=|<=|>|<|=)?(.+)$/', $part, $m)) return null;
		$op = $m[1];
		$r = self::contractVersion($m[2]);
		if($r === null) return null;
		$cmp = $v <=> $r;
		switch($op) {
			case '^':
				if($cmp < 0) return false;
				return $r[0] > 0 ? $v[0] === $r[0] : ($v[0] === 0 && $v[1] === $r[1]);
			case '~':
				return $cmp >= 0 && $v[0] === $r[0] && $v[1] === $r[1];
			case '>=': return $cmp >= 0;
			case '<=': return $cmp <= 0;
			case '>': return $cmp > 0;
			case '<': return $cmp < 0;
			default: return $cmp === 0;
		}
	}
}

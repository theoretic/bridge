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
	 * with `?v=<module version>`. Keys the contract does not know are kept apart in `unknown`
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
		if($url !== '' && strpos($url, '?') === false) {
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
	 * @param \Throwable $e
	 *
	 */
	protected function extensionError($name, \Throwable $e) {
		$this->wire()->log->save('bridge-extensions', "$name: " . get_class($e) . ': ' . $e->getMessage());
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
				'sortableDataTable', 'uikitReasons', 'extensionSurface',
			),
			'reads' => array(
				'useLegacyStack', 'componentInfo', 'extensions', 'extensionInfo', 'extensionAllowed', 'cspNonce', 'nonceAttr',
				'nonceScriptTag', 'themeAssetUrl', 'getVariant', 'getColorScheme', 'shellLabel', 'getHistorySteps',
			),
			// the keys __construct() sets (smoke compares with the source)
			'settings' => array(
				'legacyStack', 'uikit', 'maxWidth', 'variant', 'primaryColor', 'colorScheme', 'logoURL', 'logoURLDark',
				'extendedBreadcrumbs', 'pageTreeDrawer', 'history', 'historySteps', 'pageSaveInPlace', 'pageAddSkipTemplate',
				'dangerWarn', 'userColors', 'dataTableSortRows', 'printScripts', 'nativeOverrides',
			),
			// none yet: the shell slots come with step 2 of the extension kit
			'slots' => array(),
			'events' => array(
				'pw-runtime-ready', 'pw-legacy-loaded', 'pw-legacy-handover', 'pw-uikit-loaded', 'pw-component-loaded',
				'pw-component-failed', 'pw-modal-opened', 'pw-modal-closed', 'pw-wiretabs-change', 'pw-tab-focus',
				'pw-drawer-open', 'pw-drawer-close', 'pw-page-save', 'pw-page-saved', 'pw-form-save', 'pw-form-saved',
				'pw-files-moved', 'opened', 'closed', 'reloaded', 'showIf', 'changed',
			),
			'runtime' => array(
				'contract', 'version', 'Inputfields', 'components', 'dialog', 'legacy', 'tables', 'pageTree', 'sortable',
				'confirm', 'guard',
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

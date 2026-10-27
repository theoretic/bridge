<?php namespace ProcessWire;

/**
 * AdminThemeBridge: Install health: the module info cache repair, AdminThemeBoss, the build manifest
 *
 * Part of the AdminThemeBridge class, split by job into traits (audit PA1); `$this` is the theme.
 * Constants and properties stay in AdminThemeBridge.module.php.
 *
 */
trait AdminThemeBridgeHealth {

	/**
	 * A value from the build's manifest (assets/dist/manifest.php, runtime/scripts/manifest.mjs):
	 * runtimeChunks, fontPreloads, uikitCovered. Null when there is no manifest, or when it is older
	 * than runtime.js (a `vite build` alone): callers then read the built files (audit PP2).
	 *
	 * @param string $key
	 * @return mixed
	 *
	 */
	public function manifest($key) {
		if($this->manifestData === null) {
			$dist = $this->path() . 'assets/dist/';
			$file = $dist . 'manifest.php';
			$data = null;
			if(is_file($file) && (!is_file($dist . 'runtime.js') || filemtime($file) >= filemtime($dist . 'runtime.js'))) {
				$data = include($file);
			}
			$this->manifestData = is_array($data) ? $data : array();
		}
		return $this->manifestData[$key] ?? null;
	}

	/**
	 * Is the module info cache missing this theme's conditional autoload?
	 *
	 * The loader reads 'template=admin' from the module info cache, not from the class; with no
	 * entry it takes autoload=true (ModulesLoader.php:570, 3.0.274) and inits the theme at boot,
	 * before the page is known. That happens when the cache rebuild that ends an install never ran
	 * to the end (atis.pro 2026-10-17: a site module ran out of memory there), and
	 * Modules::refresh() does not repair it: it skips the rebuild while no module file changed.
	 *
	 * @return bool
	 *
	 */
	public function moduleCacheIsStale() {
		$modules = $this->wire()->modules;
		$name = $this->className();
		if(!$modules->getModuleID($name)) return false;
		return !is_string($modules->info->moduleInfoCache($name, 'autoload'));
	}

	/**
	 * Rebuild the module info cache and flags, as Modules > Refresh does after a module file changed
	 *
	 * @return bool True if a rebuild ran
	 *
	 */
	public function repairModuleCache() {
		if(!$this->moduleCacheIsStale()) return false;
		$cache = $this->wire()->cache;
		$database = $this->wire()->database;
		// one rebuild at a time: two superuser requests at once would both run it
		$lock = $database->quote(self::repairFlag);
		try {
			$got = (int) $database->query("SELECT GET_LOCK($lock, 0)")->fetchColumn();
		} catch(\Throwable $e) {
			$got = 1; // no named locks on this server: the try counter still bounds the rebuilds
		}
		if(!$got) return false;
		try {
			// counted before the rebuild: a rebuild that dies (a module running out of memory in it,
			// not catchable) must not run again on the next request, nor forever
			$state = $this->repairState();
			$cache->save(self::repairFlag, array('time' => time(), 'attempts' => $state['attempts'] + 1), 86400 * 30);
			$modules = $this->wire()->modules;
			// refresh() compares this snapshot of module file times first and returns when it matches;
			// an empty one forces the rebuild, as refresh() itself does (deleteCache() leaves the
			// modules table row in place)
			$modules->saveCache('moduleFileSnapshot', array());
			$modules->refresh();
			if(!$this->moduleCacheIsStale()) $cache->delete(self::repairFlag);
		} finally {
			try { $database->query("SELECT RELEASE_LOCK($lock)"); } catch(\Throwable $e) { /* released with the connection */ }
		}
		return true;
	}

	/**
	 * State of the module info cache rebuild: time of the last try and number of tries
	 *
	 * @return array ['time' => int, 'attempts' => int]
	 *
	 */
	public function repairState() {
		$state = $this->wire()->cache->get(self::repairFlag);
		// 0.9.8 and earlier saved the time alone
		if(is_numeric($state)) $state = array('time' => (int) $state, 'attempts' => 1);
		if(!is_array($state)) $state = array();
		return array('time' => (int) ($state['time'] ?? 0), 'attempts' => (int) ($state['attempts'] ?? 0));
	}

	/**
	 * Does AdminThemeBoss force Uikit on every user ("activate for all users")?
	 *
	 * AdminThemeBoss::init() then calls $user->setAndSave('admin_theme', 'AdminThemeUikit') for
	 * any user with another theme, on every request: no user can keep this theme, and the save
	 * runs at boot, before any template file, so site hooks on Pages::saved run without whatever
	 * the site's prepend file sets up (testfly.me 2026-10-18: 'Class "SiteIndex" not found').
	 *
	 * @return bool
	 *
	 */
	public function bossForcesUikit() {
		if($this->bossForces !== null) return $this->bossForces;
		$modules = $this->wire()->modules;
		if(!$modules->isInstalled('AdminThemeBoss')) return $this->bossForces = false;
		// a setting never saved is Boss's default, and both default to on
		// (AdminThemeBossConfig::getDefaults(): enablemodule, allusers => true)
		$boss = (array) $modules->getConfig('AdminThemeBoss');
		$on = function($key) use($boss) { return !array_key_exists($key, $boss) || !empty($boss[$key]); };
		return $this->bossForces = $on('enablemodule') && $on('allusers');
	}

	public function ready() {
		if(!$this->loadedAtBoot || !$this->moduleCacheIsStale()) return;
		// the stale state is harmless (init() sits the request out); a rebuild on every request of a
		// site, front end included, is not: rebuild only for a superuser in the admin, at most once
		// per interval, and say so once per interval otherwise
		$cache = $this->wire()->cache;
		if(!$this->canRepairModuleCache()) {
			$user = $this->wire()->user;
			$page = $this->wire()->page;
			if($this->repairState()['attempts'] >= self::repairAttempts && $user && $user->isSuperuser() && $page && $page->template && $page->template->name === 'admin') {
				$this->warning(sprintf(__('AdminThemeBridge: rebuilding the module info cache failed %d times. Open Modules > Refresh; if the theme still loads on every page, see the Bridge install notes.', __FILE__), self::repairAttempts));
			}
			if(!$cache->get(self::repairFlag . '.noted')) {
				$cache->save(self::repairFlag . '.noted', time(), self::repairInterval);
				$this->log('Loaded at boot: module info cache is stale; a superuser opening the admin rebuilds it (or Modules > Refresh)');
			}
			return;
		}
		try {
			if($this->repairModuleCache()) $this->log('Loaded at boot: module info cache was stale, rebuilt it');
		} catch(\Throwable $e) {
			$this->log('Loaded at boot: rebuilding the module info cache failed: ' . $e->getMessage());
		}
	}

	/**
	 * May this request rebuild the module info cache (see moduleCacheIsStale())?
	 *
	 * Only an admin request by a superuser, at most repairAttempts times, waiting repairInterval
	 * after the first try and twice as long after each further one.
	 *
	 * @return bool
	 *
	 */
	public function canRepairModuleCache() {
		$page = $this->wire()->page;
		$user = $this->wire()->user;
		if(!$page || !$page->template || $page->template->name !== 'admin') return false;
		if(!$user || !$user->isSuperuser()) return false;
		$state = $this->repairState();
		if($state['attempts'] >= self::repairAttempts) return false;
		$wait = $state['attempts'] ? self::repairInterval * pow(2, $state['attempts'] - 1) : 0;
		return time() - $state['time'] >= $wait;
	}

	/**
	 * Hook before Pages::saveReady while AdminThemeBoss forces Uikit: keep this theme unselected
	 *
	 * Saved, the choice would last one redirect: AdminThemeBoss would save the user back to Uikit
	 * at boot of the next request (see bossForcesUikit()). Saving Uikit here instead means it has
	 * nothing to undo, and the user learns why now.
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookUserThemeSave(HookEvent $event) {
		$user = $event->arguments(0);
		if(!$user instanceof User || !$user->isChanged('admin_theme')) return;
		if((string) $user->admin_theme !== $this->className()) return;
		$user->admin_theme = 'AdminThemeUikit';
		$this->error(__('Bridge was not selected: AdminThemeBoss has "activate for all users" on and would switch the theme back to Uikit on the next request. Turn that setting off in Modules > AdminThemeBoss first.', __FILE__));
	}
}

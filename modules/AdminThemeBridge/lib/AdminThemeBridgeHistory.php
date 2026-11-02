<?php namespace ProcessWire;

/**
 * AdminThemeBridge: the admin screens each user visited, for the history drawer (0.25.0)
 *
 * Part of the AdminThemeBridge class, split by job into traits; `$this` is the theme. Constants
 * and properties stay in AdminThemeBridge.module.php.
 *
 * With the `history` setting on, every admin screen a logged-in user opens with a plain GET (no
 * AJAX, no modal window) is recorded after its Process ran (hookHistoryRecord()): one entry per
 * screen, keyed by its admin-relative URL with the query sorted and the request-only parameters
 * dropped. A screen visited again moves to the top and counts the visit. The entries live in the
 * user page's meta data (`$user->meta('AdminThemeBridge.history')`), so they follow the user to
 * every browser; at most `historySteps` of them, the oldest go first.
 *
 * Each entry: `name` (the screen's headline), `type` (an English key the drawer translates: page,
 * template, field, module, user, role, permission, lister, pages, screen), `url` (relative to the
 * admin), `visits`, `last` (unix time). historyEntry() decides what a visit records and is
 * hookable.
 *
 */
trait AdminThemeBridgeHistory {

	/**
	 * Hook after ProcessController::execute: record the screen the user just opened
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookHistoryRecord(HookEvent $event) {
		if(!is_string($event->return)) return;
		/** @var ProcessController $controller */
		$controller = $event->object;
		$process = $controller->getProcess();
		if($process) $this->historyRecord($process);
	}

	/**
	 * Record a visit of the current admin screen, if it is one worth keeping
	 *
	 * @param Process $process The screen's Process, after it ran
	 * @return bool Was it recorded?
	 *
	 */
	public function historyRecord(Process $process) {
		$input = $this->wire()->input;
		$config = $this->wire()->config;
		$user = $this->wire()->user;
		$page = $this->wire()->page;
		if(!$this->history || !$user || !$user->id || !$user->isLoggedin()) return false;
		if(!$input->requestMethod('GET') || $config->ajax || $input->get('modal') || $this->isModal) return false;
		// output for scripts, even when opened as a page (?render=JSON, an AJAX field's markup)
		if($input->get('render') || $input->get('renderInputfieldAjax')) return false;
		if(!$page || !$page->id || (string) $page->process === '') return false;
		$entry = $this->historyEntry($process, $page);
		if(!is_array($entry) || empty($entry['url'])) return false;
		try {
			$entries = $user->meta(self::historyMeta);
			if(!is_array($entries)) $entries = array();
			$key = $entry['url'];
			$visits = isset($entries[$key]['visits']) ? (int) $entries[$key]['visits'] : 0;
			unset($entries[$key]);
			$entries[$key] = array(
				'name' => (string) $entry['name'],
				'type' => (string) $entry['type'],
				'url' => $key,
				'visits' => $visits + 1,
				'last' => time(),
			);
			// oldest first, then the cap from the start
			uasort($entries, function($a, $b) { return ((int) $a['last']) <=> ((int) $b['last']); });
			$steps = $this->getHistorySteps();
			if(count($entries) > $steps) $entries = array_slice($entries, count($entries) - $steps, null, true);
			$user->meta(self::historyMeta, $entries);
		} catch(\Throwable $e) {
			// no history beats no screen
			return false;
		}
		return true;
	}

	/**
	 * What a visit of the current screen records: name, type and admin-relative URL, or null to
	 * skip it (login, logout, search, the admin home, Add New, a URL too long to be a key)
	 *
	 * @param Process $process
	 * @param Page $adminPage The admin page the Process runs on
	 * @return array|null
	 *
	 */
	public function ___historyEntry(Process $process, Page $adminPage) {
		$input = $this->wire()->input;
		foreach(array('ProcessLogin', 'ProcessLogout', 'ProcessPageSearch', 'ProcessHome', 'ProcessPageAdd') as $class) {
			if(wireInstanceOf($process, $class, false)) return null;
		}
		$url = $this->historyUrl();
		if($url === '' || strlen($url) > 250) return null;
		$id = (int) $input->get('id');
		$type = 'screen';
		$types = array(
			'ProcessPageEdit' => 'page', 'ProcessTemplate' => 'template', 'ProcessField' => 'field',
			'ProcessUser' => 'user', 'ProcessRole' => 'role', 'ProcessPermission' => 'permission',
		);
		foreach($types as $class => $key) {
			if($id > 0 && wireInstanceOf($process, $class, false)) {
				$type = $key;
				break;
			}
		}
		if($type === 'screen') {
			if(wireInstanceOf($process, 'ProcessModule', false) && $input->get('name')) {
				$type = 'module';
			} else if(wireInstanceOf($process, array('ProcessPageLister', 'ProcessPageListerPro'), false)) {
				$type = 'lister';
			} else if(wireInstanceOf($process, 'ProcessPageList', false)) {
				$type = 'pages';
			}
		}
		$name = self::historyName((string) $this->wire('processHeadline'));
		if($name === '') $name = (string) $adminPage->get('title|name');
		return array('name' => $name, 'type' => $type, 'url' => $url);
	}

	/**
	 * The current screen's URL relative to the admin, with the query sorted and without the
	 * request-only parameters (historyDropParams, the CSRF token); '' outside the admin
	 *
	 * @return string
	 *
	 */
	protected function historyUrl() {
		$input = $this->wire()->input;
		$admin = (string) $this->wire()->config->urls->admin;
		$path = (string) $input->url();
		if($admin === '' || strpos($path, $admin) !== 0) return '';
		$drop = $this->historyDropParams;
		$drop[] = $this->wire()->session->CSRF->getTokenName();
		$query = array();
		foreach($input->get->getArray() as $key => $value) {
			if(in_array($key, $drop, true) || !is_scalar($value) || (string) $value === '') continue;
			$query[$key] = (string) $value;
		}
		ksort($query);
		$url = substr($path, strlen($admin));
		return count($query) ? $url . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986) : $url;
	}

	/**
	 * A headline as text: markup and `<icon-name>` tokens out, entities decoded
	 *
	 * @param string $headline
	 * @return string
	 *
	 */
	public static function historyName($headline) {
		$name = preg_replace('/<icon-[\w-]+>\s*/', '', $headline);
		$name = html_entity_decode(strip_tags((string) $name), ENT_QUOTES | ENT_HTML5, 'UTF-8');
		return trim(preg_replace('/\s+/u', ' ', $name));
	}

	/**
	 * The current user's history, newest first, keyed by URL
	 *
	 * @return array
	 *
	 */
	public function historyEntries() {
		$user = $this->wire()->user;
		if(!$user || !$user->id || !$user->isLoggedin()) return array();
		$entries = $user->meta(self::historyMeta);
		if(!is_array($entries)) return array();
		// stored oldest first (historyRecord()), so visits within one second keep their order
		return array_reverse($entries, true);
	}

	/**
	 * Forget the current user's history (the smoke test; no control for it yet)
	 *
	 */
	public function historyClear() {
		$user = $this->wire()->user;
		if($user && $user->id && $user->isLoggedin()) $user->meta()->remove(self::historyMeta);
	}
}

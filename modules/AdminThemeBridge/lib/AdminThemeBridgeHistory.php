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
 * dropped. An editor of one thing (a page, template, field, user, role or permission, by `id`)
 * keeps only the parameters that name it (historyKeepParams()), so `?c=3&id=5` after a save is the
 * same entry as `?id=5`; entries stored under an older key merge when read (0.30.1). A screen
 * visited again moves to the top and counts the visit. The entries live in the
 * user page's meta data (`$user->meta('AdminThemeBridge.history')`), so they follow the user to
 * every browser; at most `historySteps` of them, the oldest go first.
 *
 * Each entry: `name` (the screen's headline), `type` (an English key the drawer translates: page,
 * template, field, module, user, role, permission, lister, pages, screen), `url` (relative to the
 * admin), `visits`, `last` (unix time). historyEntry() decides what a visit records and is
 * hookable.
 *
 * The history drawer (scripts/drawers.js) fetches its table with a GET of the screen's own URL
 * plus `bridgeHistory=1`, as XMLHttpRequest: hookHistoryFragment() answers it before the Process
 * runs, with renderHistoryTable() (the screen's own entry marked aria-current). The drawer's Clear
 * button POSTs `bridgeHistory=clear` with the CSRF token to the admin (0.26.0).
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
	 * Hook before ProcessController::execute: the history drawer's table for `?bridgeHistory=1`
	 * (AJAX GET, any admin screen; read only, so no CSRF token), and its Clear button's POST of
	 * `bridgeHistory=clear` (AJAX, CSRF token; 0.26.0), answered with the emptied table; 403 for a
	 * guest or a POST without a valid token
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookHistoryFragment(HookEvent $event) {
		$input = $this->wire()->input;
		$clear = $input->requestMethod('POST') && $input->post('bridgeHistory') === 'clear';
		if(!$clear && ($input->get('bridgeHistory') === null || !$input->requestMethod('GET'))) return;
		if(!$this->wire()->config->ajax) return;
		$event->replace = true;
		$user = $this->wire()->user;
		if(!$this->history || !$user->isLoggedin() || ($clear && !$this->wire()->session->CSRF->hasValidToken())) {
			http_response_code(403);
			$event->return = ' ';
			return;
		}
		header('Content-Type: text/html; charset=utf-8');
		if($clear) {
			$this->historyClear();
			$event->return = $this->renderHistoryTable();
			return;
		}
		$process = null;
		try {
			/** @var ProcessController $controller */
			$controller = $event->object;
			$process = $controller->getProcess();
		} catch(\Throwable $e) {
			// no access or no such Process: the plain URL marks the row
		}
		$event->return = $this->renderHistoryTable($this->historyCurrentKey($process));
	}

	/**
	 * The current screen's history key: the `url` historyEntry() records for it (so a hook that
	 * rewrites the key still finds the row), or historyUrl() when the screen records nothing
	 *
	 * @param Process|null $process The screen's Process
	 * @return string
	 *
	 */
	protected function historyCurrentKey(?Process $process = null) {
		$page = $this->wire()->page;
		if($process && $page && $page->id) {
			try {
				$entry = $this->historyEntry($process, $page);
				if(is_array($entry) && !empty($entry['url'])) return (string) $entry['url'];
			} catch(\Throwable $e) {
				// fall through to the plain URL
			}
		}
		return $this->historyUrl();
	}

	/**
	 * The history drawer's content: a table of the user's entries, newest first, or a sentence
	 * when there are none
	 *
	 * @param string $current The screen's own key (historyUrl()): its link gets aria-current
	 * @return string
	 *
	 */
	public function renderHistoryTable($current = '') {
		$sanitizer = $this->wire()->sanitizer;
		$entries = $this->historyEntries();
		if(!count($entries)) return "<p class='pw-history-empty'>" . $sanitizer->entities1(__('No screens visited yet.', __FILE__)) . "</p>";
		$admin = (string) $this->wire()->config->urls->admin;
		$datetime = $this->wire()->datetime;
		$format = __('Y-m-d H:i', __FILE__); // date and time of the last visit (PHP date format)
		$lastLabel = __('Last visit: %s', __FILE__);
		$rows = '';
		foreach($entries as $key => $entry) {
			$url = isset($entry['url']) ? (string) $entry['url'] : (string) $key;
			$name = isset($entry['name']) && $entry['name'] !== '' ? (string) $entry['name'] : $url;
			$typeKey = isset($entry['type']) ? (string) $entry['type'] : '';
			$type = $sanitizer->entities($this->historyTypeLabel($typeKey));
			// an editor of one thing shows its id: same-named rows differ on touch, where the
			// link's title cannot be seen (0.30.1, audit U5)
			if($this->historyKeepParams($typeKey) !== null && preg_match('/[?&]id=(\d+)/', $url, $m)) {
				$type .= " <span class='pw-history-id'>#$m[1]</span>";
			}
			$visits = isset($entry['visits']) ? (int) $entry['visits'] : 1;
			$last = isset($entry['last']) ? sprintf($lastLabel, $datetime->date($format, (int) $entry['last'])) : '';
			$attr = $current !== '' && $url === $current ? " aria-current='page'" : '';
			// the key as the link's title tells same-named screens apart (two pages called "Home")
			$rows .= "<tr><td><a href='" . $sanitizer->entities($admin . $url) . "' title='" . $sanitizer->entities($url) . "'$attr>" . $sanitizer->entities($name) . "</a></td>" .
				"<td>$type</td>" .
				"<td class='pw-history-visits' title='" . $sanitizer->entities($last) . "'>$visits</td></tr>";
		}
		return "<table class='pw-history'><caption class='pw-sr-only'>" . $sanitizer->entities1(__('Visited screens, newest first', __FILE__)) . "</caption>" .
			"<thead><tr><th scope='col'>" . $sanitizer->entities1(__('Name', __FILE__)) . "</th><th scope='col'>" . $sanitizer->entities1(__('Type', __FILE__)) . "</th>" .
			"<th scope='col' class='pw-history-visits'>" . $sanitizer->entities1(__('Visits', __FILE__)) . "</th></tr></thead><tbody>$rows</tbody></table>";
	}

	/**
	 * A history entry's type as the user reads it; an unknown key as it is
	 *
	 * @param string $type
	 * @return string
	 *
	 */
	public function historyTypeLabel($type) {
		switch($type) {
			case 'page': return __('page', __FILE__);
			case 'template': return __('template', __FILE__);
			case 'field': return __('field', __FILE__);
			case 'module': return __('module', __FILE__);
			case 'user': return __('user', __FILE__);
			case 'role': return __('role', __FILE__);
			case 'permission': return __('permission', __FILE__);
			case 'lister': return __('lister', __FILE__);
			case 'pages': return __('page tree', __FILE__);
			case 'screen': return __('screen', __FILE__);
		}
		return $type;
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
			$entries = is_array($entries) ? $this->historyMerge($entries) : array();
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
		$url = $this->historyUrl($type);
		if($url === '' || strlen($url) > 250) return null;
		$name = self::historyName((string) $this->wire('processHeadline'));
		if($name === '') $name = (string) $adminPage->get('title|name');
		return array('name' => $name, 'type' => $type, 'url' => $url);
	}

	/**
	 * The current screen's URL relative to the admin, with the query sorted and without the
	 * request-only parameters (historyDropParams, the CSRF token); for an editor of one thing only
	 * the parameters that name it (historyKeepParams()); '' outside the admin
	 *
	 * @param string $type The entry's type (historyEntry()); '' when not known
	 * @return string
	 *
	 */
	protected function historyUrl($type = '') {
		$input = $this->wire()->input;
		$admin = (string) $this->wire()->config->urls->admin;
		$path = (string) $input->url();
		if($admin === '' || strpos($path, $admin) !== 0) return '';
		return $this->historyKey(substr($path, strlen($admin)), $input->get->getArray(), $type);
	}

	/**
	 * A history key: an admin-relative path and its query, sorted, without the request-only
	 * parameters, and for an editor of one thing with only the parameters that name it (0.30.1)
	 *
	 * @param string $path Relative to the admin
	 * @param array $query
	 * @param string $type
	 * @return string
	 *
	 */
	protected function historyKey($path, array $query, $type = '') {
		$drop = $this->historyDropParams;
		$drop[] = $this->wire()->session->CSRF->getTokenName();
		$keep = $this->historyKeepParams($type);
		$out = array();
		foreach($query as $key => $value) {
			$key = (string) $key;
			if(in_array($key, $drop, true) || !is_scalar($value) || (string) $value === '') continue;
			if($keep !== null && !in_array($key, $keep, true)) continue;
			$out[$key] = (string) $value;
		}
		ksort($out);
		return count($out) ? $path . '?' . http_build_query($out, '', '&', PHP_QUERY_RFC3986) : $path;
	}

	/**
	 * The query parameters an entry of this type keeps, or null for all but the dropped ones: an
	 * editor of one thing keeps its `id` (a field also its template context), so what core adds
	 * after a save (`c`, `changes`, `collapse_info`), a Lister filter or a search term never makes a
	 * second row of the same page (0.30.1, audit B1 and S3)
	 *
	 * @param string $type
	 * @return array|null
	 *
	 */
	protected function historyKeepParams($type) {
		switch($type) {
			case 'page':
			case 'template':
			case 'user':
			case 'role':
			case 'permission':
				return array('id');
			case 'field':
				return array('id', 'fieldgroup_id', 'context_namespace');
		}
		return null;
	}

	/**
	 * Stored entries, oldest first, with entries under an older key of the same screen merged:
	 * the newest name and time, the visits added up (entries recorded before 0.30.1 kept `c` and
	 * other core parameters in the key)
	 *
	 * @param array $entries As stored, oldest first
	 * @return array
	 *
	 */
	protected function historyMerge(array $entries) {
		$out = array();
		foreach($entries as $key => $entry) {
			if(!is_array($entry)) continue;
			$url = isset($entry['url']) ? (string) $entry['url'] : (string) $key;
			$type = isset($entry['type']) ? (string) $entry['type'] : '';
			$newKey = $url;
			$pos = strpos($url, '?');
			if($pos !== false) {
				$query = array();
				parse_str(substr($url, $pos + 1), $query);
				$rebuilt = $this->historyKey(substr($url, 0, $pos), $query, $type);
				// a key loses parameters only when it had some it should not keep; else it stays
				// as stored, byte for byte
				$kept = array();
				$rpos = strpos($rebuilt, '?');
				if($rpos !== false) parse_str(substr($rebuilt, $rpos + 1), $kept);
				if(count($kept) < count($query)) $newKey = $rebuilt;
			}
			$entry['url'] = $newKey;
			if(isset($out[$newKey])) {
				$old = $out[$newKey];
				$entry['visits'] = (isset($old['visits']) ? (int) $old['visits'] : 1) + (isset($entry['visits']) ? (int) $entry['visits'] : 1);
				if((isset($old['last']) ? (int) $old['last'] : 0) > (isset($entry['last']) ? (int) $entry['last'] : 0)) {
					$entry = array_merge($entry, array('name' => $old['name'], 'last' => $old['last']));
				}
				unset($out[$newKey]);
			}
			$out[$newKey] = $entry;
		}
		uasort($out, function($a, $b) { return (isset($a['last']) ? (int) $a['last'] : 0) <=> (isset($b['last']) ? (int) $b['last'] : 0); });
		return $out;
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
		// stored oldest first (historyRecord()), so visits within one second keep their order;
		// entries under an older key of one screen merge (0.30.1)
		return array_reverse($this->historyMerge($entries), true);
	}

	/**
	 * Forget the current user's history (the history drawer's Clear button, hookHistoryFragment())
	 *
	 */
	public function historyClear() {
		$user = $this->wire()->user;
		if($user && $user->id && $user->isLoggedin()) $user->meta()->remove(self::historyMeta);
	}
}

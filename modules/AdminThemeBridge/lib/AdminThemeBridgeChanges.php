<?php namespace ProcessWire;

/**
 * AdminThemeBridge: the change log behind "changed elsewhere" warnings (1.6.0)
 *
 * Part of the AdminThemeBridge class, split by job into traits; `$this` is the theme. Constants
 * and properties stay in AdminThemeBridge.module.php.
 *
 * Fields, templates and fieldgroups have no "modified" stamp in core, so their saves are written
 * to the table `bridge_changes` by hooks on core's own save points (hookChangeLog(), bound on every
 * admin request whichever admin theme is current). One row per change: `id` (the cursor), `ts`,
 * `users_id`, `kind` (field, template, fieldgroup, context, page), `object_id`, `context_id` (the
 * fieldgroup of a context change), `action` (saved, renamed, deleted, trashed, moved), `tab` (the
 * saving tab's id, changeTab(): the `_bridge_tab` input hookChangeTabInput() adds to the forms this
 * theme renders, or the `X-Bridge-Tab` header of an AJAX save; the client fills both) and `diff`, JSON of at most changeDiffMax bytes:
 *  - field, template, context: property => array(old, new), long values cut;
 *  - fieldgroup: `added` and `removed` (field ids), `reordered` (true when the order alone moved);
 *  - page: each changed property => null (no values), `name`, `parent`, `template` => array(old, new).
 *
 * Old values of a field or template come from its stored row, read in `saveReady` before the
 * UPDATE (core keeps no old values: trackChangesValues is never on, and `label` is not tracked);
 * the row is written in `saved`, so a failed save writes nothing, nor does a save with no change.
 * Page saves (and one-field saves, Pages::savedField) are logged only for admin requests of a logged-in user, not from the CLI or the front
 * end. Rows older than getChangesDays() go at most once an hour, on write. With the changesWarn
 * setting off (Features > Warn about changes made elsewhere) no hook is bound, no snapshot printed
 * and nothing answers `?bridgeChanges=1`; the table stays.
 *
 * The check on tab focus is an AJAX GET of any admin URL with `bridgeChanges=1` and `deps`, the
 * screen's snapshot (changeDeps()) as JSON with the cursor it last got. hookChangesFragment()
 * answers it before the Process boots and exits: JSON `{cursor, page, changes, more}` from
 * changesAnswer(), 403 and no body for a guest. Not AJAX: the screen renders as usual. Rows saved
 * from the asking tab (the snapshot's `tab`) are skipped: a tab is never warned about itself.
 *
 */
trait AdminThemeBridgeChanges {

	/**
	 * Bind the change log's hooks (once per instance): fields, templates, fieldgroups, field
	 * contexts, and admin page saves
	 *
	 */
	public function hookChangeLog() {
		if($this->changesHooked) return;
		$this->changesHooked = true;
		$fields = $this->wire()->fields;
		$templates = $this->wire()->templates;
		$pages = $this->wire()->pages;
		foreach(array($fields, $templates) as $items) {
			$items->addHookAfter('saveReady', $this, 'hookChangeItemReady');
			$items->addHookAfter('renamed', $this, 'hookChangeItemRenamed');
			$items->addHookAfter('saved', $this, 'hookChangeItemSaved');
			$items->addHookAfter('deleted', $this, 'hookChangeItemDeleted');
		}
		$fieldgroups = $this->wire()->fieldgroups;
		$fieldgroups->addHookBefore('save', $this, 'hookChangeFieldgroupBefore');
		$fieldgroups->addHookAfter('save', $this, 'hookChangeFieldgroupAfter');
		$fields->addHookBefore('saveFieldgroupContext', $this, 'hookChangeContextBefore');
		$fields->addHookAfter('saveFieldgroupContext', $this, 'hookChangeContextAfter');
		$pages->addHookAfter('saveReady', $this, 'hookChangePageReady');
		$pages->addHookAfter('saved', $this, 'hookChangePageSaved');
		$pages->addHookAfter('savedField', $this, 'hookChangePageFieldSaved');
		$pages->addHookAfter('moved', $this, 'hookChangePageAction');
		$pages->addHookAfter('trashed', $this, 'hookChangePageAction');
		$pages->addHookAfter('deleted', $this, 'hookChangePageAction');
	}

	/**
	 * Days the change log keeps its rows (the changesDays setting), 1..3650; anything else is 30
	 *
	 * @return int
	 *
	 */
	public function getChangesDays() {
		$n = (int) $this->get('changesDays');
		return $n >= 1 && $n <= 3650 ? $n : 30;
	}

	/**
	 * What the current screen depends on, and where the change log stood when it rendered
	 *
	 * Printed by _head.php as `<script type="application/json" id="pw-deps">` (changeDepsJson()); the
	 * check on tab focus sends it back. Keys: `screen` (page-edit, page-add, field-edit,
	 * template-edit), `cursor` (the log's highest id, 0 without a table), `page` (`id`, `modified`;
	 * null on page add), `template`, `fieldgroup` (ids, 0 when none), `fields`, `templates` (ids).
	 * Page edit (users, roles, permissions and other page types too) lists the page's template and
	 * fields, and the item templates of repeater and FieldsetPage fields with their fields, at any
	 * depth; page add the chosen template (when known) and the parent's; field edit the field;
	 * template edit the template and its fields. A hook may add ids, or return null.
	 *
	 * @return array|null Null on any other screen: nothing is printed
	 *
	 */
	public function ___changeDeps() {
		$process = $this->wire()->process;
		$adminPage = $this->wire()->page;
		$input = $this->wire()->input;
		if(!$process instanceof Process || !$adminPage || !$adminPage->id) return null;
		$segment = (string) $input->urlSegment1;
		$pageType = wireInstanceOf($process, 'ProcessPageType');
		$deps = null;
		if(($process instanceof ProcessPageEdit && $segment === '') || ($pageType && $segment === 'edit')) {
			$page = $process->getPage();
			if(!$page instanceof Page || !$page->id || !$page->template) return null;
			$fields = array();
			$templates = array();
			$this->changeFormIds($page->template, $fields, $templates);
			$deps = array(
				'screen' => 'page-edit',
				'page' => array('id' => (int) $page->id, 'modified' => (int) $page->modified),
				'template' => (int) $page->template->id,
				'fieldgroup' => $page->template->fieldgroup ? (int) $page->template->fieldgroup->id : 0,
				'fields' => $fields,
				'templates' => $templates,
			);
		} else if(($process instanceof ProcessPageAdd && $segment === '') || ($pageType && $segment === 'add')) {
			$deps = $this->changeAddDeps($pageType ? $this->wire((string) $adminPage->name) : null);
		} else if($process instanceof ProcessField && $segment === 'edit') {
			$field = $process->getField();
			if($field instanceof Field && $field->id) {
				$deps = array('screen' => 'field-edit', 'page' => null, 'template' => 0, 'fieldgroup' => 0,
					'fields' => array((int) $field->id), 'templates' => array());
			}
		} else if($process instanceof ProcessTemplate && $segment === 'edit') {
			$template = $this->wire()->templates->get((int) $input->get('id'));
			if($template instanceof Template) {
				$fields = array();
				if($template->fieldgroup) foreach($template->fieldgroup as $field) $fields[] = (int) $field->id;
				$deps = array('screen' => 'template-edit', 'page' => null, 'template' => (int) $template->id,
					'fieldgroup' => $template->fieldgroup ? (int) $template->fieldgroup->id : 0,
					'fields' => $fields, 'templates' => array((int) $template->id));
			}
		}
		if($deps === null) return null;
		return array_merge(array('cursor' => $this->changeCursor()), $deps);
	}

	/**
	 * changeDeps() as the JSON _head.php prints, safe inside `<script>`; '' when there is none or
	 * the changesWarn setting is off (then the runtime loads no changes chunk either)
	 *
	 * Internal: not on the extension surface.
	 *
	 * @return string
	 *
	 */
	public function changeDepsJson() {
		if(!$this->changesWarn) return '';
		$deps = $this->changeDeps();
		if(!is_array($deps)) return '';
		$json = json_encode($deps, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES);
		return is_string($json) ? $json : '';
	}

	/**
	 * The page-add part of changeDeps(): the chosen template and the parent's template
	 *
	 * @param mixed $pagesType The PagesType of a ProcessPageType screen (users, roles...), else null
	 * @return array|null
	 *
	 */
	protected function changeAddDeps($pagesType) {
		$input = $this->wire()->input;
		$templates = $this->wire()->templates;
		$chosen = null;
		$parent = null;
		$templateId = (int) $input->get('template_id');
		if($templateId) $chosen = $templates->get($templateId);
		$parentId = (int) $input->get('parent_id');
		if($parentId) $parent = $this->wire()->pages->get($parentId);
		if($pagesType instanceof PagesType) {
			if(!$parent || !$parent->id) $parent = $pagesType->getParent();
			if(!$chosen) $chosen = $pagesType->getTemplate();
		}
		if(!$chosen && $parent && $parent->id && $parent->template && count($parent->template->childTemplates) === 1) {
			$childTemplates = $parent->template->childTemplates;
			$chosen = $templates->get((int) reset($childTemplates));
		}
		$ids = array();
		if($chosen instanceof Template) $ids[] = (int) $chosen->id;
		if($parent && $parent->id && $parent->template && !in_array((int) $parent->template->id, $ids, true)) $ids[] = (int) $parent->template->id;
		if(!count($ids)) return null;
		return array(
			'screen' => 'page-add',
			'page' => null,
			'template' => $chosen instanceof Template ? (int) $chosen->id : 0,
			'fieldgroup' => $chosen instanceof Template && $chosen->fieldgroup ? (int) $chosen->fieldgroup->id : 0,
			'fields' => array(),
			'templates' => $ids,
		);
	}

	/**
	 * A template's fields and templates as its edit form holds them: repeater and FieldsetPage
	 * item templates and their fields walked at any depth, each once
	 *
	 * @param Template $template
	 * @param array $fields Field ids, added to
	 * @param array $templates Template ids, added to
	 *
	 */
	protected function changeFormIds(Template $template, array &$fields, array &$templates) {
		if(in_array((int) $template->id, $templates, true)) return;
		$templates[] = (int) $template->id;
		if(!$template->fieldgroup) return;
		foreach($template->fieldgroup as $field) {
			if(!in_array((int) $field->id, $fields, true)) $fields[] = (int) $field->id;
			if(!$field->type || !wireInstanceOf($field->type, 'FieldtypeRepeater')) continue;
			$item = $this->wire()->templates->get((int) $field->get('template_id'));
			if($item instanceof Template) $this->changeFormIds($item, $fields, $templates);
		}
	}

	/**
	 * The change log's highest id (the cursor a snapshot carries), 0 without a table or rows
	 *
	 * @return int
	 *
	 */
	protected function changeCursor() {
		if(!$this->changeTableReady()) return 0;
		try {
			$query = $this->wire()->database->query('SELECT MAX(id) FROM `' . self::changesTable . '`');
			$id = (int) $query->fetchColumn();
			$query->closeCursor();
			return $id;
		} catch(\Exception $e) {
			$this->changeError($e);
			return 0;
		}
	}

	/**
	 * A tab id as the log keeps it: letters, digits, `_` and `-`, at most 64; anything else is ''
	 *
	 * @param mixed $value
	 * @return string
	 *
	 */
	protected function changeTabId($value) {
		if(!is_string($value) || $value === '' || strlen($value) > 64) return '';
		return preg_match('/\A[A-Za-z0-9_-]+\z/', $value) ? $value : '';
	}

	/**
	 * The saving tab's id: the posted `_bridge_tab`, else the `X-Bridge-Tab` header; '' when neither
	 *
	 * @return string
	 *
	 */
	protected function changeTab() {
		$tab = $this->changeTabId($this->wire()->input->post('_bridge_tab'));
		if($tab === '' && isset($_SERVER['HTTP_X_BRIDGE_TAB'])) $tab = $this->changeTabId($_SERVER['HTTP_X_BRIDGE_TAB']);
		return $tab;
	}

	/**
	 * Hook after InputfieldForm::render: an empty hidden `_bridge_tab` input before the end of a POST
	 * form, for the client to fill with its tab id; other forms are left alone
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookChangeTabInput(HookEvent $event) {
		$out = $event->return;
		if(!is_string($out) || strpos($out, "name='_InputfieldForm'") === false || strpos($out, "name='_bridge_tab'") !== false) return;
		$at = strrpos($out, '</form>');
		if($at === false) return;
		$event->return = substr($out, 0, $at) . "<input type='hidden' name='_bridge_tab' value='' />" . substr($out, $at);
	}

	/**
	 * Hook before ProcessController::execute: the answer to `?bridgeChanges=1` (AJAX GET only), sent
	 * before the Process boots, then exit; 403 without a body for a guest
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookChangesFragment(HookEvent $event) {
		$input = $this->wire()->input;
		if($input->get('bridgeChanges') === null || !$input->requestMethod('GET') || !$this->wire()->config->ajax) return;
		$answer = $this->changesRequest();
		header('Cache-Control: no-store');
		if($answer === null) {
			http_response_code(403);
			exit;
		}
		header('Content-Type: application/json; charset=utf-8');
		echo json_encode($answer, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
		exit;
	}

	/**
	 * changesAnswer() for the request's `deps` parameter (the snapshot as JSON)
	 *
	 * Internal: not on the extension surface.
	 *
	 * @return array|null Null for a guest
	 *
	 */
	public function changesRequest() {
		$json = $this->wire()->input->get('deps');
		$deps = is_string($json) && strlen($json) <= 65536 ? json_decode($json, true) : null;
		return $this->changesAnswer(is_array($deps) ? $deps : array());
	}

	/**
	 * What changed since a snapshot, for the current user (the `?bridgeChanges=1` answer)
	 *
	 * The snapshot is only a list of ids to look at, never trusted. Its screen decides what the
	 * user must hold: page-edit a page they can still see (else nothing) and edit (else only
	 * `message`: they can no longer save it); page-add `page-edit`; field-edit `field-admin`;
	 * template-edit `template-admin`; any other screen gets nothing. One query on the log (rows past
	 * the cursor of the snapshot's fields, templates, their fieldgroups, the field contexts there and
	 * the page) and the page itself. Rows the snapshot's `tab` saved are left out, and the page entry
	 * too when the newest save of the page past the cursor was that tab's. A row's diff is whole for a user with `field-admin` (fields,
	 * contexts) or `template-admin` (templates, fieldgroups); others get changeSafeProps only, the
	 * code-like properties named (`named`), the rest counted (`hidden`).
	 *
	 * Internal: not on the extension surface.
	 *
	 * @param array $deps The snapshot: screen, cursor, page (id, modified), template, fieldgroup, fields, templates, tab
	 * @return array|null Keys: cursor (the newest row seen), page (who saved it since, or null),
	 *  changes (rows, newest first: id, kind, action, ts, user, you, object, name, label, in, diff,
	 *  named, hidden), more (true when rows past the 50 newest were left out), message (only when
	 *  the page can no longer be saved), modified (only when this tab saved the page last: its
	 *  current modified time, for the client's snapshot). Null for a guest.
	 *
	 */
	public function changesAnswer(array $deps) {
		$user = $this->wire()->user;
		if(!$user || !$user->isLoggedin()) return null;
		$cursor = isset($deps['cursor']) ? max(0, (int) $deps['cursor']) : 0;
		$screen = isset($deps['screen']) ? (string) $deps['screen'] : '';
		$out = array('cursor' => $cursor, 'page' => null, 'changes' => array(), 'more' => false);
		$fields = $this->changeIds($deps, 'fields');
		$templates = $this->changeIds($deps, 'templates');
		if(!empty($deps['template']) && is_scalar($deps['template'])) $templates[] = (int) $deps['template'];
		$page = null;
		if($screen === 'page-edit') {
			$pageId = isset($deps['page']['id']) && is_scalar($deps['page']['id']) ? (int) $deps['page']['id'] : 0;
			if($pageId < 1) return $out;
			$page = $this->wire()->pages->getById(array($pageId), array('getOne' => true));
			if($page->id && !$page->listable()) return $out;
			if(!$page->id || !$page->editable()) {
				$out['message'] = __('You can no longer save this page', __FILE__);
				return $out;
			}
		} else if($screen === 'page-add') {
			if(!$user->hasPermission('page-edit')) return $out;
		} else if($screen === 'field-edit') {
			if(!$user->hasPermission('field-admin')) return $out;
		} else if($screen === 'template-edit') {
			if(!$user->hasPermission('template-admin')) return $out;
		} else {
			return $out;
		}
		$templates = array_values(array_unique(array_filter($templates)));
		$fieldgroups = array();
		if(!empty($deps['fieldgroup']) && is_scalar($deps['fieldgroup'])) $fieldgroups[] = (int) $deps['fieldgroup'];
		foreach($templates as $id) {
			$template = $this->wire()->templates->get($id);
			if($template instanceof Template && $template->fieldgroup) $fieldgroups[] = (int) $template->fieldgroup->id;
		}
		$fieldgroups = array_values(array_unique(array_filter($fieldgroups)));
		$tab = isset($deps['tab']) ? $this->changeTabId($deps['tab']) : '';
		$rows = $this->changeRows($cursor, $fields, $templates, $fieldgroups, $page ? (int) $page->id : 0, $tab);
		// this tab's own page saves come back only to tell whether the page entry is someone else's
		$ownPage = false;
		$pageSeen = false;
		$own = 0;
		foreach($rows as $i => $row) {
			if($row['kind'] === 'page' && !$pageSeen) {
				$pageSeen = true;
				$ownPage = $tab !== '' && $row['tab'] === $tab && $page && (int) $row['ts'] >= (int) $page->modified;
			}
			if($tab !== '' && $row['tab'] === $tab) {
				$own = max($own, (int) $row['id']);
				unset($rows[$i]);
			}
		}
		$rows = array_values($rows);
		if($own) $out['cursor'] = max($cursor, $own);
		if(count($rows) > 50) {
			$out['more'] = true;
			$rows = array_slice($rows, 0, 50);
		}
		if(count($rows)) $out['cursor'] = max($out['cursor'], (int) $rows[0]['id']);
		$userIds = array();
		foreach($rows as $row) $userIds[] = (int) $row['users_id'];
		$pageMoved = $page && isset($deps['page']['modified']) && is_scalar($deps['page']['modified'])
			&& (int) $page->modified > (int) $deps['page']['modified'] && !$ownPage;
		if($pageMoved) $userIds[] = (int) $page->modified_users_id;
		$names = $this->changeUserNames($userIds);
		// the client keeps this as its page modified time, or the next check would see its own save as moved
		if($ownPage) $out['modified'] = (int) $page->modified;
		if($pageMoved) {
			$by = (int) $page->modified_users_id;
			$out['page'] = array('id' => (int) $page->id, 'modified' => (int) $page->modified,
				'user' => isset($names[$by]) ? $names[$by] : '', 'you' => $by === (int) $user->id);
		}
		foreach($rows as $row) $out['changes'][] = $this->changeEntry($row, $names);
		return $out;
	}

	/**
	 * A list of ids from the snapshot: positive integers, each once, at most 500
	 *
	 * @param array $deps
	 * @param string $key
	 * @return array
	 *
	 */
	protected function changeIds(array $deps, $key) {
		$ids = array();
		if(!isset($deps[$key]) || !is_array($deps[$key])) return $ids;
		foreach($deps[$key] as $id) {
			if(!is_scalar($id) || (int) $id < 1) continue;
			$ids[(int) $id] = (int) $id;
			if(count($ids) >= 500) break;
		}
		return array_values($ids);
	}

	/**
	 * The log's rows past the cursor that touch the given ids, newest first, at most 51; with a tab,
	 * none of that tab's rows but its page rows (the caller drops them after reading them)
	 *
	 * @param int $cursor
	 * @param array $fields Field ids (field rows, and context rows in one of the fieldgroups)
	 * @param array $templates Template ids
	 * @param array $fieldgroups Fieldgroup ids
	 * @param int $pageId 0 for none
	 * @param string $tab The asking tab's id, '' for none
	 * @return array
	 *
	 */
	protected function changeRows($cursor, array $fields, array $templates, array $fieldgroups, $pageId, $tab = '') {
		$in = function(array $ids) { return implode(',', array_map('intval', $ids)); };
		$where = array();
		if(count($fields)) $where[] = "(kind='field' AND object_id IN(" . $in($fields) . '))';
		if(count($templates)) $where[] = "(kind='template' AND object_id IN(" . $in($templates) . '))';
		if(count($fieldgroups)) $where[] = "(kind='fieldgroup' AND object_id IN(" . $in($fieldgroups) . '))';
		if(count($fields) && count($fieldgroups)) $where[] = "(kind='context' AND object_id IN(" . $in($fields) . ') AND context_id IN(' . $in($fieldgroups) . '))';
		if($pageId) $where[] = "(kind='page' AND object_id=" . (int) $pageId . ')';
		if(!count($where) || !$this->changeTableReady()) return array();
		try {
			$query = $this->wire()->database->prepare('SELECT id, ts, users_id, kind, object_id, context_id, action, tab, diff FROM `' . self::changesTable .
				'` WHERE id>:cursor AND (' . implode(' OR ', $where) . ')' . ($tab !== '' ? " AND (tab<>:tab OR kind='page')" : '') . ' ORDER BY id DESC LIMIT 51');
			$query->bindValue(':cursor', (int) $cursor, \PDO::PARAM_INT);
			if($tab !== '') $query->bindValue(':tab', $tab);
			$query->execute();
			$rows = $query->fetchAll(\PDO::FETCH_ASSOC);
			$query->closeCursor();
			return $rows;
		} catch(\Exception $e) {
			$this->changeError($e);
			return array();
		}
	}

	/**
	 * Users' names by id, in one query
	 *
	 * @param array $ids
	 * @return array id => name
	 *
	 */
	protected function changeUserNames(array $ids) {
		$ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
		$names = array();
		if(!count($ids)) return $names;
		try {
			$query = $this->wire()->database->query('SELECT id, name FROM pages WHERE id IN(' . implode(',', $ids) . ')');
			while($row = $query->fetch(\PDO::FETCH_ASSOC)) $names[(int) $row['id']] = (string) $row['name'];
			$query->closeCursor();
		} catch(\Exception $e) {
			$this->changeError($e);
		}
		return $names;
	}

	/**
	 * A log row as the answer gives it: who, what, and the diff the current user may see
	 *
	 * @param array $row
	 * @param array $names User names by id
	 * @return array
	 *
	 */
	protected function changeEntry(array $row, array $names) {
		$user = $this->wire()->user;
		$kind = (string) $row['kind'];
		$objectId = (int) $row['object_id'];
		$diff = $row['diff'] !== null ? json_decode((string) $row['diff'], true) : array();
		if(!is_array($diff)) $diff = array();
		$by = (int) $row['users_id'];
		$entry = array('id' => (int) $row['id'], 'kind' => $kind, 'action' => (string) $row['action'], 'ts' => (int) $row['ts'],
			'user' => isset($names[$by]) ? $names[$by] : '', 'you' => $by === (int) $user->id, 'object' => $objectId,
			'name' => '', 'label' => '', 'in' => '', 'diff' => array(), 'named' => array(), 'hidden' => 0);
		$item = null;
		if($kind === 'field' || $kind === 'context') $item = $this->wire()->fields->get($objectId);
		else if($kind === 'template') $item = $this->wire()->templates->get($objectId);
		else if($kind === 'fieldgroup') $item = $this->wire()->fieldgroups->get($objectId);
		if($item instanceof Saveable && $item->id) {
			$entry['name'] = (string) $item->name;
			if($item instanceof Field || $item instanceof Template) $entry['label'] = (string) $item->getLabel();
		} else if(isset($diff['name'][0]) && is_string($diff['name'][0])) {
			$entry['name'] = $diff['name'][0];
		}
		if($kind === 'context') {
			$fieldgroup = $this->wire()->fieldgroups->get((int) $row['context_id']);
			if($fieldgroup instanceof Fieldgroup) $entry['in'] = (string) $fieldgroup->name;
		}
		if(isset($diff['_more'])) {
			$entry['hidden'] = (int) $diff['_more'];
			unset($diff['_more']);
		}
		if($kind === 'page') {
			$full = true;
		} else if($kind === 'field' || $kind === 'context') {
			$full = $user->hasPermission('field-admin');
		} else {
			$full = $user->hasPermission('template-admin');
		}
		if($full) {
			$entry['diff'] = $diff;
			return $entry;
		}
		foreach($diff as $key => $value) {
			$key = (string) $key;
			if($this->changeSafeProp($key)) {
				$entry['diff'][$key] = $value;
			} else if($this->changeCodeProp($key)) {
				$entry['named'][] = $key;
			} else if($value !== array() && $value !== false) {
				$entry['hidden']++;
			}
		}
		return $entry;
	}

	/**
	 * Is a property one whose values any editor of the page may see (labels, descriptions in any
	 * language, extensions, max files, required, column width, collapsed, inputfield class)?
	 *
	 * @param string $key
	 * @return bool
	 *
	 */
	protected function changeSafeProp($key) {
		if(preg_match('/^(label|description)\d*$/', $key)) return true;
		return in_array($key, array('extensions', 'maxFiles', 'required', 'columnWidth', 'collapsed', 'inputfieldClass'), true);
	}

	/**
	 * Is a property code-like (show/required conditions, selectors, code, hooks, access role ids):
	 * named to a user without the admin permission, its values never shown?
	 *
	 * @param string $key
	 * @return bool
	 *
	 */
	protected function changeCodeProp($key) {
		return (bool) preg_match('/^(showIf|requiredIf|roles|rolesPermissions)$|Roles$|[sS]elector|Code$|[hH]ook/', $key);
	}

	/**
	 * Hook after Fields::saveReady and Templates::saveReady: the diff against the stored row,
	 * kept until `saved`
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookChangeItemReady(HookEvent $event) {
		$items = $event->object;
		$item = $event->arguments(0);
		$kind = $this->changeItemKind($items);
		if(!$kind || !$item instanceof Saveable || !$item->id) return;
		$key = "$kind:$item->id";
		unset($this->changesPending[$key]);
		try {
			$old = $this->changeStoredRow($items, (int) $item->id);
		} catch(\Exception $e) {
			return;
		}
		if($old === null) return;
		$diff = $this->changeDiff($old, $this->changeItemRow($item));
		if(count($diff)) $this->changesPending[$key] = array('action' => 'saved', 'diff' => $diff);
	}

	/**
	 * Hook after Fields::renamed and Templates::renamed: the pending row becomes a rename
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookChangeItemRenamed(HookEvent $event) {
		$kind = $this->changeItemKind($event->object);
		$item = $event->arguments(0);
		$key = $kind && $item ? "$kind:$item->id" : '';
		if(isset($this->changesPending[$key])) $this->changesPending[$key]['action'] = 'renamed';
	}

	/**
	 * Hook after Fields::saved and Templates::saved: write the pending row
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookChangeItemSaved(HookEvent $event) {
		$kind = $this->changeItemKind($event->object);
		$item = $event->arguments(0);
		if(!$kind || !$item) return;
		$key = "$kind:$item->id";
		if(!isset($this->changesPending[$key])) return;
		$row = $this->changesPending[$key];
		unset($this->changesPending[$key]);
		$this->changeWrite($kind, (int) $item->id, 0, $row['action'], $row['diff']);
	}

	/**
	 * Hook after Fields::deleted and Templates::deleted
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookChangeItemDeleted(HookEvent $event) {
		$kind = $this->changeItemKind($event->object);
		$item = $event->arguments(0);
		if(!$kind || !$item || !$item->id) return;
		$this->changeWrite($kind, (int) $item->id, 0, 'deleted', array('name' => array((string) $item->name, null)));
	}

	/**
	 * Hook before Fieldgroups::save: the stored field order
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookChangeFieldgroupBefore(HookEvent $event) {
		$fieldgroup = $event->arguments(0);
		if(!$fieldgroup instanceof Fieldgroup || !$fieldgroup->id) return;
		$key = "fieldgroup:$fieldgroup->id";
		unset($this->changesPending[$key]);
		try {
			$query = $this->wire()->database->prepare('SELECT fields_id FROM fieldgroups_fields WHERE fieldgroups_id=:id ORDER BY sort');
			$query->bindValue(':id', (int) $fieldgroup->id, \PDO::PARAM_INT);
			$query->execute();
			$ids = array_map('intval', $query->fetchAll(\PDO::FETCH_COLUMN));
			$query->closeCursor();
		} catch(\Exception $e) {
			return;
		}
		$this->changesPending[$key] = array('ids' => $ids);
	}

	/**
	 * Hook after Fieldgroups::save: fields added, removed or reordered
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookChangeFieldgroupAfter(HookEvent $event) {
		$fieldgroup = $event->arguments(0);
		if(!$fieldgroup instanceof Fieldgroup) return;
		$key = "fieldgroup:$fieldgroup->id";
		if(!isset($this->changesPending[$key])) return;
		$old = $this->changesPending[$key]['ids'];
		unset($this->changesPending[$key]);
		if(!$event->return) return;
		$new = array();
		foreach($fieldgroup as $field) $new[] = (int) $field->id;
		if($old === $new) return;
		$added = array_values(array_diff($new, $old));
		$removed = array_values(array_diff($old, $new));
		$diff = array('added' => $added, 'removed' => $removed,
			'reordered' => array_values(array_intersect($old, $new)) !== array_values(array_intersect($new, $old)));
		$this->changeWrite('fieldgroup', (int) $fieldgroup->id, 0, 'saved', $diff);
	}

	/**
	 * Hook before Fields::saveFieldgroupContext: the context as it was
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookChangeContextBefore(HookEvent $event) {
		$field = $event->arguments(0);
		$fieldgroup = $event->arguments(1);
		if(!$field instanceof Field || !$fieldgroup instanceof Fieldgroup) return;
		$this->changesPending["context:$field->id:$fieldgroup->id"] = array('old' => $fieldgroup->getFieldContextArray((int) $field->id));
	}

	/**
	 * Hook after Fields::saveFieldgroupContext: the context's diff
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookChangeContextAfter(HookEvent $event) {
		$field = $event->arguments(0);
		$fieldgroup = $event->arguments(1);
		if(!$field instanceof Field || !$fieldgroup instanceof Fieldgroup) return;
		$key = "context:$field->id:$fieldgroup->id";
		if(!isset($this->changesPending[$key])) return;
		$old = $this->changesPending[$key]['old'];
		unset($this->changesPending[$key]);
		if(!$event->return) return;
		$diff = $this->changeDiff($old, $fieldgroup->getFieldContextArray((int) $field->id));
		if(count($diff)) $this->changeWrite('context', (int) $field->id, (int) $fieldgroup->id, 'saved', $diff);
	}

	/**
	 * Hook after Pages::saveReady: the changed properties of a page saved in the admin
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookChangePageReady(HookEvent $event) {
		$page = $event->arguments(0);
		if(!$page instanceof Page || !$page->id) return;
		$key = "page:$page->id";
		unset($this->changesPending[$key]);
		if(!$this->changeLogPages()) return;
		$changes = $page->getChanges();
		if(!count($changes)) return;
		$diff = array();
		foreach($changes as $name) $diff[(string) $name] = null;
		if(isset($diff['name']) && $page->namePrevious) $diff['name'] = array((string) $page->namePrevious, (string) $page->name);
		if(isset($diff['parent']) && $page->parentPrevious) $diff['parent'] = array((int) $page->parentPrevious->id, (int) $page->parent_id);
		if(isset($diff['template']) && $page->templatePrevious) $diff['template'] = array((int) $page->templatePrevious->id, (int) $page->templates_id);
		$this->changesPending[$key] = array('action' => isset($diff['name']) ? 'renamed' : 'saved', 'diff' => $diff);
	}

	/**
	 * Hook after Pages::saved: write the pending row
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookChangePageSaved(HookEvent $event) {
		$page = $event->arguments(0);
		if(!$page instanceof Page) return;
		$key = "page:$page->id";
		if(!isset($this->changesPending[$key])) return;
		$row = $this->changesPending[$key];
		unset($this->changesPending[$key]);
		$id = $this->changeWrite('page', (int) $page->id, 0, $row['action'], $row['diff']);
		if($id) $this->changesPageRows[(int) $page->id] = $id;
	}

	/**
	 * Hook after Pages::savedField: a page's one-field save in the admin (ProcessPageEdit's AJAX
	 * save, as an upload makes it), which moves `modified` without Pages::saveReady. Called only
	 * when the field's save succeeded, so no pending row is needed.
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookChangePageFieldSaved(HookEvent $event) {
		$page = $event->arguments(0);
		$field = $event->arguments(1);
		if(!$page instanceof Page || !$page->id || !$field instanceof Field || !$this->changeLogPages()) return;
		$id = $this->changeWrite('page', (int) $page->id, 0, 'saved', array((string) $field->name => null));
		if($id) $this->changesPageRows[(int) $page->id] = $id;
	}

	/**
	 * Hook after Pages::moved, Pages::trashed and Pages::deleted: the row this request wrote for
	 * the page's save takes the action; without one (a delete) a row of its own
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookChangePageAction(HookEvent $event) {
		$page = $event->arguments(0);
		if(!$page instanceof Page || !$page->id || !$this->changeLogPages()) return;
		$action = $event->method;
		$id = (int) $page->id;
		if($action !== 'deleted' && isset($this->changesPageRows[$id])) {
			try {
				$query = $this->wire()->database->prepare('UPDATE `' . self::changesTable . '` SET action=:action WHERE id=:id');
				$query->bindValue(':action', $action);
				$query->bindValue(':id', $this->changesPageRows[$id], \PDO::PARAM_INT);
				$query->execute();
			} catch(\Exception $e) {
				$this->changeError($e);
			}
			return;
		}
		$diff = $action === 'deleted' ? array('name' => array((string) $page->name, null)) : array();
		$row = $this->changeWrite('page', $id, 0, $action, $diff);
		if($row && $action !== 'deleted') $this->changesPageRows[$id] = $row;
	}

	/**
	 * Is this a request whose page saves are logged: an admin page, a logged-in user, not the CLI
	 *
	 * @return bool
	 *
	 */
	protected function changeLogPages() {
		if(PHP_SAPI === 'cli') return false;
		$page = $this->wire()->page;
		$user = $this->wire()->user;
		return $page && $page->template && $page->template->name === 'admin' && $user && $user->isLoggedin();
	}

	/**
	 * The log's kind for a Fields or Templates instance ('' for anything else)
	 *
	 * @param mixed $items
	 * @return string
	 *
	 */
	protected function changeItemKind($items) {
		if($items instanceof Fields) return 'field';
		if($items instanceof Templates) return 'template';
		return '';
	}

	/**
	 * The stored row of a field or template, flattened: its columns, then its `data` keys
	 *
	 * @param WireSaveableItems $items
	 * @param int $id
	 * @return array|null null when there is no row
	 *
	 */
	protected function changeStoredRow(WireSaveableItems $items, $id) {
		$database = $this->wire()->database;
		$table = $database->escapeTable($items->getTable());
		$query = $database->prepare("SELECT * FROM `$table` WHERE id=:id");
		$query->bindValue(':id', (int) $id, \PDO::PARAM_INT);
		$query->execute();
		$row = $query->fetch(\PDO::FETCH_ASSOC);
		$query->closeCursor();
		if(!is_array($row)) return null;
		$data = isset($row['data']) ? wireDecodeJSON((string) $row['data']) : array();
		unset($row['id'], $row['data']);
		return array_merge($row, is_array($data) ? $data : array());
	}

	/**
	 * What a save of the field or template is about to store, flattened as changeStoredRow()
	 *
	 * @param Saveable $item
	 * @return array
	 *
	 */
	protected function changeItemRow(Saveable $item) {
		$row = $item->getTableData();
		$data = isset($row['data']) && is_array($row['data']) ? $row['data'] : array();
		unset($row['id'], $row['data']);
		foreach($data as $key => $value) {
			if(strpos((string) $key, '_') === 0) unset($data[$key]);
		}
		return array_merge($row, $data);
	}

	/**
	 * Property => array(old, new) for every key whose value differs (empty values are alike)
	 *
	 * @param array $old
	 * @param array $new
	 * @return array
	 *
	 */
	protected function changeDiff(array $old, array $new) {
		$diff = array();
		foreach(array_keys($old + $new) as $key) {
			$a = array_key_exists($key, $old) ? $old[$key] : null;
			$b = array_key_exists($key, $new) ? $new[$key] : null;
			if($key === 'columnWidth') {
				if((int) $a === 100) $a = null;
				if((int) $b === 100) $b = null;
			}
			if($this->changeNorm($a) === $this->changeNorm($b)) continue;
			$diff[(string) $key] = array($this->changeScalar($a), $this->changeScalar($b));
		}
		return $diff;
	}

	/**
	 * A value as a comparable string: empty values (null, '', 0, false, empty arrays) are '',
	 * arrays compared by their non-empty values, objects by their string form
	 *
	 * @param mixed $value
	 * @return string
	 *
	 */
	protected function changeNorm($value) {
		$value = $this->changeScalar($value);
		if(is_array($value)) {
			$a = array();
			foreach($value as $k => $v) {
				$v = $this->changeNorm($v);
				if($v !== '') $a[$k] = $v;
			}
			return count($a) ? json_encode($a) : '';
		}
		if(empty($value)) return '';
		if($value === true) return '1';
		return (string) $value;
	}

	/**
	 * Objects as their string form (a Fieldtype is its class name), anything else unchanged
	 *
	 * @param mixed $value
	 * @return mixed
	 *
	 */
	protected function changeScalar($value) {
		if(!is_object($value)) return $value;
		if(method_exists($value, '__toString')) return (string) $value;
		return wireClassName($value);
	}

	/**
	 * A diff as JSON of at most changeDiffMax bytes: strings cut to 200, then 60 characters, then
	 * the values dropped (names only), then the names past the limit counted in `_more`
	 *
	 * @param array $diff
	 * @return string
	 *
	 */
	protected function changeDiffJson(array $diff) {
		$flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR;
		foreach(array(200, 60, 0) as $cap) {
			$cut = array();
			foreach($diff as $key => $value) {
				if($cap === 0) {
					$cut[$key] = null;
				} else if(is_array($value) && count($value) === 2 && array_keys($value) === array(0, 1)) {
					$cut[$key] = array($this->changeCut($value[0], $cap), $this->changeCut($value[1], $cap));
				} else {
					$cut[$key] = $this->changeCut($value, $cap * 5);
				}
			}
			$json = (string) json_encode($cut, $flags);
			if(strlen($json) <= self::changesDiffMax) return $json;
		}
		$keep = array();
		$more = count($diff);
		foreach(array_keys($diff) as $key) {
			$try = $keep;
			$try[mb_substr((string) $key, 0, 60)] = null;
			$try['_more'] = $more - 1;
			if(strlen((string) json_encode($try, $flags)) > self::changesDiffMax) break;
			unset($try['_more']);
			$keep = $try;
			$more--;
		}
		if($more) $keep['_more'] = $more;
		return (string) json_encode($keep, $flags);
	}

	/**
	 * A value cut to $cap characters: a long string ends in an ellipsis, an array whose JSON is
	 * longer becomes that JSON cut
	 *
	 * @param mixed $value
	 * @param int $cap
	 * @return mixed
	 *
	 */
	protected function changeCut($value, $cap) {
		$value = $this->changeScalar($value);
		if(is_array($value)) {
			$json = (string) json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
			if(strlen($json) <= $cap) return $value;
			$value = $json;
		}
		if(is_string($value) && mb_strlen($value) > $cap) return mb_substr($value, 0, $cap) . '…';
		return $value;
	}

	/**
	 * Write a row to the log (creating the table if missing; pruning at most once an hour)
	 *
	 * @param string $kind
	 * @param int $objectId
	 * @param int $contextId
	 * @param string $action
	 * @param array $diff
	 * @return int The row's id, 0 when nothing was written
	 *
	 */
	protected function changeWrite($kind, $objectId, $contextId, $action, array $diff) {
		if(!$this->changeTableReady()) return 0;
		$database = $this->wire()->database;
		$user = $this->wire()->user;
		try {
			$query = $database->prepare('INSERT INTO `' . self::changesTable . '` SET ts=:ts, users_id=:users_id, kind=:kind, ' .
				'object_id=:object_id, context_id=:context_id, action=:action, tab=:tab, diff=:diff');
			$query->bindValue(':ts', time(), \PDO::PARAM_INT);
			$query->bindValue(':users_id', $user ? (int) $user->id : 0, \PDO::PARAM_INT);
			$query->bindValue(':kind', $kind);
			$query->bindValue(':object_id', (int) $objectId, \PDO::PARAM_INT);
			$query->bindValue(':context_id', (int) $contextId, \PDO::PARAM_INT);
			$query->bindValue(':action', $action);
			$query->bindValue(':tab', $this->changeTab());
			$query->bindValue(':diff', count($diff) ? $this->changeDiffJson($diff) : null, count($diff) ? \PDO::PARAM_STR : \PDO::PARAM_NULL);
			$query->execute();
			$id = (int) $database->lastInsertId();
		} catch(\Exception $e) {
			$this->changeError($e);
			return 0;
		}
		$this->changePrune();
		return $id;
	}

	/**
	 * Delete rows older than getChangesDays(), at most once an hour
	 *
	 */
	protected function changePrune() {
		$cache = $this->wire()->cache;
		if($cache->get(self::changesPruneCache)) return;
		$cache->save(self::changesPruneCache, time(), 3600);
		try {
			$query = $this->wire()->database->prepare('DELETE FROM `' . self::changesTable . '` WHERE ts<:ts');
			$query->bindValue(':ts', time() - $this->getChangesDays() * 86400, \PDO::PARAM_INT);
			$query->execute();
		} catch(\Exception $e) {
			$this->changeError($e);
		}
	}

	/**
	 * Make sure the log's table exists (on install, and lazily before a write: an upgrade or a
	 * deploy by plain copy finds it missing)
	 *
	 * @param bool $recheck Ask the database even when this request already knows
	 * @return bool
	 *
	 */
	public function changeTableReady($recheck = false) {
		if($this->changesTableOk !== null && !$recheck) return $this->changesTableOk;
		$database = $this->wire()->database;
		$config = $this->wire()->config;
		try {
			if(!$database->tableExists(self::changesTable)) {
				$engine = $database->escapeStr((string) $config->dbEngine);
				$charset = $database->escapeStr((string) $config->dbCharset);
				$database->exec('CREATE TABLE `' . self::changesTable . '` (' .
					'id INT UNSIGNED NOT NULL AUTO_INCREMENT, ' .
					'ts INT UNSIGNED NOT NULL, ' .
					'users_id INT UNSIGNED NOT NULL DEFAULT 0, ' .
					'kind VARCHAR(16) NOT NULL, ' .
					'object_id INT UNSIGNED NOT NULL, ' .
					'context_id INT UNSIGNED NOT NULL DEFAULT 0, ' .
					'action VARCHAR(16) NOT NULL, ' .
					'tab VARCHAR(64) NOT NULL DEFAULT \'\', ' .
					'diff TEXT NULL, ' .
					'PRIMARY KEY (id), ' .
					'INDEX kind_object (kind, object_id), ' .
					'INDEX ts (ts)' .
					") ENGINE=$engine DEFAULT CHARSET=$charset");
			}
			$this->changesTableOk = true;
		} catch(\Exception $e) {
			$this->changeError($e);
			$this->changesTableOk = false;
		}
		return $this->changesTableOk;
	}

	/**
	 * Drop the log's table (uninstall)
	 *
	 */
	protected function changeTableDrop() {
		try {
			$this->wire()->database->exec('DROP TABLE IF EXISTS `' . self::changesTable . '`');
		} catch(\Exception $e) {
			$this->changeError($e);
		}
		$this->changesTableOk = null;
	}

	/**
	 * A failure of the log never stops the save it describes: it goes to the `bridge-changes` log
	 *
	 * @param \Exception $e
	 *
	 */
	protected function changeError(\Exception $e) {
		$log = $this->wire()->log;
		if($log) $log->save('bridge-changes', $e->getMessage());
	}
}

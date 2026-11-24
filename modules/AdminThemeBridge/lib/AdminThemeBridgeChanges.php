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
 * saving tab's id, step 04 fills it) and `diff`, JSON of at most changeDiffMax bytes:
 *  - field, template, context: property => array(old, new), long values cut;
 *  - fieldgroup: `added` and `removed` (field ids), `reordered` (true when the order alone moved);
 *  - page: each changed property => null (no values), `name`, `parent`, `template` => array(old, new).
 *
 * Old values of a field or template come from its stored row, read in `saveReady` before the
 * UPDATE (core keeps no old values: trackChangesValues is never on, and `label` is not tracked);
 * the row is written in `saved`, so a failed save writes nothing, nor does a save with no change.
 * Page saves are logged only for admin requests of a logged-in user, not from the CLI or the front
 * end. Rows older than getChangesDays() go at most once an hour, on write.
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
	 * changeDeps() as the JSON _head.php prints, safe inside `<script>`; '' when there is none
	 *
	 * Internal: not on the extension surface.
	 *
	 * @return string
	 *
	 */
	public function changeDepsJson() {
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
			$query->bindValue(':tab', '');
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

<?php namespace ProcessWire;

/**
 * AdminThemeBridge: the masthead's live search looks in every single-line text field (1.8.0)
 *
 * Upstream's live search matches the fields named in ProcessPageSearch's settings, `title` by
 * default. Here it matches every field whose type is Text or one of its kinds (Page Title, Email,
 * URL and their multi-language versions), in every language; Textarea and its kinds stay out.
 * Each result names the field that matched, after the template: `basic-page · Subtitle`, with the
 * language when it is not the user's own.
 *
 * How: the search's fields become one name that no field has (searchField), and PageFinder asks
 * hooks what an unknown field is. The answer is a join on one derived table, a UNION of one
 * SELECT per field table with the user's operator on every language column. A field with access
 * control counts only on the templates where the user may view it. PageFinder does the rest as
 * for any selector (page access, status, trash, repeaters, users, start and limit).
 * Upstream's way, `title|subtitle|...`, would join each field table once per language and can
 * reach MySQL's 61-table limit on a big multi-language site.
 *
 * Part of the AdminThemeBridge class, split by job into traits (audit PA1); `$this` is the theme.
 *
 */
trait AdminThemeBridgeSearch {

	/**
	 * Hooks for the live search, on ProcessPageSearch requests only
	 *
	 */
	protected function hookSearch() {
		$this->addHookAfter('ProcessPageSearchLive::getDefaultPageSearchFields', function(HookEvent $event) {
			if(count($this->searchTextFields())) $event->return = array(self::searchField);
		});
		$this->addHookAfter('PageFinder::getQueryUnknownField', $this, 'hookSearchQuery');
		$this->addHookAfter('ProcessPageSearchLive::execute', $this, 'hookSearchResults');
	}

	/**
	 * The single-line text fields that this user may view on at least one template
	 *
	 * @return array
	 *
	 */
	protected function searchTextFields() {
		if($this->searchText !== null) return $this->searchText;
		$this->searchText = array();
		$user = $this->wire()->user;
		$su = $user->isSuperuser();
		$languages = $this->wire()->languages;
		foreach($this->wire()->fields as $field) {
			$type = $field->type;
			if(!$type instanceof FieldtypeText || $type instanceof FieldtypeTextarea) continue;
			$ids = array();
			$all = true;
			foreach($field->getTemplates() as $template) {
				$context = $template->fieldgroup->getFieldContext($field);
				if(!$su && $context && $context->useRoles && !$context->viewable(null, $user)) {
					$all = false;
				} else {
					$ids[] = (int) $template->id;
				}
			}
			if(!count($ids)) continue;
			$this->searchText[$field->name] = array($field, $all ? null : $ids, $languages && $type instanceof FieldtypeLanguageInterface);
		}
		return $this->searchText;
	}

	/**
	 * Hook after PageFinder::getQueryUnknownField: searchField joins the pages that have the value
	 * in any text field, in any language
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookSearchQuery(HookEvent $event) {
		if($event->return || $event->arguments(0) !== self::searchField) return;
		$data = $event->arguments(1);
		/** @var DatabaseQuerySelect $query */
		$query = $data['query'];
		/** @var Selector $selector */
		$selector = $data['selector'];
		// operators that LIKE can answer on any column (Email and URL have no fulltext index)
		$operator = $selector->operator;
		if(!in_array($operator, array('=', '%=', '*=', '~=', '~|=', '~%=', '~|%=', '^=', '$=', '%^=', '%$='))) $operator = '%=';
		$values = array_values(array_filter(array_map('strval', $selector->values(true)), 'strlen'));
		$database = $this->wire()->database;
		$columns = array('data');
		foreach($this->wire()->languages ?: array() as $language) {
			if(!$language->isDefault()) $columns[] = 'data' . (int) $language->id;
		}
		$selects = array();
		if(count($values)) foreach($this->searchTextFields() as $item) {
			list($field, $ids, $multi) = $item;
			// one match per column and value: given several columns or values at once, the fulltext
			// class ORs every word's condition, so `~=` would match any word instead of all
			$ors = array();
			foreach($multi ? $columns : array('data') as $column) foreach($values as $value) {
				$sub = $this->wire(new DatabaseQuerySelect());
				$sub->bindOption('global', true);
				$ft = $this->wire(new DatabaseQuerySelectFulltext($sub));
				$ft->forceLike(true);
				$ft->allowOrder(false);
				$ft->match('t', $column, $operator, $value);
				if(!count($sub->where)) continue;
				$ors[] = '(' . implode(' AND ', $sub->where) . ')';
				$sub->copyBindValuesTo($query);
			}
			if(!count($ors)) continue;
			$sql = 'SELECT t.pages_id FROM `' . $database->escapeTable($field->getTable()) . '` AS t ';
			if($ids) $sql .= 'JOIN pages AS tp ON tp.id=t.pages_id AND tp.templates_id IN(' . implode(',', $ids) . ') ';
			$selects[] = $sql . 'WHERE ' . implode(' OR ', $ors);
		}
		if(count($selects)) {
			$query->join('(' . implode(' UNION ', $selects) . ') AS bridge_search ON bridge_search.pages_id=pages.id');
		} else {
			$query->where('1>2');
		}
		$this->searchAsked = array($operator, $values);
		$event->return = true;
	}

	/**
	 * Hook after ProcessPageSearchLive::execute: each page found by searchField names the field
	 * that matched after its template (template_label, which the masthead shows)
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookSearchResults(HookEvent $event) {
		if(!$this->searchAsked) return;
		$json = is_string($event->return);
		$result = $json ? json_decode($event->return, true) : array('matches' => $event->return);
		if(empty($result['matches']) || !is_array($result['matches'])) return;
		$pages = $this->wire()->pages;
		foreach($result['matches'] as $key => $m) {
			if(empty($m['id']) || !isset($m['template_label'])) continue;
			$page = $pages->get((int) $m['id']);
			// module results (fields, templates...) carry IDs too: a page result's hint is its template name
			if(!$page->id || strpos($m['template_label'], $page->template->name) !== 0) continue;
			$label = $this->searchMatchedLabel($page);
			if($label !== '') $result['matches'][$key]['template_label'] .= " \u{00B7} $label";
		}
		$event->return = $json ? json_encode($result) : $result['matches'];
	}

	/**
	 * Label of the first field on the page whose value has what was searched (in the template's
	 * context), with the language in brackets when it is not the user's; blank when none has
	 *
	 * @param Page $page
	 * @return string
	 *
	 */
	protected function searchMatchedLabel(Page $page) {
		list($operator, $values) = $this->searchAsked;
		$user = $this->wire()->user;
		$languages = $this->wire()->languages;
		// the user's language first, then the others in their order
		$order = array();
		if($languages) {
			$order[] = $user->language;
			foreach($languages as $language) if($language->id !== $user->language->id) $order[] = $language;
		}
		$fieldgroup = $page->template->fieldgroup;
		foreach($fieldgroup as $field) {
			if(!isset($this->searchText[$field->name])) continue;
			list(, $ids) = $this->searchText[$field->name];
			if($ids && !in_array((int) $page->templates_id, $ids, true)) continue;
			$value = $page->getUnformatted($field->name);
			$texts = array();
			if($value instanceof LanguagesPageFieldValue) {
				foreach($order as $language) $texts[] = array($language, (string) $value->getLanguageValue($language->id));
			} else {
				$texts[] = array(null, (string) $value);
			}
			foreach($texts as $text) {
				list($language, $text) = $text;
				if(!$this->searchTextHas($text, $operator, $values)) continue;
				$label = $fieldgroup->getFieldContext($field)->getLabel();
				if($language && $language->id !== $user->language->id) $label .= ' (' . $language->get('title|name') . ')';
				return $label;
			}
		}
		return '';
	}

	/**
	 * Does the text have any of the values: the phrase, or for the word operators (~) each word?
	 *
	 * @param string $text
	 * @param string $operator
	 * @param array $values
	 * @return bool
	 *
	 */
	protected function searchTextHas($text, $operator, array $values) {
		if($text === '') return false;
		foreach($values as $value) {
			$words = $operator[0] === '~' ? preg_split('/\s+/u', $value, -1, PREG_SPLIT_NO_EMPTY) : array($value);
			$any = strpos($operator, '|') !== false;
			$hits = 0;
			foreach($words as $word) if(mb_stripos($text, $word) !== false) $hits++;
			if($hits && ($any || $hits === count($words))) return true;
		}
		return false;
	}
}

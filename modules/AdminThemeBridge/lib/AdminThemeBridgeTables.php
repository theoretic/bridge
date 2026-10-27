<?php namespace ProcessWire;

/**
 * AdminThemeBridge: Data tables: the inline initTable() rewrite and sortable core tables
 *
 * Part of the AdminThemeBridge class, split by job into traits (audit PA1); `$this` is the theme.
 * Constants and properties stay in AdminThemeBridge.module.php.
 *
 */
trait AdminThemeBridgeTables {

	/**
	 * Hook after MarkupAdminDataTable::render: its inline `initTable($('#id'))` gets the element
	 * itself where jQuery is not on the page (the runtime's AdminDataTable takes either)
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookDataTableRender(HookEvent $event) {
		$out = $event->return;
		if(!is_string($out) || strpos($out, "AdminDataTable.initTable($('#") === false) return;
		$event->return = preg_replace('~AdminDataTable\.initTable\(\$\(\'#([^\']+)\'\)\)~',
			'AdminDataTable.initTable(window.jQuery ? jQuery(\'#$1\') : document.getElementById(\'$1\'))', $out);
	}

	/**
	 * Hook before MarkupAdminDataTable::render: a table sortableDataTable() accepts sorts by its
	 * headers, also when its maker called setSortable(false); a column whose header has no text (a
	 * checkbox or icon column) does not sort (`th.sorter-false`, honoured by both sorters)
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookDataTableRenderBefore(HookEvent $event) {
		$table = $event->object;
		if(!$table instanceof MarkupAdminDataTable || $table->sortable) return;
		if(!$this->sortableDataTable($table, $this->dataTableMaker())) return;
		$table->setSortable(true);
		foreach(array_values((array) $table->headerRow) as $n => $th) {
			$label = is_array($th) ? (string) reset($th) : (string) $th;
			$text = preg_replace('/[\s\x{00A0}]+/u', '', strip_tags(html_entity_decode($label, ENT_QUOTES, 'UTF-8')));
			if($text === '' || $text === null) $table->setColNotSortable($n);
		}
	}

	/**
	 * File of the code that rendered the data table being hooked (first frame outside wire/core,
	 * which only runs the hook, and outside this module)
	 *
	 * @return string
	 *
	 */
	protected function dataTableMaker() {
		$core = $this->wire()->config->paths->core;
		foreach(debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 16) as $frame) {
			// core only runs the hook; the theme's own files (module and lib/) only pass the call on
			if(empty($frame['file']) || $this->isUnder($frame['file'], $core) || $this->isUnder($frame['file'], dirname(__DIR__))) continue;
			return $frame['file'];
		}
		return '';
	}

	/**
	 * Should a data table that its maker made unsortable sort by its headers under this theme?
	 *
	 * Hook after to opt a module's table in or out. By default: tables made by core modules
	 * (wire/modules) with a header row and at least two rows, except
	 *
	 * - the Lister's (`ProcessListerTable`): it sorts on the server by its own header links;
	 * - InputfieldCheckboxes' table mode (`pw-no-select`): the order of its rows is posted;
	 * - Sessions (ProcessSessionDB): the list is replaced every few seconds.
	 *
	 * A third-party table keeps its maker's choice (its row order may be its value).
	 *
	 * @param MarkupAdminDataTable $table
	 * @param string $maker File that rendered the table ('' when not known)
	 * @return bool
	 *
	 */
	public function ___sortableDataTable(MarkupAdminDataTable $table, $maker = '') {
		if(count((array) $table->headerRow) === 0 || count((array) $table->rows) < 2) return false;
		$classes = ' ' . $table->settings('class') . ' ' . $table->class . ' ';
		foreach(array('ProcessListerTable', 'pw-no-select') as $class) {
			if(strpos($classes, " $class ") !== false) return false;
		}
		$process = $this->wire()->process;
		if($process instanceof Process && wireInstanceOf($process, 'ProcessSessionDB')) return false;
		return $this->isUnder($maker, $this->wire()->config->paths->modules);
	}
}

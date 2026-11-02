<?php namespace ProcessWire;

/**
 * AdminThemeBridge: the page tree and history drawers beside the logo (0.25.0)
 *
 * Part of the AdminThemeBridge class, split by job into traits; `$this` is the theme. Constants
 * and properties stay in AdminThemeBridge.module.php.
 *
 * With the `pageTreeDrawer` setting on, every admin screen but the page tree itself shows a tree
 * button right of the logo; with `history` on, a history button after it. Each opens a native
 * `<dialog class='pw-drawer'>` printed after the masthead (scripts/drawers.js): the page tree
 * drawer holds a `<template>` the script clones on the first open, the history drawer's body is
 * fetched (`?bridgeHistory=1`, AdminThemeBridgeHistory). Modal windows and guests get neither.
 *
 */
trait AdminThemeBridgeDrawers {

	/**
	 * The drawers this request shows, in masthead order: 'tree', 'history'
	 *
	 * @return array
	 *
	 */
	public function drawerNames() {
		if(!$this->isLoggedIn || $this->isModal || $this->wire()->input->get('modal')) return array();
		$names = array();
		if($this->pageTreeDrawer && $this->treeDrawerAllowed()) $names[] = 'tree';
		if($this->history) $names[] = 'history';
		return $names;
	}

	/**
	 * May this request show the page tree drawer? The user has the page tree's permission and the
	 * screen is not the page tree itself
	 *
	 * @return bool
	 *
	 */
	protected function treeDrawerAllowed() {
		$page = $this->wire()->page;
		// the process field may hold the module itself (instantiated): compare its name (BG3)
		if($page && (string) $page->process === 'ProcessPageList') return false;
		$permission = (string) $this->wire()->modules->getModuleInfoProperty('ProcessPageList', 'permission');
		$user = $this->wire()->user;
		return $permission === '' || $user->isSuperuser() || $user->hasPermission($permission);
	}

	/**
	 * The drawers' labels: button, dialog name, close button
	 *
	 * @param string $key 'tree', 'history' or 'close'
	 * @return string
	 *
	 */
	public function drawerLabel($key) {
		switch($key) {
			case 'tree': return __('Page tree', __FILE__);
			case 'history': return __('History', __FILE__);
			case 'close': return __('Close', __FILE__);
		}
		return $key;
	}

	/**
	 * The masthead's drawer buttons, right of the logo; '' when no drawer applies
	 *
	 * @return string
	 *
	 */
	public function renderDrawerButtons() {
		$names = $this->drawerNames();
		if(!count($names)) return '';
		$sanitizer = $this->wire()->sanitizer;
		$icons = array('tree' => 'sitemap', 'history' => 'history');
		$out = '';
		foreach($names as $name) {
			$label = $sanitizer->entities1($this->drawerLabel($name));
			$out .= "<button type='button' class='pw-drawer-button' data-pw-drawer='$name' aria-controls='pw-drawer-$name' aria-expanded='false' " .
				"title='$label' aria-label='$label'><i class='fa fa-fw fa-$icons[$name]' aria-hidden='true'></i></button>";
		}
		return "<div class='pw-drawer-buttons'>$out</div>";
	}

	/**
	 * The drawers themselves, one `<dialog>` per button, printed after the masthead; '' for none
	 *
	 * @return string
	 *
	 */
	public function renderDrawers() {
		$names = $this->drawerNames();
		if(!count($names)) return '';
		$sanitizer = $this->wire()->sanitizer;
		$close = $sanitizer->entities1($this->drawerLabel('close'));
		$out = '';
		foreach($names as $name) {
			$label = $sanitizer->entities1($this->drawerLabel($name));
			$extra = $name === 'tree' ? "<template class='pw-drawer-template'>" . $this->renderTreeDrawerContent() . "</template>" : '';
			$out .= "<dialog class='pw-drawer' id='pw-drawer-$name' aria-label='$label' data-pw-drawer-name='$name'>" .
				"<div class='pw-drawer-head'><h2 class='pw-drawer-title'>$label</h2>" .
				"<button type='button' class='pw-drawer-close' aria-label='$close' title='$close'><i class='fa fa-fw fa-times' aria-hidden='true'></i></button></div>" .
				"<div class='pw-drawer-body'></div>$extra</dialog>";
		}
		return $out;
	}

	/**
	 * The page tree drawer's template content (filled in by the page tree step)
	 *
	 * @return string
	 *
	 */
	protected function renderTreeDrawerContent() {
		return '';
	}
}

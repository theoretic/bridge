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
	 * The drawers this request shows, in masthead order: 'tree', 'history', then the drawers
	 * extensions fill (the `drawer` slot, extensionDrawers(): 'ext-<name>')
	 *
	 * Hookable (on the extension surface): an after hook may drop names; a name added here needs
	 * a drawer behind it (renderDrawers() prints only the ones it knows).
	 *
	 * @return array
	 *
	 */
	public function ___drawerNames() {
		if(!$this->isLoggedIn || $this->isModal || $this->wire()->input->get('modal')) return array();
		$names = array();
		if($this->pageTreeDrawer && $this->treeDrawerAllowed()) $names[] = 'tree';
		if($this->history) $names[] = 'history';
		foreach(array_keys($this->extensionDrawers()) as $name) $names[] = $name;
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
	 * The drawers' labels: button, dialog name, close button, the history's Clear button
	 *
	 * @param string $key 'tree', 'history', 'close' or 'clear'
	 * @return string
	 *
	 */
	public function drawerLabel($key) {
		switch($key) {
			case 'tree': return __('Page tree', __FILE__);
			case 'history': return __('History', __FILE__);
			case 'close': return __('Close', __FILE__);
			case 'clear': return __('Clear', __FILE__); // the history drawer's button (0.26.0)
		}
		$drawers = $this->extensionDrawers();
		return isset($drawers[$key]) ? $drawers[$key]['label'] : $key;
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
		foreach($this->extensionDrawers() as $key => $drawer) $icons[$key] = $drawer['icon'];
		$out = '';
		foreach($names as $name) {
			if(!isset($icons[$name])) continue; // a name a hook added, with no drawer behind it
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
		$extensionDrawers = $this->extensionDrawers();
		$out = '';
		foreach($names as $name) {
			$isExtension = isset($extensionDrawers[$name]);
			if(!$isExtension && $name !== 'tree' && $name !== 'history') continue;
			$label = $sanitizer->entities1($this->drawerLabel($name));
			$extra = $name === 'tree' ? "<template class='pw-drawer-template'>" . $this->renderTreeDrawerContent() . "</template>" : '';
			// an extension's drawer: its body as the extension gave it (it escapes its own output)
			$body = $isExtension ? $extensionDrawers[$name]['content'] : '';
			$slot = $isExtension ? " data-bridge-slot='drawer' data-bridge-extension='" . $sanitizer->entities($extensionDrawers[$name]['extension']) . "'" : '';
			// the history's Clear button (0.26.0): no data-pw-drawer, that marks the masthead toggles
			$action = '';
			if($name === 'history') {
				$csrf = $this->wire()->session->CSRF;
				$action = "<button type='button' class='pw-drawer-action pw-history-clear' data-token-name='" . $sanitizer->entities($csrf->getTokenName()) . "' " .
					"data-token-value='" . $sanitizer->entities($csrf->getTokenValue()) . "'>" . $sanitizer->entities1($this->drawerLabel('clear')) . "</button>";
			}
			$out .= "<dialog class='pw-drawer' id='pw-drawer-$name' aria-label='$label' data-pw-drawer-name='$name'$slot>" .
				"<div class='pw-drawer-head'><h2 class='pw-drawer-title'>$label</h2>$action" .
				"<button type='button' class='pw-drawer-close' aria-label='$close' title='$close'><i class='fa fa-fw fa-times' aria-hidden='true'></i></button></div>" .
				"<div class='pw-drawer-body'>$body</div>$extra</dialog>";
		}
		return $out;
	}

	/**
	 * The page tree drawer's template content: a tree container with its own options
	 *
	 * No id='PageListContainer' (the page editor's Children tab has it) and no global options: the
	 * runtime (fields/pagelist.ts) reads data-pw-tree over ProcessWire.config.ProcessPageList.
	 *
	 * @return string
	 *
	 */
	protected function renderTreeDrawerContent() {
		$sanitizer = $this->wire()->sanitizer;
		$csrf = $this->wire()->session->CSRF;
		$json = json_encode($this->treeDrawerOptions());
		if($json === false) $json = '{}';
		return "<div class='PageListContainer PageListContainerRoot pw-drawer-tree' data-pw-tree='" . $sanitizer->entities($json) . "' " .
			"data-token-name='" . $sanitizer->entities($csrf->getTokenName()) . "' data-token-value='" . $sanitizer->entities($csrf->getTokenValue()) . "'></div>";
	}

	/**
	 * Options of the drawer's page tree: a root tree (home page shown) as ProcessPageList's
	 * renderReady() sets them, with the branches the user left open in it (treeDrawerCookie)
	 *
	 * The global ProcessWire.config.ProcessPageList is left as it was: the page editor's Children
	 * tab has its own tree there (rootPageID = the edited page, root hidden).
	 *
	 * @return array
	 *
	 */
	public function treeDrawerOptions() {
		$config = $this->wire()->config;
		$was = $config->get('ProcessPageList');
		$shared = array_key_exists('ProcessPageList', $config->js());
		$options = array();
		try {
			// a fresh instance with the module's settings, not the one the page editor's Children tab
			// may hold, and no init(): it would add the jQuery UI scripts to $config->scripts
			$modules = $this->wire()->modules;
			$list = $modules->includeModule('ProcessPageList') ? $this->wire(new ProcessPageList()) : null;
			if($list) {
				foreach((array) $modules->getConfig('ProcessPageList') as $key => $value) $list->set($key, $value);
				// what init() takes from $config->pageList, so the drawer's tree behaves as the screen's
				$settings = $config->pageList;
				if(is_array($settings)) {
					if(!empty($settings['useHoverActions'])) $list->set('useHoverActions', true);
					$list->set('hoverActionDelay', isset($settings['hoverActionDelay']) ? (int) $settings['hoverActionDelay'] : 100);
					$list->set('hoverActionFade', isset($settings['hoverActionFade']) ? (int) $settings['hoverActionFade'] : 100);
					if(!empty($settings['limit'])) $list->set('limit', (int) $settings['limit']);
				}
				$list->set('id', 0);
				$list->set('showRootPage', true);
				// renderReady() merges whatever $config->ProcessPageList already holds over its own
				$config->set('ProcessPageList', null);
				$list->renderReady();
				$options = $config->js('ProcessPageList');
			}
		} catch(\Throwable $e) {
			$options = array();
		}
		$config->set('ProcessPageList', $was);
		if(!$shared) {
			// renderReady() shared the key with the client: take it back, the page did not have it
			$fields = new \ReflectionProperty($config, 'jsFields');
			$fields->setValue($config, array_values(array_diff((array) $fields->getValue($config), array('ProcessPageList'))));
		}
		if(!is_array($options)) $options = array();
		$options['rootPageID'] = 0;
		$options['showRootPage'] = true;
		$options['openPageIDs'] = $this->treeDrawerOpenIDs();
		$options['openPageData'] = array();
		$options['openPagination'] = 0;
		$options['start'] = 0;
		// its open branches, the same on every screen (the tree screen's cookie is per path)
		$options['cookieName'] = self::treeDrawerCookie;
		$options['cookiePath'] = (string) $config->urls->admin;
		return $options;
	}

	/**
	 * The branches the user left open in the drawer's tree (its own cookie, treeDrawerCookie,
	 * "id-start"), only pages that exist and the user may list
	 *
	 * @return array of "id-start" strings
	 *
	 */
	protected function treeDrawerOpenIDs() {
		$pages = $this->wire()->pages;
		$ids = array();
		foreach($this->wire()->input->cookie->array(self::treeDrawerCookie) as $value) {
			$parts = explode('-', (string) $value, 2);
			$id = (int) $parts[0];
			$start = isset($parts[1]) ? max(0, (int) $parts[1]) : 0;
			if($id < 1 || isset($ids["$id-$start"])) continue;
			$p = $pages->get($id);
			if(!$p->id || !$p->listable()) continue;
			$ids["$id-$start"] = "$id-$start";
		}
		return array_values($ids);
	}
}

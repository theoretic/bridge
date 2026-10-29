<?php namespace ProcessWire;

/**
 * AdminThemeBridge: The shell: colours, logo, notices, title, labels, navigation, breadcrumbs, Add New
 *
 * Part of the AdminThemeBridge class, split by job into traits (audit PA1); `$this` is the theme.
 * Constants and properties stay in AdminThemeBridge.module.php.
 *
 */
trait AdminThemeBridgeShell {

	/**
	 * Current colour variant, validated
	 *
	 * @return string
	 *
	 */
	public function getVariant() {
		$variant = (string) $this->get('variant');
		if(!in_array($variant, $this->variants, true)) $variant = 'blue';
		if($variant === 'custom' && $this->getPrimaryColor() === '') $variant = 'blue';
		return $variant;
	}

	/**
	 * Custom primary colour as #rrggbb, or '' when unset or invalid
	 *
	 * @return string
	 *
	 */
	public function getPrimaryColor() {
		$color = trim((string) $this->get('primaryColor'));
		return preg_match('/^#[0-9a-f]{6}$/i', $color) ? strtolower($color) : '';
	}

	/**
	 * Colour scheme setting: auto, light or dark
	 *
	 * @return string
	 *
	 */
	public function getColorScheme() {
		$scheme = (string) $this->get('colorScheme');
		return in_array($scheme, array('auto', 'light', 'dark'), true) ? $scheme : 'auto';
	}

	/**
	 * Attributes for <html>: variant, scheme (when not auto) and the custom primary
	 *
	 * @return string
	 *
	 */
	public function renderHtmlAttributes() {
		$variant = $this->getVariant();
		$out = " data-pw-variant='$variant'";
		$scheme = $this->getColorScheme();
		if($scheme !== 'auto') $out .= " data-pw-scheme='$scheme'";
		if($variant === 'custom') $out .= " style='--pw-primary:" . $this->getPrimaryColor() . "'";
		return $out;
	}

	/**
	 * Is this URL an asset of another admin theme module (AdminThemeUikit, AdminThemeBoss, ...)?
	 *
	 * Matches a path segment /AdminTheme<Name>/ other than this theme's. Core's shared
	 * wire/templates-admin/styles/AdminTheme.css is not a theme module asset and is kept.
	 *
	 * @param string $url
	 * @return bool
	 *
	 */
	public function isOtherThemeAsset($url) {
		// UIkit's script, added by a module, is that module's request for UIkit (ADR 0017)
		if(self::isUikitScript($url)) return false;
		return (bool) preg_match('~/AdminTheme(?!Bridge/)[A-Za-z0-9]+/~', (string) $url);
	}

	/**
	 * Logo markup: the configured image (light and optional dark version) or the theme's own mark
	 *
	 * @return string
	 *
	 */
	public function renderLogo() {
		$config = $this->wire()->config;
		$sanitizer = $this->wire()->sanitizer;
		$out = '';
		$hasDark = trim((string) $this->get('logoURLDark')) !== '' && trim((string) $this->get('logoURL')) !== '';
		foreach(array('logoURL' => 'pw-logo-light', 'logoURLDark' => 'pw-logo-dark') as $key => $class) {
			$url = trim((string) $this->get($key));
			if($url === '') continue;
			if(!$hasDark) $class = ''; // a single logo is shown in both schemes
			if(strpos($url, '//') === false) $url = $config->urls->root . ltrim($url, '/');
			// the logo is the only content of its link: it names the link (audit SU3)
			$out .= "<img class='pw-logo pw-logo-custom $class' src='" . $sanitizer->entities($url) . "' alt='" . $sanitizer->entities1($this->shellLabel('home')) . "' />";
		}
		if($out !== '') return $out;
		return $this->renderNativeLogo();
	}

	/**
	 * Notices with a result class next to the upstream one: messages (confirmations such as
	 * "saved") pw-notice-success, warnings pw-notice-warning, errors pw-notice-error. Upstream
	 * classes stay, so module CSS and JS that target NoticeMessage etc. keep working.
	 *
	 * @param Notices|bool $notices
	 * @param array $options
	 * @return string|array
	 *
	 */
	public function renderNotices($notices, array $options = array()) {
		$options = array_merge(array(
			'messageClass' => 'NoticeMessage pw-notice-success',
			'warningClass' => 'NoticeWarning pw-notice-warning',
			'errorClass' => 'NoticeError pw-notice-error',
			// announced to assistive technology (audit SU7); id and class as upstream
			'listMarkup' => "<ul class='pw-notices' id='notices' role='status' aria-live='polite'>{out}</ul><!--/notices-->",
		), $options);
		return parent::renderNotices($notices, $options);
	}

	/**
	 * Is this the login screen (ProcessLogin for a guest)? It gets no masthead; the mark sits in the
	 * card title instead.
	 *
	 * @return bool
	 *
	 */
	public function isLoginScreen() {
		return !$this->isLoggedIn && $this->wire()->process instanceof ProcessLogin;
	}

	/**
	 * Browser title: upstream's, escaped in modal windows too, with the product named Bridge
	 *
	 * @return string
	 *
	 */
	public function getBrowserTitle() {
		$title = (string) parent::getBrowserTitle();
		$input = $this->wire()->input;
		// in a modal window upstream returns the Process headline as it is (audit B10)
		if($input->get('modal') && !strlen((string) $this->browserTitle) && !$this->wire('processBrowserTitle')) {
			$title = $this->wire()->sanitizer->entities1(strip_tags($title));
		}
		// the product is not ProcessWire (CLAUDE.md, ADR 0006): "Page • Bridge • host"
		return str_replace(array(' • ProcessWire', ' &bull; ProcessWire'), array(' • Bridge', ' &bull; Bridge'), $title);
	}

	/**
	 * The ProcessWire mark, read at runtime from the installed core (the file AdminThemeUikit
	 * renders), inlined unmodified. Bridge does not ship a copy: MPL 2.0 section 2.3 grants no
	 * trademark rights, so the mark stays the core's own file (ADR 0012). Falls back to the
	 * product name as text when a future core moves the file.
	 *
	 * @return string
	 *
	 */
	public function renderNativeLogo() {
		if($this->nativeLogo !== null) return $this->nativeLogo; // the login screen prints it twice
		$file = $this->wire()->config->paths->wire . 'modules/AdminTheme/AdminThemeUikit/themes/default/logo.svg';
		$svg = is_file($file) ? trim((string) file_get_contents($file)) : '';
		if(strpos($svg, '<svg') !== 0) return $this->nativeLogo = "<span class='pw-logo-text'>ProcessWire</span>";
		// accessible name only; shape, colour model (currentColor) and markup stay as shipped
		return $this->nativeLogo = (string) preg_replace('/^<svg\b/', "<svg role='img' aria-label='ProcessWire'", $svg, 1);
	}

	/**
	 * Icon set: Font Awesome 6 with the v4 shims, as AdminThemeUikit does, so icon pickers
	 * (field and template "icon" selects) offer the same list under both themes. Cores before
	 * 3.0.265 never call this and load Font Awesome 4.7, so the theme's own glyphs (theme.css)
	 * name the FontAwesome font as a fallback.
	 *
	 * @return array
	 *
	 */
	protected function getConfigAdminIcons() {
		$icons = parent::getConfigAdminIcons();
		if(empty($icons['version'])) $icons['version'] = '6.7.2';
		return $icons;
	}

	/**
	 * Labels for the runtime's own dialogs and tables (ProcessWire.config.AdminThemeBridge.labels,
	 * runtime/src/util/labels.ts), translated in this file's textdomain
	 *
	 * @return array
	 *
	 */
	public function runtimeLabels() {
		return array(
			'ok' => __('OK', __FILE__),
			'cancel' => __('Cancel', __FILE__),
			'close' => __('Close', __FILE__),
			'sortsPage' => __('Sorts the rows on this page', __FILE__),
			'requestFailed' => __('A request to the server failed. Reload the page and try again.', __FILE__),
			'toggle' => __('Open or close', __FILE__),
			'previous' => __('Previous', __FILE__),
			'next' => __('Next', __FILE__),
			'today' => __('Today', __FILE__), // the date picker's buttons
			'done' => __('Done', __FILE__),
			'partFailed' => __('A part of this screen failed to load. Reload the page to try again.', __FILE__),
			'saveNoAnswer' => __('The save got no answer from the server. Check the page and save again if needed.', __FILE__),
			'saveWaiting' => __('Waiting for the uploads to finish, then saving. Click again to save now, Esc to stop.', __FILE__),
		);
	}

	/**
	 * Labels the shell templates print (_masthead.php, _footer.php), translated in this file's
	 * textdomain: `$adminTheme->_()` in a template is looked up here while the language parser files
	 * it under the template, so a translation entered there was never used (audit B2)
	 *
	 * @param string $key
	 * @return string
	 *
	 */
	public function shellLabel($key) {
		switch($key) {
			case 'menu': return __('Menu', __FILE__);
			case 'mainNav': return __('Main', __FILE__); // the main navigation landmark
			case 'breadcrumbs': return __('Breadcrumbs', __FILE__);
			case 'skip': return __('Skip to content', __FILE__);
			case 'search': return __('Search', __FILE__);
			case 'home': return __('Home', __FILE__);
			case 'pagination': return __('Pagination', __FILE__);
			case 'display': return __('Display', __FILE__); // the group of scale and scheme buttons
			case 'smaller': return __('Smaller', __FILE__);
			case 'larger': return __('Larger', __FILE__);
			case 'basedOn': return __('based on ProcessWire %s', __FILE__); // %s is the core version
			case 'coloursFrom': return __('colours from %s', __FILE__); // %s is a link to AdminThemeBoss
		}
		return $key;
	}

	/**
	 * Render primary navigation from the framework's nav array
	 *
	 * @return string
	 *
	 */
	public function renderPrimaryNav() {
		$out = '';
		foreach($this->getPrimaryNavArray() as $item) {
			$out .= $this->renderNavItem($item, 0);
		}
		return "<ul class='pw-primary-nav'>$out</ul>";
	}

	/**
	 * Render one nav item (and children) as list markup
	 *
	 * @param array $item
	 * @param int $level
	 * @return string
	 *
	 */
	protected function renderNavItem(array $item, $level) {
		// markup follows AdminThemeUikit::renderPrimaryNavItem() so upstream main.js drives hover,
		// flyout submenus (jQuery UI menu) and AJAX submenus (pw-has-ajax-items + data-json) on
		// legacy pages; scripts/main.js gives the same behaviour on native pages
		$sanitizer = $this->wire()->sanitizer;
		$title = $sanitizer->entities1($item['title']);
		$url = $sanitizer->entities($item['url']);
		$id = (int) $item['id'];
		$parentId = (int) $item['parent_id'];
		$icon = empty($item['icon']) ? '' : $this->renderNavIcon($item['icon']);
		$children = empty($item['children']) ? array() : $item['children'];
		if($level === 0) {
			$class = "pw-nav-item pw-nav-item-top page-$id-";
			// current section: the request URL lies under this item's URL (Pages, Setup, ...)
			$current = (string) $this->wire()->input->url();
			$ariaCurrent = '';
			if(!empty($item['url']) && $item['url'] !== $this->wire()->urls->admin && strpos($current, $item['url']) === 0) {
				$class .= ' pw-current';
				$ariaCurrent = " aria-current='true'"; // the section of this page (audit SU1)
			}
			// top level is text only, as Uikit and Boss render it
			if(!count($children)) return "<li class='$class'><a href='$url'$ariaCurrent>$title</a></li>";
			$my = in_array($item['name'], array('access', 'page', 'module'), true) ? 'left top' : 'left-1 top';
			$out = "<li class='$class pw-nav-item-parent pw-dropdown'>" .
				"<a href='$url' id='prnav-page-$id' data-from='prnav-page-$parentId' class='pw-dropdown-toggle' aria-haspopup='true' aria-expanded='false'$ariaCurrent>$title</a>" .
				"<ul class='pw-dropdown-menu prnav' data-my='$my' data-at='left bottom' style='display:none'>";
			foreach($children as $child) $out .= $this->renderNavItem($child, $level + 1);
			return $out . "</ul></li>";
		}
		$out = "<li class='page-$id-'>";
		if(count($children)) {
			$out .= "<a class='pw-has-items' data-from='prnav-page-$parentId' href='$url'>$icon$title</a><ul>";
			foreach($children as $child) $out .= $this->renderNavItem($child, $level + 1);
			$out .= "</ul>";
		} else if(!empty($item['navJSON'])) {
			$json = $sanitizer->entities($item['navJSON']);
			$out .= "<a class='pw-has-items pw-has-ajax-items' data-from='prnav-page-$parentId' data-json='$json' href='$url'>$icon$title</a><ul></ul>";
		} else {
			$out .= "<a href='$url'>$icon$title</a>";
		}
		return $out . "</li>";
	}

	/**
	 * Render user navigation (view site, profile, logout)
	 *
	 * @return string
	 *
	 */
	public function renderUserNav() {
		$sanitizer = $this->wire()->sanitizer;
		$user = $this->wire()->user;
		$out = '';
		// attributes as AdminThemeUikit::renderUserNavItems() passes them (core 3.0.248 user nav
		// items may carry id, class, data-* and on* handlers): href, target, class, id, data-*, on*
		$allowAttrs = array('href', 'target', 'class', 'id');
		foreach($this->getUserNavArray() as $item) {
			if(isset($item['url'])) $item['href'] = $item['url'];
			$title = $sanitizer->entities1($item['title']);
			$icon = empty($item['icon']) ? '' : $this->renderNavIcon($item['icon']);
			$attrs = '';
			foreach($item as $name => $value) {
				if(!is_string($name) || is_array($value) || is_object($value)) continue;
				if(in_array($name, $allowAttrs, true) || strpos($name, 'data-') === 0 || strpos($name, 'on') === 0) {
					if($value === '' || $value === null) continue;
					$attrs .= " $name='" . $sanitizer->entities((string) $value) . "'";
				}
			}
			$out .= "<li><a$attrs>$icon$title</a></li>";
		}
		$name = $sanitizer->entities1($user->name);
		// the name links to the profile when the user may edit it (touch: a second tap follows it);
		// otherwise it only opens the menu, a button (audit SU2)
		$profile = $user->hasPermission('profile-edit') ? " href='" . $this->wire()->sanitizer->entities($this->wire()->urls->admin . 'profile/') . "'" : " href='#' role='button'";
		return
			"<ul class='pw-user-nav'><li class='pw-dropdown'>" .
			"<a id='tools-toggle' class='pw-dropdown-toggle' aria-haspopup='true' aria-expanded='false'$profile>" .
			$this->renderNavIcon('user') . $name . "</a>" .
			"<ul class='pw-dropdown-menu' data-my='right top' data-at='right bottom' style='display:none'>$out</ul>" .
			"</li></ul>";
	}

	/**
	 * Display controls left of the user menu (0.11.0): interface scale (smaller, larger) and the
	 * colour scheme (auto, light, dark). scripts/main.js keeps both per user in this browser
	 * (prefs, under prefsKey()) and updates icons, names and the disabled ends.
	 *
	 * @return string
	 *
	 */
	public function renderViewControls() {
		$sanitizer = $this->wire()->sanitizer;
		$button = function($attrs, $icon, $label) use($sanitizer) {
			$label = $sanitizer->entities1($label);
			return "<button type='button' class='pw-view-button'$attrs title='$label' aria-label='$label'>" .
				"<i class='fa fa-fw fa-$icon' aria-hidden='true'></i></button>";
		};
		$labels = array(
			'auto' => __('Scheme: auto', __FILE__),
			'light' => __('Scheme: light', __FILE__),
			'dark' => __('Scheme: dark', __FILE__),
		);
		$attrs = ' data-pw-scheme-toggle';
		foreach($labels as $key => $label) $attrs .= " data-label-$key='" . $sanitizer->entities($label) . "'";
		// the configured scheme until scripts/main.js puts the user's own in its place (audit SU6)
		$scheme = $this->getColorScheme();
		$icons = array('auto' => 'adjust', 'light' => 'sun-o', 'dark' => 'moon-o');
		return "<div class='pw-view-controls' role='group' aria-label='" . $sanitizer->entities1($this->shellLabel('display')) . "'>" .
			$button(" data-pw-scale='-1'", 'search-minus', $this->shellLabel('smaller')) .
			$button(" data-pw-scale='1'", 'search-plus', $this->shellLabel('larger')) .
			$button($attrs, $icons[$scheme] ?? 'adjust', $labels[$scheme] ?? $labels['auto']) .
			"</div>";
	}

	/**
	 * localStorage key of this user's display settings in this browser (scripts/main.js prefs):
	 * derived from the user id with the site's secret salt, so it names no user and differs
	 * between sites. Empty for a guest (the login screen uses the last user's settings).
	 *
	 * @return string
	 *
	 */
	public function prefsKey() {
		$user = $this->wire()->user;
		if(!$user || !$user->isLoggedin()) return '';
		$config = $this->wire()->config;
		$salt = (string) $config->userAuthSalt;
		if($salt === '') $salt = $config->paths->root . $config->dbName;
		return 'pwPrefs.' . substr(hash_hmac('sha256', 'AdminThemeBridge.prefs.' . $user->id, $salt), 0, 20);
	}

	/**
	 * Render breadcrumbs
	 *
	 * With extendedBreadcrumbs (default on, AdminThemeBoss's behaviour): hidden on the page tree,
	 * and when there are fewer than two crumbs except in the page editor; a quick link to the page
	 * tree first; an edit link after every crumb whose page the user may edit; in the page editor
	 * the parent crumb opens the tree at that page.
	 *
	 * @return string
	 *
	 */
	public function ___renderBreadcrumbs() {
		$breadcrumbs = $this->wire()->breadcrumbs;
		if(!$breadcrumbs || !count($breadcrumbs)) return '';
		if($this->isModal || !$this->isLoggedIn) return '';
		$sanitizer = $this->wire()->sanitizer;
		$extended = (bool) $this->extendedBreadcrumbs;
		$process = $this->wire()->page->process;
		$isPageEdit = $process === 'ProcessPageEdit';
		if($extended) {
			if($process === 'ProcessPageList') return '';
			if(count($breadcrumbs) < 2 && !$isPageEdit) return '';
		}
		$out = '';
		if($extended) {
			$treeUrl = $sanitizer->entities($this->wire()->urls->admin . 'page/');
			// icon-only links: named for assistive technology, not by their title alone (audit SU8)
			$treeLabel = $sanitizer->entities1(__('Page tree', __FILE__));
			$out .= "<li class='pw-breadcrumb-tree'><a href='$treeUrl' title='$treeLabel' aria-label='$treeLabel'>" . $this->renderIcon('sitemap') . "</a></li>";
		}
		$editPage = null;
		if($isPageEdit) {
			$p = $this->wire()->process;
			if($p && method_exists($p, 'getPage')) $editPage = $p->getPage();
		}
		// the pages behind the crumbs, loaded in one query (audit PP6)
		$crumbPages = array();
		if($extended) {
			$ids = array();
			foreach($breadcrumbs as $breadcrumb) {
				if(preg_match('/[?&]open=(\d+)/', (string) $breadcrumb->url, $m)) $ids[] = (int) $m[1];
			}
			if($editPage && $editPage->parent_id) $ids[] = (int) $editPage->parent_id;
			$ids = array_values(array_unique(array_filter($ids)));
			if(count($ids)) foreach($this->wire()->pages->getById($ids) as $p) $crumbPages[$p->id] = $p;
		}
		foreach($breadcrumbs as $breadcrumb) {
			// as AdminThemeUikit: markup a Process set for the crumb, else its title, translated
			$title = (string) $breadcrumb->get('titleMarkup');
			if($title === '') $title = $sanitizer->entities1($this->_($breadcrumb->title));
			$href = (string) $breadcrumb->url;
			$edit = '';
			if($extended) {
				$id = 0;
				if(preg_match('/[?&]open=(\d+)/', $href, $m)) $id = (int) $m[1];
				if(!$id && $editPage && $editPage->parent_id && strpos($href, '../') !== false) {
					$id = (int) $editPage->parent_id;
					$href .= (strpos($href, '?') === false ? '?' : '&') . "open=$id";
				}
				if($id) {
					$p = isset($crumbPages[$id]) ? $crumbPages[$id] : $this->wire()->pages->get($id);
					if($p->id && $p->editable()) {
						$editUrl = $sanitizer->entities($p->editUrl());
						$editLabel = $sanitizer->entities1(__('Edit', __FILE__)) . ': ' . $sanitizer->entities1(strip_tags($title));
						$edit = "<a class='pw-breadcrumb-edit' href='$editUrl' title='" .
							$sanitizer->entities1(__('Edit', __FILE__)) . "' aria-label='$editLabel'>" . $this->renderIcon('pencil') . "</a>";
					}
				}
			}
			$url = $sanitizer->entities($href);
			$out .= "<li><a href='$url'>$title</a>$edit</li>";
		}
		// a navigation landmark of its own (audit SU1); the list keeps its class for CSS and modules
		return "<nav class='pw-breadcrumbs-nav' aria-label='" . $sanitizer->entities1($this->shellLabel('breadcrumbs')) . "'><ul class='pw-breadcrumbs'>$out</ul></nav>";
	}

	/**
	 * Render the "Add New" button with its dropdown of templates (page tree only)
	 *
	 * @return string
	 *
	 */
	public function renderAddNewButton() {
		$actions = $this->getAddNewActions();
		if(!count($actions)) return '';
		$sanitizer = $this->wire()->sanitizer;
		$label = $sanitizer->entities1($this->getAddNewLabel());
		$items = '';
		foreach($actions as $action) {
			$url = $sanitizer->entities($action['url']);
			$title = $sanitizer->entities1($action['label']);
			$icon = empty($action['icon']) ? '' : $this->renderNavIcon($action['icon']);
			$items .= "<li><a href='$url'>$icon$title</a></li>";
		}
		return
			"<div class='pw-dropdown pw-add-new'>" .
			"<button type='button' class='ui-button pw-dropdown-toggle'>" . $this->renderIcon('plus-circle') . " $label</button>" .
			"<ul class='pw-dropdown-menu' data-my='right top' data-at='right bottom' style='display:none'>$items</ul>" .
			"</div>";
	}

	/**
	 * Maximum content width in px (0 = none), within 0..4000
	 *
	 * @return int
	 *
	 */
	public function getMaxWidth() {
		return max(0, min(4000, (int) $this->get('maxWidth')));
	}
}

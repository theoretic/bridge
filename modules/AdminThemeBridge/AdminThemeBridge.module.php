<?php namespace ProcessWire;

require_once(__DIR__ . '/BridgeComponent.php');

/**
 * AdminThemeBridge
 *
 * The Bridge admin shell. Renders its own page frame (masthead, navigation, breadcrumbs,
 * notices, content, footer) and leaves every Inputfield and Process module exactly as
 * upstream renders it.
 *
 * Legacy stack (jQuery, jQuery UI, inputfields.js, main.js and everything registered by the
 * Jquery* modules):
 *  - `legacyStack = always`: printed on every page (milestone 1.1 behaviour).
 *  - `legacyStack = auto`: printed only when the page rendered an Inputfield or ran a Process
 *    that does not implement BridgeComponent. Otherwise the URLs are handed to the client
 *    (ProcessWire.config.AdminThemeBridge.legacyScripts) and scripts/main.js loads them the
 *    moment legacy markup appears in the DOM (AJAX-loaded fields, modals).
 *
 * Original work, MIT. Extends the core AdminThemeFramework (wire/core/Admin/).
 */
class AdminThemeBridge extends AdminThemeFramework implements Module, ConfigurableModule {

	public static function getModuleInfo() {
		return array(
			'title' => 'Bridge',
			'version' => '0.8.7',
			'summary' => 'Native-component admin shell that still runs every existing Inputfield and Process module.',
			'author' => 'Alexei Tarasov',
			'autoload' => 'template=admin',
			// FilenameArray::urls() is 3.0.227, ModulesInfo::moduleInfoCache() 3.0.218
			'requires' => 'ProcessWire>=3.0.227, PHP>=8.1',
			'icon' => 'cubes',
		);
	}

	const legacyAlways = 'always';
	const legacyAuto = 'auto';

	// WireCache name and lifetime (seconds) of the last module info cache rebuild (ready())
	const repairFlag = 'AdminThemeBridge.moduleCacheRepair';
	const repairInterval = 600;

	/**
	 * Core Inputfield classes that ship no JavaScript and need nothing from the legacy stack
	 *
	 * Wrappers (InputfieldWrapper, InputfieldForm, InputfieldFieldset) are native by type: their
	 * markup is the theme's (setMarkup) and their behaviour (collapse, showIf) is the shell's.
	 *
	 * @var array
	 *
	 */
	protected $nativeTypes = array(
		'InputfieldSubmit',
		'InputfieldButton',
		'InputfieldHidden',
		'InputfieldMarkup',
	);

	/**
	 * Core field types native in the runtime (ADR 0015). Milestone 2.3: the scriptless ones; what
	 * they need from inputfields.js (change tracking, leave warning, Enter guard, invalid-open,
	 * showIf/requiredIf, collapse, columns, the Text counter) is the runtime's. Milestone 2.4:
	 * Toggle and Checkboxes, whose scripts the runtime replaces, and language tabs (multi-language
	 * fields). Milestone 3.1: PageTitle and PageName; 3.2: File and Image; 3.3: Repeater
	 * and PageTable (ADR 0016). Exact class
	 * names: subclasses (Password, CKEditor, third-party image fields, ...) add scripts and stay
	 * legacy.
	 *
	 * @var array
	 *
	 */
	protected $nativeFieldTypes = array(
		'InputfieldText',
		'InputfieldTextarea',
		'InputfieldCheckbox',
		'InputfieldRadios',
		'InputfieldSelect',
		'InputfieldInteger',
		'InputfieldFloat',
		'InputfieldURL',
		'InputfieldEmail',
		'InputfieldName',
		'InputfieldToggle',
		'InputfieldCheckboxes',
		'InputfieldSelectMultiple',
		'InputfieldAsmSelect',
		'InputfieldPageAutocomplete',
		'InputfieldPageListSelect',
		'InputfieldPageListSelectMultiple',
		'InputfieldDatetime',
		'InputfieldTextTags',
		'InputfieldSelector',
		'InputfieldPageTitle',
		'InputfieldPageName',
		'InputfieldFile',
		'InputfieldImage',
		'InputfieldRepeater',
		'InputfieldPageTable',
		'InputfieldIcon',
		'InputfieldPassword',
	);

	/**
	 * Core Process modules native in the runtime (ADR 0016), by exact class: the theme's scripts
	 * stand in for theirs (scripts/wire-tabs.js, scripts/page-edit.js). What a screen renders keeps
	 * its own reasons: fields, an embedded page tree, scripts other modules add.
	 *
	 * @var array
	 *
	 */
	protected $nativeProcesses = array(
		'ProcessPageEdit',
		'ProcessPageList',
		'ProcessPageLister',
		// the setup and access screens (milestone 3.6): scripts/setup.js
		'ProcessModule',
		'ProcessField',
		'ProcessTemplate',
		'ProcessUser',
		'ProcessRole',
		'ProcessPermission',
		// the remaining core screens (milestone 3.7): scripts/screens.js, scripts/link.js; Recent,
		// Clone and Trash have no scripts of their own
		'ProcessPageAdd',
		'ProcessProfile',
		'ProcessLogger',
		'ProcessRecentPages',
		'ProcessPageClone',
		'ProcessPageTrash',
		'ProcessPageEditLink',
		// image select, Crop and Variations (milestone 3.9): scripts/image-select.js
		'ProcessPageEditImageSelect',
	);

	/**
	 * Native setup Processes that are ProcessPageType lists: their list is a Lister, their editor
	 * ProcessPageEdit (scripts/lister.js and scripts/page-edit.js come along)
	 *
	 * @var array
	 *
	 */
	protected $nativePageTypes = array('ProcessUser', 'ProcessRole', 'ProcessPermission');

	/**
	 * Inner widgets an InputfieldPage may use and stay native (milestone 2.4): the Page field's own
	 * script (add new, dependent selects) is the runtime's; it is native when its widget is.
	 *
	 * @var array
	 *
	 */
	protected $nativePageWidgets = array(
		'InputfieldSelect',
		'InputfieldRadios',
		'InputfieldCheckboxes',
		'InputfieldSelectMultiple',
		'InputfieldAsmSelect',
		'InputfieldPageAutocomplete',
		'InputfieldPageListSelect',
		'InputfieldPageListSelectMultiple',
		'InputfieldTextTags',
	);

	/**
	 * Set once something on the page needs the legacy stack (auto mode)
	 *
	 * @var bool
	 *
	 */
	protected $legacyNeeded = false;

	/**
	 * Why: 'Inputfield:ClassName' / 'Process:ClassName' => count
	 *
	 * @var array
	 *
	 */
	protected $legacyReasons = array();

	/**
	 * Script URLs in $config->scripts when the Process started (hookProcessExecuteBefore)
	 *
	 * @var array|null
	 *
	 */
	protected $scriptsBeforeProcess = null;

	/**
	 * Colour presets (Boss's variants); 'custom' uses primaryColor
	 *
	 * @var array
	 *
	 */
	protected $variants = array('blue', 'vibrant', 'black', 'pink', 'green', 'custom');

	/**
	 * Control classes added to Inputfields by type (hookInputfieldRender); never on the wrapper
	 *
	 * @var array class => array(control class, content class)
	 *
	 */
	protected $controlClasses = array(
		'InputfieldTextarea' => array('pw-textarea', ''),
		'InputfieldCheckboxes' => array('pw-checkbox', 'pw-controls-text'),
		'InputfieldCheckbox' => array('pw-checkbox', 'pw-controls-text'),
		'InputfieldRadios' => array('pw-radio', 'pw-controls-text'),
		'InputfieldAsmSelect' => array('pw-select-asm', ''),
		'InputfieldSubmit' => array('pw-button', ''),
		'InputfieldButton' => array('pw-button', ''),
		'InputfieldPassword' => array('pw-input', ''),
		'InputfieldText' => array('pw-input', ''),
		'InputfieldSelect' => array('pw-select', ''),
	);

	public function __construct() {
		parent::__construct();
		$this->set('legacyStack', self::legacyAuto);
		$this->set('maxWidth', 1600);
		$this->set('variant', 'blue');
		$this->set('primaryColor', '');
		$this->set('colorScheme', 'auto');
		$this->set('logoURL', '');
		$this->set('logoURLDark', '');
		$this->set('extendedBreadcrumbs', 1);
		$this->set('pageSaveInPlace', 1);
		$this->setClasses(array(
			'input' => 'pw-input',
			'input-small' => 'pw-input pw-input-small',
			'input-checkbox' => 'pw-checkbox',
			'input-radio' => 'pw-radio',
			'input-password' => 'pw-input',
			'select' => 'pw-select',
			'select-asm' => 'pw-select-asm',
			'select-small' => 'pw-select pw-select-small',
			'textarea' => 'pw-textarea',
			'table' => 'pw-table',
			'dl' => 'pw-dl',
		));
	}

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
			$out .= "<img class='pw-logo pw-logo-custom $class' src='" . $sanitizer->entities($url) . "' alt='' />";
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
	 * The ProcessWire mark, read at runtime from the installed core (the file AdminThemeUikit
	 * renders), inlined unmodified. Bridge does not ship a copy: MPL 2.0 section 2.3 grants no
	 * trademark rights, so the mark stays the core's own file (ADR 0012). Falls back to the
	 * product name as text when a future core moves the file.
	 *
	 * @return string
	 *
	 */
	public function renderNativeLogo() {
		$file = $this->wire()->config->paths->wire . 'modules/AdminTheme/AdminThemeUikit/themes/default/logo.svg';
		$svg = is_file($file) ? trim((string) file_get_contents($file)) : '';
		if(strpos($svg, '<svg') !== 0) return "<span class='pw-logo-text'>ProcessWire</span>";
		// accessible name only; shape, colour model (currentColor) and markup stay as shipped
		return preg_replace('/^<svg\b/', "<svg role='img' aria-label='ProcessWire'", $svg, 1);
	}

	/**
	 * True when this request loaded the theme at boot instead of on admin pages only
	 *
	 * @var bool
	 *
	 */
	protected $loadedAtBoot = false;

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
		// set before the rebuild: a rebuild that dies (a module running out of memory in it) must
		// not run again on the next request
		$this->wire()->cache->save(self::repairFlag, time(), self::repairInterval);
		$modules = $this->wire()->modules;
		// refresh() compares this snapshot of module file times first and returns when it matches;
		// an empty one forces the rebuild, as refresh() itself does (deleteCache() leaves the
		// modules table row in place)
		$modules->saveCache('moduleFileSnapshot', array());
		$modules->refresh();
		return true;
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
		$modules = $this->wire()->modules;
		if(!$modules->isInstalled('AdminThemeBoss')) return false;
		$boss = $modules->getConfig('AdminThemeBoss');
		return !empty($boss['enablemodule']) && !empty($boss['allusers']);
	}

	public function ___install() {
		parent::___install();
		if($this->bossForcesUikit()) {
			$this->warning($this->_('AdminThemeBoss has "activate for all users" on: it switches every user back to Uikit on each request. Turn it off in its module settings, then select Bridge in your profile.'));
		}
	}

	public function init() {
		if(!$this->wire()->page) {
			// loaded at boot (see moduleCacheIsStale): useAsLogin would make this theme current for
			// every request, logged in or not, with none of its set-up below. Sit this request out;
			// ready() repairs the cache, and from the next request the theme loads on admin pages only.
			$this->loadedAtBoot = true;
			$this->set('useAsLogin', false);
		}
		parent::init();
		$page = $this->wire()->page;
		if(!$page || $page->template->name !== 'admin') return;
		// whichever theme is current: the profile and user editors are where this theme is chosen
		if($this->bossForcesUikit()) $this->addHookBefore('Pages::saveReady', $this, 'hookUserThemeSave');
		if(!$this->isCurrent()) return;

		$this->addBodyClass('AdminThemeBridge');
		$this->addBodyClass('pw-legacy-' . $this->legacyStack);
		$this->addBodyClass('pw-variant-' . $this->getVariant());
		$this->addBodyClass('pw-scheme-' . $this->getColorScheme());

		// marking happens in both modes so the client can tell legacy and native markup apart;
		// the flag only matters in auto mode
		// login form: labels hidden, placeholders instead (ProcessLogin does both when skipLabel is set)
		$this->addHookBefore('ProcessLogin::buildLoginForm', function(HookEvent $event) {
			$event->object->set('skipLabel', Inputfield::skipLabelHeader);
		});

		$this->addHookBefore('Inputfield::render', $this, 'hookInputfieldRender');
		$this->addHookBefore('Inputfield::renderValue', $this, 'hookInputfieldRender');
		// AJAX-collapsed fields are rendered as a placeholder without render(): mark them when
		// they get ready, so opening one later loads the legacy stack it needs
		$this->addHookAfter('Inputfield::renderReadyHook', $this, 'hookInputfieldReady');
		$this->addHookBefore('ProcessController::execute', $this, 'hookProcessExecuteBefore');
		$this->addHookAfter('ProcessController::execute', $this, 'hookProcessExecute');
		// LanguageTabs appends `setupLanguageTabs($('#form'))` to each form with language tabs; on a
		// page without jQuery the runtime sets them up itself (milestone 2.4)
		$this->addHookAfter('InputfieldForm::render', $this, 'hookFormRender', array('priority' => 200));
		// the page editor (milestone 3.1): its inline init call falls back to the native editor, and
		// the page tree in its Children tab stays legacy until the page tree is native (3.4)
		$this->addHookAfter('ProcessPageEdit::execute', $this, 'hookPageEditExecute');
		$this->addHookAfter('ProcessPageEdit::buildFormChildren', $this, 'hookPageEditChildren');
		// tables print `AdminDataTable.initTable($('#id'))`: without jQuery the runtime's
		// AdminDataTable (milestone 3.5) takes the element instead
		$this->addHookAfter('MarkupAdminDataTable::render', $this, 'hookDataTableRender');
	}

	public function ready() {
		if(!$this->loadedAtBoot || !$this->moduleCacheIsStale()) return;
		// the stale state is harmless (init() sits the request out); a rebuild on every request of a
		// site, front end included, is not: rebuild only for a superuser in the admin, at most once
		// per interval, and say so once per interval otherwise
		$cache = $this->wire()->cache;
		if(!$this->canRepairModuleCache()) {
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
	 * Only an admin request by a superuser, and not again within repairInterval of the last try.
	 *
	 * @return bool
	 *
	 */
	public function canRepairModuleCache() {
		$page = $this->wire()->page;
		$user = $this->wire()->user;
		if(!$page || !$page->template || $page->template->name !== 'admin') return false;
		if(!$user || !$user->isSuperuser()) return false;
		return !$this->wire()->cache->get(self::repairFlag);
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
		$this->error($this->_('Bridge was not selected: AdminThemeBoss has "activate for all users" on and would switch the theme back to Uikit on the next request. Turn that setting off in Modules > AdminThemeBoss first.'));
	}

	/**
	 * Icon set: Font Awesome 6 with the v4 shims, as AdminThemeUikit does, so icon pickers
	 * (field and template "icon" selects) offer the same list under both themes.
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
	 * Hook before Inputfield::render / renderValue: mark the wrapper and record legacy needs
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookInputfieldRender(HookEvent $event) {
		/** @var Inputfield $inputfield */
		$inputfield = $event->object;
		$this->addControlClasses($inputfield);
		// core runs the before-render hooks for an AJAX placeholder too, without rendering
		$this->markInputfield($inputfield, !$this->isAjaxPlaceholder($inputfield));
	}

	/**
	 * On a page that defers the legacy stack, inline scripts that configure a legacy library wait
	 * for it: JqueryUI::useVex() adds `<script>vex.defaultOptions...</script>` to the head markup,
	 * which would throw before vex is there. Wrapped, it runs once the stack loads (if it does).
	 *
	 * @param string $markup
	 * @return string
	 *
	 */
	public function deferLegacyInline($markup) {
		$markup = (string) $markup;
		if($this->useLegacyStack() || strpos($markup, 'vex.') === false) return $markup;
		return preg_replace_callback('~<script>(\s*vex\..*?)</script>~s', function($m) {
			return "<script>ProcessWireAdminTheme.legacy.later(function(){" . $m[1] . "});</script>";
		}, $markup);
	}

	/**
	 * Will core render this Inputfield as an AJAX placeholder on this request? Same condition as
	 * InputfieldWrapper::___renderInputfield() (3.0.274): an AJAX collapse mode, a logged-in
	 * user, not required-and-empty (core then falls back to a plain collapse), and not the AJAX
	 * request that renders this very field.
	 *
	 * @param Inputfield $inputfield
	 * @return bool
	 *
	 */
	protected function isAjaxPlaceholder(Inputfield $inputfield) {
		$collapsed = (int) $inputfield->getSetting('collapsed');
		$ajax = $collapsed === Inputfield::collapsedYesAjax || $collapsed === Inputfield::collapsedTabAjax ||
			($collapsed === Inputfield::collapsedBlankAjax && $inputfield->isEmpty());
		if(!$ajax || !$this->wire()->user->isLoggedin()) return false;
		if($inputfield->getSetting('required') && $inputfield->isEmpty()) return false;
		if($this->wire()->config->ajax && $this->wire()->input->get('renderInputfieldAjax') === $inputfield->attr('id')) return false;
		return true;
	}

	/**
	 * Hook after Inputfield::renderReadyHook: mark the wrapper only. An AJAX-collapsed field is
	 * not rendered on this request (its placeholder is), so it does not need the stack yet; the
	 * mark tells the client to load it when the field is opened.
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookInputfieldReady(HookEvent $event) {
		/** @var Inputfield $inputfield */
		$inputfield = $event->object;
		if($inputfield instanceof InputfieldWrapper && !$inputfield instanceof InputfieldMarkup) return;
		$this->markInputfield($inputfield, false);
	}

	/**
	 * Mark the wrapper as component or legacy, and record the legacy need
	 *
	 * @param Inputfield $inputfield
	 * @param bool $record Record a legacy need for this request (rendered now)
	 *
	 */
	protected function markInputfield(Inputfield $inputfield, $record) {
		$class = $inputfield->className();
		// content of a legacy Process inside a native type (the editor's Children page tree)
		$legacyProcess = (string) $inputfield->getSetting('bridgeLegacyProcess');
		if($legacyProcess !== '') {
			$inputfield->wrapAttr('data-bridge-legacy', $legacyProcess);
			if($record) $this->needLegacy("Process:$legacyProcess");
			return;
		}
		if($this->isNativeInputfield($inputfield)) {
			$tag = '';
			if($inputfield instanceof BridgeComponent) {
				$info = $this->componentInfo($inputfield);
				$tag = $info['tag'];
				if($info['module'] !== '') $inputfield->wrapAttr('data-bridge-module', $info['module']);
				$inputfield->wrapAttr('data-bridge-version', $info['version']);
			}
			$inputfield->wrapAttr('data-bridge-component', $tag === '' ? $class : $tag);
		} else {
			$inputfield->wrapAttr('data-bridge-legacy', $class);
			if($record) $this->needLegacy("Inputfield:$class");
		}
	}

	/**
	 * Add the theme's control classes for this Inputfield type (first match in $controlClasses,
	 * by instanceof, so subclasses such as InputfieldEmail inherit InputfieldText's). Classes go
	 * on the control and on the content element, never on the wrapper, which the conformance
	 * suite compares with upstream.
	 *
	 * @param Inputfield $inputfield
	 *
	 */
	protected function addControlClasses(Inputfield $inputfield) {
		if($inputfield instanceof InputfieldWrapper) return;
		foreach($this->controlClasses as $type => $classes) {
			$fqn = "\\ProcessWire\\$type";
			if(!$inputfield instanceof $fqn) continue;
			if($type === 'InputfieldSelect' && $inputfield instanceof InputfieldHasArrayValue) {
				if(!$inputfield instanceof InputfieldAsmSelect) continue;
			}
			list($control, $content) = $classes;
			if($control !== '') $inputfield->addClass($control);
			if($content !== '') $inputfield->addClass($content, 'contentClass');
			return;
		}
	}

	/**
	 * Hook after InputfieldForm::render: run LanguageTabs' inline setup only where jQuery is
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookFormRender(HookEvent $event) {
		$out = (string) $event->return;
		if(strpos($out, 'setupLanguageTabs(') === false) return;
		$event->return = str_replace("<script>setupLanguageTabs($('#", "<script>window.jQuery && setupLanguageTabs(jQuery('#", $out);
	}

	/**
	 * Hook after ProcessController::execute: a Process that is not a component needs the stack
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookProcessExecute(HookEvent $event) {
		/** @var ProcessController $controller */
		$controller = $event->object;
		$process = $controller->getProcess();
		if(!$process) return;
		$this->needScriptsAddedByProcess($process);
		if($this->isNativeProcess($process)) {
			if(is_string($event->return)) $event->return = $this->nativeInlineScripts($event->return);
			return;
		}
		$this->needLegacy('Process:' . $process->className());
	}

	/**
	 * Hook before ProcessController::execute: remember the scripts there are so far
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookProcessExecuteBefore(HookEvent $event) {
		$this->scriptsBeforeProcess = array();
		foreach($this->wire()->config->scripts->urls() as $url) $this->scriptsBeforeProcess[] = (string) $url;
	}

	/**
	 * A jQuery script a site module adds while the Process builds the screen belongs to that
	 * screen (BatchChildEditor's, from a ProcessPageEdit hook): it is a legacy reason (Gate 3).
	 * Scripts added before, at init or ready on every admin page (RockMigrations'), stay deferred
	 * (isJqueryScript()); core scripts under wire/ have their own reasons (their Inputfield or
	 * Process), and so does the Process's own script (added when it initialises): a native
	 * Process (a component such as ProcessBridgeDemo) answers for it.
	 *
	 * @param Process $process
	 *
	 */
	protected function needScriptsAddedByProcess(Process $process) {
		if($this->scriptsBeforeProcess === null) return;
		$config = $this->wire()->config;
		$before = $this->scriptsBeforeProcess;
		$this->scriptsBeforeProcess = null;
		$own = $config->urls($process->className());
		foreach($config->scripts->urls() as $url) {
			$url = (string) $url;
			if(in_array($url, $before, true) || strpos($url, $config->urls->wire) === 0) continue;
			if($own && strpos($url, $own) === 0) continue;
			if(!$this->isJqueryScript($url)) continue;
			$path = preg_replace('/[?#].*$/', '', $url);
			$dir = $this->siteModuleDir($path);
			// a field module's script (added as its Inputfield renders) has the Inputfield's reason
			if($dir !== '' && $this->isFieldModuleDir($dir)) continue;
			$this->needLegacy('Script:' . basename(dirname($path)) . '/' . basename($path));
		}
	}

	/**
	 * The module directory under site/modules a script URL belongs to (its first path segment),
	 * or '' for a script elsewhere
	 *
	 * @param string $path Root-relative URL path
	 * @return string Absolute directory path
	 *
	 */
	protected function siteModuleDir($path) {
		$config = $this->wire()->config;
		$base = $config->urls->siteModules;
		if(strpos($path, $base) !== 0) return '';
		$first = explode('/', substr($path, strlen($base)))[0];
		return $first === '' ? '' : $config->paths->siteModules . $first . '/';
	}

	/**
	 * Does this module directory hold an Inputfield or Fieldtype module?
	 *
	 * @param string $dir
	 * @return bool
	 *
	 */
	protected function isFieldModuleDir($dir) {
		static $cache = array();
		if(!isset($cache[$dir])) {
			$cache[$dir] = count((array) glob($dir . '{Inputfield,Fieldtype}*.module{,.php}', GLOB_BRACE)) > 0;
		}
		return $cache[$dir];
	}

	/**
	 * Inline jQuery calls in a native Process's output (milestone 3.6), made to work either way:
	 * the template editor's `$(document).ready(function() { ProcessTemplateInitFields(); })`, the
	 * field editor's `jQuery(document).ready(...)` for ?focus=, and the "pages using this
	 * template" Lister iframe's `$('#ProcessTemplatePageLister').iFrameResize({ })`, the image
	 * window's `$(document).ready(function() { setupProcessSave(...) })` (3.9). With jQuery on the
	 * page they run as before.
	 *
	 * @param string $out
	 * @return string
	 *
	 */
	protected function nativeInlineScripts($out) {
		if(strpos($out, 'ready(function() {') === false && strpos($out, 'iFrameResize(') === false) return $out;
		$ready = "(window.jQuery ? jQuery : function(f) { document.readyState === 'loading' ? " .
			"document.addEventListener('DOMContentLoaded', f) : f(); })(function() { ";
		$out = str_replace(
			array(
				'$(document).ready(function() { ProcessTemplateInitFields(); });',
				'jQuery(document).ready(function() { ',
				'$(document).ready(function() { ',
				"\$('#ProcessTemplatePageLister').iFrameResize({ });",
			),
			array(
				$ready . 'ProcessTemplateInitFields(); });',
				$ready,
				$ready,
				"window.jQuery && jQuery.fn.iFrameResize ? jQuery('#ProcessTemplatePageLister').iFrameResize({ }) : " .
					"window.ProcessWireAdminTheme && ProcessWireAdminTheme.iframeHeight && " .
					"ProcessWireAdminTheme.iframeHeight(document.getElementById('ProcessTemplatePageLister'));",
			),
			$out
		);
		return $out;
	}

	/**
	 * Is this Process fine without the legacy stack (its own client part)? A component, or a core
	 * Process the theme stands in for, by exact class (ADR 0016)
	 *
	 * @param Process $process
	 * @return bool
	 *
	 */
	public function isNativeProcess(Process $process) {
		if($process instanceof BridgeComponent) return true;
		return in_array($process->className(), $this->nativeProcesses, true);
	}

	/**
	 * The theme's stand-ins for the current Process's scripts, printed after the theme script on a
	 * page without the legacy stack (with it, upstream's scripts run as before)
	 *
	 * @return array Paths relative to the theme directory
	 *
	 */
	public function nativeProcessScripts() {
		$process = $this->wire()->process;
		if(!$process instanceof Process) return array();
		// the image window's script also on a legacy window: it answers an opener without jQuery
		if($process->className() === 'ProcessPageEditImageSelect') return array('scripts/image-select.js');
		if($this->useLegacyStack()) return array();
		if($process->className() === 'ProcessPageEdit') return array('scripts/wire-tabs.js', 'scripts/page-edit.js');
		$class = $process->className();
		if($class === 'ProcessPageLister') return array('scripts/wire-tabs.js', 'scripts/lister.js');
		if(in_array($class, $this->nativePageTypes, true)) {
			return array('scripts/wire-tabs.js', 'scripts/page-edit.js', 'scripts/lister.js', 'scripts/setup.js');
		}
		if(in_array($class, array('ProcessModule', 'ProcessField', 'ProcessTemplate'), true)) {
			return array('scripts/wire-tabs.js', 'scripts/setup.js');
		}
		if(in_array($class, array('ProcessPageAdd', 'ProcessProfile', 'ProcessLogger'), true)) return array('scripts/screens.js');
		if($class === 'ProcessPageEditLink') return array('scripts/wire-tabs.js', 'scripts/link.js');
		return array();
	}

	/**
	 * Does this Process's edit form save without a reload (scripts/page-save.js)? The page editor
	 * (and its subclasses, as before), and by exact class the screens whose edit forms page-save.js
	 * knows (milestone 3.8): fields, templates, module settings, the profile, and users, roles and
	 * permissions (ProcessPageEdit forms). The script itself checks the form and the button.
	 *
	 * @param Process|null $process
	 * @return bool
	 *
	 */
	public function saveInPlaceProcess($process) {
		if(!$process instanceof Process) return false;
		if($process instanceof ProcessPageEdit) return true;
		return in_array($process->className(), array(
			'ProcessField', 'ProcessTemplate', 'ProcessModule', 'ProcessProfile',
			'ProcessUser', 'ProcessRole', 'ProcessPermission',
		), true);
	}

	/**
	 * Hook after ProcessPageEdit::execute: upstream ends the editor with an inline
	 * `initPageEditForm()` (ProcessPageEdit.js). Without the legacy stack that function is not
	 * there; the call then goes to the native editor (scripts/page-edit.js).
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookPageEditExecute(HookEvent $event) {
		$out = $event->return;
		if(!is_string($out) || strpos($out, '<script>initPageEditForm();</script>') === false) return;
		$event->return = str_replace('<script>initPageEditForm();</script>',
			"<script>typeof initPageEditForm === 'function' ? initPageEditForm() : " .
			"window.ProcessWireAdminTheme && ProcessWireAdminTheme.pageEdit && ProcessWireAdminTheme.pageEdit.init();</script>", $out);
	}

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
	 * Hook after ProcessPageEdit::buildFormChildren: the Children tab renders the page tree
	 * (ProcessPageList) inside an InputfieldMarkup; until the page tree is native that field needs
	 * the legacy stack, now or when its AJAX tab opens
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookPageEditChildren(HookEvent $event) {
		if(in_array('ProcessPageList', $this->nativeProcesses, true)) return;
		$wrapper = $event->return;
		if(!$wrapper instanceof InputfieldWrapper) return;
		$list = $wrapper->getChildByName('ChildrenPageList');
		if($list && trim((string) $list->value) !== '') $list->set('bridgeLegacyProcess', 'ProcessPageList');
	}

	/**
	 * Normalised component descriptor for a BridgeComponent module
	 *
	 * `module` is resolved to a URL: absolute URLs and root-relative paths are kept, anything
	 * else is relative to the module's own directory ($config->urls->ClassName).
	 *
	 * @param Module|BridgeComponent $module
	 * @return array ['tag' => string, 'module' => string, 'version' => string]
	 *
	 */
	public function componentInfo($module) {
		$info = $module instanceof BridgeComponent ? $module->getBridgeComponent() : array();
		if(!is_array($info)) $info = array();
		$tag = empty($info['tag']) ? '' : (string) $info['tag'];
		$url = empty($info['module']) ? '' : (string) $info['module'];
		$version = empty($info['version']) ? '1' : (string) $info['version'];
		if($url !== '' && strpos($url, '/') !== 0 && strpos($url, '://') === false) {
			$base = $this->wire()->config->urls($module->className());
			$url = ($base ? $base : '') . $url;
		}
		if($url !== '' && strpos($url, '?') === false) {
			$moduleVersion = $this->wire()->modules->getModuleInfoProperty($module, 'version');
			if($moduleVersion) $url .= '?v=' . rawurlencode((string) $moduleVersion);
		}
		return array('tag' => $tag, 'module' => $url, 'version' => $version);
	}

	/**
	 * Is this Inputfield fine without the legacy stack?
	 *
	 * @param Inputfield $inputfield
	 * @return bool
	 *
	 */
	public function isNativeInputfield(Inputfield $inputfield) {
		if($inputfield instanceof InputfieldWrapper) return true;
		if(in_array($inputfield->className(), $this->nativeTypes, true)) return true;
		if(in_array($inputfield->className(), $this->nativeFieldTypes, true)) return true;
		if($inputfield->className() === 'InputfieldPage') {
			$widget = ltrim((string) $inputfield->getSetting('inputfield'), '_');
			return in_array($widget === '' ? 'InputfieldSelect' : $widget, $this->nativePageWidgets, true);
		}
		// a component counts for its own class only: a subclass may add jQuery scripts of its own
		// (ADR 0015: native by exact class, never by inheritance)
		if($inputfield instanceof BridgeComponent) {
			$method = new \ReflectionMethod($inputfield, 'getBridgeComponent');
			return $method->getDeclaringClass()->getName() === get_class($inputfield);
		}
		return false;
	}

	/**
	 * Record that the legacy stack is needed on this request
	 *
	 * @param string $reason
	 *
	 */
	public function needLegacy($reason) {
		$this->legacyNeeded = true;
		if(!isset($this->legacyReasons[$reason])) $this->legacyReasons[$reason] = 0;
		$this->legacyReasons[$reason]++;
	}

	/**
	 * Does this request print the legacy stack in <head>?
	 *
	 * @return bool
	 *
	 */
	public function useLegacyStack() {
		if($this->legacyStack !== self::legacyAuto) return true;
		return $this->legacyNeeded;
	}

	/**
	 * Reasons recorded so far (auto mode)
	 *
	 * @return array
	 *
	 */
	public function getLegacyReasons() {
		return $this->legacyReasons;
	}

	/**
	 * Is this script URL part of the legacy stack?
	 *
	 * Every script under wire/: the Jquery* modules, the two shared admin scripts, and every core
	 * module script (all written against jQuery; some, like LanguageSupport's LanguageTabs.js,
	 * are added on every admin page by hooks). Scripts outside wire/ (site modules, components)
	 * are printed as they are: on a legacy page the stack precedes them in order; on a native
	 * page, by construction, only components added scripts.
	 *
	 * @param string $url
	 * @return bool
	 *
	 */
	public function isLegacyScript($url) {
		$wireUrl = $this->wire()->config->urls->wire;
		if(strpos($url, $wireUrl) !== 0) return false;
		$rel = substr($url, strlen($wireUrl));
		return strpos($rel, 'modules/') === 0 || strpos($rel, 'templates-admin/scripts/') === 0;
	}

	/**
	 * Is this a site or third-party module script written against jQuery? (milestone 3.2)
	 *
	 * Such a script, printed on a page without the legacy stack, throws ("$ is not defined"):
	 * RockMigrations adds one to every admin page. It is deferred with the stack instead, and runs
	 * when (if) the stack loads, as core module scripts do. Decided from the file's content (a
	 * jQuery call or the $ alias), for local root-relative .js URLs only; the theme's own scripts
	 * never count. Cached per file and modification time for the request.
	 *
	 * @param string $url
	 * @return bool
	 *
	 */
	public function isJqueryScript($url) {
		static $cache = array();
		$config = $this->wire()->config;
		$path = preg_replace('/[?#].*$/', '', (string) $url);
		if(strpos($path, '/') !== 0 || strpos($path, '//') === 0 || substr($path, -3) !== '.js') return false;
		if(strpos($path, $this->url()) === 0) return false;
		$root = $config->urls->root;
		if(strpos($path, $root) !== 0) return false;
		$file = $config->paths->root . substr($path, strlen($root));
		if(!is_file($file)) return false;
		$key = $file . '|' . filemtime($file);
		if(!isset($cache[$key])) {
			$js = (string) file_get_contents($file, false, null, 0, 512 * 1024);
			$cache[$key] = (bool) preg_match('/\bjQuery\b|(?<![\w$])\$\s*\(|(?<![\w$])\$\.\w/', $js);
		}
		return $cache[$key];
	}

	/**
	 * Split $config->scripts into what gets printed now and what is deferred to the client
	 *
	 * @param array|null $all Script URLs in print order (default: $config->scripts->urls())
	 * @return array ['print' => string[], 'deferred' => string[]]
	 *
	 */
	public function getScriptUrls(?array $all = null) {
		if($all === null) {
			$all = array();
			foreach($this->wire()->config->scripts->urls() as $url) $all[] = $url;
		}
		if($this->useLegacyStack()) return array('print' => $all, 'deferred' => array());
		$print = array();
		$deferred = array();
		foreach($all as $url) {
			if($this->isLegacyScript($url) || $this->isJqueryScript($url)) {
				$deferred[] = $url;
			} else {
				$print[] = $url;
			}
		}
		return array('print' => $print, 'deferred' => $deferred);
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
			if(!empty($item['url']) && $item['url'] !== $this->wire()->urls->admin && strpos($current, $item['url']) === 0) $class .= ' pw-current';
			// top level is text only, as Uikit and Boss render it
			if(!count($children)) return "<li class='$class'><a href='$url'>$title</a></li>";
			$my = in_array($item['name'], array('access', 'page', 'module'), true) ? 'left top' : 'left-1 top';
			$out = "<li class='$class pw-nav-item-parent pw-dropdown'>" .
				"<a href='$url' id='prnav-page-$id' data-from='prnav-page-$parentId' class='pw-dropdown-toggle'>$title</a>" .
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
		foreach($this->getUserNavArray() as $item) {
			$url = $sanitizer->entities($item['url']);
			$title = $sanitizer->entities1($item['title']);
			$icon = empty($item['icon']) ? '' : $this->renderNavIcon($item['icon']);
			$target = empty($item['target']) ? '' : " target='" . $sanitizer->entities($item['target']) . "'";
			$out .= "<li><a href='$url'$target>$icon$title</a></li>";
		}
		// colour scheme toggle; scripts/main.js cycles auto, light, dark and updates icon and label
		$labels = array(
			'auto' => $this->_('Scheme: auto'),
			'light' => $this->_('Scheme: light'),
			'dark' => $this->_('Scheme: dark'),
		);
		$attrs = '';
		foreach($labels as $key => $label) $attrs .= " data-label-$key='" . $sanitizer->entities($label) . "'";
		$out .= "<li class='pw-scheme-toggle'><a href='#' data-pw-scheme-toggle$attrs>" .
			"<i class='fa fa-fw fa-adjust'></i><span class='pw-scheme-label'>" . $sanitizer->entities1($labels['auto']) . "</span></a></li>";
		$name = $sanitizer->entities1($user->name);
		return
			"<ul class='pw-user-nav'><li class='pw-dropdown'>" .
			"<a id='tools-toggle' class='pw-dropdown-toggle' href='" . $this->wire()->urls->admin . "profile/'>" .
			$this->renderNavIcon('user') . $name . "</a>" .
			"<ul class='pw-dropdown-menu' data-my='right top' data-at='right bottom' style='display:none'>$out</ul>" .
			"</li></ul>";
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
		if($this->isModal) return '';
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
			$out .= "<li class='pw-breadcrumb-tree'><a href='$treeUrl' title='" .
				$sanitizer->entities1($this->_('Page tree')) . "'>" . $this->renderIcon('sitemap') . "</a></li>";
		}
		$editPage = null;
		if($isPageEdit) {
			$p = $this->wire()->process;
			if($p && method_exists($p, 'getPage')) $editPage = $p->getPage();
		}
		foreach($breadcrumbs as $breadcrumb) {
			$title = $sanitizer->entities1($breadcrumb->title);
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
					$p = $this->wire()->pages->get($id);
					if($p->id && $p->editable()) {
						$editUrl = $sanitizer->entities($p->editUrl());
						$edit = "<a class='pw-breadcrumb-edit' href='$editUrl' title='" .
							$sanitizer->entities1($this->_('Edit')) . "'>" . $this->renderIcon('pencil') . "</a>";
					}
				}
			}
			$url = $sanitizer->entities($href);
			$out .= "<li><a href='$url'>$title</a>$edit</li>";
		}
		return "<ul class='pw-breadcrumbs'>$out</ul>";
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

	public function getModuleConfigInputfields(InputfieldWrapper $inputfields) {
		parent::getModuleConfigInputfields($inputfields);
		$modules = $this->wire()->modules;

		/** @var InputfieldFieldset $fs */
		$fs = $modules->get('InputfieldFieldset');
		$fs->attr('name', '_appearance');
		$fs->label = $this->_('Appearance');
		$fs->icon = 'paint-brush';
		$inputfields->add($fs);

		/** @var InputfieldRadios $f */
		$f = $modules->get('InputfieldRadios');
		$f->attr('name', 'variant');
		$f->label = $this->_('Colour');
		$f->addOption('blue', $this->_('Blue (default)'));
		$f->addOption('vibrant', $this->_('Vibrant'));
		$f->addOption('black', $this->_('Black'));
		$f->addOption('pink', $this->_('Pink'));
		$f->addOption('green', $this->_('Green'));
		$f->addOption('custom', $this->_('Custom colour'));
		$f->optionColumns = 1;
		$f->attr('value', in_array($this->get('variant'), $this->variants, true) ? $this->get('variant') : 'blue');
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldText $f */
		$f = $modules->get('InputfieldText');
		$f->attr('name', 'primaryColor');
		$f->label = $this->_('Custom colour');
		$f->description = $this->_('Hex value such as #3584EA. Hover, tints and shadows are derived from it.');
		$f->attr('placeholder', '#3584EA');
		$f->attr('value', (string) $this->get('primaryColor'));
		$f->showIf = 'variant=custom';
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldRadios $f */
		$f = $modules->get('InputfieldRadios');
		$f->attr('name', 'colorScheme');
		$f->label = $this->_('Colour scheme');
		$f->notes = $this->_('Each user can override this from the user menu; the choice is kept in the browser.');
		$f->addOption('auto', $this->_('Follow the operating system (default)'));
		$f->addOption('light', $this->_('Light'));
		$f->addOption('dark', $this->_('Dark'));
		$f->attr('value', $this->getColorScheme());
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldCheckbox $f */
		$f = $modules->get('InputfieldCheckbox');
		$f->attr('name', 'extendedBreadcrumbs');
		$f->label = $this->_('Extended breadcrumbs');
		$f->description = $this->_('Page tree shortcut, edit links on crumbs, hidden on the page tree and when there is only one crumb.');
		$f->attr('value', 1);
		if($this->extendedBreadcrumbs) $f->attr('checked', 'checked');
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldCheckbox $f */
		$f = $modules->get('InputfieldCheckbox');
		$f->attr('name', 'pageSaveInPlace');
		$f->label = $this->_('Save without reload');
		$f->description = $this->_('Save, Publish and Save + Keep Unpublished in the page editor update the page in place, and so does Save in the field, template, module, user, role, permission and profile editors (on pages without jQuery). Shift+click a save button for a classic save; other save actions, Delete, template changes and modal windows always reload.');
		$f->attr('value', 1);
		if($this->pageSaveInPlace) $f->attr('checked', 'checked');
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldText $f */
		$f = $modules->get('InputfieldText');
		$f->attr('name', 'logoURL');
		$f->label = $this->_('Logo URL');
		$f->description = $this->_('Relative to the site root, e.g. site/templates/admin-logo.svg. Empty for the ProcessWire mark from the installed core.');
		$f->attr('value', (string) $this->get('logoURL'));
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldText $f */
		$f = $modules->get('InputfieldText');
		$f->attr('name', 'logoURLDark');
		$f->label = $this->_('Logo URL for the dark scheme');
		$f->description = $this->_('Optional. Shown instead of the logo above when the dark scheme is on.');
		$f->attr('value', (string) $this->get('logoURLDark'));
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldRadios $f */
		$f = $modules->get('InputfieldRadios');
		$f->attr('name', 'legacyStack');
		$f->label = $this->_('Legacy script stack (jQuery, jQuery UI, inputfields.js, main.js)');
		$f->addOption(self::legacyAuto, $this->_('Load only when the page has a legacy Inputfield or Process (default)'));
		$f->addOption(self::legacyAlways, $this->_('Always load (every admin page)'));
		$f->attr('value', $this->legacyStack);
		$inputfields->add($f);

		/** @var InputfieldInteger $f */
		$f = $modules->get('InputfieldInteger');
		$f->attr('name', 'maxWidth');
		$f->label = $this->_('Maximum content width (px), 0 for none');
		$f->attr('value', (int) $this->maxWidth);
		$inputfields->add($f);
	}
}

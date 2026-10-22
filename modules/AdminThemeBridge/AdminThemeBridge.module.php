<?php namespace ProcessWire;

// a module may have declared the interface already (docs/contract.md 2)
if(!interface_exists('ProcessWire\\BridgeComponent', false)) require_once(__DIR__ . '/BridgeComponent.php');

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
			'version' => '0.9.4',
			'summary' => 'Native-component admin shell that still runs every existing Inputfield and Process module.',
			'author' => 'Alexei Tarasov',
			'autoload' => 'template=admin',
			// FilenameArray::urls() is 3.0.227, ModulesInfo::moduleInfoCache() 3.0.218
			'requires' => 'ProcessWire>=3.0.227, PHP>=8.1',
			'icon' => 'cubes',
			'href' => 'https://github.com/theoretic/bridge',
		);
	}

	const legacyAlways = 'always';
	const legacyAuto = 'auto';

	// WireCache name and lifetime (seconds) of the last module info cache rebuild (ready())
	const repairFlag = 'AdminThemeBridge.moduleCacheRepair';
	const repairInterval = 600;

	/**
	 * The native map (ADR 0015, 0016; audit A19): every class the theme runs without the legacy
	 * stack, by exact class name, never by inheritance (a subclass may add jQuery scripts of its
	 * own). One place instead of seven lists; read through nativeMap(), which hooks can extend,
	 * and the nativeOverrides setting, which wins over everything.
	 *
	 * kind:
	 *  - wrapper: structure; markup is the theme's (setMarkup), behaviour (collapse, showIf) the shell's
	 *  - type: a core Inputfield that ships no JavaScript
	 *  - field: a core Inputfield whose script the runtime replaces (milestones 2.3 to 3.9)
	 *  - process: a core Process the theme's scripts stand in for
	 * pageWidget: the Page field (InputfieldPage) stays native with this widget (its own script, add
	 *   new and dependent selects, is the runtime's)
	 * scripts: a Process's stand-ins, printed after the theme script on a page without the stack
	 * scriptsAlways: printed with the stack too (the image window answers an opener without jQuery)
	 * saveInPlace: its edit form saves without a reload (scripts/page-save.js, milestone 3.8)
	 *
	 * @var array class => entry
	 *
	 */
	protected $nativeBase = array(
		// structure (core 3.0.274's InputfieldWrapper family)
		'InputfieldWrapper' => array('kind' => 'wrapper'),
		'InputfieldForm' => array('kind' => 'wrapper'),
		'InputfieldFieldset' => array('kind' => 'wrapper'),
		'InputfieldFieldsetOpen' => array('kind' => 'wrapper'),
		'InputfieldFieldsetClose' => array('kind' => 'wrapper'),
		'InputfieldFieldsetTabOpen' => array('kind' => 'wrapper'),
		'InputfieldMarkup' => array('kind' => 'wrapper'),
		// no script of their own
		'InputfieldSubmit' => array('kind' => 'type'),
		'InputfieldButton' => array('kind' => 'type'),
		'InputfieldHidden' => array('kind' => 'type'),
		// 2.3: what they need from inputfields.js (change tracking, leave warning, Enter guard,
		// invalid-open, showIf/requiredIf, collapse, columns, the Text counter) is the runtime's
		'InputfieldText' => array('kind' => 'field'),
		'InputfieldTextarea' => array('kind' => 'field'),
		'InputfieldCheckbox' => array('kind' => 'field'),
		'InputfieldRadios' => array('kind' => 'field', 'pageWidget' => true),
		'InputfieldSelect' => array('kind' => 'field', 'pageWidget' => true),
		'InputfieldInteger' => array('kind' => 'field'),
		'InputfieldFloat' => array('kind' => 'field'),
		'InputfieldURL' => array('kind' => 'field'),
		'InputfieldEmail' => array('kind' => 'field'),
		'InputfieldName' => array('kind' => 'field'),
		// 2.4: Toggle, Checkboxes and the selection widgets, their scripts replaced; language tabs
		'InputfieldToggle' => array('kind' => 'field'),
		'InputfieldCheckboxes' => array('kind' => 'field', 'pageWidget' => true),
		'InputfieldSelectMultiple' => array('kind' => 'field', 'pageWidget' => true),
		'InputfieldAsmSelect' => array('kind' => 'field', 'pageWidget' => true),
		'InputfieldPageAutocomplete' => array('kind' => 'field', 'pageWidget' => true),
		'InputfieldPageListSelect' => array('kind' => 'field', 'pageWidget' => true),
		'InputfieldPageListSelectMultiple' => array('kind' => 'field', 'pageWidget' => true),
		'InputfieldDatetime' => array('kind' => 'field'),
		'InputfieldTextTags' => array('kind' => 'field', 'pageWidget' => true),
		'InputfieldSelector' => array('kind' => 'field'),
		// 3.1 to 3.6
		'InputfieldPageTitle' => array('kind' => 'field'),
		'InputfieldPageName' => array('kind' => 'field'),
		'InputfieldFile' => array('kind' => 'field'),
		'InputfieldImage' => array('kind' => 'field'),
		'InputfieldRepeater' => array('kind' => 'field'),
		'InputfieldPageTable' => array('kind' => 'field'),
		'InputfieldIcon' => array('kind' => 'field'),
		'InputfieldPassword' => array('kind' => 'field'),
		// Processes (ADR 0016): what a screen renders keeps its own reasons (fields, scripts other
		// modules add)
		'ProcessPageEdit' => array('kind' => 'process', 'scripts' => array('scripts/wire-tabs.js', 'scripts/page-edit.js'), 'saveInPlace' => true),
		'ProcessPageList' => array('kind' => 'process'),
		'ProcessPageLister' => array('kind' => 'process', 'scripts' => array('scripts/wire-tabs.js', 'scripts/lister.js')),
		// 3.6: setup and access; users, roles and permissions are ProcessPageType lists (a Lister)
		// with ProcessPageEdit as their editor
		'ProcessModule' => array('kind' => 'process', 'scripts' => array('scripts/wire-tabs.js', 'scripts/setup.js'), 'saveInPlace' => true),
		'ProcessField' => array('kind' => 'process', 'scripts' => array('scripts/wire-tabs.js', 'scripts/setup.js'), 'saveInPlace' => true),
		'ProcessTemplate' => array('kind' => 'process', 'scripts' => array('scripts/wire-tabs.js', 'scripts/setup.js'), 'saveInPlace' => true),
		'ProcessUser' => array('kind' => 'process', 'scripts' => array('scripts/wire-tabs.js', 'scripts/page-edit.js', 'scripts/lister.js', 'scripts/setup.js'), 'saveInPlace' => true),
		'ProcessRole' => array('kind' => 'process', 'scripts' => array('scripts/wire-tabs.js', 'scripts/page-edit.js', 'scripts/lister.js', 'scripts/setup.js'), 'saveInPlace' => true),
		'ProcessPermission' => array('kind' => 'process', 'scripts' => array('scripts/wire-tabs.js', 'scripts/page-edit.js', 'scripts/lister.js', 'scripts/setup.js'), 'saveInPlace' => true),
		// 3.7: the remaining core screens; Recent, Clone and Trash have no scripts of their own
		'ProcessPageAdd' => array('kind' => 'process', 'scripts' => array('scripts/screens.js')),
		'ProcessProfile' => array('kind' => 'process', 'scripts' => array('scripts/screens.js'), 'saveInPlace' => true),
		'ProcessLogger' => array('kind' => 'process', 'scripts' => array('scripts/screens.js')),
		'ProcessRecentPages' => array('kind' => 'process'),
		'ProcessPageClone' => array('kind' => 'process'),
		'ProcessPageTrash' => array('kind' => 'process'),
		'ProcessPageEditLink' => array('kind' => 'process', 'scripts' => array('scripts/wire-tabs.js', 'scripts/link.js')),
		// 3.9: image select, Crop and Variations
		'ProcessPageEditImageSelect' => array('kind' => 'process', 'scripts' => array('scripts/image-select.js'), 'scriptsAlways' => true),
	);

	/**
	 * nativeMap() after hooks, for the request
	 *
	 * @var array|null
	 */
	protected $nativeMapCache = null;

	/**
	 * The nativeOverrides setting, parsed
	 *
	 * @var array|null class => 'native'|'legacy'
	 */
	protected $nativeOverridesCache = null;

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
	 * Site scripts added on every admin page that call jQuery only for certain fields: printed
	 * where none of those fields render (they run without it there), a legacy reason where one
	 * does. Read through scriptNeeds(), which hooks can extend; the printScripts setting still
	 * prints a script everywhere.
	 *
	 * Key: a part of the script URL. Value: where it needs jQuery, 'languages' (a multi-language
	 * Inputfield, useLanguages) or an Inputfield class name (exact class).
	 *
	 * @var array URL part => condition
	 *
	 */
	protected $scriptNeedsBase = array(
		// Fluency: translation buttons on multi-language fields, set up on window load (so it cannot
		// wait for a stack loaded later); each translation ends in `$(field).trigger('change')`.
		// Its admin menu tweak (the Fluency item opens in a modal) is vanilla.
		'/Fluency/assets/bundle/scripts/fluency.js' => 'languages',
	);

	/**
	 * scriptNeeds() after hooks, for the request
	 *
	 * @var array|null
	 */
	protected $scriptNeedsCache = null;

	/**
	 * Conditions of scriptNeeds() met on this request: 'languages' and the classes of the
	 * Inputfields rendered
	 *
	 * @var array condition => true
	 */
	protected $renderedNeeds = array();

	/**
	 * scriptNeeds() keys already settled (their script was registered when the condition was met)
	 *
	 * @var array URL part => true
	 */
	protected $settledNeeds = array();

	/**
	 * Field module directories whose jQuery script the Process added (needScriptsAddedByProcess):
	 * the script is that module's Inputfield's business, unless no legacy Inputfield from the
	 * directory was rendered (its Fieldtype renders a core native Inputfield: audit A4)
	 *
	 * @var array dir => 'Script:dir/file.js'
	 */
	protected $pendingScriptReasons = array();

	/**
	 * Module directories of the legacy Inputfields recorded on this request
	 *
	 * @var array dir => true
	 */
	protected $legacyInputfieldDirs = array();

	/**
	 * isJqueryScript() verdicts: 'file|mtime' => bool, kept in WireCache across requests
	 *
	 * @var array|null
	 */
	protected $jqueryVerdicts = null;
	protected $jqueryVerdictsChanged = false;
	const jqueryVerdictsCache = 'AdminThemeBridge.jqueryScripts';

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
		$this->set('printScripts', '');
		$this->set('nativeOverrides', '');
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
		static $forces = null;
		if($forces !== null) return $forces;
		$modules = $this->wire()->modules;
		if(!$modules->isInstalled('AdminThemeBoss')) return $forces = false;
		// a setting never saved is Boss's default, and both default to on
		// (AdminThemeBossConfig::getDefaults(): enablemodule, allusers => true)
		$boss = (array) $modules->getConfig('AdminThemeBoss');
		$on = function($key) use($boss) { return !array_key_exists($key, $boss) || !empty($boss[$key]); };
		return $forces = $on('enablemodule') && $on('allusers');
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
		if($this->legacyStack !== self::legacyAlways) $this->set('legacyStack', self::legacyAuto);
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
		// tables print `AdminDataTable.initTable($('#id'))`: without jQuery the runtime's
		// AdminDataTable (milestone 3.5) takes the element instead
		$this->addHookAfter('MarkupAdminDataTable::render', $this, 'hookDataTableRender');
		// inline jQuery code in a native markup field (a module's config screen, notes): A5
		$this->addHookAfter('InputfieldMarkup::render', $this, 'hookMarkupRender');
		$this->addHookAfter('InputfieldMarkup::renderValue', $this, 'hookMarkupRender');
	}

	/**
	 * Hook after InputfieldMarkup::render / renderValue: InputfieldMarkup is native, but what it
	 * prints is anyone's. An inline script in it that calls jQuery (PageTableNext's config prints
	 * `$('#...').iFrameResize()`) needs the stack on this page (audit A5).
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookMarkupRender(HookEvent $event) {
		$out = $event->return;
		if(!is_string($out) || stripos($out, '<script') === false || $this->useLegacyStack()) return;
		if(!preg_match_all('~<script\b([^>]*)>(.*?)</script>~is', $out, $m, PREG_SET_ORDER)) return;
		foreach($m as $script) {
			if(preg_match('/\bsrc\s*=/i', $script[1])) continue;
			if(preg_match('/\btype\s*=\s*[\'"]?(?!text\/javascript|application\/javascript|module)[\w\/+-]+/i', $script[1])) continue;
			if(!self::needsJquery($script[2])) continue;
			$this->needLegacy('Inline:' . $event->object->className());
			return;
		}
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
		// the core structure is the theme's; a third-party wrapper subclass is marked like any field
		if($this->isNativeWrapper($inputfield) && $inputfield->className() !== 'InputfieldMarkup') return;
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
		if($record) {
			$this->renderedNeeds[$class] = true;
			if($inputfield->getSetting('useLanguages')) $this->renderedNeeds['languages'] = true;
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
			if($record) {
				$this->needLegacy("Inputfield:$class");
				$dir = $this->wire()->config->paths($class);
				if($dir) $this->legacyInputfieldDirs[$dir] = true;
			}
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
		if($this->recordProcess($process) && is_string($event->return)) {
			$event->return = $this->nativeInlineScripts($event->return);
		}
	}

	/**
	 * The Process's legacy reasons: the scripts it added (needScriptsAddedByProcess()), and itself
	 * unless it is native
	 *
	 * @param Process $process
	 * @return bool Is the Process native?
	 *
	 */
	protected function recordProcess(Process $process) {
		$this->needScriptsAddedByProcess($process);
		if($this->isNativeProcess($process)) return true;
		$this->needLegacy('Process:' . $process->className());
		return false;
	}

	/**
	 * Called by default.php once the Process is done: a Process that threw (wire/core/admin.php
	 * catches it and shows the error) never reached hookProcessExecute(). It keeps the reasons it
	 * would have had, so its own script (ProcessHannaCode.js, added when it initialised) is not
	 * left deferred on a screen that is not native.
	 *
	 */
	public function settleProcess() {
		if($this->scriptsBeforeProcess === null) return;
		$process = $this->wire()->process;
		if($process instanceof Process) {
			$this->recordProcess($process);
		} else {
			$this->scriptsBeforeProcess = null;
		}
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
	 * A module's config screen (ProcessModule, `edit?name=X`) is the exception: a jQuery script
	 * from X's own directory is that screen's, whenever it was added. Modules add it at init or
	 * ready when they see `?name=X` (AdminOnSteroids' aos_config.min.js, GeneralSettings'
	 * Settings.js), before the Process starts.
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
		$configured = $this->moduleConfigUrl($process);
		foreach($config->scripts->urls() as $url) {
			$url = (string) $url;
			if(strpos($url, $config->urls->wire) === 0) continue;
			$forConfig = $configured !== '' && strpos($url, $configured) === 0;
			if(!$forConfig && in_array($url, $before, true)) continue;
			if($own && strpos($url, $own) === 0) continue;
			if(!$this->isJqueryScript($url)) continue;
			$path = preg_replace('/[?#].*$/', '', $url);
			$dir = $this->siteModuleDir($path);
			$reason = $this->scriptReason($path);
			// a field module's script (added as its Inputfield renders) has the Inputfield's reason,
			// if one of its Inputfields was legacy; settled in useLegacyStack()
			if(!$forConfig && $dir !== '' && $this->isFieldModuleDir($dir)) {
				$this->pendingScriptReasons[$dir] = $reason;
				continue;
			}
			$this->needLegacy($reason);
		}
	}

	/**
	 * On a module's config screen (ProcessModule `edit?name=X`), the URL of X's directory
	 *
	 * @param Process $process
	 * @return string URL, or '' on any other screen (or for a module directly in site/modules/)
	 *
	 */
	public function moduleConfigUrl(Process $process) {
		if($process->className() !== 'ProcessModule') return '';
		$input = $this->wire()->input;
		if($input->urlSegment1 !== 'edit') return '';
		$name = $this->wire()->sanitizer->name((string) $input->get('name'));
		if($name === '' || !$this->wire()->modules->isInstalled($name)) return '';
		$config = $this->wire()->config;
		$url = (string) $config->urls($name);
		if($url === '' || $url === $config->urls->siteModules || strpos($url, $config->urls->wire) === 0) return '';
		return $url;
	}

	/**
	 * The legacy reason for a script: `Script:<dir>/<file>`, dir being its module's directory under
	 * site/modules (Fluency/fluency.js, not scripts/fluency.js), else the script's own directory
	 *
	 * @param string $path Root-relative URL path, no query
	 * @return string
	 *
	 */
	protected function scriptReason($path) {
		$dir = $this->siteModuleDir($path);
		return 'Script:' . ($dir !== '' ? basename(rtrim($dir, '/')) : basename(dirname($path))) . '/' . basename($path);
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
	 * The native map (see $nativeBase): hook after to add, change or remove entries, e.g.
	 * `$wire->addHookAfter('AdminThemeBridge::nativeMap', function($e) { $map = $e->return;
	 * $map['InputfieldMyMarkup'] = array('kind' => 'wrapper'); $e->return = $map; });`
	 *
	 * @return array class => entry
	 *
	 */
	public function ___nativeMap() {
		return $this->nativeBase;
	}

	/**
	 * nativeMap(), once per request
	 *
	 * @return array
	 *
	 */
	public function getNativeMap() {
		if($this->nativeMapCache === null) {
			$map = $this->nativeMap();
			$this->nativeMapCache = is_array($map) ? $map : $this->nativeBase;
		}
		return $this->nativeMapCache;
	}

	/**
	 * The nativeOverrides setting: one `ClassName=native` or `ClassName=legacy` per line; other
	 * lines are ignored (see nativeOverrideErrors())
	 *
	 * @return array class => 'native'|'legacy'
	 *
	 */
	public function set($key, $value) {
		if($key === 'nativeOverrides') $this->nativeOverridesCache = null;
		return parent::set($key, $value);
	}

	public function getNativeOverrides() {
		if($this->nativeOverridesCache !== null) return $this->nativeOverridesCache;
		$this->nativeOverridesCache = array();
		foreach(preg_split('/\r?\n/', (string) $this->get('nativeOverrides')) as $line) {
			if(preg_match('/^\s*([A-Z][A-Za-z0-9_]*)\s*=\s*(native|legacy)\s*$/', $line, $m)) $this->nativeOverridesCache[$m[1]] = $m[2];
		}
		return $this->nativeOverridesCache;
	}

	/**
	 * Lines of the nativeOverrides setting that are not `ClassName=native|legacy`
	 *
	 * @return array
	 *
	 */
	public function nativeOverrideErrors() {
		$bad = array();
		foreach(preg_split('/\r?\n/', (string) $this->get('nativeOverrides')) as $line) {
			if(trim($line) === '' || strpos(ltrim($line), '#') === 0) continue;
			if(!preg_match('/^\s*[A-Z][A-Za-z0-9_]*\s*=\s*(native|legacy)\s*$/', $line)) $bad[] = trim($line);
		}
		return $bad;
	}

	/**
	 * Is this Process fine without the legacy stack (its own client part)? The override setting
	 * first, then a component (its own class, not a subclass: ADR 0015), then the native map by
	 * exact class (ADR 0016). Hookable.
	 *
	 * @param Process $process
	 * @return bool
	 *
	 */
	public function ___isNativeProcess(Process $process) {
		$class = $process->className();
		$overrides = $this->getNativeOverrides();
		if(isset($overrides[$class])) return $overrides[$class] === 'native';
		if($process instanceof BridgeComponent) return $this->componentClass($process) === get_class($process);
		$map = $this->getNativeMap();
		return isset($map[$class]) && $map[$class]['kind'] === 'process';
	}

	/**
	 * The class that declares a component's getBridgeComponent()
	 *
	 * @param BridgeComponent $module
	 * @return string Fully qualified class name
	 *
	 */
	protected function componentClass($module) {
		$method = new \ReflectionMethod($module, 'getBridgeComponent');
		return $method->getDeclaringClass()->getName();
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
		return $this->processScripts($process->className(), $this->useLegacyStack());
	}

	/**
	 * A Process class's stand-in scripts from the native map (nativeProcessScripts())
	 *
	 * @param string $class
	 * @param bool $legacy Is the stack on the page? (then only scriptsAlways entries print theirs)
	 * @return array Paths relative to the theme directory
	 *
	 */
	public function processScripts($class, $legacy = false) {
		$map = $this->getNativeMap();
		$entry = isset($map[$class]) && $map[$class]['kind'] === 'process' ? $map[$class] : null;
		if(!$entry || empty($entry['scripts'])) return array();
		if($legacy && empty($entry['scriptsAlways'])) return array();
		return array_values((array) $entry['scripts']);
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
		$map = $this->getNativeMap();
		$class = $process->className();
		return isset($map[$class]) && !empty($map[$class]['saveInPlace']);
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
			// relative to the directory of the class that declares the component (a subclass in
			// another module would otherwise point at its own directory)
			$declaring = $module instanceof BridgeComponent ? wireClassName($this->componentClass($module), false) : $module->className();
			$base = $this->wire()->config->urls($declaring);
			$url = ($base ? $base : '') . $url;
		}
		if($url !== '' && strpos($url, '?') === false) {
			$moduleVersion = $this->wire()->modules->getModuleInfoProperty($module, 'version');
			if($moduleVersion) $url .= '?v=' . rawurlencode((string) $moduleVersion);
		}
		return array('tag' => $tag, 'module' => $url, 'version' => $version);
	}

	/**
	 * Is this Inputfield fine without the legacy stack? The override setting first, then the
	 * native map by exact class (wrappers included: a subclass of InputfieldMarkup or
	 * InputfieldFieldset may add scripts like any other; audit A19), the Page field by its widget,
	 * a component by its own class. Hookable.
	 *
	 * @param Inputfield $inputfield
	 * @return bool
	 *
	 */
	public function ___isNativeInputfield(Inputfield $inputfield) {
		$class = $inputfield->className();
		$overrides = $this->getNativeOverrides();
		if(isset($overrides[$class])) return $overrides[$class] === 'native';
		$map = $this->getNativeMap();
		if(isset($map[$class]) && $map[$class]['kind'] !== 'process') return true;
		if($class === 'InputfieldPage') {
			$widget = ltrim((string) $inputfield->getSetting('inputfield'), '_');
			if($widget === '') $widget = 'InputfieldSelect';
			if(isset($overrides[$widget])) return $overrides[$widget] === 'native';
			return isset($map[$widget]) && !empty($map[$widget]['pageWidget']);
		}
		// a component counts for its own class only: a subclass may add jQuery scripts of its own
		// (ADR 0015: native by exact class, never by inheritance)
		if($inputfield instanceof BridgeComponent) return $this->componentClass($inputfield) === get_class($inputfield);
		return false;
	}

	/**
	 * Is this one of the structural wrappers of the native map (InputfieldWrapper, Form, Fieldset,
	 * FieldsetOpen/Close/TabOpen, Markup), by exact class?
	 *
	 * @param Inputfield $inputfield
	 * @return bool
	 *
	 */
	public function isNativeWrapper(Inputfield $inputfield) {
		$map = $this->getNativeMap();
		$class = $inputfield->className();
		return isset($map[$class]) && $map[$class]['kind'] === 'wrapper';
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
		$this->settleScriptReasons();
		return $this->legacyNeeded;
	}

	/**
	 * A jQuery script from a field module directory needs the stack unless a legacy Inputfield
	 * from that directory was rendered (it then has that Inputfield's reason): a Fieldtype that
	 * renders a core native Inputfield and adds its own jQuery script (FieldtypeOptionsColor)
	 * would otherwise have its script deferred and never run (ADR 0015 3; audit A4)
	 *
	 */
	protected function settleScriptReasons() {
		foreach($this->pendingScriptReasons as $dir => $reason) {
			unset($this->pendingScriptReasons[$dir]);
			if(empty($this->legacyInputfieldDirs[$dir])) $this->needLegacy($reason);
		}
		if(!count($this->renderedNeeds)) return;
		// a scriptNeeds() script whose fields render here
		foreach($this->getScriptNeeds() as $part => $when) {
			if(isset($this->settledNeeds[$part]) || empty($this->renderedNeeds[$when])) continue;
			foreach($this->wire()->config->scripts->urls() as $url) {
				$url = (string) $url;
				$path = preg_replace('/[?#].*$/', '', $url);
				if(strpos($path, $part) === false) continue;
				$this->settledNeeds[$part] = true;
				if($this->isJqueryScript($url)) $this->needLegacy($this->scriptReason($path));
				break;
			}
		}
	}

	/**
	 * The scriptNeeds map (see $scriptNeedsBase): hook after to add, change or remove entries, e.g.
	 * `$wire->addHookAfter('AdminThemeBridge::scriptNeeds', function($e) { $map = $e->return;
	 * $map['/MyModule/my-admin.js'] = 'InputfieldMyField'; $e->return = $map; });`
	 *
	 * @return array URL part => 'languages' or an Inputfield class name
	 *
	 */
	public function ___scriptNeeds() {
		return $this->scriptNeedsBase;
	}

	/**
	 * scriptNeeds(), once per request
	 *
	 * @return array
	 *
	 */
	public function getScriptNeeds() {
		if($this->scriptNeedsCache === null) {
			$map = $this->scriptNeeds();
			$this->scriptNeedsCache = is_array($map) ? $map : $this->scriptNeedsBase;
		}
		return $this->scriptNeedsCache;
	}

	/**
	 * Is this script in the scriptNeeds() map? (Printed on a page without the stack: where its
	 * fields render, it made the page legacy.)
	 *
	 * @param string $url
	 * @return bool
	 *
	 */
	public function isScriptNeedsScript($url) {
		$path = preg_replace('/[?#].*$/', '', (string) $url);
		foreach($this->getScriptNeeds() as $part => $when) {
			if($part !== '' && strpos($path, $part) !== false) return true;
		}
		return false;
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
	 * never count. Comments do not count ("No jQuery."), and a script that checks for jQuery
	 * (`window.jQuery`, `typeof jQuery`) works without it and is printed (audit A3). URLs that
	 * contain one of the lines of the printScripts setting are always printed, and so are the
	 * scriptNeeds() scripts on a page without the stack (getScriptUrls()). Verdicts are kept per
	 * file and modification time in one WireCache entry (A14).
	 *
	 * @param string $url
	 * @return bool
	 *
	 */
	public function isJqueryScript($url) {
		$config = $this->wire()->config;
		$path = preg_replace('/[?#].*$/', '', (string) $url);
		if(strpos($path, '/') !== 0 || strpos($path, '//') === 0 || substr($path, -3) !== '.js') return false;
		if(strpos($path, $this->url()) === 0) return false;
		foreach($this->printScriptsList() as $needle) if(strpos($path, $needle) !== false) return false;
		$root = $config->urls->root;
		if(strpos($path, $root) !== 0) return false;
		$file = $config->paths->root . substr($path, strlen($root));
		if(!is_file($file)) return false;
		$key = $file . '|' . filemtime($file);
		if($this->jqueryVerdicts === null) {
			$this->jqueryVerdicts = (array) $this->wire()->cache->get(self::jqueryVerdictsCache);
		}
		if(!isset($this->jqueryVerdicts[$key])) {
			$this->jqueryVerdicts[$key] = self::needsJquery((string) file_get_contents($file, false, null, 0, 512 * 1024));
			$this->jqueryVerdictsChanged = true;
		}
		return (bool) $this->jqueryVerdicts[$key];
	}

	/**
	 * Does this script source call jQuery? (isJqueryScript())
	 *
	 * @param string $js
	 * @return bool
	 *
	 */
	public static function needsJquery($js) {
		// comments out (a // inside a string such as 'http://' is left alone: a : or quote before it)
		$js = preg_replace('~/\*.*?\*/~s', '', $js);
		$js = (string) preg_replace('~(^|[^:\'"\\\\])//[^\n]*~m', '$1', (string) $js);
		// a script that asks whether jQuery is there runs without it
		if(preg_match('/\bwindow\.jQuery\b|\btypeof\s+(window\.)?jQuery\b|[\'"]jQuery[\'"]\s+in\s+window/', $js)) return false;
		return (bool) preg_match('/\bjQuery\b|(?<![\w$])\$\s*\(|(?<![\w$])\$\.\w/', $js);
	}

	/**
	 * The printScripts setting as a list (one URL part per line)
	 *
	 * @return array
	 *
	 */
	protected function printScriptsList() {
		static $list = null;
		if($list === null) $list = array_values(array_filter(array_map('trim', preg_split('/\r?\n/', (string) $this->get('printScripts')))));
		return $list;
	}

	/**
	 * Keep new isJqueryScript() verdicts for later requests (called once the head is printed)
	 *
	 */
	public function saveScriptVerdicts() {
		if(!$this->jqueryVerdictsChanged || !is_array($this->jqueryVerdicts)) return;
		$this->jqueryVerdictsChanged = false;
		// stale entries (an older mtime) go: keep the newest verdict per file
		$byFile = array();
		foreach($this->jqueryVerdicts as $key => $verdict) {
			$file = substr($key, 0, strrpos($key, '|'));
			$byFile[$file] = array($key, $verdict);
		}
		$keep = array();
		foreach($byFile as $entry) $keep[$entry[0]] = $entry[1];
		$this->wire()->cache->save(self::jqueryVerdictsCache, $keep, WireCache::expireNever);
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
			if($this->isLegacyScript($url) || ($this->isJqueryScript($url) && !$this->isScriptNeedsScript($url))) {
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
		// the name links to the profile when the user may edit it (touch: a second tap follows it)
		$profile = $user->hasPermission('profile-edit') ? " href='" . $this->wire()->urls->admin . "profile/'" : " href='#'";
		return
			"<ul class='pw-user-nav'><li class='pw-dropdown'>" .
			"<a id='tools-toggle' class='pw-dropdown-toggle'$profile>" .
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
			$out .= "<li class='pw-breadcrumb-tree'><a href='$treeUrl' title='" .
				$sanitizer->entities1($this->_('Page tree')) . "'>" . $this->renderIcon('sitemap') . "</a></li>";
		}
		$editPage = null;
		if($isPageEdit) {
			$p = $this->wire()->process;
			if($p && method_exists($p, 'getPage')) $editPage = $p->getPage();
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

		/** @var InputfieldTextarea $f */
		$f = $modules->get('InputfieldTextarea');
		$f->attr('name', 'printScripts');
		$f->label = $this->_('Site scripts that never wait for the legacy stack');
		$f->description = $this->_('On pages without jQuery, a site module script that calls jQuery is held back until the stack loads. One URL part per line (such as a module directory name) for scripts that work without it although they mention jQuery.');
		$f->attr('rows', 3);
		$f->attr('value', (string) $this->get('printScripts'));
		$f->collapsed = Inputfield::collapsedBlank;
		$inputfields->add($f);

		/** @var InputfieldTextarea $f */
		$f = $modules->get('InputfieldTextarea');
		$f->attr('name', 'nativeOverrides');
		$f->label = $this->_('Native or legacy, per class');
		$f->description = $this->_('One "ClassName=native" or "ClassName=legacy" per line, for an Inputfield or Process class: "native" runs it without the legacy stack (it must need neither jQuery nor inputfields.js), "legacy" always loads the stack where it renders. Wins over the theme\'s own list and over BridgeComponent.');
		$f->notes = $this->_('Example: InputfieldSeoNeoPreview=native');
		$f->attr('rows', 3);
		$f->attr('value', (string) $this->get('nativeOverrides'));
		$bad = $this->nativeOverrideErrors();
		if(count($bad)) $f->error(sprintf($this->_('Ignored (not ClassName=native|legacy): %s'), implode(', ', $bad)));
		$f->collapsed = count($bad) ? Inputfield::collapsedNo : Inputfield::collapsedBlank;
		$inputfields->add($f);

		/** @var InputfieldInteger $f */
		$f = $modules->get('InputfieldInteger');
		$f->attr('name', 'maxWidth');
		$f->label = $this->_('Maximum content width (px), 0 for none');
		$f->attr('value', $this->getMaxWidth());
		$f->attr('min', 0);
		$f->attr('max', 4000);
		$inputfields->add($f);
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

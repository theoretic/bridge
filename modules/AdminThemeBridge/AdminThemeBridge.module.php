<?php namespace ProcessWire;

// a module may have declared the interface already (docs/contract.md 2)
if(!interface_exists('ProcessWire\\BridgeComponent', false)) require_once(__DIR__ . '/BridgeComponent.php');
// the class, split by job into traits (lib/, audit PA1)
require_once(__DIR__ . '/lib/AdminThemeBridgeShell.php');
require_once(__DIR__ . '/lib/AdminThemeBridgeHealth.php');
require_once(__DIR__ . '/lib/AdminThemeBridgeLegacy.php');
require_once(__DIR__ . '/lib/AdminThemeBridgeScripts.php');
require_once(__DIR__ . '/lib/AdminThemeBridgeRewrites.php');
require_once(__DIR__ . '/lib/AdminThemeBridgeTables.php');
require_once(__DIR__ . '/lib/AdminThemeBridgeUikit.php');
require_once(__DIR__ . '/lib/AdminThemeBridgeComponents.php');
require_once(__DIR__ . '/lib/AdminThemeBridgeConfig.php');
require_once(__DIR__ . '/lib/AdminThemeBridgeHead.php');
require_once(__DIR__ . '/lib/AdminThemeBridgePageAdd.php');
require_once(__DIR__ . '/lib/AdminThemeBridgeFiles.php');

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

	use AdminThemeBridgeShell;
	use AdminThemeBridgeHealth;
	use AdminThemeBridgeLegacy;
	use AdminThemeBridgeScripts;
	use AdminThemeBridgeRewrites;
	use AdminThemeBridgeTables;
	use AdminThemeBridgeUikit;
	use AdminThemeBridgeComponents;
	use AdminThemeBridgeConfig;
	use AdminThemeBridgeHead;
	use AdminThemeBridgePageAdd;
	use AdminThemeBridgeFiles;

	public static function getModuleInfo() {
		return array(
			'title' => 'Bridge',
			'version' => '0.17.0',
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
	// the uikit setting's modes (the same stored values as the legacy stack's, plus never)
	const uikitAlways = 'always';
	const uikitAuto = 'auto';
	const uikitNever = 'never';

	// WireCache name of the module info cache rebuild state (ready()): the time of the last try and
	// the number of tries; the wait after a try doubles from repairInterval (seconds), and after
	// repairAttempts tries the theme stops and tells superusers (audit B7)
	const repairFlag = 'AdminThemeBridge.moduleCacheRepair';
	const repairInterval = 600;
	const repairAttempts = 5;

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
	 * componentInfo(): directory URL of the declaring class and module version, by class
	 *
	 */
	protected $componentBase = array();
	protected $componentVersion = array();

	/**
	 * bossForcesUikit() and printScriptsList() answers, per instance (audit B12: method statics
	 * were shared by every instance)
	 *
	 */
	protected $bossForces = null;
	protected $printScriptsList = null;

	/**
	 * isFieldModuleDir() answers for this request
	 *
	 * @var array dir => bool
	 */
	protected $fieldModuleDirs = array();

	/**
	 * isJqueryScript() verdicts: 'file|mtime|size' => bool, kept in WireCache across requests
	 *
	 * @var array|null
	 */
	protected $jqueryVerdicts = null;
	protected $jqueryVerdictsChanged = false;
	const jqueryVerdictsCache = 'AdminThemeBridge.jqueryScripts';

	/**
	 * Why this request needs the UIkit layer (ADR 0017): 'Markup:uk-grid', 'Script:path',
	 * 'Asset:url', 'Module:Name' => count
	 *
	 * @var array
	 *
	 */
	protected $uikitReasons = array();

	/**
	 * useUikit() for this request, once the head asked (null before)
	 *
	 * @var bool|null
	 */
	protected $uikitDecided = null;

	/**
	 * uk-* classes the theme's own compat rules style (assets/dist/uikit-covered.json)
	 *
	 * @var array|null class => true
	 */
	protected $uikitCovered = null;

	/**
	 * Script verdicts for UIkit: 'file|mtime' => bool (does it name the UIkit global?), in WireCache
	 *
	 * @var array|null
	 */
	protected $uikitVerdicts = null;
	protected $uikitVerdictsChanged = false;
	const uikitVerdictsCache = 'AdminThemeBridge.uikitScripts';

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
		$this->set('uikit', self::uikitAuto);
		$this->set('maxWidth', 1600);
		$this->set('variant', 'blue');
		$this->set('primaryColor', '');
		$this->set('colorScheme', 'auto');
		$this->set('logoURL', '');
		$this->set('logoURLDark', '');
		$this->set('extendedBreadcrumbs', 1);
		$this->set('pageSaveInPlace', 1);
		$this->set('pageAddSkipTemplate', 0);
		$this->set('dangerWarn', 1);
		$this->set('dataTableSortRows', 10);
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
	 * renderNativeLogo() for this request
	 *
	 * @var string|null
	 *
	 */
	protected $nativeLogo = null;

	/**
	 * manifest() data for this request
	 *
	 * @var array|null
	 *
	 */
	protected $manifestData = null;

	/**
	 * True when this request loaded the theme at boot instead of on admin pages only
	 *
	 * @var bool
	 *
	 */
	protected $loadedAtBoot = false;

	public function ___install() {
		parent::___install();
		if($this->bossForcesUikit()) {
			$this->warning($this->_('AdminThemeBoss has "activate for all users" on: it switches every user back to Uikit on each request. Turn it off in its module settings, then select Bridge in your profile.'));
		}
	}

	/**
	 * Uninstall: the theme's WireCache entries (script verdicts, kept forever, and the module-cache
	 * repair state) go with it (audit B13)
	 *
	 */
	public function ___uninstall() {
		parent::___uninstall();
		$this->wire()->cache->delete('AdminThemeBridge.*');
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
		// without a visible label the inputs keep their label as accessible name (audit SU5)
		$this->addHookAfter('ProcessLogin::buildLoginForm', function(HookEvent $event) {
			$form = $event->return;
			if(!$form instanceof InputfieldForm) return;
			foreach(array('login_name', 'login_pass') as $name) {
				$f = $form->getChildByName($name);
				if($f && $f->label && !$f->attr('aria-label')) $f->attr('aria-label', $f->label);
			}
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
		// files and images dragged between the file fields of a page (0.14.0, lib/AdminThemeBridgeFiles.php)
		$this->addHookBefore('ProcessPageEdit::ajaxSave', $this, 'hookPageEditAjaxSave');
		// Add New with a known template goes straight to the editor (setting, off by default)
		if($this->pageAddSkipTemplate) $this->addHookBefore('ProcessPageAdd::buildForm', $this, 'hookPageAddBuildForm');
		// tables print `AdminDataTable.initTable($('#id'))`: without jQuery the runtime's
		// AdminDataTable (milestone 3.5) takes the element instead
		$this->addHookAfter('MarkupAdminDataTable::render', $this, 'hookDataTableRender');
		// every core data table sorts by its headers, also those core made unsortable (0.9.9), once
		// it has as many rows as the dataTableSortRows setting (0.17.0)
		$this->addHookBefore('MarkupAdminDataTable::render', $this, 'hookDataTableRenderBefore');
		// inline jQuery code in a native markup field (a module's config screen, notes): A5
		$this->addHookAfter('InputfieldMarkup::render', $this, 'hookMarkupRender');
		$this->addHookAfter('InputfieldMarkup::renderValue', $this, 'hookMarkupRender');
	}

	/**
	 * Set a property; a new nativeOverrides value drops the parsed copy (getNativeOverrides())
	 *
	 * @param string $key
	 * @param mixed $value
	 * @return $this
	 *
	 */
	public function set($key, $value) {
		if($key === 'nativeOverrides') $this->nativeOverridesCache = null;
		return parent::set($key, $value);
	}

	/**
	 * assetUrls() answers
	 *
	 * @var array
	 *
	 */
	protected $urlsMemo = array();

}

<?php namespace ProcessWire;

/**
 * Included by AdminThemeFramework::includeInitFile() before the Process module runs.
 * Settings that core modules read from $config to adapt their markup to the theme. Class names set
 * here are styled by assets/dist/theme.css (source runtime/src/styles/).
 *
 * FileCompiler=0
 */

if(!defined("PROCESSWIRE")) die();

/** @var Config $config */
/** @var AdminThemeBridge $adminTheme */

$adminTheme = $config->wire('adminTheme');

// no percentage gap between columns: the gap is CSS padding instead. Same value as
// AdminThemeUikit, so InputfieldWrapper breaks rows at the same fields under both themes.
$config->set('inputfieldColumnWidthSpacing', 0);

// 2 = write both style="width:%" and data-colwidth, and let the wrapper round a 95..99% row up
// to 100 so the next field starts a new row. Same as AdminThemeUikit; without it a row of three
// 33% columns stays "open" and the fourth field joins it instead of starting the next row.
$wrapperConfig = $config->InputfieldWrapper;
if(!is_array($wrapperConfig)) $wrapperConfig = array();
$wrapperConfig['useColumnWidth'] = 2;
$config->set('InputfieldWrapper', $wrapperConfig);

// tabs: own look (33-tabs.css), upstream gif-based WireTabs CSS not needed
$config->set('JqueryWireTabs', array(
	'ulClass' => 'WireTabs',
	'liActiveClass' => 'pw-active',
	'aActiveClass' => 'on',
	'loadStyles' => false,
));

// language tabs on fields: plain markup instead of jQuery UI tabs. LanguageTabs.js then toggles
// .LanguageSupportCurrent on the panels (shown/hidden by 21-controls.css) and moves uk-active
// between the tabs only inside a ul.uk-tab; the class is a hook name here, no Uikit involved.
$config->set('LanguageTabs', array(
	'jQueryUI' => false,
	'ulClass' => 'pw-lang-tabs uk-tab',
	'ulAttrs' => '',
	'liActiveClass' => 'uk-active',
	'liDisabledClass' => 'pw-disabled',
	'liEmptyClass' => 'pw-empty',
	'aClass' => '',
));

// data tables: upstream CSS stays (responsive and sortable behaviour), the look comes from 31-tables.css
$config->set('MarkupAdminDataTable', array(
	'addClass' => $adminTheme->getClass('table'),
	'loadStyles' => true,
	'loadScripts' => true,
));

$config->set('MarkupPagerNav', array(
	// a list in a navigation landmark (role=navigation on the <ul> took its list semantics; audit SU7)
	'listMarkup' => "<nav class='pw-pagination-nav' aria-label='" . $adminTheme->wire()->sanitizer->entities1($adminTheme->shellLabel('pagination')) . "'><ul class='pw-pagination MarkupPagerNav'>{out}</ul></nav>",
	'currentItemClass' => 'pw-active MarkupPagerNavOn',
	'separatorItemClass' => 'pw-disabled MarkupPagerNavSeparator',
	'separatorItemLabel' => '<span>&hellip;</span>',
	'nextItemLabel' => wireIconMarkup('angle-right'),
	'previousItemLabel' => wireIconMarkup('angle-left'),
));

$config->set('ProcessPageList', array(
	'paginationClass' => 'pw-pagination PageListPagination',
	'paginationCurrentClass' => 'pw-active',
	'paginationLinkClass' => 'pw-link',
	'paginationLinkCurrentClass' => 'pw-link-active',
	'paginationHoverClass' => 'pw-link-hover',
	'paginationDisabledClass' => 'pw-disabled',
));

$config->set('ProcessList', array(
	'dlClass' => $adminTheme->getClass('dl'),
	'dtClass' => '',
	'ddClass' => '',
	'aClass' => '',
	'disabledClass' => 'ui-priority-secondary',
	'showIcon' => true,
));

// image field buttons; only when renderButtons is not hooked by someone else (Uikit's guard)
$buttonClassKey = $config->wire('hooks')->isHooked('InputfieldImage::renderButtons()') ? '_buttonClass' : 'buttonClass';
$config->set('InputfieldImage', array(
	$buttonClassKey => 'pw-button pw-button-small pw-button-text',
	'buttonText' => '{out}',
	'selectClass' => $adminTheme->getClass('select-small'),
));

$config->set('InputfieldSelector', array(
	'selectClass' => $adminTheme->getClass('select') . ' InputfieldSetWidth',
	'inputClass' => $adminTheme->getClass('input') . ' InputfieldSetWidth',
	'checkboxClass' => $adminTheme->getClass('input-checkbox'),
));

$config->set('InputfieldRadios', array('wbr' => false));

$config->set('SystemNotifications', array(
	'classCommon' => 'pw-alert',
	'classMessage' => 'NoticeMessage pw-alert-message pw-notice-success',
	'classWarning' => 'NoticeWarning pw-alert-warning pw-notice-warning',
	'classError' => 'NoticeError pw-alert-error pw-notice-error',
	'classContainer' => 'pw-container',
	'iconRemove' => 'times',
));

$config->js('AdminThemeBridge', array(
	// signed-in users only, as the footer (audit B9)
	'version' => $adminTheme->isLoggedIn ? $adminTheme->version : '',
	'legacyStack' => $adminTheme->legacyStack,
	// the user's display settings in this browser (scripts/main.js prefs; empty for a guest)
	'prefsKey' => $adminTheme->prefsKey(),
));

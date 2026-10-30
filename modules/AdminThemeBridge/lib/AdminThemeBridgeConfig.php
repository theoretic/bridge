<?php namespace ProcessWire;

/**
 * AdminThemeBridge: Module configuration screen
 *
 * Part of the AdminThemeBridge class, split by job into traits (audit PA1); `$this` is the theme.
 * Constants and properties stay in AdminThemeBridge.module.php.
 *
 */
trait AdminThemeBridgeConfig {

	public function getModuleConfigInputfields(InputfieldWrapper $inputfields) {
		parent::getModuleConfigInputfields($inputfields);
		$modules = $this->wire()->modules;

		// the two settings AdminThemeFramework adds (login screen, users by role) go first, in Users
		/** @var InputfieldFieldset $fs */
		$fs = $modules->get('InputfieldFieldset');
		$fs->attr('name', '_users');
		$fs->label = __('Users', __FILE__);
		$fs->icon = 'users';
		$inputfields->add($fs);
		foreach(array('useAsLogin', '_setAdminThemeRoleId') as $name) {
			$f = $inputfields->getChildByName($name);
			if(!$f) continue;
			$inputfields->remove($f);
			$fs->add($f);
		}

		/** @var InputfieldFieldset $fs */
		$fs = $modules->get('InputfieldFieldset');
		$fs->attr('name', '_appearance');
		$fs->label = __('Appearance', __FILE__);
		$fs->icon = 'paint-brush';
		$inputfields->add($fs);

		/** @var InputfieldRadios $f */
		$f = $modules->get('InputfieldRadios');
		$f->attr('name', 'variant');
		$f->label = __('Colour', __FILE__);
		$f->addOption('blue', __('Blue (default)', __FILE__));
		$f->addOption('vibrant', __('Vibrant', __FILE__));
		$f->addOption('black', __('Black', __FILE__));
		$f->addOption('pink', __('Pink', __FILE__));
		$f->addOption('green', __('Green', __FILE__));
		$f->addOption('custom', __('Custom colour', __FILE__));
		$f->optionColumns = 1;
		$f->attr('value', in_array($this->get('variant'), $this->variants, true) ? $this->get('variant') : 'blue');
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldText $f */
		$f = $modules->get('InputfieldText');
		$f->attr('name', 'primaryColor');
		$f->label = __('Custom colour', __FILE__);
		$f->description = __('Hex value such as #3584EA. Hover, tints and shadows are derived from it.', __FILE__);
		$f->attr('placeholder', '#3584EA');
		$f->attr('value', (string) $this->get('primaryColor'));
		// a value the theme cannot use falls back to blue: say so (audit SU9)
		$color = trim((string) $this->get('primaryColor'));
		if($color !== '' && $this->getPrimaryColor() === '') {
			$f->error(sprintf(__('Not a hex colour (#RRGGBB): %s. The blue preset is used instead.', __FILE__), $color));
		}
		$f->showIf = 'variant=custom';
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldRadios $f */
		$f = $modules->get('InputfieldRadios');
		$f->attr('name', 'colorScheme');
		$f->label = __('Colour scheme', __FILE__);
		$f->notes = __('Each user can override this from the user menu; the choice is kept in the browser.', __FILE__);
		$f->addOption('auto', __('Follow the operating system (default)', __FILE__));
		$f->addOption('light', __('Light', __FILE__));
		$f->addOption('dark', __('Dark', __FILE__));
		$f->attr('value', $this->getColorScheme());
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldText $f */
		$f = $modules->get('InputfieldText');
		$f->attr('name', 'logoURL');
		$f->label = __('Logo URL', __FILE__);
		$f->description = __('Relative to the site root, e.g. site/templates/admin-logo.svg. Empty for the ProcessWire mark from the installed core.', __FILE__);
		$f->attr('value', (string) $this->get('logoURL'));
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldText $f */
		$f = $modules->get('InputfieldText');
		$f->attr('name', 'logoURLDark');
		$f->label = __('Logo URL for the dark scheme', __FILE__);
		$f->description = __('Optional. Shown instead of the logo above when the dark scheme is on.', __FILE__);
		$f->attr('value', (string) $this->get('logoURLDark'));
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldInteger $f */
		$f = $modules->get('InputfieldInteger');
		$f->attr('name', 'maxWidth');
		$f->label = __('Maximum content width (px), 0 for none', __FILE__);
		$f->attr('value', $this->getMaxWidth());
		$f->attr('min', 0);
		$f->attr('max', 4000);
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldFieldset $fs */
		$fs = $modules->get('InputfieldFieldset');
		$fs->attr('name', '_features');
		$fs->label = __('Features', __FILE__);
		$fs->icon = 'toggle-on';
		$inputfields->add($fs);

		/** @var InputfieldCheckbox $f */
		$f = $modules->get('InputfieldCheckbox');
		$f->attr('name', 'extendedBreadcrumbs');
		$f->label = __('Extended breadcrumbs', __FILE__);
		$f->description = __('Page tree shortcut, edit links on crumbs, hidden on the page tree and when there is only one crumb.', __FILE__);
		$f->attr('value', 1);
		if($this->extendedBreadcrumbs) $f->attr('checked', 'checked');
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldCheckbox $f */
		$f = $modules->get('InputfieldCheckbox');
		$f->attr('name', 'pageSaveInPlace');
		$f->label = __('Save without reload', __FILE__);
		$f->description = __('Save, Publish and Save + Keep Unpublished in the page editor update the page in place, and so does Save in the field, template, module, user, role, permission and profile editors (on pages without jQuery). Shift+click a save button for a classic save; other save actions, Delete, template changes and modal windows always reload.', __FILE__);
		$f->attr('value', 1);
		if($this->pageSaveInPlace) $f->attr('checked', 'checked');
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldCheckbox $f */
		$f = $modules->get('InputfieldCheckbox');
		$f->attr('name', 'pageAddSkipTemplate');
		$f->label = __('Step 2 if template auto-selected', __FILE__);
		$f->description = __('When every page under the parent uses one template, or the parent allows only one, Add New creates the page with that template and opens it in the page editor, without the Add New form. A notice names the template. A template chosen in the link (such as Add New shortcuts) still shows the form.', __FILE__);
		$f->notes = __('The new page starts unpublished, with a placeholder name that the title replaces on the first save. A page left without saving stays unpublished; after a day it goes to the trash the next time a page is added this way.', __FILE__);
		$f->attr('value', 1);
		if($this->pageAddSkipTemplate) $f->attr('checked', 'checked');
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldCheckbox $f */
		$f = $modules->get('InputfieldCheckbox');
		$f->attr('name', 'dangerWarn');
		$f->label = __('Warn before risky actions', __FILE__);
		$f->description = __('A dialog names what is lost before it goes: a file or image that replaces the one in a single-file field, an upload that overwrites a file of the same name, Save and Replace in the image editor, deleted image variations, B&W, Sepia and Reduce 50%, a module uninstall, a comment set to Delete, a published page renamed without path history, a page sent to the trash from the page tree, images moved into a file field and a new repeater item removed with what was typed in it.', __FILE__);
		$f->notes = __('Confirmations the core and this theme already show stay either way.', __FILE__);
		$f->attr('value', 1);
		if($this->dangerWarn) $f->attr('checked', 'checked');
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldInteger $f */
		$f = $modules->get('InputfieldInteger');
		$f->attr('name', 'dataTableSortRows');
		$f->label = __('Datatable sortable rows threshold', __FILE__);
		$f->description = __('A data table sorts by its column headers only when it has at least this many rows; a shorter table shows no sort arrows. Default 10.', __FILE__);
		$f->notes = __('A table split into pages counts the rows of its page. Tables that never sort under this theme (the Lister\'s, which sorts on the server, and third-party tables made unsortable) stay so. 0 sorts every table.', __FILE__);
		$f->attr('value', $this->getDataTableSortRows());
		$f->attr('min', 0);
		$f->attr('max', 10000);
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldFieldset $fs */
		$fs = $modules->get('InputfieldFieldset');
		$fs->attr('name', '_legacy');
		$fs->label = __('Legacy', __FILE__);
		$fs->icon = 'history';
		$inputfields->add($fs);

		/** @var InputfieldRadios $f */
		$f = $modules->get('InputfieldRadios');
		$f->attr('name', 'legacyStack');
		$f->label = __('Legacy script stack (jQuery, jQuery UI, inputfields.js, main.js)', __FILE__);
		$f->addOption(self::legacyAuto, __('Load only when the page has a legacy Inputfield or Process (default)', __FILE__));
		$f->addOption(self::legacyAlways, __('Always load (every admin page)', __FILE__));
		$f->attr('value', $this->legacyStack);
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldRadios $f */
		$f = $modules->get('InputfieldRadios');
		$f->attr('name', 'uikit');
		$f->label = __('UIkit for modules written for AdminThemeUikit', __FILE__);
		$f->description = __('UIkit\'s script and a UIkit stylesheet in this theme\'s colours, for modules that use UIkit components (uk-grid, uk-modal, UIkit.notification(), ...).', __FILE__);
		$f->addOption(self::uikitAuto, __('Load only on pages that use UIkit (default)', __FILE__));
		$f->addOption(self::uikitAlways, __('Always load (every admin page)', __FILE__));
		$f->addOption(self::uikitNever, __('Never load', __FILE__));
		$mode = $this->get('uikit');
		$f->attr('value', in_array($mode, array(self::uikitAuto, self::uikitAlways, self::uikitNever), true) ? $mode : self::uikitAuto);
		$f->columnWidth = 50;
		$fs->add($f);

		/** @var InputfieldTextarea $f */
		$f = $modules->get('InputfieldTextarea');
		$f->attr('name', 'printScripts');
		$f->label = __('Site scripts that never wait for the legacy stack', __FILE__);
		$f->description = __('On pages without jQuery, a site module script that calls jQuery is held back until the stack loads. One URL part per line (such as a module directory name) for scripts that work without it although they mention jQuery.', __FILE__);
		$f->attr('rows', 3);
		$f->attr('value', (string) $this->get('printScripts'));
		$f->collapsed = Inputfield::collapsedBlank;
		$fs->add($f);

		/** @var InputfieldTextarea $f */
		$f = $modules->get('InputfieldTextarea');
		$f->attr('name', 'nativeOverrides');
		$f->label = __('Native or legacy, per class', __FILE__);
		$f->description = __('One "ClassName=native" or "ClassName=legacy" per line, for an Inputfield or Process class: "native" runs it without the legacy stack (it must need neither jQuery nor inputfields.js), "legacy" always loads the stack where it renders. Wins over the theme\'s own list and over BridgeComponent.', __FILE__);
		$f->notes = __('Example: InputfieldSeoNeoPreview=native', __FILE__);
		$f->attr('rows', 3);
		$f->attr('value', (string) $this->get('nativeOverrides'));
		$bad = $this->nativeOverrideErrors();
		if(count($bad)) $f->error(sprintf(__('Ignored (not ClassName=native|legacy): %s', __FILE__), implode(', ', $bad)));
		$f->collapsed = count($bad) ? Inputfield::collapsedNo : Inputfield::collapsedBlank;
		$fs->add($f);
	}
}

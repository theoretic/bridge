<?php namespace ProcessWire;

// the interface without depending on the theme: its file when the theme is there, else the same
// one-method interface declared here (docs/contract.md 2)
if(!interface_exists("ProcessWire\\BridgeComponent", false)) {
	$bridgeComponentFile = dirname(__DIR__) . '/AdminThemeBridge/BridgeComponent.php';
	if(is_file($bridgeComponentFile)) {
		require_once($bridgeComponentFile);
	} else {
		interface BridgeComponent { public function getBridgeComponent(); }
	}
	unset($bridgeComponentFile);
}

/**
 * ProcessBridgeDemo
 *
 * Proof page for the legacy bridge: a Process that implements BridgeComponent and renders a
 * form made only of component Inputfields. Under AdminThemeBridge in "auto" mode this page
 * loads no jQuery. A button fetches a legacy Inputfield over AJAX, which must make the shell
 * load the legacy stack lazily and initialise the field.
 *
 * Original work, MIT. Demo and test fixture, not for production sites.
 */
class ProcessBridgeDemo extends Process implements Module, BridgeComponent {

	public static function getModuleInfo() {
		return array(
			'title' => 'Bridge demo',
			'version' => '0.1.0',
			'summary' => 'Test page for AdminThemeBridge: a Process without jQuery, with lazy-loaded legacy field.',
			'author' => 'Alexei Tarasov',
			'permission' => 'page-edit',
			'requires' => 'AdminThemeBridge, InputfieldBridgeText',
			'installs' => 'InputfieldBridgeText',
			'icon' => 'flask',
			'page' => array(
				'name' => 'bridge-demo',
				'parent' => 'setup',
				'title' => 'Bridge demo',
			),
		);
	}

	public function getBridgeComponent() {
		return array('tag' => 'pw-bridge-demo', 'module' => 'ProcessBridgeDemo.mjs', 'version' => '1');
	}

	public function ___execute() {
		$modules = $this->wire()->modules;
		$input = $this->wire()->input;
		$sanitizer = $this->wire()->sanitizer;

		/** @var InputfieldForm $form */
		$form = $modules->get('InputfieldForm');
		$form->attr('id', 'BridgeDemoForm');
		$form->attr('action', './');
		$form->attr('method', 'post');

		/** @var InputfieldBridgeText $f */
		$f = $modules->get('InputfieldBridgeText');
		$f->attr('name', 'demo_name');
		$f->label = $this->_('Name');
		$f->description = $this->_('A component Inputfield: plain markup, no script of its own.');
		$f->required = true;
		$f->columnWidth = 50;
		$form->add($f);

		/** @var InputfieldBridgeText $f */
		$f = $modules->get('InputfieldBridgeText');
		$f->attr('name', 'demo_note');
		$f->label = $this->_('Note (collapsed)');
		$f->collapsed = Inputfield::collapsedYes;
		$f->columnWidth = 50;
		$form->add($f);

		/** @var InputfieldBridgeText $f */
		$f = $modules->get('InputfieldBridgeText');
		$f->attr('name', 'demo_extra');
		$f->label = $this->_('Extra (shown when Name is "show")');
		$f->showIf = 'demo_name=show';
		$f->required = true; // upstream emits data-required-if only on required fields
		$f->requiredIf = 'demo_name=show';
		$f->columnWidth = 50;
		$form->add($f);

		/** @var InputfieldBridgeText $f */
		$f = $modules->get('InputfieldBridgeText');
		$f->attr('name', 'demo_other');
		$f->label = $this->_('Other (always visible; widens when Extra hides)');
		$f->columnWidth = 50;
		$form->add($f);

		// a legacy field collapsed over AJAX: the page stays native (only its placeholder renders);
		// opening it must load the legacy stack and initialise the field (InputfieldIcon: jQuery)
		/** @var InputfieldIcon $f */
		$f = $modules->get('InputfieldIcon');
		$f->attr('name', 'demo_icon');
		$f->label = $this->_('Icon (legacy field, collapsed over AJAX)');
		$f->collapsed = Inputfield::collapsedYesAjax;
		$form->add($f);

		/** @var InputfieldSubmit $f */
		$f = $modules->get('InputfieldSubmit');
		$f->attr('name', 'submit_demo');
		$f->attr('value', $this->_('Submit'));
		$form->add($f);

		if($input->post('submit_demo')) {
			$form->processInput($input->post);
			if(!count($form->getErrors())) {
				$name = $sanitizer->entities($form->getChildByName('demo_name')->attr('value'));
				$this->message(sprintf($this->_('Received: %s'), $name));
			}
		}

		$legacyUrl = $sanitizer->entities($this->wire()->page->url . 'legacy/');
		$out = "<p class='description'>" . $this->_('This page is rendered by a BridgeComponent Process with component Inputfields only. In auto mode the shell prints no jQuery here.') . "</p>";
		$out .= $form->render();
		$editUrl = $sanitizer->entities($this->wire()->config->urls->admin . 'page/edit/?id=1');
		$out .= "<h2>" . $this->_('Runtime elements') . "</h2>";
		$out .= "<pw-tabs id='BridgeDemoTabs'>";
		$out .= "<section id='demo-tab-one' data-tab='" . $sanitizer->entities1($this->_('Tab one')) . "'><p>" . $this->_('First tab. The active tab is kept in the URL hash.') . "</p></section>";
		$out .= "<section id='demo-tab-two' data-tab='" . $sanitizer->entities1($this->_('Tab two')) . "'><p><a class='pw-modal pw-modal-large' href='$editUrl'>" . $this->_('Open the home page editor in a dialog (pw-modal)') . "</a></p></section>";
		$out .= "</pw-tabs>";
		$out .= "<h2>" . $this->_('Lazy legacy stack') . "</h2>";
		$out .= "<p><button type='button' class='ui-button' id='BridgeDemoLoadLegacy' data-url='$legacyUrl'>" . $this->_('Load a legacy Inputfield over AJAX') . "</button></p>";
		$out .= "<div id='BridgeDemoLegacy'></div>";
		return $out;
	}

	/**
	 * Field lab (Gate 2, ADR 0015): one field of each Phase 2 core type, built from the plain core
	 * modules, with the shared behaviours the runtime must cover without inputfields.js: change
	 * tracking and the leave warning (InputfieldFormConfirm), Enter in a text field, showIf and
	 * requiredIf, collapse (plain and AJAX), columns, a required field inside a collapsed one,
	 * the Text counter, submit dropdown items, and a save round trip (values come back from POST).
	 * tools/native-check.js drives it.
	 *
	 * @return string
	 *
	 */
	public function ___executeFields() {
		$modules = $this->wire()->modules;
		$input = $this->wire()->input;
		$sanitizer = $this->wire()->sanitizer;
		$options = array('a' => 'Alpha', 'b' => 'Beta (shows Detail)', 'c' => 'Gamma');

		/** @var InputfieldForm $form */
		$form = $modules->get('InputfieldForm');
		$form->attr('id', 'BridgeFieldLab');
		$form->attr('action', './');
		$form->attr('method', 'post');
		$form->addClass('InputfieldFormConfirm');

		$add = function($type, $name, $label, array $settings = array()) use($modules, $form) {
			/** @var Inputfield $f */
			$f = $modules->get($type);
			$f->attr('name', $name);
			$f->label = $label;
			foreach($settings as $key => $value) {
				if($key === 'value') $f->attr('value', $value); else $f->set($key, $value);
			}
			$form->add($f);
			return $f;
		};

		$add('InputfieldText', 'lab_text', 'Text (required)', array('required' => true, 'columnWidth' => 50));
		$add('InputfieldText', 'lab_count', 'Text with counter', array('maxlength' => 40, 'showCount' => 1, 'columnWidth' => 50));
		$add('InputfieldTextarea', 'lab_textarea', 'Textarea', array('rows' => 3));
		$add('InputfieldEmail', 'lab_email', 'Email', array('columnWidth' => 34));
		$add('InputfieldURL', 'lab_url', 'URL', array('columnWidth' => 33));
		$add('InputfieldName', 'lab_name', 'Name', array('columnWidth' => 33, 'required' => false));
		$add('InputfieldInteger', 'lab_integer', 'Integer (1..10)', array('inputType' => 'number', 'min' => 1, 'max' => 10, 'columnWidth' => 50));
		$add('InputfieldFloat', 'lab_float', 'Float (2 digits)', array('precision' => 2, 'columnWidth' => 50));
		$add('InputfieldCheckbox', 'lab_checkbox', 'Checkbox', array('columnWidth' => 34));
		$radios = $add('InputfieldRadios', 'lab_radios', 'Radios', array('columnWidth' => 33, 'optionColumns' => 1));
		$select = $add('InputfieldSelect', 'lab_select', 'Select', array('columnWidth' => 33));
		foreach($options as $value => $label) {
			$radios->addOption($value, $label);
			$select->addOption($value, $label);
		}
		// milestone 2.4: fields with scripts of their own, native in the runtime
		$add('InputfieldToggle', 'lab_toggle', 'Toggle (click the current one to deselect)', array('useDeselect' => 1, 'columnWidth' => 50));
		$checkboxes = $add('InputfieldCheckboxes', 'lab_checkboxes', 'Checkboxes (shift-click selects a range)', array('optionColumns' => 3, 'columnWidth' => 50));
		foreach(array('one' => 'One', 'two' => 'Two', 'three' => 'Three', 'four' => 'Four', 'five' => 'Five', 'six' => 'Six') as $value => $label) {
			$checkboxes->addOption($value, $label);
		}
		/** @var InputfieldAsmSelect $asm */
		$asm = $add('InputfieldAsmSelect', 'lab_asm', 'asmSelect (pick, sort, remove)', array('columnWidth' => 50));
		foreach(array('red' => 'Red', 'green' => 'Green', 'blue' => 'Blue', 'cyan' => 'Cyan', 'magenta' => 'Magenta') as $value => $label) {
			$asm->addOption($value, $label);
		}
		$asm->attr('value', array('green', 'red'));
		/** @var InputfieldPage $pagesField */
		$pagesField = $add('InputfieldPage', 'lab_pages', 'Pages (Page field with asmSelect)', array(
			'inputfield' => 'InputfieldAsmSelect', 'parent_id' => 1, 'derefAsPage' => 0, 'columnWidth' => 50,
		));
		$add('InputfieldPageAutocomplete', 'lab_auto', 'Page autocomplete (type 2+ letters)', array(
			'parent_id' => 1, 'labelFieldName' => 'title', 'searchFields' => 'title', 'columnWidth' => 50,
		));
		$add('InputfieldPageListSelect', 'lab_tree', 'Page list select (Change, pick a page)', array('parent_id' => 0, 'columnWidth' => 50));
		$add('InputfieldPageListSelectMultiple', 'lab_trees', 'Page list select multiple', array('parent_id' => 0, 'columnWidth' => 50));
		$add('InputfieldDatetime', 'lab_date', 'Date and time (picker on focus)', array(
			'inputType' => 'text', 'datepicker' => 3, 'dateInputFormat' => 'Y-m-d', 'timeInputFormat' => 'H:i', 'columnWidth' => 34,
		));
		$add('InputfieldDatetime', 'lab_date_button', 'Date (picker on button)', array(
			'inputType' => 'text', 'datepicker' => 1, 'dateInputFormat' => 'd.m.Y', 'columnWidth' => 33,
		));
		$add('InputfieldDatetime', 'lab_date_select', 'Date (selects)', array('inputType' => 'select', 'columnWidth' => 33));
		$add('InputfieldDatetime', 'lab_date_inline', 'Date (inline calendar)', array(
			'inputType' => 'text', 'datepicker' => 2, 'dateInputFormat' => 'Y-m-d',
		));
		$add('InputfieldTextTags', 'lab_tags', 'Tags (pick or add)', array(
			'tagsList' => "alpha
beta
gamma
delta", 'allowUserTags' => 1, 'columnWidth' => 50,
		));
		$add('InputfieldTextTags', 'lab_tag', 'Tag (one)', array('tagsList' => "alpha
beta
gamma", 'maxItems' => 1, 'columnWidth' => 50));
		$add('InputfieldSelector', 'lab_selector', 'Selector (pick a field, an operator, a value)', array());
		if($this->wire()->languages && count($this->wire()->languages) > 1) {
			$add('InputfieldText', 'lab_multilang', 'Multi-language text (language tabs)', array('useLanguages' => true));
		}
		$add('InputfieldText', 'lab_detail', 'Detail (shown and required when Radios is Beta)', array(
			'showIf' => 'lab_radios=b', 'required' => true, 'requiredIf' => 'lab_radios=b',
		));
		$add('InputfieldText', 'lab_collapsed', 'Collapsed', array('collapsed' => Inputfield::collapsedYes));
		$add('InputfieldText', 'lab_ajax', 'Collapsed, loaded over AJAX', array('collapsed' => Inputfield::collapsedYesAjax));
		/** @var InputfieldFieldset $fieldset */
		$fieldset = $modules->get('InputfieldFieldset');
		$fieldset->attr('name', 'lab_fieldset');
		$fieldset->label = 'Collapsed fieldset with a required field';
		$fieldset->collapsed = Inputfield::collapsedYes;
		$inner = $modules->get('InputfieldText');
		$inner->attr('name', 'lab_inner');
		$inner->label = 'Required inside a collapsed fieldset';
		$inner->required = true;
		$inner->attr('required', 'required');
		$fieldset->add($inner);
		$form->add($fieldset);

		/** @var InputfieldSubmit $submit */
		$submit = $modules->get('InputfieldSubmit');
		$submit->attr('name', 'submit_lab');
		$submit->attr('value', 'Save');
		$submit->addActionValue('again', 'Save and add another', 'plus-circle');
		$submit->addActionValue('done', 'Save and finish', 'check');
		$form->add($submit);
		// a second submit button: with two, Enter in a text field must not submit (upstream
		// InputfieldIntentions moves the focus to the nearest button instead)
		/** @var InputfieldSubmit $draft */
		$draft = $modules->get('InputfieldSubmit');
		$draft->attr('name', 'submit_lab_draft');
		$draft->attr('value', 'Save draft');
		$draft->setSecondary(true);
		$form->add($draft);

		if($input->post('submit_lab') || $input->post('submit_lab_draft')) {
			$form->processInput($input->post);
			$values = array();
			foreach($form->getAll() as $f) {
				if(strpos($f->attr('name'), 'lab_') !== 0 || $f instanceof InputfieldWrapper) continue;
				$value = $f->attr('value');
				if(is_array($value)) $value = implode(',', $value);
				if($f instanceof InputfieldCheckbox) $value = $f->attr('checked') ? 'checked' : '';
				$values[] = $f->attr('name') . '=' . $value;
			}
			$action = $sanitizer->name($input->post('_action_value'));
			$this->message('Lab saved' . ($action ? " ($action)" : '') . ': ' . implode('; ', $values));
			foreach($form->getErrors() as $error) $this->error($error);
		}

		return "<p class='description'>Field lab: core fields only, for the Phase 2 behaviour checks (tools/native-check.js).</p>" .
			$form->render();
	}

	/**
	 * AJAX: a legacy (collapsed) Inputfield. The core field types of Phase 2 are native, so the
	 * example is InputfieldIcon, whose icon picker is jQuery (not a Phase 2 type).
	 *
	 * @return string
	 *
	 */
	public function ___executeLegacy() {
		$modules = $this->wire()->modules;
		/** @var InputfieldWrapper $wrapper */
		$wrapper = $this->wire(new InputfieldWrapper());
		/** @var InputfieldIcon $f */
		$f = $modules->get('InputfieldIcon');
		$f->attr('name', 'legacy_icon');
		$f->label = $this->_('Legacy icon picker (collapsed; opening it needs the legacy stack)');
		$f->collapsed = Inputfield::collapsedYes;
		$wrapper->add($f);
		return $wrapper->render();
	}
}

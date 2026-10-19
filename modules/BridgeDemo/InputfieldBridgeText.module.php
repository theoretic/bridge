<?php namespace ProcessWire;

if(!interface_exists("ProcessWire\\BridgeComponent", false)) {
	require_once(dirname(__DIR__) . '/AdminThemeBridge/BridgeComponent.php');
}

/**
 * InputfieldBridgeText
 *
 * The smallest possible BridgeComponent: upstream InputfieldText markup, no script. Exists so
 * the legacy detector has something native to see. Phase 2 replaces core Inputfields for real.
 *
 * Original work, MIT. Demo and test fixture.
 */
class InputfieldBridgeText extends InputfieldText implements BridgeComponent {

	public static function getModuleInfo() {
		return array(
			'title' => 'Bridge Text (demo)',
			'version' => '0.1.0',
			'summary' => 'Text input that declares itself a Bridge component. Test fixture for AdminThemeBridge.',
			'author' => 'Alexei Tarasov',
			'requires' => 'AdminThemeBridge',
		);
	}

	public function getBridgeComponent() {
		return array(
			'tag' => 'pw-text',
			'module' => 'pw-text.js', // relative to this module's directory
			'version' => '1',
		);
	}

	/**
	 * Upstream markup wrapped in the component's element
	 *
	 * The element adds a character counter and dispatches a bubbling `change` when the value
	 * changes; the <input> keeps its upstream id and name so dependencies and processInput
	 * see nothing new.
	 *
	 * @return string
	 *
	 */
	public function ___render() {
		$maxlength = (int) $this->attr('maxlength');
		$attrs = $maxlength > 0 ? " maxlength='$maxlength'" : '';
		return "<pw-text$attrs>" . parent::___render() . "</pw-text>";
	}
}

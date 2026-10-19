<?php namespace ProcessWire;

/**
 * BridgeComponent: marker + descriptor for modules that run on the Bridge runtime without
 * the legacy jQuery stack.
 *
 * Implemented by Inputfield and Process modules whose markup and behaviour do not depend on
 * jQuery, jQuery UI, wire/templates-admin/scripts/inputfields.js or main.js. When every
 * Inputfield and the Process on a page implement it, AdminThemeBridge (in "auto" mode) does
 * not print the legacy stack. Anything else on the page is treated as legacy and gets the
 * stack, server side or lazily on the client.
 *
 * The full contract (custom element, attributes, events, DOM/JSON invariants) is in
 * docs/contract.md. This file is deliberately small so that third-party modules can
 * implement it without depending on the theme being installed: copy the interface check
 * from modules/BridgeDemo/InputfieldBridgeText.module.php.
 *
 * Original work, MIT.
 */
interface BridgeComponent {

	/**
	 * Describe the component
	 *
	 * @return array Keys:
	 *  - `tag` (string): custom element tag the component renders, or '' when it renders plain HTML
	 *  - `module` (string): optional URL of an ES module that defines the element
	 *  - `version` (string): optional contract version the component targets (default '1')
	 *
	 */
	public function getBridgeComponent();
}

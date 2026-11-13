<?php namespace ProcessWire;

/**
 * BridgeExtension: marker + manifest for modules that extend the Bridge admin through its
 * published surface (docs/extensions.md).
 *
 * An extension is an ordinary module. It declares what it touches in a manifest: the theme's
 * hookable methods it attaches to, the shell slots it fills, the client ES module it ships,
 * the public theme methods it reads. The theme discovers it (lib/AdminThemeBridgeExtensions.php),
 * hands the manifest to the client (ProcessWire.config.AdminThemeBridge.extensions) and fills
 * its slots; the contract tests (tools/extension-check.php) and the compatibility checker
 * (tools/extension-compat.php) read the same manifest.
 *
 * The same array may be given without code as `getModuleInfo()['bridge']`; when a module has
 * both, this method wins. An extension may also be a BridgeComponent: the two are separate.
 *
 * Like BridgeComponent.php this file is deliberately small, so that a module can implement it
 * without depending on the theme being installed: copy the interface check from
 * modules/BridgeDemo/InputfieldBridgeText.module.php.
 *
 * Original work, MIT.
 */
if(!interface_exists('ProcessWire\\BridgeExtension', false)) {

interface BridgeExtension {

	/**
	 * Describe the extension (asked on an instance that may not have run init(): use no config)
	 *
	 * @return array Keys (docs/extensions.md 2):
	 *  - `contract` (string): the extension contract range it was written for, e.g. '^1.0'
	 *  - `name` (string): optional, defaults to the module's class name
	 *  - `module` (string): optional URL of an ES module the admin imports on every page
	 *  - `styles` (array): optional, stylesheets relative to the module's directory, linked after the theme's
	 *  - `tokens` (array): optional, the theme's CSS custom properties its stylesheets read or set
	 *  - `slots` (array): optional, slot name => name of a public method returning markup
	 *  - `hooks` (array): optional, the theme's hookable methods it attaches to (without `___`)
	 *  - `reads` (array): optional, the theme's public non-hookable methods it calls
	 *  - `settings` (array): optional, the theme settings it reads
	 *  - `permission` (string): optional, a permission the user needs for the extension to load
	 *  - `priority` (int): optional, order among extensions in one slot, lower first (default 100)
	 *
	 */
	public function getBridgeExtension();
}

}

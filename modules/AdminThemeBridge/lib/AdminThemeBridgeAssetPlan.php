<?php namespace ProcessWire;

/**
 * AdminThemeBridge: what the head prints (audit AR1)
 *
 * A value object filled by AdminThemeBridge::assetPlan(): URLs in print order, every decision
 * already made (which stylesheets, the UIkit layer or not, preloads, which scripts wait for
 * DOMContentLoaded). _head.php escapes and prints it and decides nothing.
 *
 * Original work, MIT.
 *
 */
class AdminThemeBridgeAssetPlan {

	/**
	 * Fonts every screen paints with, fetched alongside the stylesheets
	 *
	 * @var string[] URLs
	 *
	 */
	public $fontPreloads = array();

	/**
	 * Stylesheets of core and modules, in order, other admin themes' left out
	 *
	 * @var string[] URLs
	 *
	 */
	public $styles = array();

	/**
	 * The UIkit layer's stylesheet (one cascade layer), '' when the page does not print it
	 *
	 * @var string
	 *
	 */
	public $uikitCss = '';

	/**
	 * The theme's stylesheet, after every module stylesheet
	 *
	 * @var string
	 *
	 */
	public $themeCss = '';

	/**
	 * The field modules' recolouring (ADR 0014), after the theme's
	 *
	 * @var string
	 *
	 */
	public $fieldsCss = '';

	/**
	 * The content's maximum width in px, 0 for the theme's own
	 *
	 * @var int
	 *
	 */
	public $maxWidth = 0;

	/**
	 * The site-wide token values of tokenOverrides(), as checked CSS rules (tokenCss()); '' when none
	 *
	 * @var string
	 *
	 */
	public $tokenCss = '';

	/**
	 * The stylesheets of this request's extensions (manifest key `styles`), after the theme's,
	 * each `array('extension' => name, 'url' => url)`
	 *
	 * @var array[]
	 *
	 */
	public $extensionStyles = array();

	/**
	 * The runtime module and the chunks it imports statically
	 *
	 * @var string[] URLs
	 *
	 */
	public $modulePreloads = array();

	/**
	 * Scripts in print order, each `array('url' => string, 'defer' => bool)`
	 *
	 * @var array[]
	 *
	 */
	public $scripts = array();

	/**
	 * ProcessWire.config.AdminThemeBridge as the page sends it
	 *
	 * @var array
	 *
	 */
	public $client = array();
}

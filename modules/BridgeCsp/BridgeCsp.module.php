<?php namespace ProcessWire;

/**
 * BridgeCsp
 *
 * Sends a nonce-based Content-Security-Policy on admin pages rendered by AdminThemeBridge, and
 * gives the theme the nonce (it hooks AdminThemeBridge::nonce, ADR 0020). One random nonce per
 * request, 16 bytes, base64.
 *
 * Modes:
 *  - off: nothing is sent, the theme prints no nonce (the default after install)
 *  - report-only: the policy goes out as Content-Security-Policy-Report-Only; the admin works as
 *    before and the browser reports what the policy would block
 *  - enforce: the policy goes out as Content-Security-Policy on screens that run without the legacy
 *    stack, and as Content-Security-Policy-Report-Only on those that load it (the login screen,
 *    CKEditor, TinyMCE, most third-party fields): jQuery and the scripts written against it write
 *    HTML strings that Trusted Types refuse, and an enforced login screen would lock everyone out
 *
 * The policy is a template: `{nonce}` becomes the request's nonce. The extra report-only policy
 * goes out as Content-Security-Policy-Report-Only in both modes other than off (for directives a
 * site wants reports on without enforcing them, such as style-src).
 *
 * Only for admin pages whose current admin theme is AdminThemeBridge: under another theme the
 * theme's inline scripts carry no nonce and an enforced policy would break the admin. A site that
 * already sends its own policy does not need this module: hook AdminThemeBridge::nonce instead.
 * If both run, the module's header goes out next to the site's, never in its place (0.1.1): the
 * browser enforces both, so the site's policy can only get stricter.
 *
 * Original work, MIT.
 */
class BridgeCsp extends WireData implements Module, ConfigurableModule {

	public static function getModuleInfo() {
		return array(
			'title' => 'Bridge CSP',
			'version' => '0.1.3',
			'summary' => 'Nonce-based Content-Security-Policy and Trusted Types for the Bridge admin (report-only or enforced).',
			'author' => 'Alexei Tarasov',
			'autoload' => 'template=admin',
			'singular' => true,
			'requires' => 'ProcessWire>=3.0.227, PHP>=8.1',
			'icon' => 'shield',
			'href' => 'https://github.com/theoretic/bridge',
			// Bridge extension manifest (docs/extensions.md 2), declarative: no dependency on the theme
			'bridge' => array(
				'contract' => '^0.1',
				'hooks' => array('nonce'),
				'reads' => array('useLegacyStack'),
			),
		);
	}

	const modeOff = 'off';
	const modeReport = 'report-only';
	const modeEnforce = 'enforce';

	/**
	 * The default policy: scripts only with the nonce or loaded by a script that had it
	 * ('strict-dynamic'), and every HTML sink through the theme's Trusted Types policy; reports
	 * carry the start of what was blocked ('report-sample')
	 *
	 */
	const defaultPolicy = "script-src 'nonce-{nonce}' 'strict-dynamic' 'report-sample'; object-src 'none'; base-uri 'self'; require-trusted-types-for 'script'; trusted-types bridge;";

	/**
	 * The default extra report-only policy: styles (the style attributes core and the runtime
	 * write are not covered by a nonce; reports only)
	 *
	 */
	const defaultReportPolicy = "style-src 'self' 'nonce-{nonce}';";

	/**
	 * This request's nonce ('' until init())
	 *
	 * @var string
	 */
	protected $nonce = '';

	public function __construct() {
		parent::__construct();
		$this->set('mode', self::modeOff);
		$this->set('policy', self::defaultPolicy);
		$this->set('reportPolicy', self::defaultReportPolicy);
	}

	public function init() {
		if(!$this->active()) return;
		$this->nonce = base64_encode(random_bytes(16));
		$nonce = $this->nonce;
		$this->addHookAfter('AdminThemeBridge::nonce', function(HookEvent $event) use($nonce) {
			$event->return = $nonce;
		});
		// sent once the Process ran: the theme knows by then whether the screen needs the legacy stack
		$this->addHookAfter('ProcessController::execute', $this, 'sendPolicy');
	}

	/**
	 * Is a policy to be sent at all (mode other than off)?
	 *
	 * @return bool
	 *
	 */
	public function active() {
		return in_array($this->get('mode'), array(self::modeReport, self::modeEnforce), true);
	}

	/**
	 * The request's nonce ('' when the mode is off)
	 *
	 * @return string
	 *
	 */
	public function getNonce() {
		return $this->nonce;
	}

	/**
	 * A policy template with the nonce in it, on one line
	 *
	 * @param string $template
	 * @return string
	 *
	 */
	public function policyFor($template) {
		$policy = str_replace('{nonce}', $this->nonce, (string) $template);
		return trim((string) preg_replace('/\s+/', ' ', $policy));
	}

	/**
	 * Hook after ProcessController::execute: send the headers when the page is the Bridge theme's
	 *
	 * In enforce mode a screen that needs the legacy stack gets the policy report only (0.1.2): the
	 * screen keeps working and the browser still reports what the policy would block.
	 *
	 * @param HookEvent|null $event
	 *
	 */
	public function sendPolicy($event = null) {
		if($this->nonce === '' || headers_sent()) return;
		$theme = $this->wire()->adminTheme;
		if(!$theme || $theme->className() !== 'AdminThemeBridge') return;
		$policy = $this->policyFor($this->get('policy'));
		if($policy !== '') {
			$enforce = $this->get('mode') === self::modeEnforce && !$this->legacyScreen($theme);
			$name = $enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
			// next to any policy the site sends, never in its place (audit SE6)
			header("$name: $policy", false);
		}
		$report = $this->policyFor($this->get('reportPolicy'));
		if($report !== '') header("Content-Security-Policy-Report-Only: $report", false);
	}

	/**
	 * Does this screen load the legacy stack? (The theme decided while the Process rendered.)
	 *
	 * @param AdminTheme $theme
	 * @return bool
	 *
	 */
	public function legacyScreen($theme) {
		return method_exists($theme, 'useLegacyStack') ? (bool) $theme->useLegacyStack() : true;
	}

	/**
	 * Module settings
	 *
	 * @param InputfieldWrapper $inputfields
	 *
	 */
	public function getModuleConfigInputfields(InputfieldWrapper $inputfields) {
		$modules = $this->wire()->modules;

		/** @var InputfieldRadios $f */
		$f = $modules->get('InputfieldRadios');
		$f->attr('name', 'mode');
		$f->label = $this->_('Mode');
		$f->description = $this->_('Report only first: the admin works as before and the browser console lists what the policy would block. Enforce once the screens you use report nothing. A policy the site sends itself stays: this one goes out next to it, and the browser applies both.');
		$f->notes = $this->_('Enforce applies to screens without the legacy stack; screens that load it (the login screen, CKEditor, TinyMCE, most third-party fields) get the policy report only. A legacy field that loads the stack later on an enforced screen does not work: use report only while you rely on one.');
		$f->addOption(self::modeOff, $this->_('Off'));
		$f->addOption(self::modeReport, $this->_('Report only'));
		$f->addOption(self::modeEnforce, $this->_('Enforce'));
		$f->attr('value', $this->get('mode'));
		$inputfields->add($f);

		/** @var InputfieldTextarea $f */
		$f = $modules->get('InputfieldTextarea');
		$f->attr('name', 'policy');
		$f->label = $this->_('Policy');
		$f->description = $this->_('Sent in the mode above. {nonce} becomes the nonce of the request, the same one the theme puts on its scripts and styles.');
		$f->notes = sprintf($this->_('Default: %s'), self::defaultPolicy);
		$f->attr('rows', 3);
		$f->attr('value', $this->get('policy'));
		$inputfields->add($f);

		/** @var InputfieldTextarea $f */
		$f = $modules->get('InputfieldTextarea');
		$f->attr('name', 'reportPolicy');
		$f->label = $this->_('Extra report-only policy');
		$f->description = $this->_('Always sent as report only (unless the mode is Off), next to the policy above. Empty to send none.');
		$f->notes = sprintf($this->_('Default: %s'), self::defaultReportPolicy);
		$f->attr('rows', 2);
		$f->attr('value', $this->get('reportPolicy'));
		$inputfields->add($f);
	}
}

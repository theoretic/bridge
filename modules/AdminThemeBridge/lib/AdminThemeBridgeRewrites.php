<?php namespace ProcessWire;

/**
 * AdminThemeBridge: Rewrites of upstream's inline jQuery code so it runs on a page without jQuery
 *
 * Part of the AdminThemeBridge class, split by job into traits (audit PA1); `$this` is the theme.
 * Constants and properties stay in AdminThemeBridge.module.php.
 *
 */
trait AdminThemeBridgeRewrites {

	/**
	 * The strings in core files that the theme's rewrites and copies depend on, by file under
	 * wire/ (audit PA3, PA2): when core changes one, tests/smoke.php fails instead of the
	 * rewrite silently doing nothing. Kept here, next to the rewrites, so a change to either side
	 * is one edit.
	 *
	 * @return array file under wire/ => list of strings that must occur in it
	 *
	 */
	public static function upstreamNeedles() {
		return array(
			// nativeInlineScripts()
			'modules/Process/ProcessTemplate/ProcessTemplate.module' => array('$(document).ready(function() { ProcessTemplateInitFields(); });', "\$('#ProcessTemplatePageLister').iFrameResize({ });"),
			'modules/Process/ProcessField/ProcessField.module' => array('"jQuery(document).ready(function() { " . '),
			'modules/Process/ProcessPageEditImageSelect/ProcessPageEditImageSelect.module' => array('$(document).ready(function() { setupProcessSave('),
			// hookDataTableRender(), hookDataTableRenderBefore() (lib/AdminThemeBridgeTables.php)
			'modules/Markup/MarkupAdminDataTable/MarkupAdminDataTable.module' => array("<script>if(typeof AdminDataTable != 'undefined') AdminDataTable.initTable($('#\$id'));</script>", "if(\$this->sortable) \$tableClass .= ' ' . \$this->settings('sortableClass');", 'public function setColNotSortable($index)'),
			// hookPageEditExecute()
			'modules/Process/ProcessPageEdit/ProcessPageEdit.module' => array("\$func = 'initPageEditForm();';", '"<scr" . "ipt>$func</script>"'),
			// hookFormRender()
			'modules/LanguageSupport/LanguageTabs.module' => array("setupLanguageTabs(\$('#\$id'));", '"<script>$func</script>"'),
			// hookFormRender(): core inline scripts on native screens that get the nonce (ADR 0020)
			'modules/Fieldtype/FieldtypeRepeater/InputfieldRepeater.module' => array("\$inputfield->appendMarkup .= \"<script>ProcessWire.config['\$idAttr'] = \" . json_encode(\$jsValue) . ';</script>';"),
			'modules/Process/ProcessPageLister/ProcessPageListerBookmarks.php' => array("\$form->appendMarkup = '<script>ProcessLister.initialized = true;</script>';"),
			'modules/Inputfield/InputfieldSubmit/InputfieldSubmit.module' => array("\$out .= \"<script\" . \">InputfieldSubmitDropdown.init('#{\$this->id}', null, \$required);</script>\";"),
			// deferLegacyInline(): the head's core inline scripts (ADR 0020)
			'modules/Jquery/JqueryUI/JqueryUI.module' => array("\"<script>\" .\n\t\t\t\"vex.defaultOptions.className='vex-theme-default';\" ."),
			'core/Admin/AdminTheme.php' => array("\$parts['head'] .= \"<\$script>\" . \n\t\t\t\t\"window.CKEDITOR_BASEPATH='\""),
			// nativeInlineHandlers(): core's inline confirm and click guard on native screens (ADR 0020)
			'modules/Process/ProcessModule/ProcessModule.module' => array("\$confirmDeleteJS = \"return confirm('\" . sprintf(", "\$confirmInstallJS = \"return confirm('\" . sprintf(", "onclick=\\\"\$confirmDeleteJS\\\"", "\$buttonWarning = \" onclick=\\\"\$confirmInstallJS\\\"\";"),
			'modules/Process/ProcessRole/ProcessRole.module' => array("\$disabled = \$disabled ? 'onclick=\"return false\"' : '';"),
			// _masthead.php names the search landmark by these (audit SU4, BG5)
			'modules/Process/ProcessPageSearch/ProcessPageSearch.module' => array("<form id='ProcessPageSearchForm'", "id='ProcessPageSearchQuery'"),
			// _footer.php moves the debug panel into a dialog (scripts/debug-tools.js)
			'templates-admin/debug.inc' => array('<div id="debug">', 'var $debug = $("#debug");'),
			// init(): the login form's inputs keep their labels as accessible names (audit SU5)
			'modules/Process/ProcessLogin/ProcessLogin.module' => array("attr('id+name', 'login_name')", "attr('id+name', 'login_pass')"),
			// getBrowserTitle(): the product name in the window title
			'core/Admin/AdminThemeFramework.php' => array("' • ProcessWire';"),
			// isAjaxPlaceholder() (lib/AdminThemeBridgeLegacy.php) copies this condition
			'core/Inputfield/InputfieldWrapper.php' => array(
				'$ajaxInputfield = $collapsed == Inputfield::collapsedYesAjax || $collapsed === Inputfield::collapsedTabAjax',
				'|| ($collapsed == Inputfield::collapsedBlankAjax && $inputfield->isEmpty());',
				"if(\$ajaxInputfield && ((\$required && \$inputfield->isEmpty()) || !\$this->wire()->user->isLoggedin())) {",
				"} else if(\$ajaxID && \$ajaxID != \$inputfieldID && \$inputfield instanceof InputfieldWrapper &&",
			),
		);
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

	/**
	 * The head's extra markup. On a page that defers the legacy stack, inline scripts that
	 * configure a legacy library wait for it: JqueryUI::useVex() adds
	 * `<script>vex.defaultOptions...</script>` to the head markup, which would throw before vex is
	 * there. Wrapped, it runs once the stack loads (if it does).
	 *
	 * Both of core's head scripts get the request's nonce (ADR 0020): that one, wrapped or not, and
	 * AdminTheme::getExtraMarkup()'s `window.CKEDITOR_BASEPATH` on page editors, each when its whole
	 * text is core's (knownInlineScripts(), audit SE1). A failed pattern match returns the markup
	 * as it came (audit BG1).
	 *
	 * @param string $markup
	 * @return string
	 *
	 */
	public function deferLegacyInline($markup) {
		$markup = (string) $markup;
		if(strpos($markup, '<script>') === false) return $markup;
		$legacy = null;
		$result = preg_replace_callback('~<script>(.*?)</script>~s', function($m) use(&$legacy) {
			$body = $m[1];
			$open = $this->nonceKnownScript('<script>', $body);
			if(strpos(ltrim($body), 'vex.') === 0) {
				if($legacy === null) $legacy = $this->useLegacyStack();
				if(!$legacy) $body = 'ProcessWireAdminTheme.legacy.later(function(){' . $body . '});';
			}
			return $open . $body . '</script>';
		}, $markup);
		return is_string($result) ? $result : $markup;
	}

	/**
	 * Hook after InputfieldWrapper::render (forms and the repeater's AJAX item included): run
	 * LanguageTabs' inline setup only where jQuery is, and give the request's nonce to the core
	 * inline scripts a native screen keeps: that one, the repeater item's config
	 * (`ProcessWire.config['…'] = …`, InputfieldRepeater.module), the Lister's bookmark line
	 * (`ProcessLister.initialized = true`, ProcessPageListerBookmarks.php), the submit button's
	 * dropdown (`InputfieldSubmitDropdown.init(…)`, InputfieldSubmit.module) and the other core
	 * scripts of knownInlineScripts() a form carries. Known scripts only, by their whole text (ADR
	 * 0020, audit SE1): a script that only begins like one of them stays without the nonce. A nested
	 * wrapper's output is stamped once: a stamped tag is no bare `<script>` any more.
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookFormRender(HookEvent $event) {
		$out = $event->return;
		if(!is_string($out) || strpos($out, '<script>') === false) return;
		$result = preg_replace_callback('~<script>(.*?)</script>~s', function($m) {
			$body = $m[1];
			$open = $this->nonceKnownScript('<script>', $body);
			// LanguageTabs' setup runs only where jQuery is; the runtime sets the tabs up otherwise
			if(preg_match("~\\AsetupLanguageTabs\\(\\$\\('#([A-Za-z0-9_:.-]+)'\\)\\);\\z~", trim($body), $t)) {
				$body = "window.jQuery && setupLanguageTabs(jQuery('#$t[1]'));";
			}
			return $open . $body . '</script>';
		}, $out);
		if(is_string($result) && $result !== $out) $event->return = $result;
	}

	/**
	 * Inline jQuery calls in a native Process's output (milestone 3.6), made to work either way:
	 * the template editor's `$(document).ready(function() { ProcessTemplateInitFields(); })`, the
	 * field editor's `jQuery(document).ready(...)` for ?focus=, and the "pages using this
	 * template" Lister iframe's `$('#ProcessTemplatePageLister').iFrameResize({ })`, the image
	 * window's `$(document).ready(function() { setupProcessSave(...) })` (3.9). With jQuery on the
	 * page they run as before.
	 *
	 * Only the inside of `<script>` elements is rewritten: the same text in a field's value (a code
	 * sample in a textarea) would otherwise be changed in the form and saved that way.
	 *
	 * @param string $out
	 * @return string
	 *
	 */
	public function nativeInlineScripts($out) {
		if(stripos($out, '<script') === false) return $out;
		// nothing to rewrite, and no nonce to give to the core scripts it knows
		if(strpos($out, 'ready(function() {') === false && strpos($out, 'iFrameResize(') === false && $this->cspNonce() === '') return $out;
		$ready = "(window.jQuery ? jQuery : function(f) { document.readyState === 'loading' ? " .
			"document.addEventListener('DOMContentLoaded', f) : f(); })(function() { ";
		$from = array(
			'$(document).ready(function() { ProcessTemplateInitFields(); });',
			'jQuery(document).ready(function() { ',
			'$(document).ready(function() { ',
			"\$('#ProcessTemplatePageLister').iFrameResize({ });",
		);
		$to = array(
			$ready . 'ProcessTemplateInitFields(); });',
			$ready,
			$ready,
			"window.jQuery && jQuery.fn.iFrameResize ? jQuery('#ProcessTemplatePageLister').iFrameResize({ }) : " .
				"window.ProcessWireAdminTheme && ProcessWireAdminTheme.iframeHeight && " .
				"ProcessWireAdminTheme.iframeHeight(document.getElementById('ProcessTemplatePageLister'));",
		);
		$result = preg_replace_callback('~(<script\b[^>]*>)(.*?)(</script>)~is', function($m) use($from, $to) {
			$code = str_replace($from, $to, $m[2]);
			// the nonce goes by what core printed, never by whether a rewrite happened: any script
			// containing a ready() call was rewritten, and vouched for, before (ADR 0020, audit SE1)
			return $this->nonceKnownScript($m[1], $m[2]) . $code . $m[3];
		}, $out);
		return is_string($result) ? $result : $out;
	}

	/**
	 * Core's inline event handlers on a native screen, as data attributes (ADR 0020 decision 7):
	 * a Content-Security-Policy without 'unsafe-inline' drops `onclick` without a word, and the
	 * module list's Delete and Install would then act without asking. `onclick="return confirm('…')"`
	 * (ProcessModule's Delete, and Install with requirements missing) becomes `data-pw-confirm="…"`,
	 * `onclick="return false"` (ProcessRole's inherited permissions) `data-pw-noclick`; a delegated
	 * listener in scripts/setup.js asks with the theme's dialog and keeps the click from acting.
	 * Only those two exact forms; any other handler stays as it is.
	 *
	 * @param string $out
	 * @return string
	 *
	 */
	public function nativeInlineHandlers($out) {
		if(strpos($out, 'onclick=') === false) return $out;
		$sanitizer = $this->wire()->sanitizer;
		$result = preg_replace_callback("~\\sonclick=\"return confirm\\('([^'\"\\\\]*)'\\)\"~", function($m) use($sanitizer) {
			// the message as core put it in the attribute (entities decoded once, escaped once again)
			$text = html_entity_decode($m[1], ENT_QUOTES, 'UTF-8');
			return " data-pw-confirm=\"" . $sanitizer->entities($text) . "\"";
		}, $out);
		if(!is_string($result)) return $out;
		return str_replace('onclick="return false"', 'data-pw-noclick', $result);
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
			$this->nonceKnownScript('<script>', 'initPageEditForm();') . "typeof initPageEditForm === 'function' ? initPageEditForm() : " .
			"window.ProcessWireAdminTheme && ProcessWireAdminTheme.pageEdit && ProcessWireAdminTheme.pageEdit.init();</script>", $out);
	}
}

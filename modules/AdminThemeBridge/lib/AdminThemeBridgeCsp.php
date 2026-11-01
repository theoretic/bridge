<?php namespace ProcessWire;

/**
 * AdminThemeBridge: the Content-Security-Policy nonce (ADR 0020)
 *
 * Part of the AdminThemeBridge class, split by job into traits (audit PA1); `$this` is the theme.
 * Constants and properties stay in AdminThemeBridge.module.php.
 *
 * A site that sends `script-src 'nonce-…'` hooks nonce() to return its per-request value. The
 * theme asks once per request (cspNonce()) and puts the value on everything it prints: the
 * `<meta property="csp-nonce">` the scripts read, its `<style>` and `<script>` elements, the
 * script tags of core and modules it prints in the head, the modulepreload links, and the core
 * inline scripts it knows (lib/AdminThemeBridgeRewrites.php, lib/AdminThemeBridgeTables.php).
 * Nothing else gets it: a pass over the whole page would vouch for injected markup too. A core
 * script is known by its whole text (knownInlineScripts()), never by how it starts: a script that
 * only begins like one of them is not core's (audit SE1).
 *
 */
trait AdminThemeBridgeCsp {

	/**
	 * The nonce of this request for a Content-Security-Policy (hookable)
	 *
	 * Empty by default: the theme then prints no nonce anywhere and nothing changes. A site that
	 * sends a nonce-based policy hooks this and returns the value its policy header carries,
	 * the same one for the whole request:
	 *
	 * ~~~~
	 * $wire->addHookAfter('AdminThemeBridge::nonce', function(HookEvent $e) { $e->return = $myNonce; });
	 * ~~~~
	 *
	 * Read the value through cspNonce(), never by calling this directly: cspNonce() asks once and
	 * keeps the answer, so every element of the page carries the same nonce.
	 *
	 * @return string Base64 characters (`A-Z a-z 0-9 + / - _ =`), or '' for none
	 *
	 */
	public function ___nonce() {
		return '';
	}

	/**
	 * The nonce of this request, asked once (nonce() with its hooks) and kept
	 *
	 * Characters outside the base64 set are dropped, so a hook's value can never break out of
	 * the attribute. With a nonce, the response also gets an `X-Bridge-Nonce` header (when no
	 * output went out yet): a fragment fetched by the runtime (an AJAX field, a repeater item)
	 * has no `<meta>`, and the runtime runs a fragment's inline scripts only when their nonce is
	 * that response's.
	 *
	 * @return string
	 *
	 */
	public function cspNonce() {
		if($this->nonceValue !== null) return $this->nonceValue;
		$nonce = (string) preg_replace('/[^A-Za-z0-9+\/=_-]/', '', (string) $this->nonce());
		$this->nonceValue = $nonce;
		if($nonce !== '' && !headers_sent()) header("X-Bridge-Nonce: $nonce");
		return $nonce;
	}

	/**
	 * The nonce as an attribute for a `<script>`, `<style>` or `<link>` the theme prints
	 *
	 * @return string ` nonce='…'` (with the leading space), or '' when the request has no nonce
	 *
	 */
	public function nonceAttr() {
		$nonce = $this->cspNonce();
		return $nonce === '' ? '' : " nonce='" . $this->wire()->sanitizer->entities($nonce) . "'";
	}

	/**
	 * The `<meta property="csp-nonce">` the theme's scripts read the nonce from (the convention
	 * Vite's preload helper reads too), printed first in the head; nothing without a nonce
	 *
	 * @return string
	 *
	 */
	public function cspMeta() {
		$attr = $this->nonceAttr();
		return $attr === '' ? '' : "<meta property='csp-nonce'$attr />";
	}

	/**
	 * Put the nonce on a `<script>` open tag the theme emits or rewrites, where it has none yet
	 *
	 * @param string $openTag `<script>` or `<script …>`
	 * @return string
	 *
	 */
	public function nonceScriptTag($openTag) {
		$attr = $this->nonceAttr();
		// a nonce attribute of its own, not data-nonce or the like (audit SE1)
		if($attr === '' || preg_match('/(?<![\w-])nonce\s*=/i', $openTag)) return $openTag;
		$tag = preg_replace('/^<script\b/i', '<script' . $attr, $openTag, 1);
		return is_string($tag) ? $tag : $openTag;
	}

	/**
	 * The core inline scripts the theme vouches for on native screens, by their whole text (audit
	 * SE1). Each pattern is anchored at both ends and allows only what core interpolates there (an
	 * id, a name, a JSON value checked separately): a script that merely begins like one of them is
	 * not core's and gets no nonce. Every file named here is in upstreamNeedles() too, so a change
	 * in core fails tests/smoke.php instead of silently dropping the nonce.
	 *
	 * @return array pattern => core file under wire/ that prints it
	 *
	 */
	public static function knownInlineScripts() {
		$id = "[A-Za-z0-9_:.-]+";
		return array(
			// InputfieldRepeater.module: the item's config, a JSON value (json_encode escapes slashes)
			"~\\AProcessWire\\.config\\['$id'\\] = (\\{.*\\}|\\[.*\\]);\\z~s" => 'modules/Fieldtype/FieldtypeRepeater/InputfieldRepeater.module',
			// ProcessPageListerBookmarks.php
			'~\AProcessLister\.initialized = true;\z~' => 'modules/Process/ProcessPageLister/ProcessPageListerBookmarks.php',
			// InputfieldSubmit.module: the submit dropdown
			"~\\AInputfieldSubmitDropdown\\.init\\('#$id', null, (true|false)\\);\\z~" => 'modules/Inputfield/InputfieldSubmit/InputfieldSubmit.module',
			// LanguageTabs.module, as core prints it and as hookFormRender() rewrites it
			"~\\AsetupLanguageTabs\\(\\$\\('#$id'\\)\\);\\z~" => 'modules/LanguageSupport/LanguageTabs.module',
			"~\\Awindow\\.jQuery && setupLanguageTabs\\(jQuery\\('#$id'\\)\\);\\z~" => 'modules/LanguageSupport/LanguageTabs.module',
			// ProcessTemplate.module
			'~\A\$\(document\)\.ready\(function\(\) \{ ProcessTemplateInitFields\(\); \}\);\z~' => 'modules/Process/ProcessTemplate/ProcessTemplate.module',
			"~\\A\\$\\('#ProcessTemplatePageLister'\\)\\.iFrameResize\\(\\{ \\}\\);\\z~" => 'modules/Process/ProcessTemplate/ProcessTemplate.module',
			// ProcessField.module: ?focus= on the field editor
			"~\\AjQuery\\(document\\)\\.ready\\(function\\(\\) \\{ Inputfields\\.find\\('#$id'\\); \\}\\);\\z~" => 'modules/Process/ProcessField/ProcessField.module',
			// ProcessPageEditImageSelect.module: the image window
			"~\\A\\$\\(document\\)\\.ready\\(function\\(\\) \\{ setupProcessSave\\('$id', '[A-Za-z0-9_.-]*', [01]?\\); \\}\\);\\z~" => 'modules/Process/ProcessPageEditImageSelect/ProcessPageEditImageSelect.module',
			"~\\ArefreshPageEditField\\('$id'\\);\\z~" => 'modules/Process/ProcessPageEditImageSelect/ProcessPageEditImageSelect.module',
			// JqueryUI.module: vex's labels (a translation with a quote breaks core's own script too)
			"~\\Avex\\.defaultOptions\\.className='vex-theme-default';vex\\.dialog\\.buttons\\.YES\\.text='[^'<\\\\\\\\]*';vex\\.dialog\\.buttons\\.NO\\.text='[^'<\\\\\\\\]*';\\z~" => 'modules/Jquery/JqueryUI/JqueryUI.module',
			// AdminTheme.php: CKEditor's base path on page editors
			"~\\Awindow\\.CKEDITOR_BASEPATH='[A-Za-z0-9_./:-]+';\\z~" => 'core/Admin/AdminTheme.php',
			// MarkupAdminDataTable.module, as core prints it
			"~\\Aif\\(typeof AdminDataTable != 'undefined'\\) AdminDataTable\\.initTable\\(\\$\\('#$id'\\)\\);\\z~" => 'modules/Markup/MarkupAdminDataTable/MarkupAdminDataTable.module',
			// ProcessPageEdit.module: the editor's init
			'~\AinitPageEditForm\(\);\z~' => 'modules/Process/ProcessPageEdit/ProcessPageEdit.module',
		);
	}

	/**
	 * Is this the whole text of a core inline script the theme knows? (knownInlineScripts())
	 *
	 * @param string $body The script element's text, as core printed it
	 * @return bool
	 *
	 */
	public static function isKnownInlineScript($body) {
		$body = trim((string) $body);
		if($body === '') return false;
		foreach(self::knownInlineScripts() as $pattern => $file) {
			if(!preg_match($pattern, $body, $m)) continue;
			// the repeater config: its value must be JSON and nothing more
			if(isset($m[1]) && strpos($pattern, 'ProcessWire\\.config') !== false && json_decode($m[1], true) === null) return false;
			return true;
		}
		return false;
	}

	/**
	 * The nonce on a `<script>` open tag when its text is a core script the theme knows, else the
	 * tag unchanged (audit SE1)
	 *
	 * @param string $openTag
	 * @param string $body The script's text as core printed it (before any rewrite)
	 * @return string
	 *
	 */
	public function nonceKnownScript($openTag, $body) {
		return self::isKnownInlineScript($body) ? $this->nonceScriptTag($openTag) : $openTag;
	}
}

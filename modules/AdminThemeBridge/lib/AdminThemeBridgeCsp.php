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
 * inline scripts it rewrites (lib/AdminThemeBridgeRewrites.php, lib/AdminThemeBridgeTables.php).
 * Nothing else gets it: a pass over the whole page would vouch for injected markup too.
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
		if($attr === '' || preg_match('/\bnonce\s*=/i', $openTag)) return $openTag;
		return preg_replace('/^<script\b/i', '<script' . $attr, $openTag, 1);
	}
}

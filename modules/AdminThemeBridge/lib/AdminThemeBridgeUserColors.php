<?php namespace ProcessWire;

/**
 * AdminThemeBridge: each user's own colour (0.22.0)
 *
 * Part of the AdminThemeBridge class, split by job into traits; `$this` is the theme. Constants
 * and properties stay in AdminThemeBridge.module.php.
 *
 * The site's colour (the `variant` and `primaryColor` settings) is the default. With the
 * `userColors` setting on, a logged-in user picks a preset or a custom colour of their own in the
 * user menu (renderColorPicker(), runtime util/colors.ts). It is kept with the user, in the user
 * page's meta data (`$user->meta('AdminThemeBridge.colors')`), so it follows the user to every
 * browser and is in the page before its first paint. "Site default" removes it.
 *
 * The picker saves with a POST to the admin (any admin page) that hookUserColorsSave() answers
 * before the Process runs: `bridgeColors=1`, `variant` (a preset, `custom`, or '' for the site's
 * colour), `color` (#rrggbb, for `custom`), the session's CSRF token; JSON `{ok}`.
 *
 */
trait AdminThemeBridgeUserColors {

	/**
	 * The logged-in user's own colour, or null when they use the site's
	 *
	 * @return array|null variant, color (#rrggbb for `custom`, else '')
	 *
	 */
	public function userColors() {
		if($this->userColorsValue !== null) return $this->userColorsValue ?: null;
		$this->userColorsValue = false;
		$user = $this->wire()->user;
		if(!$this->userColors || !$user || !$user->isLoggedin() || !$user->id) return null;
		$saved = $user->meta(self::userColorsMeta);
		if(!is_array($saved)) return null;
		$variant = (string) ($saved['variant'] ?? '');
		$color = self::hexColor($saved['color'] ?? '');
		if(!in_array($variant, $this->variants, true) || ($variant === 'custom' && $color === '')) return null;
		$this->userColorsValue = array('variant' => $variant, 'color' => $variant === 'custom' ? $color : '');
		return $this->userColorsValue;
	}

	/**
	 * A colour as #rrggbb in lower case, or '' when it is not one
	 *
	 * @param mixed $color
	 * @return string
	 *
	 */
	public static function hexColor($color) {
		$color = trim((string) $color);
		return preg_match('/^#[0-9a-f]{6}$/i', $color) ? strtolower($color) : '';
	}

	/**
	 * The site's colour variant (the setting, or what an extension's appearance() hook sets), validated
	 *
	 * @return string
	 *
	 */
	public function siteVariant() {
		$values = $this->appearanceValues();
		return $this->validVariant($values['variant'], $values['primaryColor']);
	}

	/**
	 * The site's custom colour as #rrggbb, or '' when unset or invalid (the setting, or what an
	 * extension's appearance() hook sets)
	 *
	 * @return string
	 *
	 */
	public function sitePrimaryColor() {
		$values = $this->appearanceValues();
		return self::hexColor(is_scalar($values['primaryColor']) ? $values['primaryColor'] : '');
	}

	/**
	 * A colour variant value: a known preset, or custom with a valid colour; else blue
	 *
	 * @param mixed $variant
	 * @param mixed $color The custom colour that goes with it
	 * @return string
	 *
	 */
	protected function validVariant($variant, $color) {
		$variant = is_scalar($variant) ? (string) $variant : '';
		if(!in_array($variant, $this->variants, true)) $variant = 'red';
		if($variant === 'custom' && self::hexColor(is_scalar($color) ? $color : '') === '') $variant = 'red';
		return $variant;
	}

	/**
	 * Save or remove the user's own colour (the picker's POST, see the trait's notes)
	 *
	 * Hooked before ProcessController::execute on admin pages while the theme is current: the
	 * Process does not run for this request, which answers JSON.
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookUserColorsSave(HookEvent $event) {
		$input = $this->wire()->input;
		if($input->post('bridgeColors') === null || !$this->wire()->config->ajax) return;
		$user = $this->wire()->user;
		if(!$this->userColors || !$user->isLoggedin()) return;
		$event->replace = true;
		header('Content-Type: application/json');
		$answer = function($ok, $status = 200) use($event) {
			if($status !== 200) http_response_code($status);
			$event->return = json_encode(array('ok' => $ok));
		};
		if(!$this->wire()->session->CSRF->hasValidToken()) return $answer(false, 403);
		$variant = (string) $input->post('variant');
		$color = self::hexColor($input->post('color'));
		if($variant === '') {
			$user->meta()->remove(self::userColorsMeta);
		} else if(!in_array($variant, $this->variants, true) || ($variant === 'custom' && $color === '')) {
			return $answer(false, 400);
		} else {
			$user->meta(self::userColorsMeta, array('variant' => $variant, 'color' => $variant === 'custom' ? $color : ''));
		}
		$this->userColorsValue = null;
		$answer(true);
	}

	/**
	 * The colour picker at the end of the user menu: the five presets (each shown in its own
	 * colour through its `data-pw-variant`), a custom colour, and the site's colour
	 *
	 * @return string An `<li>` for the user menu, or '' when users do not pick their colour
	 *
	 */
	public function renderColorPicker() {
		$user = $this->wire()->user;
		if(!$this->userColors || !$user || !$user->isLoggedin()) return '';
		$sanitizer = $this->wire()->sanitizer;
		$csrf = $this->wire()->session->CSRF;
		$own = $this->userColors();
		$current = $own ? $own['variant'] : '';
		// the colour in use is ringed, the site's included when the user has none of their own
		$inUse = $this->getVariant();
		$names = array(
			'red' => __('ProcessWire', __FILE__),
			'blue' => __('Blue', __FILE__),
			'vibrant' => __('Vibrant', __FILE__),
			'black' => __('Black', __FILE__),
			'pink' => __('Pink', __FILE__),
			'green' => __('Green', __FILE__),
		);
		$label = $sanitizer->entities1(__('Colour', __FILE__));
		$out = "<li class='pw-color-pick' role='group' aria-label='$label'" .
			" data-url='" . $sanitizer->entities($this->wire()->config->urls->admin) . "'" .
			" data-token-name='" . $sanitizer->entities($csrf->getTokenName()) . "'" .
			" data-token-value='" . $sanitizer->entities($csrf->getTokenValue()) . "'>" .
			"<span class='pw-color-pick-label'><i class='fa fa-fw fa-paint-brush' aria-hidden='true'></i>$label</span>";
		// the site's colour first, beside the label; the swatches on the row below
		$site = $sanitizer->entities1(__('Site default', __FILE__));
		$out .= "<button type='button' class='pw-color-reset' data-pw-variant-pick='' aria-pressed='" . ($current === '' ? 'true' : 'false') . "'" .
			" title='$site' aria-label='$site'><i class='fa fa-fw fa-undo' aria-hidden='true'></i></button>";
		foreach($names as $variant => $name) {
			$name = $sanitizer->entities1($name);
			$out .= "<button type='button' class='pw-color-swatch" . ($inUse === $variant ? ' pw-color-current' : '') . "' data-pw-variant='$variant' data-pw-variant-pick='$variant'" .
				" aria-pressed='" . ($current === $variant ? 'true' : 'false') . "' title='$name' aria-label='$name'></button>";
		}
		$custom = $sanitizer->entities1(__('Custom colour', __FILE__));
		$value = $own && $own['variant'] === 'custom' ? $own['color'] : ($this->sitePrimaryColor() ?: '#3584ea');
		$out .= "<label class='pw-color-swatch pw-color-custom" . ($inUse === 'custom' ? ' pw-color-current' : '') . "' title='$custom'>" .
			"<input type='color' data-pw-variant-pick='custom' value='$value' aria-label='$custom'></label>";
		return $out . "</li>";
	}
}

<?php namespace ProcessWire;

/**
 * AdminThemeBridge: Add New skips the template step when the template is auto-selected
 *
 * With the setting `pageAddSkipTemplate` on, Add New under a parent whose children all use one
 * template (or that allows only one) creates the page through upstream's quick add
 * (ProcessPageAdd::processQuickAdd(), `name_format=untitled-time`) and opens the editor; a notice
 * names the template. The `untitled-*` name is replaced from the title on the first save.
 *
 * Part of the AdminThemeBridge class, split by job into traits (audit PA1); `$this` is the theme.
 * Constants and properties stay in AdminThemeBridge.module.php.
 *
 */
trait AdminThemeBridgePageAdd {

	/**
	 * Hook before ProcessPageAdd::buildForm: parent and any fixed template are checked by now; when
	 * the template is known, quick-add the page instead of building the form (redirects on success)
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookPageAddBuildForm(HookEvent $event) {
		$process = $event->object;
		$input = $this->wire()->input;
		$pages = $this->wire()->pages;
		// ProcessUser and other ProcessPageType screens bring their own parents and templates
		if($this->wire()->page->process != 'ProcessPageAdd') return;
		// a template chosen in the URL (nav shortcuts, Save + Publish + Add Another) is a choice
		if(!$input->requestMethod('GET') || $input->get('template_id') || $input->get('name_format')) return;
		$parent = $pages->get((int) $input->get('parent_id'));
		// upstream's own quick add (childNameFormat) had its go before buildForm()
		if(!$parent->id || strlen((string) $parent->template->childNameFormat)) return;

		list($template, $reason) = $this->pageAddAutoTemplate($parent, (array) $process->getAllowedTemplates($parent));
		if(!$template) return;

		// the notice goes with the page actually created; the quick add redirects (and exits) after it
		$hookId = $pages->addHookAfter('added', function(HookEvent $e) use($parent, $template, $reason) {
			$page = $e->arguments(0);
			if(!$page instanceof Page || $page->parent_id != $parent->id || $page->template->id != $template->id) return;
			$this->wire()->session->message($this->pageAddNotice($parent, $template, $reason), Notice::allowMarkup);
		});
		$input->get->set('name_format', 'untitled-time');
		$process->processQuickAdd($parent, $template);
		// still here: the quick add did not go through, so the form is built as upstream does
		$pages->removeHook($hookId);
		$input->get->remove('name_format');
	}

	/**
	 * The template Add New would use under $parent without asking, and why
	 *
	 * @param Page $parent
	 * @param array $allowed Templates allowed under the parent, by ID (ProcessPageAdd::getAllowedTemplates())
	 * @return array Template|null and 'only' (the one allowed), 'siblings' (all children use it) or ''
	 *
	 */
	public function pageAddAutoTemplate(Page $parent, array $allowed) {
		if(count($allowed) === 1) return array(reset($allowed), 'only');
		if(!count($allowed) || !$this->pageAddSuggests($parent)) return array(null, '');
		$pages = $this->wire()->pages;
		$first = $pages->get("parent_id=$parent->id, include=all, sort=sort");
		if(!$first->id || !isset($allowed[$first->template->id])) return array(null, '');
		if($pages->count("parent_id=$parent->id, templates_id!={$first->template->id}, include=all")) return array(null, '');
		return array($first->template, 'siblings');
	}

	/**
	 * Does upstream suggest a template under $parent? `$config->pageAdd['noSuggestTemplates']`:
	 * 1 or true for none, or template names of parents without suggestions (as buildForm() reads it)
	 *
	 * @param Page $parent
	 * @return bool
	 *
	 */
	protected function pageAddSuggests(Page $parent) {
		$settings = $this->wire()->config->pageAdd;
		$noSuggest = is_array($settings) && !empty($settings['noSuggestTemplates']) ? $settings['noSuggestTemplates'] : '';
		if(empty($noSuggest)) return true;
		if(((string) $noSuggest) === '1') return false;
		$names = is_array($noSuggest) ? $noSuggest : explode(' ', $noSuggest);
		return !in_array($parent->template->name, $names);
	}

	/**
	 * Notice for an auto-selected template (markup; the settings link for superusers)
	 *
	 * @param Page $parent
	 * @param Template $template
	 * @param string $reason 'only' or 'siblings'
	 * @return string
	 *
	 */
	protected function pageAddNotice(Page $parent, Template $template, $reason) {
		$sanitizer = $this->wire()->sanitizer;
		$label = $sanitizer->entities($template->getLabel());
		$title = $sanitizer->entities($parent->get('title|name'));
		$out = $reason === 'only'
			? sprintf(__('Template "%1$s" was selected automatically: it is the only template allowed under "%2$s".', __FILE__), $label, $title)
			: sprintf(__('Template "%1$s" was selected automatically: every page under "%2$s" uses it.', __FILE__), $label, $title);
		$settings = __('Bridge settings', __FILE__);
		if($this->wire()->user->isSuperuser()) {
			$url = $this->wire()->config->urls->admin . 'module/edit?name=AdminThemeBridge';
			$settings = "<a href='" . $sanitizer->entities($url) . "'>" . $sanitizer->entities($settings) . '</a>';
		} else {
			$settings = $sanitizer->entities($settings);
		}
		return $out . ' ' . sprintf(__('To choose the template on the Add New screen, turn off "Step 2 if template auto-selected" in the %s.', __FILE__), $settings);
	}
}

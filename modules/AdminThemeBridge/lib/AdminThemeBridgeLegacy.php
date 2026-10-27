<?php namespace ProcessWire;

/**
 * AdminThemeBridge: Legacy detection: native map, marked Inputfields and Processes, the reasons that load the legacy stack
 *
 * Part of the AdminThemeBridge class, split by job into traits (audit PA1); `$this` is the theme.
 * Constants and properties stay in AdminThemeBridge.module.php.
 *
 */
trait AdminThemeBridgeLegacy {

	/**
	 * Hook before Inputfield::render / renderValue: mark the wrapper and record legacy needs
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookInputfieldRender(HookEvent $event) {
		/** @var Inputfield $inputfield */
		$inputfield = $event->object;
		$this->addControlClasses($inputfield);
		// core runs the before-render hooks for an AJAX placeholder too, without rendering
		$this->markInputfield($inputfield, !$this->isAjaxPlaceholder($inputfield));
	}

	/**
	 * Will core render this Inputfield as an AJAX placeholder on this request? Same condition as
	 * InputfieldWrapper::___renderInputfield() (3.0.274): an AJAX collapse mode, a logged-in
	 * user, not required-and-empty (core then falls back to a plain collapse), and not the AJAX
	 * request that renders this very field.
	 *
	 * @param Inputfield $inputfield
	 * @return bool
	 *
	 */
	protected function isAjaxPlaceholder(Inputfield $inputfield) {
		$collapsed = (int) $inputfield->getSetting('collapsed');
		$ajax = $collapsed === Inputfield::collapsedYesAjax || $collapsed === Inputfield::collapsedTabAjax ||
			($collapsed === Inputfield::collapsedBlankAjax && $inputfield->isEmpty());
		if(!$ajax || !$this->wire()->user->isLoggedin()) return false;
		if($inputfield->getSetting('required') && $inputfield->isEmpty()) return false;
		if($this->wire()->config->ajax && $this->wire()->input->get('renderInputfieldAjax') === $inputfield->attr('id')) return false;
		return true;
	}

	/**
	 * Hook after Inputfield::renderReadyHook: mark the wrapper only. An AJAX-collapsed field is
	 * not rendered on this request (its placeholder is), so it does not need the stack yet; the
	 * mark tells the client to load it when the field is opened.
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookInputfieldReady(HookEvent $event) {
		/** @var Inputfield $inputfield */
		$inputfield = $event->object;
		// the core structure is the theme's; a third-party wrapper subclass is marked like any field
		if($this->isNativeWrapper($inputfield) && $inputfield->className() !== 'InputfieldMarkup') return;
		$this->markInputfield($inputfield, false);
	}

	/**
	 * Mark the wrapper as component or legacy, and record the legacy need
	 *
	 * @param Inputfield $inputfield
	 * @param bool $record Record a legacy need for this request (rendered now)
	 *
	 */
	protected function markInputfield(Inputfield $inputfield, $record) {
		$class = $inputfield->className();
		if($record) {
			$this->renderedNeeds[$class] = true;
			if($inputfield->getSetting('useLanguages')) $this->renderedNeeds['languages'] = true;
		}
		if($this->isNativeInputfield($inputfield)) {
			$tag = '';
			if($inputfield instanceof BridgeComponent) {
				$info = $this->componentInfo($inputfield);
				$tag = $info['tag'];
				if($info['module'] !== '') $inputfield->wrapAttr('data-bridge-module', $info['module']);
				$inputfield->wrapAttr('data-bridge-version', $info['version']);
			}
			$inputfield->wrapAttr('data-bridge-component', $tag === '' ? $class : $tag);
		} else {
			$inputfield->wrapAttr('data-bridge-legacy', $class);
			if($record) {
				$this->needLegacy("Inputfield:$class");
				$dir = $this->wire()->config->paths($class);
				if($dir) $this->legacyInputfieldDirs[$dir] = true;
			}
		}
	}

	/**
	 * Add the theme's control classes for this Inputfield type (first match in $controlClasses,
	 * by instanceof, so subclasses such as InputfieldEmail inherit InputfieldText's). Classes go
	 * on the control and on the content element, never on the wrapper, which the conformance
	 * suite compares with upstream.
	 *
	 * @param Inputfield $inputfield
	 *
	 */
	protected function addControlClasses(Inputfield $inputfield) {
		if($inputfield instanceof InputfieldWrapper) return;
		foreach($this->controlClasses as $type => $classes) {
			$fqn = "\\ProcessWire\\$type";
			if(!$inputfield instanceof $fqn) continue;
			if($type === 'InputfieldSelect' && $inputfield instanceof InputfieldHasArrayValue) {
				if(!$inputfield instanceof InputfieldAsmSelect) continue;
			}
			list($control, $content) = $classes;
			if($control !== '') $inputfield->addClass($control);
			if($content !== '') $inputfield->addClass($content, 'contentClass');
			return;
		}
	}

	/**
	 * Hook after ProcessController::execute: a Process that is not a component needs the stack
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookProcessExecute(HookEvent $event) {
		/** @var ProcessController $controller */
		$controller = $event->object;
		$process = $controller->getProcess();
		if(!$process) return;
		if($this->recordProcess($process) && is_string($event->return)) {
			$event->return = $this->nativeInlineScripts($event->return);
		}
	}

	/**
	 * The Process's legacy reasons: the scripts it added (needScriptsAddedByProcess()), and itself
	 * unless it is native
	 *
	 * @param Process $process
	 * @return bool Is the Process native?
	 *
	 */
	protected function recordProcess(Process $process) {
		$this->needScriptsAddedByProcess($process);
		if($this->isNativeProcess($process)) return true;
		$this->needLegacy('Process:' . $process->className());
		return false;
	}

	/**
	 * Called by default.php once the Process is done: a Process that threw (wire/core/admin.php
	 * catches it and shows the error) never reached hookProcessExecute(). It keeps the reasons it
	 * would have had, so its own script (ProcessHannaCode.js, added when it initialised) is not
	 * left deferred on a screen that is not native.
	 *
	 */
	public function settleProcess() {
		if($this->scriptsBeforeProcess === null) return;
		$process = $this->wire()->process;
		if($process instanceof Process) {
			$this->recordProcess($process);
		} else {
			$this->scriptsBeforeProcess = null;
		}
	}

	/**
	 * Hook before ProcessController::execute: remember the scripts there are so far
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookProcessExecuteBefore(HookEvent $event) {
		$this->scriptsBeforeProcess = array();
		foreach($this->assetUrls($this->wire()->config->scripts) as $url) $this->scriptsBeforeProcess[] = (string) $url;
	}

	/**
	 * A jQuery script a site module adds while the Process builds the screen belongs to that
	 * screen (BatchChildEditor's, from a ProcessPageEdit hook): it is a legacy reason (Gate 3).
	 * Scripts added before, at init or ready on every admin page (RockMigrations'), stay deferred
	 * (isJqueryScript()); core scripts under wire/ have their own reasons (their Inputfield or
	 * Process), and so does the Process's own script (added when it initialises): a native
	 * Process (a component such as ProcessBridgeDemo) answers for it.
	 *
	 * A module's config screen (ProcessModule, `edit?name=X`) is the exception: a jQuery script
	 * from X's own directory is that screen's, whenever it was added. Modules add it at init or
	 * ready when they see `?name=X` (AdminOnSteroids' aos_config.min.js, GeneralSettings'
	 * Settings.js), before the Process starts.
	 *
	 * @param Process $process
	 *
	 */
	protected function needScriptsAddedByProcess(Process $process) {
		if($this->scriptsBeforeProcess === null) return;
		$config = $this->wire()->config;
		$before = $this->scriptsBeforeProcess;
		$this->scriptsBeforeProcess = null;
		$own = (string) $config->urls($process->className());
		// a Process placed directly in site/modules/ owns no directory of its own (audit B5)
		if($own === $config->urls->siteModules || $own === $config->urls->modules) $own = '';
		$configured = $this->moduleConfigUrl($process);
		foreach($this->assetUrls($config->scripts) as $url) {
			$url = (string) $url;
			if(strpos($url, $config->urls->wire) === 0) continue;
			$forConfig = $configured !== '' && strpos($url, $configured) === 0;
			if(!$forConfig && in_array($url, $before, true)) continue;
			if($own && strpos($url, $own) === 0) continue;
			if(!$this->isJqueryScript($url)) continue;
			$path = preg_replace('/[?#].*$/', '', $url);
			$dir = $this->siteModuleDir($path);
			$reason = $this->scriptReason($path);
			// a field module's script (added as its Inputfield renders) has the Inputfield's reason,
			// if one of its Inputfields was legacy; settled in useLegacyStack()
			if(!$forConfig && $dir !== '' && $this->isFieldModuleDir($dir)) {
				$this->pendingScriptReasons[$dir] = $reason;
				continue;
			}
			$this->needLegacy($reason);
		}
	}

	/**
	 * On a module's config screen (ProcessModule `edit?name=X`), the URL of X's directory
	 *
	 * @param Process $process
	 * @return string URL, or '' on any other screen (or for a module directly in site/modules/)
	 *
	 */
	public function moduleConfigUrl(Process $process) {
		if($process->className() !== 'ProcessModule') return '';
		$input = $this->wire()->input;
		if($input->urlSegment1 !== 'edit') return '';
		$name = $this->wire()->sanitizer->name((string) $input->get('name'));
		if($name === '' || !$this->wire()->modules->isInstalled($name)) return '';
		$config = $this->wire()->config;
		$url = (string) $config->urls($name);
		if($url === '' || $url === $config->urls->siteModules || strpos($url, $config->urls->wire) === 0) return '';
		return $url;
	}

	/**
	 * The legacy reason for a script: `Script:<dir>/<file>`, dir being its module's directory under
	 * site/modules (Fluency/fluency.js, not scripts/fluency.js), else the script's own directory
	 *
	 * @param string $path Root-relative URL path, no query
	 * @return string
	 *
	 */
	protected function scriptReason($path) {
		$dir = $this->siteModuleDir($path);
		return 'Script:' . ($dir !== '' ? basename(rtrim($dir, '/')) : basename(dirname($path))) . '/' . basename($path);
	}

	/**
	 * The module directory under site/modules a script URL belongs to (its first path segment),
	 * or '' for a script elsewhere
	 *
	 * @param string $path Root-relative URL path
	 * @return string Absolute directory path
	 *
	 */
	protected function siteModuleDir($path) {
		$config = $this->wire()->config;
		$base = $config->urls->siteModules;
		if(strpos($path, $base) !== 0) return '';
		$first = explode('/', substr($path, strlen($base)))[0];
		return $first === '' ? '' : $config->paths->siteModules . $first . '/';
	}

	/**
	 * Does this module directory hold an Inputfield or Fieldtype module?
	 *
	 * @param string $dir
	 * @return bool
	 *
	 */
	protected function isFieldModuleDir($dir) {
		if(!isset($this->fieldModuleDirs[$dir])) {
			// two patterns, no GLOB_BRACE (not defined on musl builds); glob() may return false (B4)
			$found = false;
			foreach(array('Inputfield*.module*', 'Fieldtype*.module*') as $pattern) {
				$files = glob($dir . $pattern);
				if(is_array($files) && count($files)) { $found = true; break; }
			}
			$this->fieldModuleDirs[$dir] = $found;
		}
		return $this->fieldModuleDirs[$dir];
	}

	/**
	 * The native map (see $nativeBase): hook after to add, change or remove entries, e.g.
	 * `$wire->addHookAfter('AdminThemeBridge::nativeMap', function($e) { $map = $e->return;
	 * $map['InputfieldMyMarkup'] = array('kind' => 'wrapper'); $e->return = $map; });`
	 *
	 * @return array class => entry
	 *
	 */
	public function ___nativeMap() {
		return $this->nativeBase;
	}

	/**
	 * nativeMap(), once per request
	 *
	 * @return array
	 *
	 */
	public function getNativeMap() {
		if($this->nativeMapCache === null) {
			$map = $this->nativeMap();
			$this->nativeMapCache = is_array($map) ? $map : $this->nativeBase;
		}
		return $this->nativeMapCache;
	}

	public function getNativeOverrides() {
		if($this->nativeOverridesCache !== null) return $this->nativeOverridesCache;
		$this->nativeOverridesCache = array();
		foreach(preg_split('/\r?\n/', (string) $this->get('nativeOverrides')) as $line) {
			if(preg_match('/^\s*([A-Z][A-Za-z0-9_]*)\s*=\s*(native|legacy)\s*$/', $line, $m)) $this->nativeOverridesCache[$m[1]] = $m[2];
		}
		return $this->nativeOverridesCache;
	}

	/**
	 * Lines of the nativeOverrides setting that are not `ClassName=native|legacy`
	 *
	 * @return array
	 *
	 */
	public function nativeOverrideErrors() {
		$bad = array();
		foreach(preg_split('/\r?\n/', (string) $this->get('nativeOverrides')) as $line) {
			if(trim($line) === '' || strpos(ltrim($line), '#') === 0) continue;
			if(!preg_match('/^\s*[A-Z][A-Za-z0-9_]*\s*=\s*(native|legacy)\s*$/', $line)) $bad[] = trim($line);
		}
		return $bad;
	}

	/**
	 * Is this Process fine without the legacy stack (its own client part)? The override setting
	 * first, then a component (its own class, not a subclass: ADR 0015), then the native map by
	 * exact class (ADR 0016). Hookable.
	 *
	 * @param Process $process
	 * @return bool
	 *
	 */
	public function ___isNativeProcess(Process $process) {
		$class = $process->className();
		$overrides = $this->getNativeOverrides();
		if(isset($overrides[$class])) return $overrides[$class] === 'native';
		if($process instanceof BridgeComponent) return $this->componentClass($process) === get_class($process);
		$map = $this->getNativeMap();
		return isset($map[$class]) && $map[$class]['kind'] === 'process';
	}

	/**
	 * The theme's stand-ins for the current Process's scripts, printed after the theme script on a
	 * page without the legacy stack (with it, upstream's scripts run as before)
	 *
	 * @return array Paths relative to the theme directory
	 *
	 */
	public function nativeProcessScripts() {
		$process = $this->wire()->process;
		if(!$process instanceof Process) return array();
		return $this->processScripts($process->className(), $this->useLegacyStack());
	}

	/**
	 * A Process class's stand-in scripts from the native map (nativeProcessScripts())
	 *
	 * @param string $class
	 * @param bool $legacy Is the stack on the page? (then only scriptsAlways entries print theirs)
	 * @return array Paths relative to the theme directory
	 *
	 */
	public function processScripts($class, $legacy = false) {
		$map = $this->getNativeMap();
		$entry = isset($map[$class]) && $map[$class]['kind'] === 'process' ? $map[$class] : null;
		if(!$entry || empty($entry['scripts'])) return array();
		if($legacy && empty($entry['scriptsAlways'])) return array();
		return array_values((array) $entry['scripts']);
	}

	/**
	 * Does this Process's edit form save without a reload (scripts/page-save.js)? The page editor
	 * (and its subclasses, as before), and by exact class the screens whose edit forms page-save.js
	 * knows (milestone 3.8): fields, templates, module settings, the profile, and users, roles and
	 * permissions (ProcessPageEdit forms). The script itself checks the form and the button.
	 *
	 * @param Process|null $process
	 * @return bool
	 *
	 */
	public function saveInPlaceProcess($process) {
		if(!$process instanceof Process) return false;
		if($process instanceof ProcessPageEdit) return true;
		$map = $this->getNativeMap();
		$class = $process->className();
		return isset($map[$class]) && !empty($map[$class]['saveInPlace']);
	}

	/**
	 * Is this Inputfield fine without the legacy stack? The override setting first, then the
	 * native map by exact class (wrappers included: a subclass of InputfieldMarkup or
	 * InputfieldFieldset may add scripts like any other; audit A19), the Page field by its widget,
	 * a component by its own class. Hookable.
	 *
	 * @param Inputfield $inputfield
	 * @return bool
	 *
	 */
	public function ___isNativeInputfield(Inputfield $inputfield) {
		$class = $inputfield->className();
		$overrides = $this->getNativeOverrides();
		if(isset($overrides[$class])) return $overrides[$class] === 'native';
		$map = $this->getNativeMap();
		if(isset($map[$class]) && $map[$class]['kind'] !== 'process') return true;
		if($class === 'InputfieldPage') {
			$widget = ltrim((string) $inputfield->getSetting('inputfield'), '_');
			if($widget === '') $widget = 'InputfieldSelect';
			if(isset($overrides[$widget])) return $overrides[$widget] === 'native';
			return isset($map[$widget]) && !empty($map[$widget]['pageWidget']);
		}
		// a component counts for its own class only: a subclass may add jQuery scripts of its own
		// (ADR 0015: native by exact class, never by inheritance)
		if($inputfield instanceof BridgeComponent) return $this->componentClass($inputfield) === get_class($inputfield);
		return false;
	}

	/**
	 * Is this one of the structural wrappers of the native map (InputfieldWrapper, Form, Fieldset,
	 * FieldsetOpen/Close/TabOpen, Markup), by exact class?
	 *
	 * @param Inputfield $inputfield
	 * @return bool
	 *
	 */
	public function isNativeWrapper(Inputfield $inputfield) {
		$map = $this->getNativeMap();
		$class = $inputfield->className();
		return isset($map[$class]) && $map[$class]['kind'] === 'wrapper';
	}

	/**
	 * Record that the legacy stack is needed on this request
	 *
	 * @param string $reason
	 *
	 */
	public function needLegacy($reason) {
		$this->legacyNeeded = true;
		if(!isset($this->legacyReasons[$reason])) $this->legacyReasons[$reason] = 0;
		$this->legacyReasons[$reason]++;
	}

	/**
	 * Does this request print the legacy stack in <head>?
	 *
	 * @return bool
	 *
	 */
	public function useLegacyStack() {
		if($this->legacyStack !== self::legacyAuto) return true;
		$this->settleScriptReasons();
		return $this->legacyNeeded;
	}

	/**
	 * A jQuery script from a field module directory needs the stack unless a legacy Inputfield
	 * from that directory was rendered (it then has that Inputfield's reason): a Fieldtype that
	 * renders a core native Inputfield and adds its own jQuery script (FieldtypeOptionsColor)
	 * would otherwise have its script deferred and never run (ADR 0015 3; audit A4)
	 *
	 */
	protected function settleScriptReasons() {
		foreach($this->pendingScriptReasons as $dir => $reason) {
			unset($this->pendingScriptReasons[$dir]);
			if(empty($this->legacyInputfieldDirs[$dir])) $this->needLegacy($reason);
		}
		if(!count($this->renderedNeeds)) return;
		// a scriptNeeds() script whose fields render here
		foreach($this->getScriptNeeds() as $part => $when) {
			if(isset($this->settledNeeds[$part]) || empty($this->renderedNeeds[$when])) continue;
			foreach($this->assetUrls($this->wire()->config->scripts) as $url) {
				$url = (string) $url;
				$path = preg_replace('/[?#].*$/', '', $url);
				if(strpos($path, $part) === false) continue;
				$this->settledNeeds[$part] = true;
				if($this->isJqueryScript($url)) $this->needLegacy($this->scriptReason($path));
				break;
			}
		}
	}

	/**
	 * The scriptNeeds map (see $scriptNeedsBase): hook after to add, change or remove entries, e.g.
	 * `$wire->addHookAfter('AdminThemeBridge::scriptNeeds', function($e) { $map = $e->return;
	 * $map['/MyModule/my-admin.js'] = 'InputfieldMyField'; $e->return = $map; });`
	 *
	 * @return array URL part => 'languages' or an Inputfield class name
	 *
	 */
	public function ___scriptNeeds() {
		return $this->scriptNeedsBase;
	}

	/**
	 * scriptNeeds(), once per request
	 *
	 * @return array
	 *
	 */
	public function getScriptNeeds() {
		if($this->scriptNeedsCache === null) {
			$map = $this->scriptNeeds();
			$this->scriptNeedsCache = is_array($map) ? $map : $this->scriptNeedsBase;
		}
		return $this->scriptNeedsCache;
	}

	/**
	 * Is this script in the scriptNeeds() map? (Printed on a page without the stack: where its
	 * fields render, it made the page legacy.)
	 *
	 * @param string $url
	 * @return bool
	 *
	 */
	public function isScriptNeedsScript($url) {
		$path = preg_replace('/[?#].*$/', '', (string) $url);
		foreach($this->getScriptNeeds() as $part => $when) {
			if($part !== '' && strpos($path, $part) !== false) return true;
		}
		return false;
	}

	/**
	 * Reasons recorded so far (auto mode)
	 *
	 * @return array
	 *
	 */
	public function getLegacyReasons() {
		return $this->legacyReasons;
	}

	/**
	 * Split $config->scripts into what gets printed now and what is deferred to the client
	 *
	 * @param array|null $all Script URLs in print order (default: $this->assetUrls($config->scripts))
	 * @return array ['print' => string[], 'deferred' => string[]]
	 *
	 */
	public function getScriptUrls(?array $all = null) {
		if($all === null) {
			$all = array();
			foreach($this->assetUrls($this->wire()->config->scripts) as $url) $all[] = $url;
		}
		if($this->useLegacyStack()) return array('print' => $all, 'deferred' => array());
		$print = array();
		$deferred = array();
		foreach($all as $url) {
			if($this->isLegacyScript($url) || ($this->isJqueryScript($url) && !$this->isScriptNeedsScript($url))) {
				$deferred[] = $url;
			} else {
				$print[] = $url;
			}
		}
		return array('print' => $print, 'deferred' => $deferred);
	}
}

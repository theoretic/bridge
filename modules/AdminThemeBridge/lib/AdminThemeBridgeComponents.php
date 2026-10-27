<?php namespace ProcessWire;

/**
 * AdminThemeBridge: The component contract (BridgeComponent, docs/contract.md)
 *
 * Part of the AdminThemeBridge class, split by job into traits (audit PA1); `$this` is the theme.
 * Constants and properties stay in AdminThemeBridge.module.php.
 *
 */
trait AdminThemeBridgeComponents {

	/**
	 * The class that declares a component's getBridgeComponent()
	 *
	 * @param BridgeComponent $module
	 * @return string Fully qualified class name
	 *
	 */
	protected function componentClass($module) {
		$method = new \ReflectionMethod($module, 'getBridgeComponent');
		return $method->getDeclaringClass()->getName();
	}

	/**
	 * Normalised component descriptor for a BridgeComponent module
	 *
	 * `module` is resolved to a URL: absolute URLs and root-relative paths are kept, anything
	 * else is relative to the module's own directory ($config->urls->ClassName).
	 *
	 * @param Module|BridgeComponent $module
	 * @return array ['tag' => string, 'module' => string, 'version' => string]
	 *
	 */
	public function componentInfo($module) {
		$info = $module instanceof BridgeComponent ? $module->getBridgeComponent() : array();
		if(!is_array($info)) $info = array();
		$tag = empty($info['tag']) ? '' : (string) $info['tag'];
		$url = empty($info['module']) ? '' : (string) $info['module'];
		$version = empty($info['version']) ? '1' : (string) $info['version'];
		// per class, once a request: every field of a component calls this (audit PP4)
		$class = $module->className();
		if($url !== '' && strpos($url, '/') !== 0 && strpos($url, '://') === false) {
			// relative to the directory of the class that declares the component (a subclass in
			// another module would otherwise point at its own directory)
			if(!isset($this->componentBase[$class])) {
				$declaring = $module instanceof BridgeComponent ? wireClassName($this->componentClass($module), false) : $class;
				$this->componentBase[$class] = (string) $this->wire()->config->urls($declaring);
			}
			$url = $this->componentBase[$class] . $url;
		}
		if($url !== '' && strpos($url, '?') === false) {
			if(!isset($this->componentVersion[$class])) {
				$this->componentVersion[$class] = (string) $this->wire()->modules->getModuleInfoProperty($module, 'version');
			}
			if($this->componentVersion[$class] !== '') $url .= '?v=' . rawurlencode($this->componentVersion[$class]);
		}
		return array('tag' => $tag, 'module' => $url, 'version' => $version);
	}
}

<?php namespace ProcessWire;

/**
 * BridgeAdminAccessControl: the extension's own checks, run by tools/extension-check.php after the contract tests.
 * Included with the sandbox booted: $wire, $module (the module, got with $modules->get()) and
 * check($label, $ok, $detail = '') are there.
 */

/** @var BridgeAdminAccessControl $module */
$modules = $wire->wire()->modules;
$config = $modules->getConfig('BridgeAdminAccessControl');
$rules = isset($config['rules']) ? $config['rules'] : array();
check('rules config is an array', is_array($rules));
check('rulesVersion is an int', is_int($module->get('rulesVersion')), gettype($module->get('rulesVersion')));
check('apiGuard is set', $module->get('apiGuard') !== null);
$acl = $wire->wire()->users->get('name=acl');
$adminRoot = $wire->wire()->pages->get((int) $wire->wire()->config->adminRootPageID);
check('verdict as acl for the admin root is allow', $acl->id && $module->verdict($adminRoot, $acl) === BridgeAdminAccessControl::ALLOW);
$info = $modules->getModuleInfoVerbose('BridgeAdminAccessControl');
check('the manifest declares navCacheKey', isset($info['bridge']['hooks']) && in_array('navCacheKey', $info['bridge']['hooks'], true));

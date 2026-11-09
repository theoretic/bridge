<?php namespace ProcessWire;

/**
 * Sets BridgeAdminAccessControl's rules on a sandbox to a named preset, for tools/acl-check.js and
 * by hand. Writes the module's config directly (replacing every rule, bumping `rulesVersion`) and
 * prints the rules.
 *
 * Usage: php tools/sandbox-acl.php /path/to/sandbox/root <preset>
 *
 *   clear               no rules
 *   deny-tree-modules   acl-editor: deny /bridge-tree/ (inherit), deny Modules
 *   deny-pages          acl-editor: deny Pages
 *   deny-all-menus      acl-editor: deny Pages, Setup, Modules, Access
 *   two-roles           acl-restricted: deny /bridge-native/ (inherit); acl-editor: allow /bridge-native/
 *
 * Original work, MIT.
 */

$preset = $argv[2] ?? '';
$presets = array('clear', 'deny-tree-modules', 'deny-pages', 'deny-all-menus', 'two-roles');
if(!isset($argv[1]) || !in_array($preset, $presets, true)) {
	exit("Usage: php tools/sandbox-acl.php /path/to/sandbox/root <" . implode('|', $presets) . ">\n");
}
// a sandbox on its own database copy only (audit SE5)
require __DIR__ . '/lib/sandbox-guard.php';
$root = bridgeSandboxRoot($argv[1]);

if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;
include "$root/index.php";
bridgeSandboxBooted($config, $root);
/** @var ProcessWire $wire */
/** @var Modules $modules */
/** @var Pages $pages */

if(!$modules->isInstalled('BridgeAdminAccessControl')) exit("FAIL BridgeAdminAccessControl is not installed on this sandbox\n");

/**
 * One rule of a preset; exits when the fixture it names is missing (tools/sandbox-admin.php and
 * tools/sandbox-fixture.php make them)
 *
 * @param string $role
 * @param int|string $page A page id, or a path
 * @param string $mode
 * @return array
 *
 */
function aclRule($role, $page, $mode = 'deny') {
	$r = wire('roles')->get("name=$role");
	$p = wire('pages')->get(is_int($page) ? $page : "path=$page, include=all");
	if(!$r->id || !$p->id) exit("FAIL fixture missing: role $role, page $page\n");
	return array('role' => (int) $r->id, 'page' => (int) $p->id, 'mode' => $mode, 'inherit' => true);
}

$wanted = array();
switch($preset) {
	case 'deny-tree-modules':
		$wanted = array(aclRule('acl-editor', '/bridge-tree/'), aclRule('acl-editor', 21));
		break;
	case 'deny-pages':
		$wanted = array(aclRule('acl-editor', 3));
		break;
	case 'deny-all-menus':
		foreach(array(3, 22, 21, 28) as $id) $wanted[] = aclRule('acl-editor', $id);
		break;
	case 'two-roles':
		$wanted = array(aclRule('acl-restricted', '/bridge-native/'), aclRule('acl-editor', '/bridge-native/', 'allow'));
		break;
}

/** @var BridgeAdminAccessControl $acl */
$acl = $modules->get('BridgeAdminAccessControl');
$before = (array) $modules->getConfig('BridgeAdminAccessControl', 'rules');
$rules = $wire->wire(new BridgeAccessRules())->fromConfig(array());
foreach($wanted as $rule) $rules->add($rule);
$acl->saveRules($rules);

echo "preset $preset (rules before: " . count($before) . ")\n";
echo json_encode($modules->getConfig('BridgeAdminAccessControl', 'rules')) . "\n";
echo "rulesVersion " . $modules->getConfig('BridgeAdminAccessControl', 'rulesVersion') . "\n";

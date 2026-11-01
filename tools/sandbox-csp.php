<?php namespace ProcessWire;

/**
 * Sets the BridgeCsp mode of a sandbox (ADR 0020), for tools/csp-check.js and by hand.
 *
 * Usage: php tools/sandbox-csp.php /path/to/sandbox/root [off|report-only|enforce]
 * Without a mode it prints the current one. Prints `mode <previous> -> <new>` otherwise.
 * Installs BridgeCsp first when it is junctioned into app/modules/ but not installed yet.
 */

$mode = $argv[2] ?? '';
if(!isset($argv[1]) || ($mode !== '' && !in_array($mode, array('off', 'report-only', 'enforce'), true))) {
	exit("Usage: php tools/sandbox-csp.php /path/to/sandbox/root [off|report-only|enforce]\n");
}
// a sandbox on its own database copy only (audit SE5)
require __DIR__ . '/lib/sandbox-guard.php';
$root = bridgeSandboxRoot($argv[1]);

if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;
include "$root/index.php";
bridgeSandboxBooted($config, $root);
/** @var Modules $modules */

if(!$modules->isInstalled('BridgeCsp')) {
	$modules->refresh();
	if(!$modules->isInstallable('BridgeCsp')) exit("FAIL BridgeCsp not installable (is app/modules/BridgeCsp present?)\n");
	$modules->install('BridgeCsp');
	echo "ok   BridgeCsp installed now\n";
}
$data = (array) $modules->getConfig('BridgeCsp');
$previous = isset($data['mode']) ? (string) $data['mode'] : 'off';
if($mode === '') exit("mode $previous\n");
$data['mode'] = $mode;
$modules->saveConfig('BridgeCsp', $data);
echo "mode $previous -> $mode\n";

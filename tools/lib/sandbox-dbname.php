<?php namespace ProcessWire;

/**
 * Prints the database name a sandbox's configuration ends up with, without booting ProcessWire
 * (audit SE5). A boot against the wrong database would already rewrite its module caches, so
 * the config is built the way bootstrap/index.php builds it (BridgeBootstrap::buildConfig(),
 * which reads site/config.php) and nothing more runs.
 *
 * tools/sandbox-site.sh compares the answer with the copy it made, and tools/lib/sandbox-guard.php
 * runs this in a child process before a tool boots the sandbox: a config that picks its dbName by
 * host, or from an included file, can name another database than the literal a script rewrote.
 *
 * Usage: php tools/lib/sandbox-dbname.php /path/to/sandbox/root
 *
 * Original work, MIT.
 */

$root = rtrim(str_replace('\\', '/', (string) ($argv[1] ?? '')), '/');
if($root === '' || !is_file("$root/index.php") || !is_file("$root/project.php")) {
	fwrite(STDERR, "Usage: php tools/lib/sandbox-dbname.php /path/to/sandbox/root\n");
	exit(1);
}
// some sites read $_SERVER['DOCUMENT_ROOT'] in config (StaticPages); CLI has none
if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;
$layout = require "$root/project.php";
if(!is_array($layout)) {
	fwrite(STDERR, "project.php must return an array\n");
	exit(1);
}
$layout['root'] = $root;
if(is_file("$root/vendor/autoload.php")) require_once "$root/vendor/autoload.php";
$bridgeDir = isset($layout['bridge']) ? rtrim($layout['bridge'], '/\\') : "$root/vendor/bridge/bootstrap";
if(!class_exists('ProcessWire\\BridgeBootstrap', false)) require_once "$bridgeDir/Bootstrap.php";
ob_start();
try {
	$config = BridgeBootstrap::buildConfig($layout);
} catch(\Throwable $e) {
	ob_end_clean();
	fwrite(STDERR, $e->getMessage() . "\n");
	exit(1);
}
ob_end_clean();
echo $config->dbName, "\n";

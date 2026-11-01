<?php namespace ProcessWire;

/**
 * Bridge index.php
 *
 * Replaces the upstream index.php. Reads the folder layout from project.php next to this
 * file and boots ProcessWire through BridgeBootstrap::buildConfig(). The request-handling
 * part below is the upstream bootstrap sequence and is kept identical on purpose.
 *
 * This file is a modified copy of ProcessWire's index.php (Copyright Ryan Cramer,
 * https://processwire.com, Mozilla Public License 2.0). Modifications: the Config is built
 * from project.php via BridgeBootstrap instead of ProcessWire::buildConfig(); the installer
 * branch is removed. The MPL 2.0 applies to this file; see LICENSE at the repository root.
 *
 * Index version follows upstream so SystemUpdater's check passes: 303 (core 3.0.270 and later
 * build ProcessWire first and boot it second, so a failing boot still has its shutdown handler).
 */

if(!defined("PROCESSWIRE")) define("PROCESSWIRE", 303); // index version

$rootPath = __DIR__;
if(DIRECTORY_SEPARATOR != '/') $rootPath = str_replace(DIRECTORY_SEPARATOR, '/', $rootPath);

$layout = is_file("$rootPath/project.php") ? require("$rootPath/project.php") : null;
if(!is_array($layout)) {
	header("HTTP/1.1 500 Internal Server Error");
	echo "project.php (next to index.php) must return an array";
	exit(1);
}
$layout['root'] = $rootPath;

$composerAutoloader = $rootPath . '/vendor/autoload.php';
if(file_exists($composerAutoloader)) require_once($composerAutoloader);

$bridgeDir = isset($layout['bridge']) ? rtrim($layout['bridge'], '/\\') : "$rootPath/vendor/bridge/bootstrap";
if(!class_exists("ProcessWire\\BridgeBootstrap", false)) require_once("$bridgeDir/Bootstrap.php");

try {
	$config = BridgeBootstrap::buildConfig($layout);
} catch(\RuntimeException $e) {
	// the message names server paths: to the error log, not the page
	error_log($e->getMessage());
	header("HTTP/1.1 500 Internal Server Error");
	echo "Bridge bootstrap: the folder layout in project.php does not match the server (details in the error log)";
	exit(1);
}

if(!$config->dbName && $config->dbType !== 'sqlite') {
	header("HTTP/1.1 404 Page Not Found");
	echo "404 page not found (no site configuration available)";
	exit(0);
}

$process = null;
$wire = null;

try {
	// built, then booted (index 303): a throw while booting still finds $wire->shutdown below. A
	// core before 3.0.270 has no boot() and boots in the constructor as before.
	$wire = new ProcessWire($config, '/', false);
	if(method_exists($wire, 'boot')) $wire->boot($config);
	$process = $wire->modules->get('ProcessPageView'); /** @var ProcessPageView $process */
	$wire->wire('process', $process);
	echo $process->execute($config->internal);
	$config->internal ? $process->finished() : extract($wire->wire('all')->getArray());

} catch(\Throwable $e) {
	$wire ? $wire->trackException($e) : $config->trackException($e);
	if($process && $e instanceof \Exception) $process->finished();
	$shutdown = $wire ? $wire->shutdown : null;
	if($shutdown) $shutdown->setFatalError($e);
}

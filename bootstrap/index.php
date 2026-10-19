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
 * Index version follows upstream so SystemUpdater's check passes: 302.
 */

if(!defined("PROCESSWIRE")) define("PROCESSWIRE", 302); // index version

$rootPath = __DIR__;
if(DIRECTORY_SEPARATOR != '/') $rootPath = str_replace(DIRECTORY_SEPARATOR, '/', $rootPath);

$layout = require("$rootPath/project.php");
if(!is_array($layout)) {
	header("HTTP/1.1 500 Internal Server Error");
	echo "project.php must return an array";
	exit(1);
}
$layout['root'] = $rootPath;

$composerAutoloader = $rootPath . '/vendor/autoload.php';
if(file_exists($composerAutoloader)) require_once($composerAutoloader);

$bridgeDir = isset($layout['bridge']) ? rtrim($layout['bridge'], '/\\') : "$rootPath/vendor/bridge/bootstrap";
if(!class_exists("ProcessWire\\BridgeBootstrap", false)) require_once("$bridgeDir/Bootstrap.php");

$config = BridgeBootstrap::buildConfig($layout);

if(!$config->dbName) {
	header("HTTP/1.1 404 Page Not Found");
	echo "404 page not found (no site configuration available)";
	exit(0);
}

$process = null;
$wire = null;

try {
	$wire = new ProcessWire($config);
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

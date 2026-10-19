<?php namespace ProcessWire;

/**
 * Backwards compatibility: sites whose site/templates/admin.php predates the move of the admin
 * controller into wire/core/ still do `require($config->paths->adminTemplates . "controller.php")`.
 * Upstream themes keep this file for that reason; so does Bridge.
 *
 * FileCompiler=0
 */

if(!defined("PROCESSWIRE")) die();

/** @var Config $config */
require($config->paths->core . "admin.php");

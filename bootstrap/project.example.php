<?php

/**
 * Bridge project layout. Copy to project.php next to index.php and adjust.
 *
 * Every path is absolute. Keys are documented in Bootstrap.php. Anything omitted falls back
 * to the upstream default relative to `site` or `assets`.
 */
return array(

	// where Bridge's Bootstrap.php lives (default: vendor/bridge/bootstrap)
	'bridge' => __DIR__ . '/vendor/bridge/bootstrap',

	// the unmodified upstream core; replaced wholesale on upgrade
	'wire' => __DIR__ . '/vendor/processwire/wire',

	// the site directory (config.php, templates/, modules/, assets/)
	'site' => __DIR__ . '/app',

	// optional: move writable data out of the code tree
	// 'assets' => '/var/data/myproject/assets',
	// 'urls' => array('assets' => '/assets/'), // then alias it in the web server

	// optional: force scheme and host, or set a subdirectory base
	// 'rootURL' => 'https://example.com/',
);

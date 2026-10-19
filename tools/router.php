<?php

/**
 * Router for PHP's built-in web server, standing in for .htaccess on the sandbox.
 *
 *   php -S localhost:8089 -t sandbox/atispro tools/router.php
 *
 * - Static files are served as they are, except PHP files, which always go through the Bridge
 *   index.php so nothing under app/ or vendor/ can be executed directly.
 * - "/wire/..." is aliased to the layout's real wire directory, because upstream admin themes
 *   and some modules build asset URLs as $config->urls->root . "wire/..." instead of
 *   $config->urls->wire. A production web server needs the same alias (Apache `Alias`,
 *   nginx `location /wire/ { alias ...; }`) whenever wire/ is not at the web root.
 * - Everything else is handed to ProcessWire as ?it=<path>, as the upstream .htaccess does.
 *
 * Development only; not a replacement for the real .htaccess rules.
 */

$docRoot = str_replace('\\', '/', rtrim($_SERVER['DOCUMENT_ROOT'], '/\\'));
$path = urldecode((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$file = $docRoot . $path;

$blocked = preg_match('~^/(app|site[^/]*)/(assets/(cache|logs|backups|sessions|config|install|tmp)|install|config)~i', $path)
	|| preg_match('~(^|/)\.~', $path)
	|| preg_match('~\.php$~i', $path);

if(!$blocked && strpos($path, '/wire/') === 0 && !is_file($file)) {
	// alias /wire/ to the layout's wire directory
	$layout = @include($docRoot . '/project.php');
	if(is_array($layout) && !empty($layout['wire'])) {
		$wire = rtrim(str_replace('\\', '/', $layout['wire']), '/');
		$aliased = $wire . substr($path, 5);
		if(is_file($aliased)) {
			$types = array(
				'js' => 'application/javascript', 'css' => 'text/css', 'svg' => 'image/svg+xml',
				'png' => 'image/png', 'jpg' => 'image/jpeg', 'gif' => 'image/gif', 'webp' => 'image/webp',
				'woff' => 'font/woff', 'woff2' => 'font/woff2', 'ttf' => 'font/ttf', 'eot' => 'application/vnd.ms-fontobject',
				'json' => 'application/json', 'map' => 'application/json', 'html' => 'text/html', 'txt' => 'text/plain',
			);
			$ext = strtolower(pathinfo($aliased, PATHINFO_EXTENSION));
			header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
			header('Content-Length: ' . filesize($aliased));
			header('X-Bridge-Alias: wire');
			readfile($aliased);
			return true;
		}
	}
}

if($path !== '/' && !$blocked && is_file($file)) {
	return false; // let the built-in server send the static file
}

$_GET['it'] = $path;
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['PHP_SELF'] = '/index.php';
$_SERVER['SCRIPT_FILENAME'] = $docRoot . '/index.php';

chdir($docRoot);
require $docRoot . '/index.php';

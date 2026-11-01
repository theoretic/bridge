<?php

/**
 * Write the .htaccess for a layout from bootstrap/ (audit PA4, SE7): upstream's htaccess.txt with
 * its protections pointed at the layout's real directories. Upstream's rules name `site/` and
 * `wire/`; a layout keeps them elsewhere (app/, vendor/processwire/wire/) and may move assets,
 * templates, site modules, classes and sessions on their own, so copied unchanged they would leave
 * the assets' cache, logs, sessions and backups, config.php, templates and module sources
 * reachable. The directories come from BridgeBootstrap::resolvePaths(), the same answer the boot
 * uses, and the text from the installation's own htaccess.txt, so it follows the core version.
 *
 * Fails (exit 1, nothing written) when a rule it knows was not found, or when a rule still names
 * site/ or wire/ after the rewrite: upstream changed its rules, check them by hand.
 *
 * Also, ahead of upstream's rules:
 *  - nothing under vendor/ is served by URL except the core's own files (Bridge's bootstrap,
 *    Composer packages, a Bridge checkout's docs and tools live there; upstream's rewrite only
 *    sends missing files to index.php, so an existing PHP file there would run);
 *  - nor the Bridge bootstrap directory when it lies under the web root elsewhere, nor project.php.
 *
 * Usage: php tools/bootstrap-htaccess.php <webroot with project.php> <upstream htaccess.txt> [--dry-run]
 * Writes <webroot>/.htaccess (refuses to overwrite one it did not write; delete it first).
 * --dry-run prints the result instead of writing it.
 */

$root = rtrim(str_replace('\\', '/', (string) realpath($argv[1] ?? '')), '/');
$source = $argv[2] ?? '';
$dry = in_array('--dry-run', $argv, true);
if($root === '' || !is_file("$root/project.php") || !is_file($source)) {
	fwrite(STDERR, "usage: php tools/bootstrap-htaccess.php <webroot with project.php> <upstream htaccess.txt> [--dry-run]\n");
	exit(1);
}
$layout = require "$root/project.php";
if(!is_array($layout)) {
	fwrite(STDERR, "project.php must return an array\n");
	exit(1);
}
$bridgeDir = isset($layout['bridge']) ? rtrim(str_replace('\\', '/', $layout['bridge']), '/') : "$root/vendor/bridge/bootstrap";
if(!is_file("$bridgeDir/Bootstrap.php")) {
	fwrite(STDERR, "no Bootstrap.php in $bridgeDir (the layout's 'bridge' key)\n");
	exit(1);
}
// BridgeBootstrap only, nothing of ProcessWire: resolvePaths() is pure
if(!class_exists('ProcessWire\\BridgeBootstrap', false)) require_once "$bridgeDir/Bootstrap.php";
$dirs = \ProcessWire\BridgeBootstrap::resolvePaths($layout, $root);

// each directory relative to the web root, regex-quoted; one outside it gets a pattern that never
// matches (no URL reaches it, so there is nothing to block)
$never = '(?!)';
$rel = function($path) use($root) {
	$path = rtrim(str_replace('\\', '/', (string) $path), '/');
	$under = DIRECTORY_SEPARATOR === '\\' ? stripos($path . '/', $root . '/') === 0 : strpos($path . '/', $root . '/') === 0;
	return $under ? substr($path, strlen($root) + 1) : '';
};
$q = array();
$plain = array();
foreach($dirs as $key => $path) {
	$r = $rel($path);
	$plain[$key] = $r;
	$q[$key] = $r === '' ? $never : preg_quote($r);
}
if($plain['site'] === '' && $plain['wire'] === '' && $plain['assets'] === '') {
	fwrite(STDERR, "site, wire and assets all lie outside the web root: no rules to point anywhere\n");
	exit(1);
}
list($W, $S, $A, $T, $M, $C, $X) = array($q['wire'], $q['site'], $q['assets'], $q['templates'], $q['siteModules'], $q['classes'], $q['sessions']);

$text = (string) file_get_contents($source);
$marker = '# written by tools/bootstrap-htaccess.php';
if(is_file("$root/.htaccess") && strpos((string) file_get_contents("$root/.htaccess"), $marker) === false && !$dry) {
	fwrite(STDERR, "$root/.htaccess exists and was not written by this tool: delete or move it first\n");
	exit(1);
}

// upstream 3.0.274's directory patterns, most specific first; required ones must match
$map = array(
	array('(site|site-[^/]+)/assets/(cache|logs|backups|sessions|config|database|install|tmp)', "($A)/(cache|logs|backups|sessions|config|database|install|tmp)", true),
	array('(site|site-[^/]+)/install($|', "($S)/install($|", true),
	array('(site|site-[^/]+)/assets.*/-.+/.*', "($A).*/-.+/.*", true),
	array('(wire|site|site-[^/]+)/(config|index\.config|config-dev)', "($W|$S)/(config|index\.config|config-dev)", true),
	array('(wire|site|site-[^/]+)/templates-admin', "($W|$S)/templates-admin", true),
	array('(site|site-[^/]+)/templates($|', "($T)($|", true),
	array('(site|site-[^/]+)/classes($|', "($C)($|", true),
	array('(site|site-[^/]+)/assets($|', "($A)($|", true),
	array('(^|/)wire/(core|modules)/', "(^|/)($W)/(core|modules)/", true),
	array('(site|site-[^/]+)/modules/', "($M)/", true),
	array('(site|site-[^/]+)/(config[^/]*/?|[^/]+\.php.*)$', "($S)/(config[^/]*/?|[^/]+\.php.*)$", true),
	array('(wire/|site[-/])', "($W/|$S/)", true),
	// commented-out options (section 15B, 18): pointed too, when present
	array('(site|site-[^/]+)/assets/files/', "($A)/files/", false),
	array('!(^|/)site/assets/', "!(^|/)($A)/", false),
);
$hits = array_fill(0, count($map), 0);
$lines = explode("\n", $text);
foreach($lines as $i => $line) {
	$t = ltrim($line);
	if(strpos($t, 'RewriteCond') !== 0 && strpos($t, '# RewriteCond') !== 0) continue;
	foreach($map as $n => $entry) {
		if(strpos($line, $entry[0]) === false) continue;
		$line = str_replace($entry[0], $entry[1], $line);
		$hits[$n]++;
	}
	$lines[$i] = $line;
}
$missing = array();
foreach($map as $n => $entry) if($entry[2] && !$hits[$n]) $missing[] = $entry[0];
if(count($missing)) {
	fwrite(STDERR, "upstream htaccess.txt changed: these rules were not found, check them by hand:\n  " . implode("\n  ", $missing) . "\n");
	exit(1);
}
// any active rule still using upstream's site/ or wire/ idioms is one this tool does not know
// (the site-*/install image exception and site-default/ stay as they are: no layout has those)
$idioms = array('(site|site-[^/]+)', '(wire|site', '(^|/)wire/', 'site[-/]', '(^|/)site/');
$left = array();
foreach($lines as $line) {
	if(strpos(ltrim($line), 'RewriteCond') !== 0) continue;
	foreach($idioms as $idiom) {
		if(strpos($line, $idiom) !== false) { $left[] = trim($line); break; }
	}
}
if(count($left)) {
	fwrite(STDERR, "upstream htaccess.txt has rules this tool does not point at the layout:\n  " . implode("\n  ", $left) . "\n");
	exit(1);
}
$text = implode("\n", $lines);

// sessions moved out of assets/: their own rule, next to the assets directories rule
if($plain['sessions'] !== '' && $plain['sessions'] !== ($plain['assets'] === '' ? '' : $plain['assets'] . '/sessions')) {
	$text = str_replace("  # Block access to the /site/install/ directories\n",
		"  # Block access to the sessions directory (Bridge layout)\n  RewriteCond %{REQUEST_URI} (^|/)($X)($|/) [NC,OR]\n\n  # Block access to the /site/install/ directories\n", $text, $n);
	if(!$n) {
		fwrite(STDERR, "upstream htaccess.txt changed: no place for the sessions rule\n");
		exit(1);
	}
}

// ahead of upstream's chain: vendor/, the bootstrap directory, project.php (RewriteRule patterns
// in .htaccess are relative to this directory, so a subdirectory install works too)
$block = "  # Bridge layout: nothing under vendor/ is served by URL except the core's own files, nor the\n" .
	"  # bootstrap directory or project.php (tools/bootstrap-htaccess.php)\n";
$wireUnderVendor = strpos($plain['wire'] . '/', 'vendor/') === 0;
$block .= "  RewriteRule ^" . ($wireUnderVendor ? "(?!$W/)" : '') . "vendor/ - [F,L]\n";
$boot = $rel($bridgeDir);
if($boot !== '' && strpos($boot . '/', 'vendor/') !== 0) $block .= "  RewriteRule ^" . preg_quote($boot) . "/ - [F,L]\n";
$block .= "  RewriteRule ^project\.php$ - [F,L]\n\n";
$anchor = '  # Prevent all the following rules from blocking images in site install directories';
if(strpos($text, $anchor) === false) {
	fwrite(STDERR, "upstream htaccess.txt changed: no '$anchor' line; check the rules by hand\n");
	exit(1);
}
$text = str_replace($anchor, $block . $anchor, $text);
$summary = "site: {$plain['site']}, wire: {$plain['wire']}, assets: {$plain['assets']}, templates: {$plain['templates']}, " .
	"siteModules: {$plain['siteModules']}, classes: {$plain['classes']}, sessions: {$plain['sessions']}";
$text = "$marker from " . basename($source) . " ($summary; outside the web root: none needed); do not edit, run it again\n\n" . $text;

$count = array_sum($hits);
if($dry) {
	echo $text;
	fwrite(STDERR, "$count rules pointed at the layout ($summary); dry run, nothing written\n");
	exit(0);
}
file_put_contents("$root/.htaccess", $text);
echo "$count rules pointed at the layout ($summary); wrote $root/.htaccess\n";

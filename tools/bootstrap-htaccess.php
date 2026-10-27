<?php

/**
 * Write the .htaccess for a layout from bootstrap/ (audit PA4): upstream's htaccess.txt with its
 * protections pointed at the layout's real directories. Upstream's rules name `site/` and `wire/`;
 * a layout keeps them elsewhere (app/, vendor/processwire/wire/), so copied unchanged they would
 * leave site/assets/{logs,sessions,backups,cache}, config.php, templates and module sources
 * reachable. Built from the installation's own htaccess.txt, so it follows the core version.
 *
 * Also blocks PHP files under vendor/ (Bridge's bootstrap and anything else installed there):
 * upstream's rewrite only sends missing files to index.php, so an existing PHP file would run.
 *
 * Usage: php tools/bootstrap-htaccess.php <webroot with project.php> <upstream htaccess.txt> [--dry-run]
 * Writes <webroot>/.htaccess (refuses to overwrite one it did not write; delete it first).
 */

$root = rtrim(str_replace('\\', '/', (string) realpath($argv[1] ?? '')), '/');
$source = $argv[2] ?? '';
$dry = in_array('--dry-run', $argv, true);
if(!is_file("$root/project.php") || !is_file($source)) {
	fwrite(STDERR, "usage: php tools/bootstrap-htaccess.php <webroot with project.php> <upstream htaccess.txt> [--dry-run]\n");
	exit(1);
}
$layout = require "$root/project.php";
$rel = function($path) use($root) {
	$path = rtrim(str_replace('\\', '/', (string) $path), '/');
	if($path === '' || stripos($path . '/', $root . '/') !== 0) return '';
	return substr($path, strlen($root) + 1);
};
$site = $rel($layout['site'] ?? '');
$wire = $rel($layout['wire'] ?? '');
if($site === '' || $wire === '') {
	fwrite(STDERR, "site and wire must lie under the web root for this tool (site: '$site', wire: '$wire'); a directory outside it needs no rules\n");
	exit(1);
}
$s = preg_quote($site, '~');
$w = preg_quote($wire, '~');
$text = (string) file_get_contents($source);
$marker = '# written by tools/bootstrap-htaccess.php';
if(is_file("$root/.htaccess") && strpos((string) file_get_contents("$root/.htaccess"), $marker) === false && !$dry) {
	fwrite(STDERR, "$root/.htaccess exists and was not written by this tool: delete or move it first\n");
	exit(1);
}

// the directory alternations of upstream's RewriteCond lines, longest first
$map = array(
	'(wire|site|site-[^/]+)' => "($w|$s)",
	'(site|site-[^/]+)' => "($s)",
	'(wire/|site[-/])' => "($w/|$s/)",
	'(^|/)wire/(core|modules)' => "(^|/)$w/(core|modules)",
	'!(^|/)site/assets/' => "!(^|/)$s/assets/",
);
$count = 0;
$lines = explode("\n", $text);
foreach($lines as $i => $line) {
	if(strpos(ltrim($line), 'RewriteCond') !== 0 && strpos(ltrim($line), '# RewriteCond') !== 0) continue;
	$new = str_replace(array_keys($map), array_values($map), $line);
	if($new !== $line) { $lines[$i] = $new; $count++; }
}
$text = implode("\n", $lines);
// PHP under vendor/ never runs by URL: before upstream's first block condition
$vendor = "  # Block access to PHP files under vendor/ (Bridge layout)\n  RewriteCond %{REQUEST_URI} (^|/)vendor/.*\\.(php|inc|module)($|/) [NC,OR]\n\n";
$anchor = '  # Block access to any htaccess files';
if(strpos($text, $anchor) === false) {
	fwrite(STDERR, "upstream htaccess.txt changed: no '$anchor' line; check the rules by hand\n");
	exit(1);
}
$text = str_replace($anchor, $vendor . $anchor, $text);
$text = "$marker from " . basename($source) . " (site: $site, wire: $wire); do not edit, run it again\n\n" . $text;

if($dry) {
	echo "$count rules pointed at $site/ and $wire/; would write $root/.htaccess\n";
	exit(0);
}
file_put_contents("$root/.htaccess", $text);
echo "$count rules pointed at $site/ and $wire/; wrote $root/.htaccess\n";

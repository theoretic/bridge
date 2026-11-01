<?php

/**
 * The guard every tool that writes to a sandbox loads (audit SE5): the root is a sandbox/
 * directory, its configuration names a sandbox copy of a database (`<name>_bridge`, made by
 * tools/sandbox-site.sh) before anything boots, and once booted, ProcessWire runs from that root
 * on that copy. A path check alone let a sandbox whose config still named the site's own
 * database (a second `dbName` line, an included config file) drop caches and create superusers
 * there.
 *
 * Usage, in a tool:
 *
 *   require __DIR__ . '/lib/sandbox-guard.php';
 *   $root = bridgeSandboxRoot($argv[1] ?? '');   // exits 2 when it is no sandbox
 *   include "$root/index.php";
 *   bridgeSandboxBooted($config, $root);         // exits 2 before anything is written
 *
 * Global functions (no namespace): callers in `namespace ProcessWire` reach them by fallback.
 *
 * Original work, MIT.
 */

/**
 * A path normalised for comparison: forward slashes, no trailing slash, lower case on Windows
 *
 * @param string $path
 * @return string
 *
 */
function bridgeSandboxNorm($path) {
	$path = rtrim(str_replace('\\', '/', (string) $path), '/');
	return DIRECTORY_SEPARATOR === '\\' ? strtolower($path) : $path;
}

/**
 * Is this a sandbox database name? (`<name>_bridge`)
 *
 * @param string $db
 * @return bool
 *
 */
function bridgeSandboxDbName($db) {
	return (bool) preg_match('/^[A-Za-z0-9_$-]+_bridge$/', (string) $db);
}

/**
 * Why a directory is not a sandbox, or '' when it is: index.php and project.php present, its real
 * path under a directory named sandbox/, and its configuration naming a `*_bridge` database
 * (read by tools/lib/sandbox-dbname.php in a child process, without booting)
 *
 * @param string $root
 * @return string
 *
 */
function bridgeSandboxRootProblem($root) {
	if($root === '' || !is_file("$root/index.php") || !is_file("$root/project.php")) return "'$root' has no index.php and project.php";
	$real = realpath($root);
	if($real === false || strpos(bridgeSandboxNorm($real) . '/', '/sandbox/') === false) return "'$root' is not under a sandbox/ directory";
	$out = array();
	$proc = proc_open(array(PHP_BINARY, __DIR__ . '/sandbox-dbname.php', $root), array(1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes);
	if(!is_resource($proc)) return 'could not read the database name';
	$db = trim((string) stream_get_contents($pipes[1]));
	$err = trim((string) stream_get_contents($pipes[2]));
	fclose($pipes[1]);
	fclose($pipes[2]);
	if(proc_close($proc) !== 0) return "its configuration did not load ($err)";
	if(!bridgeSandboxDbName($db)) return "its configuration names the database '$db', not a sandbox copy (<name>_bridge)";
	return '';
}

/**
 * The sandbox root from a tool's argument; stops the tool (exit 2) when it is not one
 *
 * @param string $arg
 * @return string Root with forward slashes, no trailing slash
 *
 */
function bridgeSandboxRoot($arg) {
	$root = rtrim(str_replace('\\', '/', (string) $arg), '/');
	$problem = bridgeSandboxRootProblem($root);
	if($problem === '') return $root;
	fwrite(STDERR, "refused, nothing written: $problem\n");
	exit(2);
}

/**
 * Why a booted install is not this sandbox, or '' when it is
 *
 * @param object $config The booted $config (dbName, paths->root)
 * @param string $root From bridgeSandboxRoot()
 * @return string
 *
 */
function bridgeSandboxProblem($config, $root) {
	$db = (string) $config->dbName;
	if(!bridgeSandboxDbName($db)) return "database '$db' is not a sandbox copy (<name>_bridge)";
	$booted = realpath((string) $config->paths->root);
	$wanted = realpath((string) $root);
	if($booted === false || $wanted === false || bridgeSandboxNorm($booted) !== bridgeSandboxNorm($wanted)) {
		return "booted root '" . $config->paths->root . "' is not the sandbox '$root'";
	}
	return '';
}

/**
 * Stop the tool (exit 2) unless the booted install is the sandbox on its own database copy
 *
 * @param object $config
 * @param string $root
 *
 */
function bridgeSandboxBooted($config, $root) {
	$problem = bridgeSandboxProblem($config, $root);
	if($problem === '') return;
	fwrite(STDERR, "refused, nothing written: $problem\n");
	exit(2);
}

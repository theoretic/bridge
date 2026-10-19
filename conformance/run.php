<?php namespace ProcessWire;

/**
 * Conformance runner: the same admin screens under AdminThemeUikit and under AdminThemeBridge
 * must expose the same contract to modules. For every screen in screens.txt it logs in as the
 * two sandbox users (uikit, bridge; tools/sandbox-admin.php creates them), fetches the page
 * over HTTP from the running sandbox server, extracts a digest of the module-facing content
 * (Inputfields, form controls, links, buttons, tables, registered module scripts and styles,
 * notices) and compares the two. Theme-specific tokens (uk-*, data-bridge-*, version query
 * strings, CSRF tokens) are normalised away before comparison.
 *
 * Usage:
 *   php conformance/run.php /path/to/sandbox/root [--base=http://localhost:8089] [--only=substr] [--json=out.json]
 *
 * Exit code: 0 when every screen matches, 1 when any screen differs or fails (HTTP error, PHP
 * error text, NoticeError). The report goes to stdout; --json writes the digests for inspection.
 */

$root = '';
$base = 'http://localhost:8089';
$only = '';
$jsonOut = '';
foreach(array_slice($argv, 1) as $arg) {
	if(strpos($arg, '--base=') === 0) $base = rtrim(substr($arg, 7), '/');
	else if(strpos($arg, '--only=') === 0) $only = substr($arg, 7);
	else if(strpos($arg, '--json=') === 0) $jsonOut = substr($arg, 7);
	else $root = rtrim(str_replace('\\', '/', $arg), '/');
}
if(!$root || !is_file("$root/index.php") || !is_file("$root/project.php")) {
	exit("Usage: php conformance/run.php /path/to/sandbox/root [--base=http://localhost:8089] [--only=substr] [--json=file]\n");
}

$credFile = "$root/.credentials";
if(!is_file($credFile)) exit("No $credFile; run tools/sandbox-admin.php first\n");
$creds = array();
foreach(file($credFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
	if(strpos($line, '#') === 0) continue;
	list($name, $pass) = array_pad(explode(':', $line, 2), 2, '');
	if($name && $pass) $creds[$name] = $pass;
}
foreach(array('uikit', 'bridge') as $name) {
	if(empty($creds[$name])) exit("User $name missing in $credFile\n");
}

// ---------------------------------------------------------------------------------------------
// bootstrap the sandbox (CLI, external mode) to resolve screen placeholders
// ---------------------------------------------------------------------------------------------

ob_start();
// some sites read $_SERVER['DOCUMENT_ROOT'] in config (StaticPages); CLI has none
if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;
include "$root/index.php";
ob_end_clean();
/** @var ProcessWire $wire */
/** @var Config $config */
/** @var Pages $pages */
/** @var Templates $templates */
/** @var Fields $fields */
/** @var Modules $modules */

$adminUrl = $config->urls->admin;

function onePagePerTemplate(Templates $templates, Pages $pages) {
	$ids = array();
	foreach($templates as $t) {
		if($t->flags & Template::flagSystem) continue;
		$p = $pages->get("template=$t, include=all, sort=id");
		if($p->id) $ids[$t->name] = $p->id;
	}
	return $ids;
}

function oneFieldPerFieldtype(Fields $fields) {
	$ids = array();
	foreach($fields as $f) {
		if($f->flags & Field::flagSystem) continue;
		$type = $f->type ? $f->type->className() : 'none';
		if(!isset($ids[$type])) $ids[$type] = $f->id;
	}
	return $ids;
}

function templateIds(Templates $templates) {
	$ids = array();
	foreach($templates as $t) {
		if($t->flags & Template::flagSystem) continue;
		$ids[$t->name] = $t->id;
	}
	return $ids;
}

/**
 * Every admin page that runs a Process (Setup > X, module-provided screens such as Tracy,
 * RockMigrations, WireWall, AgentTools), by URL relative to root
 */
function adminProcessPages(Pages $pages, Config $config) {
	$urls = array();
	$admin = $pages->get($config->adminRootPageID);
	foreach($pages->find("has_parent=$admin, template=admin, include=all, sort=id") as $p) {
		if(!$p->process) continue;
		$name = (string) $p->process;
		if(in_array($name, array('ProcessPageEdit', 'ProcessPageAdd', 'ProcessPageClone', 'ProcessPageSort', 'ProcessPageEditImageSelect', 'ProcessPageEditLink', 'ProcessLogin', 'ProcessForgotPassword'))) continue; // need parameters or are covered elsewhere
		if(strpos($p->path, '/trash/') !== false) continue;
		$urls[] = $p->url;
	}
	return array_values(array_unique($urls));
}

function configurableModules(Modules $modules, $limit = 40) {
	$names = array();
	foreach($modules as $module) {
		$name = $module->className();
		if(strpos($name, 'AdminTheme') === 0) continue;
		if(!$modules->isInstalled($name)) continue;
		if(!$modules->isConfigurable($name)) continue;
		$names[] = $name;
		if(count($names) >= $limit) break;
	}
	return $names;
}

$placeholders = array(
	'{one-page-per-template}' => array_values(onePagePerTemplate($templates, $pages)),
	'{one-field-per-fieldtype}' => array_values(oneFieldPerFieldtype($fields)),
	'{one-per-template}' => array_values(templateIds($templates)),
	'{one-per-installed-module-with-config}' => configurableModules($modules),
	'{admin-process-pages}' => adminProcessPages($pages, $config),
);

$screens = array();
foreach(file(__DIR__ . '/screens.txt', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
	$line = trim($line);
	if($line === '' || strpos($line, '#') === 0) continue;
	$line = str_replace('{admin}', $adminUrl, $line);
	$expanded = array($line);
	foreach($placeholders as $key => $values) {
		if(strpos($line, $key) === false) continue;
		$expanded = array();
		foreach($values as $v) $expanded[] = str_replace($key, $v, $line);
	}
	foreach($expanded as $url) $screens[] = $url;
}
// extra contract endpoints: page list JSON, page edit modal
$screens[] = $adminUrl . 'page/list/?id=1&render=JSON';
$screens[] = $adminUrl . 'page/edit/?id=1&modal=1';
$screens = array_values(array_unique($screens));
if($only !== '') $screens = array_values(array_filter($screens, function($s) use($only) { return strpos($s, $only) !== false; }));

// ---------------------------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------------------------

class ConformanceClient {
	public $base;
	public $cookies;
	public function __construct($base) {
		$this->base = $base;
		$this->cookies = tempnam(sys_get_temp_dir(), 'bridge-conf-');
	}
	public function __destruct() {
		if(is_file($this->cookies)) @unlink($this->cookies);
	}
	public function request($url, array $post = null) {
		$ch = curl_init($this->base . $url);
		$headers = array('Accept: text/html,application/json');
		// JSON endpoints are what modules call over AJAX; ask the way they do
		if(strpos($url, 'render=JSON') !== false) $headers[] = 'X-Requested-With: XMLHttpRequest';
		curl_setopt_array($ch, array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_FOLLOWLOCATION => true,
			CURLOPT_MAXREDIRS => 5,
			CURLOPT_COOKIEJAR => $this->cookies,
			CURLOPT_COOKIEFILE => $this->cookies,
			CURLOPT_TIMEOUT => 60,
			CURLOPT_HTTPHEADER => $headers,
		));
		if($post !== null) {
			curl_setopt($ch, CURLOPT_POST, true);
			curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post));
		}
		$body = curl_exec($ch);
		$status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
		$final = (string) curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
		curl_close($ch);
		return array('status' => $status, 'body' => (string) $body, 'url' => $final);
	}
	public function login($adminUrl, $name, $pass) {
		$r = $this->request($adminUrl);
		if($r['status'] !== 200) return "login page HTTP $r[status]";
		$post = array();
		if(preg_match_all('~<input[^>]+type=.?hidden[^>]*>~i', $r['body'], $m)) {
			foreach($m[0] as $tag) {
				if(!preg_match('~name=["\']?([^"\'\s>]+)~', $tag, $n)) continue;
				// attributes may be unquoted (value=0 type="hidden") or quoted (value='…')
				if(preg_match('~value=(["\'])(.*?)\1~', $tag, $vv)) $v = html_entity_decode($vv[2], ENT_QUOTES);
				else if(preg_match('~value=([^"\'\s>]+)~', $tag, $vv)) $v = html_entity_decode($vv[1], ENT_QUOTES);
				else $v = '';
				$post[$n[1]] = $v;
			}
		}
		$post['login_name'] = $name;
		$post['login_pass'] = $pass;
		$post['login_submit'] = 'Login';
		$r = $this->request($adminUrl, $post);
		if(strpos($r['body'], 'ProcessLoginForm') !== false) {
			$why = '';
			if(preg_match('~<li class=.NoticeError[^>]*>(.*?)</li>~s', $r['body'], $m)) $why = trim(preg_replace('/\s+/', ' ', strip_tags($m[1])));
			return "login rejected for $name (HTTP $r[status], $r[url])" . ($why !== '' ? ": $why" : '');
		}
		return '';
	}
}

// ---------------------------------------------------------------------------------------------
// digest
// ---------------------------------------------------------------------------------------------

function normalizeUrl($url) {
	$url = preg_replace('~[?&](v|tm\w*)=[^&#]*~', '', $url);
	$url = preg_replace('~\?tm\w+~', '', $url);
	$url = preg_replace('~[?&]modal=1~', '', $url);
	$url = preg_replace('~[?&]_post_token=[^&#]*~', '', $url);
	return rtrim($url, '?&');
}

function isThemeAsset($url) {
	return (bool) preg_match('~/AdminTheme[A-Za-z]*/|/modules/Jquery/|templates-admin/|/uikit/~', $url);
}

/**
 * Names of fields and controls a theme adds for itself (Uikit: per-field theme settings and
 * their example fields). Not part of the module-facing contract.
 */
function isThemeOwnField($name) {
	return (bool) preg_match('/^(wrap_)?(Inputfield_)?(_adminTheme\w*|theme[A-Z]\w*)$/', $name);
}

function classList($el) {
	$out = array();
	foreach(preg_split('/\s+/', trim((string) $el->getAttribute('class'))) as $c) {
		if($c === '') continue;
		if(strpos($c, 'uk-') === 0) continue; // Uikit
		if(strpos($c, 'AdminTheme') === 0) continue;
		if(preg_match('/^(InputfieldNoBorder|InputfieldHideBorder|InputfieldIs[A-Z]\w*|InputfieldStateToggle|InputfieldColumnWidthFirstTmp)$/', $c)) continue; // theme presentation (Uikit's border setting, InputfieldIsOffset, IsPrimary, IsCard, IsColor, ...)
		if(strpos($c, 'ui-widget') === 0 || strpos($c, 'ui-state-') === 0) continue; // upstream jQuery UI classes that Uikit strips
		if($c === 'Inputfield_') continue; // nameless field: upstream's default item class strips it, Uikit's item template leaves it
		$out[] = $c;
	}
	sort($out);
	return $out;
}

function digest($status, $html, $url) {
	$d = array('status' => $status, 'error' => '', 'fields' => array(), 'controls' => array(), 'links' => array(), 'buttons' => array(), 'tables' => array(), 'scripts' => array(), 'styles' => array(), 'notices' => array(), 'title' => '');
	if(strpos($url, 'render=JSON') !== false) {
		$json = json_decode($html, true);
		if($json === null) {
			// not JSON under this theme: keep a whitespace-normalised excerpt so the two themes
			// can still be compared, and flag it
			$d['error'] = 'not JSON';
			$d['json'] = 'NOT JSON: ' . substr(preg_replace('/\s+/', ' ', strip_tags($html)), 0, 300);
		} else {
			$d['json'] = $json;
		}
		return $d;
	}
	if(preg_match('~(Fatal error|Uncaught [A-Za-z\\\\]*(Error|Exception)|Internal Server Error)~', $html, $m)) $d['error'] = $m[1];
	libxml_use_internal_errors(true);
	$doc = new \DOMDocument();
	$doc->loadHTML('<?xml encoding="utf-8" ?>' . $html);
	libxml_clear_errors();
	$xp = new \DOMXPath($doc);

	foreach($xp->query('//script[@src]') as $s) {
		$src = normalizeUrl($s->getAttribute('src'));
		if(isThemeAsset($src)) continue;
		$d['scripts'][] = $src;
	}
	// Bridge in auto mode hands the legacy stack to the client instead of printing it on a native
	// page (ProcessWire.config.AdminThemeBridge.legacyScripts); those scripts are available on
	// demand, so they count as registered for the comparison
	if(preg_match('~"legacyScripts":(\[[^\]]*\])~', $html, $m)) {
		$deferred = json_decode($m[1], true);
		if(is_array($deferred)) foreach($deferred as $src) {
			$src = normalizeUrl((string) $src);
			if(isThemeAsset($src)) continue;
			$d['scripts'][] = $src;
		}
	}
	foreach($xp->query('//link[@rel="stylesheet"][@href]') as $s) {
		$href = normalizeUrl($s->getAttribute('href'));
		if(isThemeAsset($href)) continue;
		$d['styles'][] = $href;
	}
	sort($d['scripts']);
	sort($d['styles']);

	$titleNode = $xp->query('//*[@id="pw-content-title"]')->item(0);
	$d['title'] = $titleNode ? trim(preg_replace('/\s+/', ' ', $titleNode->textContent)) : '';
	$isProfile = strpos($url, '/profile/') !== false; // the two users differ by name and id there
	if($isProfile) $d['title'] = preg_replace('/:.*$/', ':', $d['title']);

	foreach($xp->query('//*[@id="notices"]//li') as $li) {
		$cls = classList($li);
		$text = trim(preg_replace('/\s+/', ' ', $li->textContent));
		$type = in_array('NoticeError', $cls) ? 'error' : (in_array('NoticeWarning', $cls) ? 'warning' : 'message');
		if($type === 'message') continue; // messages are session/time dependent
		$d['notices'][] = "$type: $text";
	}

	$content = $xp->query('//*[@id="pw-content-body"]')->item(0);
	if(!$content) $content = $xp->query('//*[@id="content"]')->item(0);
	if(!$content) {
		$d['error'] = $d['error'] ?: 'no #pw-content-body';
		return $d;
	}

	foreach($xp->query('.//*[contains(concat(" ", normalize-space(@class), " "), " Inputfield ")]', $content) as $li) {
		$style = (string) $li->getAttribute('style');
		$width = preg_match('/width:\s*(\d+)%/', $style, $w) ? (int) $w[1] : 0;
		$id = (string) $li->getAttribute('id');
		if(isThemeOwnField($id)) continue;
		// anonymous Inputfields get counter ids (InputfieldMarkup73); the counter shifts with every
		// theme-added field, so compare them by position within their kind instead of by number
		if(preg_match('/^(Inputfield[A-Za-z]+)\d+$/', $id, $m)) $id = $m[1] . '#' . count(array_filter($d['fields'], function($f) use($m) { return strpos($f['id'], $m[1] . '#') === 0; }));
		$d['fields'][] = array(
			'id' => $id,
			'classes' => classList($li),
			'showIf' => (string) $li->getAttribute('data-show-if'),
			'requiredIf' => (string) $li->getAttribute('data-required-if'),
			'width' => $width,
		);
	}
	foreach($xp->query('.//input|.//select|.//textarea', $content) as $c) {
		$name = (string) $c->getAttribute('name');
		if($name === '' || preg_match('/^TOKEN\d+/', $name) || $name === '_InputfieldForm') continue;
		if(isThemeOwnField($name)) continue;
		if($isProfile && ($name === 'id' || $name === '_user_name')) continue;
		$type = $c->tagName === 'input' ? (string) ($c->getAttribute('type') ?: 'text') : $c->tagName;
		$value = $type === 'hidden' && preg_match('/token|nonce/i', $name) ? '' : (string) $c->getAttribute('value');
		if(preg_match('~^https?://|^/~', $value)) $value = normalizeUrl($value);
		if(strlen($value) > 200) $value = substr($value, 0, 200);
		$entry = array('name' => $name, 'type' => $type, 'value' => $value);
		if($c->tagName === 'select') $entry['options'] = $xp->query('.//option', $c)->length;
		$d['controls'][] = $entry;
	}
	foreach($xp->query('.//a[@href]', $content) as $a) {
		$href = normalizeUrl((string) $a->getAttribute('href'));
		if($href === '' || $href === '#') continue;
		$d['links'][] = $href;
	}
	$d['links'] = array_values(array_unique($d['links']));
	sort($d['links']);
	foreach($xp->query('.//button', $content) as $b) {
		$d['buttons'][] = trim((string) $b->getAttribute('name') . '|' . (string) $b->getAttribute('value'));
	}
	sort($d['buttons']);
	foreach($xp->query('.//table', $content) as $t) {
		$d['tables'][] = $xp->query('.//tr', $t)->length;
	}
	return $d;
}

function diffDigest(array $a, array $b) {
	$diff = array();
	foreach(array('status', 'error', 'title') as $k) {
		if(($a[$k] ?? null) !== ($b[$k] ?? null)) $diff[] = "$k: uikit=" . json_encode($a[$k] ?? null) . " bridge=" . json_encode($b[$k] ?? null);
	}
	if(isset($a['json']) || isset($b['json'])) {
		if(json_encode($a['json'] ?? null) !== json_encode($b['json'] ?? null)) $diff[] = 'json differs';
		return $diff;
	}
	// styles are informational: a theme may ask modules for their stylesheets (loadStyles) or not
	foreach(array('scripts', 'links', 'buttons', 'notices') as $k) {
		$onlyA = array_values(array_diff($a[$k], $b[$k]));
		$onlyB = array_values(array_diff($b[$k], $a[$k]));
		if($onlyA) $diff[] = "$k only in uikit: " . implode(', ', $onlyA);
		if($onlyB) $diff[] = "$k only in bridge: " . implode(', ', $onlyB);
	}
	$fa = array(); foreach($a['fields'] as $f) $fa[$f['id'] ?: spl_object_hash((object) $f)] = $f;
	$fb = array(); foreach($b['fields'] as $f) $fb[$f['id'] ?: spl_object_hash((object) $f)] = $f;
	foreach(array_diff_key($fa, $fb) as $id => $f) $diff[] = "field only in uikit: $id";
	foreach(array_diff_key($fb, $fa) as $id => $f) $diff[] = "field only in bridge: $id";
	foreach(array_intersect_key($fa, $fb) as $id => $f) {
		foreach(array('classes', 'showIf', 'requiredIf') as $k) {
			if(json_encode($f[$k]) !== json_encode($fb[$id][$k])) $diff[] = "field $id $k: uikit=" . json_encode($f[$k]) . " bridge=" . json_encode($fb[$id][$k]);
		}
		// column spacing is a theme setting (Uikit 0%, default 1%), so widths may differ by a few points
		if(abs($f['width'] - $fb[$id]['width']) > 3) $diff[] = "field $id width: uikit=$f[width] bridge={$fb[$id]['width']}";
	}
	$ca = array(); foreach($a['controls'] as $c) $ca[] = json_encode($c);
	$cb = array(); foreach($b['controls'] as $c) $cb[] = json_encode($c);
	foreach(array_diff($ca, $cb) as $c) $diff[] = "control only in uikit: $c";
	foreach(array_diff($cb, $ca) as $c) $diff[] = "control only in bridge: $c";
	if(json_encode($a['tables']) !== json_encode($b['tables'])) $diff[] = 'tables: uikit=' . json_encode($a['tables']) . ' bridge=' . json_encode($b['tables']);
	return $diff;
}

// ---------------------------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------------------------

$clients = array();
foreach(array('uikit', 'bridge') as $name) {
	$c = new ConformanceClient($base);
	$err = $c->login($adminUrl, $name, $creds[$name]);
	if($err) exit("FAIL $err\n");
	$clients[$name] = $c;
}
echo "logged in as uikit and bridge at $base$adminUrl; " . count($screens) . " screens\n\n";

$results = array();
$fails = 0;
$siteFails = 0;
$diffs = 0;
foreach($screens as $url) {
	$row = array();
	foreach($clients as $name => $client) {
		$r = $client->request($url);
		$row[$name] = digest($r['status'], $r['body'], $url);
		$row[$name]['finalUrl'] = $r['url'];
	}
	$diff = diffDigest($row['uikit'], $row['bridge']);
	$failed = false;
	$problems = array();
	foreach($row as $name => $d) {
		$p = array();
		if($d['status'] !== 200) $p[] = "HTTP $d[status]";
		if($d['error'] !== '') $p[] = $d['error'];
		foreach($d['notices'] as $n) if(strpos($n, 'error:') === 0) $p[] = $n;
		if($p) $failed = true;
		$problems[$name] = $p;
	}
	// the same failure under both themes is the site's (or the sandbox's), not the theme's; error
	// texts may embed theme paths (e.g. TemplateFile's list of allowed paths), compare without them
	$strip = function(array $list) {
		return json_encode(array_map(function($s) { return preg_replace('/\s*Paths: .*$/s', '', $s); }, $list));
	};
	$site = $failed && $strip($problems['uikit']) === $strip($problems['bridge']);
	if($site) $siteFails++;
	else if($failed) $fails++;
	else if($diff) $diffs++;
	$mark = $site ? 'SITE' : ($failed ? 'FAIL' : ($diff ? 'DIFF' : 'ok  '));
	echo "$mark $url\n";
	if($failed) {
		foreach($row as $name => $d) {
			if($d['status'] !== 200) echo "       $name: HTTP $d[status] ($d[finalUrl])\n";
			if($d['error'] !== '') echo "       $name: $d[error]\n";
			foreach($d['notices'] as $n) echo "       $name: $n\n";
		}
	}
	foreach($diff as $line) echo "       $line\n";
	$results[$url] = array('uikit' => $row['uikit'], 'bridge' => $row['bridge'], 'diff' => $diff, 'failed' => $failed);
}

$total = count($screens);
echo "\n$total screens: " . ($total - $fails - $diffs - $siteFails) . " identical, $diffs differ, $fails failed, $siteFails fail identically under both themes (site)\n";
if($jsonOut) {
	file_put_contents($jsonOut, json_encode($results, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
	echo "digests written to $jsonOut\n";
}
exit(($fails || $diffs) ? 1 : 0);

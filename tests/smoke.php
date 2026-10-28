<?php namespace ProcessWire;

/**
 * Smoke test for the Bridge bootstrap: boots a sandbox install whose wire/ and site/ live at
 * non-default locations and checks that the core sees the layout correctly.
 *
 * Usage: php tests/smoke.php /path/to/sandbox/root
 * The sandbox is produced by tools/sandbox-site.sh (own DB copy, own site copy).
 * Read-only for the database apart from what a normal boot writes (module cache refresh).
 */

$root = rtrim(str_replace('\\', '/', $argv[1] ?? (getenv('BRIDGE_SANDBOX') ?: '')), '/');
if(!is_file("$root/index.php") || !is_file("$root/project.php")) {
	exit("Usage: php tests/smoke.php /path/to/sandbox/root (needs index.php + project.php)\n");
}

$fails = 0;
function check($label, $ok, $detail = '') {
	global $fails;
	if(!$ok) $fails++;
	echo ($ok ? 'ok   ' : 'FAIL ') . $label . ($detail !== '' && !$ok ? "  [$detail]" : '') . "\n";
}
function warn($label, $detail = '') {
	echo "warn $label" . ($detail !== '' ? "  [$detail]" : '') . "\n";
}

// as a web request has it (site modules such as StaticPages read it at boot)
if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;

$layout = require "$root/project.php";
$expectWire = rtrim(str_replace('\\', '/', $layout['wire']), '/') . '/';
$expectSite = rtrim(str_replace('\\', '/', $layout['site']), '/') . '/';

include "$root/index.php";
/** @var ProcessWire $wire */
/** @var Config $config */
/** @var Modules $modules */
/** @var Pages $pages */
/** @var Templates $templates */

check('booted: $wire is a ProcessWire instance', isset($wire) && $wire instanceof ProcessWire);
check('index version seen by core is 302', PROCESSWIRE === 302);

// paths
check('paths->root is the sandbox root', $config->paths->root === "$root/", $config->paths->root);
check('paths->wire is the layout wire dir', $config->paths->wire === $expectWire, $config->paths->wire);
check('paths->core under wire', $config->paths->core === $expectWire . 'core/', $config->paths->core);
check('paths->modules under wire', $config->paths->modules === $expectWire . 'modules/', $config->paths->modules);
check('paths->site is the layout site dir', $config->paths->site === $expectSite, $config->paths->site);
check('paths->templates under site', $config->paths->templates === $expectSite . 'templates/', $config->paths->templates);
check('paths->siteModules under site', $config->paths->siteModules === $expectSite . 'modules/', $config->paths->siteModules);
check('paths->assets under site', $config->paths->assets === $expectSite . 'assets/', $config->paths->assets);
check('paths->cache under assets', $config->paths->cache === $expectSite . 'assets/cache/', $config->paths->cache);
check('paths->sessions under assets', $config->paths->sessions === $expectSite . 'assets/sessions/', $config->paths->sessions);
check('paths->classes under site', $config->paths->classes === $expectSite . 'classes/', $config->paths->classes);
check('paths->adminTemplates under wire', $config->paths->adminTemplates === $expectWire . 'templates-admin/', $config->paths->adminTemplates);
check('no path warnings (everything under root)', empty($config->bridgeLayoutWarnings), json_encode($config->bridgeLayoutWarnings));

// urls
check('urls->root is /', $config->urls->root === '/', $config->urls->root);
check('urls->wire relative to root', $config->urls->wire === '/' . substr($expectWire, strlen($root) + 1), $config->urls->wire);
check('urls->site relative to root', $config->urls->site === '/' . substr($expectSite, strlen($root) + 1), $config->urls->site);
check('urls->admin resolved from site config', is_string($config->urls->admin) && strlen($config->urls->admin) > 1, (string) $config->urls->admin);
check('urls->templates under urls->site', strpos($config->urls->templates, $config->urls->site) === 0, $config->urls->templates);

// site config applied
check('site config.php was read (dbName set)', strlen((string) $config->dbName) > 0);
check('sandbox uses its own database', (bool) preg_match('/_bridge$/', (string) $config->dbName), (string) $config->dbName);
check('wire/config.php defaults present', is_array($config->substituteModules));

// modules
$modulePaths = $modules->getPaths();
check('modules paths: core first', isset($modulePaths[0]) && $modulePaths[0] === $expectWire . 'modules/', json_encode($modulePaths));
check('modules paths: site modules second', isset($modulePaths[1]) && $modulePaths[1] === $expectSite . 'modules/', json_encode($modulePaths));
check('core module resolves under wire', strpos((string) $modules->getModuleFile('ProcessPageEdit'), $expectWire) === 0, (string) $modules->getModuleFile('ProcessPageEdit'));
$siteModule = '';
foreach(array('AdminThemeBoss', 'SettingsFactory', 'StaticPages', 'WireMailSmtp') as $name) {
	if($modules->isInstalled($name)) { $siteModule = $name; break; }
}
check('a site module is installed', $siteModule !== '');
if($siteModule) {
	check("site module $siteModule resolves under site/modules", strpos((string) $modules->getModuleFile($siteModule), $expectSite . 'modules/') === 0, (string) $modules->getModuleFile($siteModule));
	$m = $modules->getModule($siteModule, array('noInit' => true, 'noPermissionCheck' => true));
	check("site module $siteModule instantiates", $m instanceof Module);
}
$ppe = $modules->getModule('ProcessPageEdit', array('noInit' => true, 'noPermissionCheck' => true));
check('ProcessPageEdit instantiates', $ppe instanceof Process);
$theme = $modules->getModule($config->defaultAdminTheme ?: 'AdminThemeUikit', array('noInit' => true, 'noPermissionCheck' => true));
check('default admin theme instantiates', $theme instanceof AdminTheme, (string) $config->defaultAdminTheme);

// data
check('pages readable', $pages->count() > 0);
$home = $pages->get('/');
check('home page found', $home->id === 1, (string) $home->id);
check('admin page found', $pages->get($config->adminRootPageID)->id > 0);
check('templates readable', $templates->getAll()->count() > 0);
$tpl = $home->template;
check('home template file under layout templates dir', strpos((string) $tpl->filename, $expectSite . 'templates/') === 0, (string) $tpl->filename);
check('home template file exists', is_file($tpl->filename));

// render: site-level code may still hold literal /site/ paths, so a failure here is a
// finding about the site, not about the bootstrap
ob_start();
try {
	$html = $home->render();
	ob_end_clean();
	check('home page renders', is_string($html) && strlen($html) > 0);
} catch(\Throwable $e) {
	ob_end_clean();
	warn('home page render threw (site-level literal paths?)', $e->getMessage());
}

check('sandbox cache dir exists', is_dir($config->paths->cache));

// theme assets (phases 1.6, 1.7): built stylesheet, fonts it references, defaults
$themeDir = dirname(__DIR__) . '/modules/AdminThemeBridge/';
// the theme class's source: the module file and its traits (lib/, audit PA1)
$themeSource = (string) @file_get_contents($themeDir . 'AdminThemeBridge.module.php');
foreach((array) glob($themeDir . 'lib/*.php') as $traitFile) $themeSource .= "
" . file_get_contents($traitFile);
$themeCss = $themeDir . 'assets/dist/theme.css';
check('theme.css built', is_file($themeCss));
if(is_file($themeCss)) {
	$css = file_get_contents($themeCss);
	check('theme.css under 80 kB raw (the gzip budget in check-css.mjs is the binding one)', strlen($css) < 80 * 1024, (string) strlen($css));
	check('theme.css under 15 kB gzip', strlen(gzencode($css, 9)) <= 15 * 1024, (string) strlen(gzencode($css, 9)));
	check('theme.css is flat (no nesting left)', !preg_match('/[{;]\s*&/', $css));
	// every font the stylesheet references ships next to it (none until Geist is self-hosted)
	preg_match_all('~url\(\.\./fonts/([^)]+)\)~', $css, $m);
	foreach($m[1] as $font) check("font $font present", is_file($themeDir . 'assets/fonts/' . $font));
	check('a licence ships with the fonts', !count($m[1]) || is_file($themeDir . 'assets/fonts/OFL.txt'));
}
// field stylesheet (ADR 0014): built, in budget, printed after theme.css
$fieldsCss = $themeDir . 'assets/dist/fields.css';
check('fields.css built', is_file($fieldsCss));
if(is_file($fieldsCss)) {
	$css = file_get_contents($fieldsCss);
	check('fields.css under 6 kB gzip', strlen(gzencode($css, 9)) <= 6 * 1024, (string) strlen(gzencode($css, 9)));
	check('fields.css is flat (no nesting left)', !preg_match('/[{;]\s*&/', $css));
	$head = (string) file_get_contents($themeDir . '_head.php');
	$posTheme = strpos($head, 'data-pw-theme />');
	$posFields = strpos($head, 'data-pw-fields />');
	check('fields.css linked after theme.css', $posTheme !== false && $posFields !== false && $posFields > $posTheme);
}
// the classic scripts' sources (0.9.0: runtime/src/classic/, built minified into scripts/); the
// source checks below read them, the presence checks the built files
$classicDir = is_dir(dirname(__DIR__) . '/runtime/src/classic') ? dirname(__DIR__) . '/runtime/src/classic/' : $themeDir . 'scripts/';
// notices from a page save time out (scripts/main.js); behaviour is checked in a browser
$mainJs = (string) @file_get_contents($classicDir . 'main.js');
check('theme script times out page-save notices', strpos($mainJs, 'this.setupNoticeTimeout();') !== false && strpos($mainJs, "addEventListener('pw-page-saved', arm)") !== false);
if($modules->isInstalled('AdminThemeBridge')) {
	$bridge = $modules->getModule('AdminThemeBridge', array('noInit' => true, 'noPermissionCheck' => true));
	check('theme default variant is a preset', in_array($bridge->getVariant(), array('blue', 'vibrant', 'black', 'pink', 'green', 'custom'), true), $bridge->getVariant());
	check('theme colour scheme is valid', in_array($bridge->getColorScheme(), array('auto', 'light', 'dark'), true), $bridge->getColorScheme());
	check('theme html attributes carry the variant', strpos($bridge->renderHtmlAttributes(), 'data-pw-variant=') !== false);
	// the loader reads 'template=admin' from the module info cache; without it the theme loads at
	// boot and repairs the cache from ready() (docs/install-live.md)
	check('module info cache has the conditional autoload', !$bridge->moduleCacheIsStale(), var_export($modules->info->moduleInfoCache('AdminThemeBridge', 'autoload'), true));
	check('a refresh can be forced past the file snapshot', method_exists($bridge, 'repairModuleCache') && method_exists($bridge, 'ready'));
	// 0.8.5: the repair runs only for a superuser in the admin, once per interval (a rebuild that
	// dies must not run on every request of the site); the core floor covers the APIs used
	check('the cache repair refuses a CLI request (no admin page, no superuser)', method_exists($bridge, 'canRepairModuleCache') && !$bridge->canRepairModuleCache());
	$requires = (string) (AdminThemeBridge::getModuleInfo()['requires'] ?? '');
	check('requires ProcessWire 3.0.227 (FilenameArray::urls())', strpos($requires, 'ProcessWire>=3.0.227') !== false, $requires);
}
// 0.8.5 client fixes, by source (behaviour: lister-check L, native-check legacy-404, page-save-check)
$listerJs = (string) @file_get_contents($classicDir . 'lister.js');
check('Lister reads ProcessListerScript by id, not by offset', strpos($listerJs, "getElementById('ProcessListerScript')") !== false && strpos($listerJs, 'pos + 21') === false);
check('legacy loader skips a script that fails to load', strpos($mainJs, 'urls.reduce(') === false && strpos($mainJs, 'console.warn(err.message)') !== false);
$pageSaveJs = (string) @file_get_contents($classicDir . 'page-save.js');
check('in-place save never re-posts a form it sent', !preg_match('/if\(!res\.redirected\) \{[^}]*classic\(/s', $pageSaveJs));
// 0.8.6: one inline-script runner, synchronous stand-ins (behaviour: setup-check ?focus=, lister, repeater)
check('theme script has the shared script runner', strpos($mainJs, 'runScripts: function(rootOrScripts, options)') !== false);
check('theme script defines stand-ins for Inputfields, Bridge, AdminDataTable', strpos($mainJs, "['Inputfields', 'Bridge', 'AdminDataTable'].forEach(") !== false && strpos($mainJs, "key === 'pwStub'") !== false);
// a runner copies a script's text into a new element and puts that in the page; loaders (src) don't
$runnerRe = '/\.text = [^;]+;\s*[\w.]*(appendChild|replaceChild|replaceWith)\(/';
$runners = array();
foreach(array('lister.js', 'page-save.js') as $f) {
	if(preg_match($runnerRe, (string) @file_get_contents($classicDir . $f))) $runners[] = $f;
}
$runtimeSrc = dirname(__DIR__) . '/runtime/src/';
if(is_dir($runtimeSrc)) {
	foreach(new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($runtimeSrc, \FilesystemIterator::SKIP_DOTS)) as $file) {
		if(substr($file->getFilename(), -3) !== '.ts' || $file->getFilename() === 'scripts.ts') continue;
		if(preg_match($runnerRe, (string) file_get_contents($file->getPathname()))) $runners[] = $file->getFilename();
	}
}
check('no other inline-script runner (lister, page-save, runtime)', !count($runners), implode(', ', $runners));
check('in-place save steps aside for Enter in a text field', strpos($pageSaveJs, 'if(implicitSubmit(form, e.submitter)) return;') !== false);
// 0.8.9: layout (behaviour: screens-check F)
$themeCss = (string) @file_get_contents($themeDir . 'assets/dist/theme.css');
foreach(array('pw-notices-static', 'pw-nav-overflow', 'forced-colors', '@media print', 'scroll-padding-top', 'body.pw-init .WireTab', '--pw-flyout-max') as $needle) {
	check("theme.css has $needle", strpos($themeCss, $needle) !== false);
}
check('theme script measures notices and the top bar, and handles touch', strpos($mainJs, 'setupNotices: function()') !== false && strpos($mainJs, 'setupNavFit: function()') !== false && strpos($mainJs, "e.pointerType === 'touch'") !== false);
$headPhp = (string) @file_get_contents($themeDir . '_head.php');
check('the head declares both colour schemes', strpos($headPhp, '<meta name="color-scheme" content="light dark">') !== false);
// 0.9.0: built assets (runtime/scripts/build-classic.mjs, prune-chunks.mjs, fa-subset.mjs)
$unbuilt = array();
foreach(glob($themeDir . 'scripts/*.js') as $f) {
	$js = (string) file_get_contents($f);
	if(substr_count($js, "
") > 2 || strpos($js, 'built from runtime/src/classic/') === false) $unbuilt[] = basename($f);
}
check('every theme script is the minified build of its source', !count($unbuilt) && count(glob($themeDir . 'scripts/*.js')) === count(glob($classicDir . '*.js')), implode(', ', $unbuilt));
check('the head preloads the runtime module', strpos($headPhp, "rel='modulepreload'") !== false);
// 0.9.5: the UIkit layer (ADR 0017; behaviour: Showcase's UIkit page, lazy load and stand-in)
$uikitCss = (string) @file_get_contents($themeDir . 'assets/dist/uikit.css');
check('the UIkit layer is built, in one cascade layer, with its covered-class list', strpos($uikitCss, '@layer uikit{') !== false && is_file($themeDir . 'assets/dist/uikit-covered.json'));
check('the UIkit stand-in is printed before every module script', strpos($themeSource, '$uikitLayer = array($themeUrl . "scripts/uikit-layer.js') !== false);
$faCssFile = glob($themeDir . 'assets/fonts/fa-*/fa.css');
$faCssText = $faCssFile ? (string) file_get_contents($faCssFile[0]) : '';
check('Font Awesome subsets carry a content hash', $faCssText === '' || (bool) preg_match('/url\(fa-solid-900-subset\.[0-9a-f]{8}\.woff2\)/', $faCssText));
check('the last build listed its chunks (kept one more release)', is_file($themeDir . 'assets/dist/chunks.json'));
// 0.8.7: one body observer, ownership by the stack (not by jQuery), placeholders, hand-over
// (behaviour: native-check placeholder and foreign-jquery, lister-check M, repeater-check B)
$observers = array();
foreach(glob($classicDir . '*.js') as $f) $observers[basename($f)] = substr_count((string) file_get_contents($f), 'new MutationObserver(');
if(is_dir($runtimeSrc)) {
	foreach(new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($runtimeSrc, \FilesystemIterator::SKIP_DOTS)) as $file) {
		if(substr($file->getFilename(), -3) === '.ts') $observers[$file->getFilename()] = substr_count((string) file_get_contents($file->getPathname()), 'new MutationObserver(');
	}
}
$observers = array_filter($observers);
check('one body MutationObserver (main.js observe(), plus its <head> style order)', $observers === array('main.js' => 2) && strpos($mainJs, 'observe: function(fn)') !== false, json_encode($observers));
$legacyTs = is_dir($runtimeSrc) ? (string) @file_get_contents($runtimeSrc . 'legacy.ts') : '';
check('the runtime asks the theme who owns the page', $legacyTs === '' || strpos($legacyTs, 'theme.upstream()') !== false);
check('an AJAX placeholder of a legacy field does not load the stack', strpos($mainJs, 'needsStack: function(li)') !== false && strpos($mainJs, 'renderInputfieldAjax') !== false);
$handoverMissing = array();
foreach(array('lister.js', 'page-edit.js', 'setup.js', 'screens.js') as $f) {
	$js = (string) @file_get_contents($classicDir . $f);
	// every listener but DOMContentLoaded carries the hand-over signal (nested per-drag ones aside)
	$all = preg_match_all('/\.addEventListener\(\'(?!DOMContentLoaded)/', $js);
	$bound = substr_count($js, 'handover.bind(');
	if(!$bound || $bound < $all - 3) $handoverMissing[] = "$f ($bound of $all)";
}
check('screen scripts end their listeners at the hand-over', !count($handoverMissing), implode(', ', $handoverMissing));
if($modules->isInstalled('AdminThemeBridge')) {
	// native status is per exact class (ADR 0015): a component's subclass may add jQuery scripts
	if($modules->isInstalled('InputfieldBridgeText')) {
		$modules->get('InputfieldBridgeText');
		if(!class_exists('ProcessWire\\BridgeSmokeSubText', false)) {
			eval('namespace ProcessWire; class BridgeSmokeSubText extends InputfieldBridgeText {}');
		}
		check('a component Inputfield is native', $bridge->isNativeInputfield($modules->get('InputfieldBridgeText')));
		check('a subclass of a component is not native', !$bridge->isNativeInputfield($modules->wire(new BridgeSmokeSubText())));
		check('a wrapper is native', $bridge->isNativeInputfield($modules->get('InputfieldFieldset')));
	}
	// native Process screens (ADR 0016): exact class, and the stand-in scripts ship
	$ppl = $modules->getModule('ProcessPageList', array('noInit' => true, 'noPermissionCheck' => true));
	$ppa = $modules->getModule('ProcessPageAdd', array('noInit' => true, 'noPermissionCheck' => true));
	check('ProcessPageEdit is a native Process', $ppe instanceof Process && $bridge->isNativeProcess($ppe));
	check('ProcessPageList is a native Process (3.4)', $ppl instanceof Process && $bridge->isNativeProcess($ppl));
	check('ProcessPageAdd is a native Process (3.7)', $ppa instanceof Process && $bridge->isNativeProcess($ppa));
	$pis = $modules->getModule('ProcessPageEditImageSelect', array('noInit' => true, 'noPermissionCheck' => true));
	check('ProcessPageEditImageSelect is a native Process (3.9)', $pis instanceof Process && $bridge->isNativeProcess($pis));
	check('scripts/image-select.js present', is_file($themeDir . 'scripts/image-select.js'));
	$lister = $modules->getModule('ProcessPageLister', array('noInit' => true, 'noPermissionCheck' => true));
	check('ProcessPageLister is a native Process (3.5)', $lister instanceof Process && $bridge->isNativeProcess($lister));
	check('scripts/lister.js present', is_file($themeDir . 'scripts/lister.js'));
	// the setup and access screens (milestone 3.6)
	foreach(array('ProcessModule', 'ProcessField', 'ProcessTemplate', 'ProcessUser', 'ProcessRole', 'ProcessPermission') as $class) {
		$p = $modules->getModule($class, array('noInit' => true, 'noPermissionCheck' => true));
		check("$class is a native Process (3.6)", $p instanceof Process && $bridge->isNativeProcess($p));
	}
	check('scripts/setup.js present', is_file($themeDir . 'scripts/setup.js'));
	// the remaining core screens (milestone 3.7)
	foreach(array('ProcessProfile', 'ProcessLogger', 'ProcessRecentPages', 'ProcessPageClone', 'ProcessPageTrash', 'ProcessPageEditLink') as $class) {
		if(!$modules->isInstalled($class)) continue;
		$p = $modules->getModule($class, array('noInit' => true, 'noPermissionCheck' => true));
		check("$class is a native Process (3.7)", $p instanceof Process && $bridge->isNativeProcess($p));
	}
	foreach(array('scripts/screens.js', 'scripts/link.js') as $file) check("$file present", is_file($themeDir . $file));
	// save without reload on other edit forms (milestone 3.8)
	check('the field editor saves in place (3.8)', $bridge->saveInPlaceProcess($modules->getModule('ProcessField', array('noInit' => true, 'noPermissionCheck' => true))));
	check('the page editor saves in place', $bridge->saveInPlaceProcess($ppe));
	check('the page tree does not (no edit form)', !$bridge->saveInPlaceProcess($ppl));
	foreach(array('InputfieldIcon', 'InputfieldPassword') as $class) check("$class is native (3.6)", $bridge->isNativeInputfield($modules->get($class)));
	foreach(array('scripts/wire-tabs.js', 'scripts/page-edit.js') as $file) check("$file present", is_file($themeDir . $file));
	// File and Image native (milestone 3.2); site module scripts written against jQuery are deferred
	check('InputfieldFile and InputfieldImage are native', $bridge->isNativeInputfield($modules->get('InputfieldFile')) && $bridge->isNativeInputfield($modules->get('InputfieldImage')));
	foreach(array('InputfieldRepeater', 'InputfieldPageTable') as $class) {
		if($modules->isInstalled($class)) check("$class is native", $bridge->isNativeInputfield($modules->get($class)));
	}
	$probe = $config->paths->cache . 'bridge-smoke-jq.js';
	$plain = $config->paths->cache . 'bridge-smoke-plain.js';
	file_put_contents($probe, '(function(){ $(document).ready(function(){}); })();');
	file_put_contents($plain, "(function(){ var price = '\$5'; document.title += ''; })();");
	check('a jQuery site script is deferred', $bridge->isJqueryScript($config->urls->cache . 'bridge-smoke-jq.js?v=1'));
	check('a plain site script is printed', !$bridge->isJqueryScript($config->urls->cache . 'bridge-smoke-plain.js'));
	check('the theme script is never deferred', !$bridge->isJqueryScript($bridge->url() . 'scripts/main.js'));
	@unlink($probe);
	@unlink($plain);
	// 0.8.8 (A3): what the content test counts
	if(method_exists('ProcessWire\\AdminThemeBridge', 'needsJquery')) {
		check('a "No jQuery." comment does not defer a script', !AdminThemeBridge::needsJquery("/**\n * No jQuery.\n */\ndocument.addEventListener('click', function() {});"));
		check('a // comment mentioning $(...) does not either', !AdminThemeBridge::needsJquery("// was: \$('#x').hide()\nvar url = 'http://example.com';"));
		check('a script that checks for jQuery is printed', !AdminThemeBridge::needsJquery("if(window.jQuery) jQuery(document).on('x', f); else document.addEventListener('x', f);"));
		check('a jQuery body is deferred', AdminThemeBridge::needsJquery("var u = 'http://x'; jQuery(function(\$) { \$('.a').hide(); });"));
		check('the $ alias is deferred', AdminThemeBridge::needsJquery("\$.ajax({ url: 'x' });"));
		check('the demo script is printed', !$bridge->isJqueryScript($config->urls->siteModules . 'BridgeDemo/ProcessBridgeDemo.js') || !is_file($config->paths->siteModules . 'BridgeDemo/ProcessBridgeDemo.js'));
	}
	// A9: a component Process counts for its own class only
	if($modules->isInstalled('ProcessBridgeDemo')) {
		$modules->getModule('ProcessBridgeDemo', array('noInit' => true, 'noPermissionCheck' => true));
		if(!class_exists('ProcessWire\\BridgeSmokeSubDemo', false)) {
			eval('namespace ProcessWire; class BridgeSmokeSubDemo extends ProcessBridgeDemo {}');
		}
		check('a component Process is native', $bridge->isNativeProcess($modules->getModule('ProcessBridgeDemo', array('noInit' => true, 'noPermissionCheck' => true))));
		check('a subclass of a component Process is not native', !$bridge->isNativeProcess($modules->wire(new BridgeSmokeSubDemo())));
	}
	// A4: a field module's jQuery script is a reason unless a legacy Inputfield of that module is
	$settle = function(array $legacyDirs) use($modules) {
		$probe = $modules->wire(new AdminThemeBridge());
		foreach(array('pendingScriptReasons' => array('/x/FieldtypeSmoke/' => 'Script:FieldtypeSmoke/smoke.js'), 'legacyInputfieldDirs' => $legacyDirs) as $prop => $value) {
			$r = new \ReflectionProperty($probe, $prop);
			$r->setAccessible(true);
			$r->setValue($probe, $value);
		}
		return array($probe->useLegacyStack(), array_keys($probe->getLegacyReasons()));
	};
	list($needed, $reasons) = $settle(array());
	check('a field module script without a legacy Inputfield of its module needs the stack', $needed && in_array('Script:FieldtypeSmoke/smoke.js', $reasons, true), implode(',', $reasons));
	list($needed) = $settle(array('/x/FieldtypeSmoke/' => true));
	check('with a legacy Inputfield of its module it adds no reason of its own', !$needed);
	// 0.9.2: scriptNeeds, a site script that needs jQuery only on certain fields (Fluency)
	// 0.9.5: the UIkit layer (ADR 0017)
	if(method_exists($bridge, 'needsUikit')) {
		check('a script that calls UIkit asks for the UIkit layer', AdminThemeBridge::needsUikit("UIkit.notification('Saved');"));
		check('a script that checks for UIkit first does not', !AdminThemeBridge::needsUikit("if(typeof UIkit !== 'undefined') UIkit.notification('x');"));
		check('a comment mentioning UIkit does not', !AdminThemeBridge::needsUikit("// works without UIkit\ndocument.body.hidden = false;"));
		$uikitScan = function($html) use($modules) {
			$probe = $modules->wire(new AdminThemeBridge());
			$probe->scanUikitMarkup($html);
			return array_keys($probe->getUikitReasons());
		};
		check('uk-* classes the theme covers need no UIkit layer', $uikitScan('<div class="uk-flex uk-margin-small-top"><input class="uk-input"></div>') === array());
		check('an uncovered uk-* class or a UIkit attribute does', $uikitScan('<div class="uk-section-primary"></div><div uk-grid></div>') === array('Markup:uk-section-primary', 'Markup:uk-grid'));
		check('a uk-* word in an attribute value is no attribute', $uikitScan('<a title="see the uk-grid docs" class="uk-flex">x</a>') === array());
		check('a tooltip needs no layer (core module list, Fluency)', $uikitScan("<span title='x' data-uk-tooltip='delay:1000'>t</span><i uk-tooltip='Translate'></i>") === array());
		$uikitJs = $config->urls->wire . 'modules/AdminTheme/AdminThemeUikit/uikit/dist/js/uikit.min.js';
		check("core's UIkit script is neither another theme's asset nor legacy", !$bridge->isOtherThemeAsset($uikitJs) && !$bridge->isLegacyScript($uikitJs));
		check('the stand-in is no UIkit script', !AdminThemeBridge::isUikitScript($bridge->url() . 'scripts/uikit-layer.js?v=1'));
		$coreUikit = $bridge->coreUikitVersion();
		$layerUikit = preg_match('/UIkit (\d+\.\d+\.\d+)/', $uikitCss, $m) ? $m[1] : '';
		if($coreUikit !== $layerUikit) warn('the UIkit layer was built from another UIkit than core ships', "layer $layerUikit, core $coreUikit: rebuild with BRIDGE_WIRE (runtime/scripts/build-uikit.mjs)");
	}
	check('Fluency\'s fluency.js is in the scriptNeeds map', $bridge->isScriptNeedsScript($config->urls->siteModules . 'Fluency/assets/bundle/scripts/fluency.js?x=1') && !$bridge->isScriptNeedsScript($config->urls->siteModules . 'Fluency/assets/bundle/scripts/fluency_module_config.js'));
	$needsFile = $config->paths->cache . 'bridge-smoke-needs.js';
	$needsUrl = $config->urls->cache . 'bridge-smoke-needs.js';
	file_put_contents($needsFile, "window.addEventListener('load', function() { document.querySelectorAll('.hasLangTabs input').forEach(function(f) { f.addEventListener('input', function() { \$(f).trigger('change'); }); }); });");
	$config->scripts->add($needsUrl);
	$needsProbe = function($rendered) use($modules) {
		$probe = $modules->wire(new AdminThemeBridge());
		$probe->addHookAfter('scriptNeeds', function(HookEvent $e) { $map = $e->return; $map['/bridge-smoke-needs.js'] = 'languages'; $e->return = $map; });
		$mark = new \ReflectionMethod($probe, 'markInputfield');
		$mark->setAccessible(true);
		foreach($rendered as $inputfield) $mark->invoke($probe, $inputfield, true);
		return $probe;
	};
	$text = $modules->get('InputfieldText');
	$langText = $modules->get('InputfieldText');
	$langText->set('useLanguages', true);
	$probe = $needsProbe(array($text));
	$split = $probe->getScriptUrls(array($needsUrl));
	check('a scriptNeeds script is printed where its fields do not render', !$probe->useLegacyStack() && $split['print'] === array($needsUrl), json_encode($split) . json_encode($probe->getLegacyReasons()));
	$probe = $needsProbe(array($text, $langText));
	check('a multi-language field makes it a legacy reason', $probe->useLegacyStack() && array_key_exists('Script:cache/bridge-smoke-needs.js', $probe->getLegacyReasons()), json_encode($probe->getLegacyReasons()));
	$config->scripts->remove($needsUrl);
	@unlink($needsFile);
	// 0.9.2: a jQuery script a module adds for its own config screen (at init or ready, before the
	// Process starts) is that screen's reason; a Process that threw keeps its own reason
	$input = $wire->input;
	$processModule = $modules->getModule('ProcessModule', array('noInit' => true, 'noPermissionCheck' => true));
	$configModule = '';
	$configScript = '';
	foreach($modules->getInstalled() as $name => $installed) {
		$dir = $config->paths($name);
		if(!$dir || strpos($dir, $config->paths->siteModules) !== 0 || $dir === $config->paths->siteModules) continue;
		foreach((array) glob($dir . '*.js') as $js) {
			if(!AdminThemeBridge::needsJquery((string) file_get_contents($js))) continue;
			$configModule = $name;
			$configScript = $config->urls($name) . basename($js);
			break 2;
		}
	}
	$configProbe = function($name, $process) use($modules, $wire, $input, $config) {
		$probe = $modules->wire(new AdminThemeBridge());
		$r = new \ReflectionProperty($probe, 'scriptsBeforeProcess');
		$r->setAccessible(true);
		// as hookProcessExecuteBefore() has it: every script so far, versioned
		$before = array();
		foreach($config->scripts->urls() as $url) $before[] = (string) $url;
		$r->setValue($probe, $before);
		$input->setUrlSegment(1, 'edit');
		$input->get->name = $name;
		$wire->wire('process', $process);
		$probe->settleProcess();
		$input->setUrlSegment(1, '');
		$input->get->name = null;
		return $probe;
	};
	if($configModule === '') {
		warn('no installed site module with a jQuery script here: config-screen checks skipped');
	} else {
		$config->scripts->add($configScript);
		$input->setUrlSegment(1, 'edit');
		$input->get->name = $configModule;
		$url = $bridge->moduleConfigUrl($processModule);
		$input->setUrlSegment(1, '');
		$input->get->name = null;
		check("moduleConfigUrl() is the module's directory on its config screen, and only there", $url === $config->urls($configModule) && $bridge->moduleConfigUrl($processModule) === '', (string) $url);
		$reason = 'Script:' . basename(dirname($configScript)) . '/' . basename($configScript);
		$probe = $configProbe($configModule, $processModule);
		check("a module's jQuery script added before ProcessModule is a reason on its config screen ($configModule)", array_key_exists($reason, $probe->getLegacyReasons()), json_encode($probe->getLegacyReasons()));
		$probe = $configProbe('ProcessPageEdit', $processModule);
		check('on another module\'s config screen it stays deferred', !$probe->useLegacyStack(), json_encode($probe->getLegacyReasons()));
		$config->scripts->remove($configScript);
	}
	$probe = $configProbe('', $modules->getModule('ProcessPageSearch', array('noInit' => true, 'noPermissionCheck' => true)));
	check('a Process that threw keeps its reason (settleProcess)', array_key_exists('Process:ProcessPageSearch', $probe->getLegacyReasons()), json_encode($probe->getLegacyReasons()));
	$probe = $modules->wire(new AdminThemeBridge());
	$probe->settleProcess();
	check('settleProcess() adds nothing after a Process that finished', !$probe->useLegacyStack());
	$wire->wire('process', null);
	// 0.9.1 (A19): one native map, wrappers by exact class, hookable, overridden per class
	check('InputfieldFieldsetOpen and InputfieldFieldsetTabOpen are native', $bridge->isNativeInputfield($modules->get('InputfieldFieldsetOpen')) && $bridge->isNativeInputfield($modules->get('InputfieldFieldsetTabOpen')));
	if(!class_exists('ProcessWire\\BridgeSmokeSubMarkup', false)) {
		eval('namespace ProcessWire; class BridgeSmokeSubMarkup extends InputfieldMarkup {}');
	}
	$subMarkup = $modules->wire(new BridgeSmokeSubMarkup());
	check('a subclass of InputfieldMarkup is not native (exact class)', !$bridge->isNativeInputfield($subMarkup));
	$probe = $modules->wire(new AdminThemeBridge());
	$probe->addHookAfter('nativeMap', function(HookEvent $e) { $map = $e->return; $map['BridgeSmokeSubMarkup'] = array('kind' => 'wrapper'); $e->return = $map; });
	check('a nativeMap hook makes a class native', $probe->isNativeInputfield($subMarkup) && $probe->isNativeWrapper($subMarkup));
	$probe = $modules->wire(new AdminThemeBridge());
	$probe->set('nativeOverrides', "InputfieldText=legacy\nBridgeSmokeSubMarkup = native\nnot a rule");
	check('nativeOverrides wins over the map, both ways', !$probe->isNativeInputfield($modules->get('InputfieldText')) && $probe->isNativeInputfield($subMarkup));
	check('nativeOverrides reports lines it ignores', $probe->nativeOverrideErrors() === array('not a rule'), json_encode($probe->nativeOverrideErrors()));
	$probe->set('nativeOverrides', 'ProcessPageEdit=legacy');
	$ppeProbe = $modules->getModule('ProcessPageEdit', array('noInit' => true, 'noPermissionCheck' => true));
	check('nativeOverrides applies to Processes', !$probe->isNativeProcess($ppeProbe));
	// the stand-in scripts per Process, as the 0.9.0 if-chain had them
	$table = array(
		'ProcessPageEdit' => 'wire-tabs,page-edit', 'ProcessPageLister' => 'wire-tabs,lister',
		'ProcessUser' => 'wire-tabs,page-edit,lister,setup', 'ProcessRole' => 'wire-tabs,page-edit,lister,setup', 'ProcessPermission' => 'wire-tabs,page-edit,lister,setup',
		'ProcessModule' => 'wire-tabs,setup', 'ProcessField' => 'wire-tabs,setup', 'ProcessTemplate' => 'wire-tabs,setup',
		'ProcessPageAdd' => 'screens', 'ProcessProfile' => 'screens', 'ProcessLogger' => 'screens',
		'ProcessPageEditLink' => 'wire-tabs,link', 'ProcessPageEditImageSelect' => 'image-select',
		'ProcessPageList' => '', 'ProcessRecentPages' => '', 'ProcessPageClone' => '', 'ProcessPageTrash' => '', 'ProcessHome' => '',
	);
	$wrong = array();
	foreach($table as $class => $want) {
		$got = implode(',', array_map(function($f) { return basename($f, '.js'); }, $bridge->processScripts($class)));
		if($got !== $want) $wrong[] = "$class: $got";
	}
	check('stand-in scripts per Process match the 0.9.0 table', !count($wrong), implode('; ', $wrong));
	check('with the stack only the image window keeps its script', $bridge->processScripts('ProcessPageEdit', true) === array() && $bridge->processScripts('ProcessPageEditImageSelect', true) === array('scripts/image-select.js'));
	$saveInPlace = array();
	foreach(array('ProcessField', 'ProcessTemplate', 'ProcessModule', 'ProcessProfile', 'ProcessUser', 'ProcessRole', 'ProcessPermission', 'ProcessPageList', 'ProcessPageLister') as $class) {
		$p = $modules->getModule($class, array('noInit' => true, 'noPermissionCheck' => true));
		if($p) $saveInPlace[$class] = $bridge->saveInPlaceProcess($p);
	}
	check('save in place for the same screens as before', array_keys(array_filter($saveInPlace)) === array('ProcessField', 'ProcessTemplate', 'ProcessModule', 'ProcessProfile', 'ProcessUser', 'ProcessRole', 'ProcessPermission'), json_encode($saveInPlace));
	// A6: AdminThemeBoss's never-saved settings are its defaults (both on)
	check('bossForcesUikit() reads Boss defaults', strpos($themeSource, "!array_key_exists(\$key, \$boss)") !== false);
	// A20: both sides guard the interface declaration
	check('the interface file is guarded', strpos((string) file_get_contents($themeDir . 'BridgeComponent.php'), "if(!interface_exists('ProcessWire\\\\BridgeComponent', false))") !== false);
	// A21: the inline-script rewrites match strings that still occur in core
	$wireDir = $config->paths->wire;
	// the list lives next to the rewrites (lib/AdminThemeBridgeRewrites.php, audit PA3)
	$needles = AdminThemeBridge::upstreamNeedles();
	foreach($needles as $file => $list) {
		$src = is_file($wireDir . $file) ? (string) file_get_contents($wireDir . $file) : '';
		foreach($list as $needle) check("core still prints the string the theme rewrites ($file)", $src !== '' && strpos($src, $needle) !== false, $needle);
	}
	// Debug Mode Tools: _footer.php drops debug.inc's jQuery script by this pattern and marks the
	// panel for scripts/debug-tools.js (link with data-panel-id='debug', sections in .container)
	$debugPattern = '~<script\b[^>]*>\s*\$\(document\)\.ready\(function\(\)\s*\{\s*var \$debug\b.*?</script>~s';
	$debugInc = (string) @file_get_contents($wireDir . 'templates-admin/debug.inc');
	check('_footer.php strips debug.inc\'s script by the tested pattern', strpos((string) file_get_contents($themeDir . '_footer.php'), "'$debugPattern'") !== false);
	check('core\'s debug.inc still has the script, the panel div and the panel link', preg_match_all($debugPattern, $debugInc) === 1
		&& substr_count($debugInc, '<div id="debug">') === 1 && strpos($debugInc, "data-panel-id='debug'") !== false && strpos($debugInc, '<div class="container">') !== false);
	check('scripts/debug-tools.js is built', is_file($themeDir . 'scripts/debug-tools.js') && strpos((string) file_get_contents($themeDir . 'scripts/debug-tools.js'), '#debug.pw-debug') !== false);
}

// 0.9.9 (audit 2026-10-27)
if(isset($bridge) && $bridge) {
	// B1: the jQuery-ready rewrite touches scripts only, never a field's value
	$value = "<textarea name='body'>\$(document).ready(function() { alert(1); });</textarea>";
	$script = "<script>\$(document).ready(function() { ProcessTemplateInitFields(); });</script>";
	$rewritten = $bridge->nativeInlineScripts($value . $script);
	check('inline rewrite leaves a field value alone', strpos($rewritten, $value) === 0, $rewritten);
	check('inline rewrite still rewrites the script', strpos($rewritten, "<script>(window.jQuery ? jQuery : function(f)") !== false, $rewritten);

	// every core data table sorts (sortableDataTable(), hookDataTableRenderBefore())
	$makeTable = function(array $head, $rows, $class = '') use($modules) {
		/** @var MarkupAdminDataTable $t */
		$t = $modules->get('MarkupAdminDataTable');
		$t->setEncodeEntities(false);
		$t->setSortable(false);
		if($class !== '') $t->addClass($class);
		if(count($head)) $t->headerRow($head);
		for($i = 0; $i < $rows; $i++) $t->row(array("r$i", 'x', 'y'));
		return $t;
	};
	$coreMaker = $config->paths->modules . 'Process/ProcessField/ProcessField.module';
	$siteMaker = $config->paths->siteModules . 'SomeModule/SomeModule.module';
	check('a core table with a header and two rows sorts', $bridge->sortableDataTable($makeTable(array('A', 'B', 'C'), 2), $coreMaker) === true);
	check('the Lister\'s table does not (server sort)', !$bridge->sortableDataTable($makeTable(array('A', 'B', 'C'), 2, 'ProcessListerTable'), $coreMaker));
	check('a checkboxes table does not (posted order)', !$bridge->sortableDataTable($makeTable(array('A', 'B', 'C'), 2, 'pw-no-select'), $coreMaker));
	check('a table without a header does not', !$bridge->sortableDataTable($makeTable(array(), 2), $coreMaker));
	check('a table with one row does not', !$bridge->sortableDataTable($makeTable(array('A', 'B', 'C'), 1), $coreMaker));
	check('a third-party table keeps its maker\'s choice', !$bridge->sortableDataTable($makeTable(array('A', 'B', 'C'), 2), $siteMaker));
	check('a core table through the resolved wire/ path (junction) sorts', $bridge->isUnder((string) realpath($coreMaker), $config->paths->modules));
	$optIn = $bridge->addHookAfter('sortableDataTable', function(HookEvent $e) { $e->return = true; });
	$table = $makeTable(array('Name', '&nbsp;', "<i class='fa fa-trash'></i>"), 2);
	$bridge->hookDataTableRenderBefore(new HookEvent(array('object' => $table)));
	$html = $table->render();
	$bridge->removeHook($optIn);
	check('an opted-in table renders sortable', strpos($html, 'AdminDataTableSortable') !== false, $html);
	check('its columns without header text do not sort', substr_count($html, 'sorter-false') === 2, $html);
	check('the runtime labels include the paged-table hint', isset($bridge->runtimeLabels()['sortsPage']));

	// B6: script URLs resolve through urls/paths pairs, also root . 'wire/' for a core elsewhere
	$siteJs = glob($config->paths->siteModules . '*/*.js');
	if(is_array($siteJs) && count($siteJs)) {
		$jsUrl = $config->urls->siteModules . substr($siteJs[0], strlen($config->paths->siteModules));
		check('urlToFile maps a site module script', $bridge->urlToFile($jsUrl . '?v=1') === $siteJs[0], $jsUrl);
	}
	$aliasUrl = $config->urls->root . 'wire/templates-admin/scripts/main.js';
	check('urlToFile maps root/wire/ to the core', $bridge->urlToFile($aliasUrl) === $config->paths->wire . 'templates-admin/scripts/main.js', $bridge->urlToFile($aliasUrl));
	check('isLegacyScript counts root/wire/ URLs', $bridge->isLegacyScript($aliasUrl));
	check('urlToFile refuses ..', $bridge->urlToFile($config->urls->siteModules . '../config.php') === '');
	$moduleSrc = $themeSource;
	check('no GLOB_BRACE flag (undefined on musl)', strpos($moduleSrc, ', GLOB_BRACE') === false);
	// B7: bounded, locked cache repair
	$state = $bridge->repairState();
	check('repair state has time and attempts', isset($state['time'], $state['attempts']), json_encode($state));
	check('the repair takes a named lock and stops after repairAttempts', strpos($moduleSrc, 'GET_LOCK(') !== false && AdminThemeBridge::repairAttempts > 0);
	// B8: the shared scripts once
	check('_head.php drops a registered copy of the shared scripts', strpos($themeSource, '$sharedPaths') !== false);
}

// 0.9.10 (audit 2026-10-27, phase 2)
if(isset($bridge) && $bridge) {
	$templates = array();
	foreach(glob($themeDir . '_*.php') as $f) $templates[basename($f)] = (string) file_get_contents($f);
	$untranslatable = array();
	foreach($templates as $name => $src) {
		if(preg_match_all('/\$adminTheme->_\(\'([^\']*)\'\)/', $src, $m)) {
			foreach($m[1] as $text) if($text !== 'en') $untranslatable[] = "$name: $text"; // 'en' is core's, by design
		}
	}
	check('B2 templates print labels through the module (translatable)', !count($untranslatable), implode('; ', $untranslatable));
	check('B2 shell labels resolve', $bridge->shellLabel('menu') !== 'menu' && strpos($bridge->shellLabel('basedOn'), '%s') !== false);
	$dirUsers = array_keys(array_filter($templates, function($src) { return strpos($src, '__DIR__') !== false; }));
	check('B3 templates find theme files through path(), not __DIR__', !count($dirUsers), implode(', ', $dirUsers));
	check('B9 footer shows the version to signed-in users only', strpos($templates['_footer.php'], "<span>Bridge<?php if(\$adminTheme->isLoggedIn) echo") !== false);
	check('B13 uninstall clears the theme caches', method_exists($bridge, '___uninstall') && strpos($moduleSrc, "cache->delete('AdminThemeBridge.*')") !== false);
	check('PA4 browser title names the product Bridge', method_exists($bridge, 'getBrowserTitle') && strpos($moduleSrc, "' • Bridge'") !== false);
	check('PA4 _main.php carries the MPL note for its upstream lines', strpos($templates['_main.php'], 'Mozilla Public License 2.0') !== false);
	check('B14 bootstrap compares paths without case on Windows', DIRECTORY_SEPARATOR !== '\\' || BridgeBootstrap::under('d:/site/app/', 'D:/site/'));
	check('B16 conformance keys fields without an id by position', strpos((string) file_get_contents(dirname(__DIR__) . '/conformance/run.php'), 'spl_object_hash') === false);
	$rt = dirname(__DIR__) . '/runtime/src/';
	check('R4 repeater, page table, page list select use fetchOk/failed', count(array_filter(array('fields/repeater.ts', 'fields/pagetable.ts', 'fields/pagelistselect.ts'), function($f) use($rt) { return strpos((string) file_get_contents($rt . $f), "from '../util/fail'") !== false; })) === 3);
	check('R6 datetime listens for outside presses only while open', strpos((string) file_get_contents($rt . 'fields/datetime.ts'), "document.addEventListener('mousedown', outside)") !== false);
	check('the runtime labels include the request failure notice', isset($bridge->runtimeLabels()['requestFailed']));
}

// 0.9.11 (audit 2026-10-27, phase 3: performance)
if(isset($bridge) && $bridge) {
	check('PP1 assetUrls() gives what urls() gives', $bridge->assetUrls($config->scripts) === $config->scripts->urls());
	$config->scripts->add('/smoke-memo-' . time() . '.js');
	check('PP1 assetUrls() follows a changed list', count($bridge->assetUrls($config->scripts)) === count($config->scripts->urls()));
	$manifestFile = $themeDir . 'assets/dist/manifest.php';
	check('PP2 the build writes assets/dist/manifest.php', is_file($manifestFile));
	if(is_file($manifestFile)) {
		$manifest = include($manifestFile);
		check('PP2 manifest has runtime chunks, font preloads, covered UIkit classes', is_array($manifest) && !empty($manifest['runtimeChunks']) && isset($manifest['fontPreloads']) && !empty($manifest['uikitCovered']));
		check('PP2 manifest chunks exist', is_array($manifest) && !array_filter((array) $manifest['runtimeChunks'], function($c) use($themeDir) { return !is_file($themeDir . 'assets/dist/' . $c); }));
	}
	check('PP3 both verdict caches load in one query', strpos($themeSource, 'protected function loadVerdicts()') !== false);
	check('PP8 the theme ships cache headers for versioned assets', is_file($themeDir . '.htaccess') && strpos((string) file_get_contents($themeDir . '.htaccess'), 'immutable') !== false);
}

// 0.10.0 (audit 2026-10-27, phase 4: UI and accessibility)
if(isset($bridge) && $bridge) {
	$masthead = (string) file_get_contents($themeDir . '_masthead.php');
	check('SU1 skip link and a named main navigation', strpos($masthead, "class='pw-sr-only pw-skip-link' href='#main'") !== false && strpos($masthead, "id='pw-nav' aria-label=") !== false);
	check('SU4 the search is a landmark with a named field', strpos($masthead, "role='search'") !== false);
	foreach(array('mainNav', 'breadcrumbs', 'skip', 'search', 'home', 'pagination') as $key) {
		check("shell label '$key' resolves", $bridge->shellLabel($key) !== $key);
	}
	foreach(array('toggle', 'previous', 'next', 'saveNoAnswer') as $key) {
		check("runtime label '$key' exists", isset($bridge->runtimeLabels()[$key]));
	}
	$themeCss = (string) @file_get_contents($themeDir . 'assets/dist/theme.css');
	check('U6 one reduced-motion rule for everything', strpos($themeCss, 'animation-iteration-count:1!important') !== false);
	check('U1 form fields have their own border token, light as the editors', strpos($themeCss, '--pw-input-border: var(--input)') !== false);
	check('U2 focusable elements get a ring', strpos($themeCss, ':focus-visible{outline:2px solid var(--ring)') !== false);
	$rt = dirname(__DIR__) . '/runtime/src/';
	check('R7 sortable lists move by Alt+arrow', strpos((string) file_get_contents($rt . 'util/sortable.ts'), "e.key !== 'ArrowUp' && e.key !== 'ArrowDown'") !== false);
	check('R7 repeater controls and the language toggle are keyboard buttons', strpos((string) file_get_contents($rt . 'fields/repeater.ts'), 'keyButton(i, title)') !== false && strpos((string) file_get_contents($rt . 'inputfields/langtabs.ts'), 'keyButton(toggle') !== false);
	check('U3 dropdown toggles report aria-expanded', strpos((string) file_get_contents($themeDir . 'scripts/main.js'), 'aria-expanded') !== false);
}

// 0.10.1 (audit 2026-10-27, phase 5: architecture)
if(isset($bridge) && $bridge) {
	$traits = class_uses($bridge);
	check('PA1 the theme class is split into its ten traits', count(array_filter(array_keys($traits), function($t) { return strpos($t, 'ProcessWire\\AdminThemeBridge') === 0; })) === 10, implode(', ', array_keys($traits)));
	check('PA1 hookable methods stay hookable through the traits', method_exists($bridge, '___sortableDataTable') && method_exists($bridge, '___nativeMap') && method_exists($bridge, '___renderBreadcrumbs'));
	$traitSrc = '';
	foreach((array) glob($themeDir . 'lib/*.php') as $f) $traitSrc .= (string) file_get_contents($f);
	check('PA1 strings in traits are translated in their own file', !preg_match('/\$this->_\(\'/', $traitSrc));
	check('A1 one HTML escape helper', is_file(dirname(__DIR__) . '/runtime/src/util/html.ts') && strpos((string) file_get_contents(dirname(__DIR__) . '/runtime/src/fields/file.ts'), 'const esc =') === false);
	check('PA4 the layout .htaccess generator exists', is_file(dirname(__DIR__) . '/tools/bootstrap-htaccess.php'));
	check('the runtime labels include the part-failed notice', isset($bridge->runtimeLabels()['partFailed']));
}

// 0.11.0: interface scale, display controls, per-user display settings
if(isset($bridge) && $bridge) {
	$themeCss = (string) @file_get_contents($themeDir . 'assets/dist/theme.css');
	$noMedia = (string) preg_replace('/@media[^{]*\{/', '{', $themeCss);
	preg_match_all('/(?<![\w-])(padding|margin|gap|width|height|top|left|right|bottom|font-size|border-radius)[\w-]*:[^;{}]*?\b([2-9]|\d{2,})px/', $noMedia, $pxLeft);
	check('built CSS sizes in rem (px only for hairlines, borders, media queries)', !count($pxLeft[0]), implode(' | ', array_slice($pxLeft[0], 0, 5)));
	check('the token the theme script measures with is in rem', strpos($themeCss, '--pw-masthead-h:') !== false && !preg_match('/--pw-masthead-h:\s*\d+px/', $themeCss));
	$controls = $bridge->renderViewControls();
	check('display controls: smaller, larger, scheme', strpos($controls, "data-pw-scale='-1'") !== false && strpos($controls, "data-pw-scale='1'") !== false && strpos($controls, 'data-pw-scheme-toggle') !== false);
	check('the scheme toggle left the user menu', strpos($themeSource, "<li class='pw-scheme-toggle'>") === false);
	check('a guest has no display settings key', $bridge->prefsKey() === '');
	$guest = $wire->user;
	$su = $wire->users->get('name=bridge');
	if($su && $su->id) {
		$wire->users->setCurrentUser($su);
		$key = $bridge->prefsKey();
		$wire->users->setCurrentUser($guest);
		check('a user\'s settings key is derived, not the id', (bool) preg_match('/^pwPrefs\.[0-9a-f]{20}$/', $key) && strpos($key, (string) $su->id) === false, $key);
	}
	$headSrc = (string) file_get_contents($themeDir . '_head.php');
	check('the head applies scheme and scale before paint, from the user key', strpos($headSrc, "c.prefsKey || 'pwPrefs.last'") !== false && strpos($headSrc, 'd.style.fontSize') !== false);
	$mainJs = (string) file_get_contents($themeDir . 'scripts/main.js');
	check('the theme script keeps prefs, scale and a rem-aware length reader', strpos($mainJs, 'pwPrefs.last') !== false && strpos($mainJs, 'data-pw-scale') !== false && strpos($mainJs, 'cssLength') !== false);
	// the drawer's menu toggle sits next to the logo; the right-hand controls take the free space
	check('the menu toggle sits next to the logo', !preg_match('/\.pw-nav-toggle\{[^}]*margin-left:auto/', $themeCss) && strpos($themeCss, 'body.pw-nav-overflow .pw-masthead-right{margin-left:auto}') !== false);
	// 0.11.4: the tree's focus ring fits its clipping branch; a screen without notices has a
	// narrow band; PageListSelect without list indent; sort arrows visible; Tab leaves a tag input
	check('a clipping tree branch keeps room for the focus ring', strpos($themeCss, '.PageList .PageList:not(:has(.PageList)):not(.pw-branch-scrolls){padding-left:.25rem;margin-left:calc(2em - .25rem)}') !== false && strpos($themeCss, 'a.PageListPage:focus-visible{border-radius:') !== false);
	check('no notices: a narrow band, except where a save swaps notices in', (bool) preg_match('/:has\(>#notices:empty\):not\(:has\(:is\(#ProcessPageEdit,[^)]*#ProcessProfile\)\)\) #main\{padding-top:/', $themeCss));
	check('PageListSelect actions and chosen pages without list indent', strpos($themeCss, '.PageListSelectHeader .PageListActions>li{border:0;padding:0;margin:0}') !== false && strpos($themeCss, '.InputfieldPageListSelectMultiple ol{padding:0}') !== false);
	check('unsorted column arrows are visible', (bool) preg_match('/\.tablesorter-header:not\(\.sorter-false\):after\{[^}]*opacity:\.7/', $themeCss));
	$tagsSrc = dirname(__DIR__) . '/runtime/src/fields/texttags.ts';
	if(is_file($tagsSrc)) check('Tab in a tag input takes the option and moves on', strpos((string) file_get_contents($tagsSrc), "if (e.key === 'Tab') e.preventDefault()") === false);
	// 0.11.5: nested repeater items draw their card from the indent; collapsed item headers are
	// rounded all round; tree items without children keep the caret's room outside the focus ring
	check('a nested repeater item has its card on header and content', strpos($themeCss, '.Inputfields>.InputfieldRepeaterItemHasDepth{background:none;outline:0}') !== false && strpos($themeCss, '.InputfieldRepeaterItemHasDepth>.InputfieldContent.ui-widget-content{background:var(--card)') !== false);
	check('a collapsed repeater item header is rounded all round', strpos($themeCss, '.InputfieldRepeaterItem.InputfieldStateCollapsed>.InputfieldHeader{border-radius:var(--radius-xl)}') !== false && !preg_match('/\.Inputfields \.InputfieldRepeater \.InputfieldRepeaterItem>\.InputfieldHeader\{[^}]*border-radius/', $themeCss));
	check('a tree item without children keeps the caret room outside its focus ring', strpos($themeCss, 'body:not(.pw-narrow-width) .PageListItem:not(.PageListHasChildren)>a.PageListPage{margin-left:') !== false);
}

echo $fails ? "\n$fails FAILED\n" : "\nall passed\n";
exit($fails ? 1 : 0);

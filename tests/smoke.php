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
$themeCss = $themeDir . 'assets/dist/theme.css';
check('theme.css built', is_file($themeCss));
if(is_file($themeCss)) {
	$css = file_get_contents($themeCss);
	check('theme.css under 75 kB raw', strlen($css) < 75 * 1024, (string) strlen($css));
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
// notices from a page save time out (scripts/main.js); behaviour is checked in a browser
$mainJs = (string) @file_get_contents($themeDir . 'scripts/main.js');
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
$listerJs = (string) @file_get_contents($themeDir . 'scripts/lister.js');
check('Lister reads ProcessListerScript by id, not by offset', strpos($listerJs, "getElementById('ProcessListerScript')") !== false && strpos($listerJs, 'pos + 21') === false);
check('legacy loader skips a script that fails to load', strpos($mainJs, 'urls.reduce(') === false && strpos($mainJs, 'console.warn(err.message)') !== false);
$pageSaveJs = (string) @file_get_contents($themeDir . 'scripts/page-save.js');
check('in-place save never re-posts a form it sent', !preg_match('/if\(!res\.redirected\) \{[^}]*classic\(/s', $pageSaveJs));
// 0.8.6: one inline-script runner, synchronous stand-ins (behaviour: setup-check ?focus=, lister, repeater)
check('theme script has the shared script runner', strpos($mainJs, 'runScripts: function(rootOrScripts, options)') !== false);
check('theme script defines stand-ins for Inputfields, Bridge, AdminDataTable', strpos($mainJs, "['Inputfields', 'Bridge', 'AdminDataTable'].forEach(") !== false && strpos($mainJs, "key === 'pwStub'") !== false);
// a runner copies a script's text into a new element and puts that in the page; loaders (src) don't
$runnerRe = '/\.text = [^;]+;\s*[\w.]*(appendChild|replaceChild|replaceWith)\(/';
$runners = array();
foreach(array('scripts/lister.js', 'scripts/page-save.js') as $f) {
	if(preg_match($runnerRe, (string) @file_get_contents($themeDir . $f))) $runners[] = $f;
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
// 0.8.7: one body observer, ownership by the stack (not by jQuery), placeholders, hand-over
// (behaviour: native-check placeholder and foreign-jquery, lister-check M, repeater-check B)
$observers = array();
foreach(glob($themeDir . 'scripts/*.js') as $f) $observers[basename($f)] = substr_count((string) file_get_contents($f), 'new MutationObserver(');
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
	$js = (string) @file_get_contents($themeDir . 'scripts/' . $f);
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
	// A6: AdminThemeBoss's never-saved settings are its defaults (both on)
	check('bossForcesUikit() reads Boss defaults', strpos((string) file_get_contents($themeDir . 'AdminThemeBridge.module.php'), "!array_key_exists(\$key, \$boss)") !== false);
	// A20: both sides guard the interface declaration
	check('the interface file is guarded', strpos((string) file_get_contents($themeDir . 'BridgeComponent.php'), "if(!interface_exists('ProcessWire\\\\BridgeComponent', false))") !== false);
	// A21: the inline-script rewrites match strings that still occur in core
	$wire = $config->paths->wire;
	$needles = array(
		'modules/Process/ProcessTemplate/ProcessTemplate.module' => array('$(document).ready(function() { ProcessTemplateInitFields(); });', "\$('#ProcessTemplatePageLister').iFrameResize({ });"),
		'modules/Process/ProcessField/ProcessField.module' => array('"jQuery(document).ready(function() { " . '),
		'modules/Markup/MarkupAdminDataTable/MarkupAdminDataTable.module' => array("AdminDataTable.initTable($('#\$id'));"),
		'modules/Process/ProcessPageEdit/ProcessPageEdit.module' => array("\$func = 'initPageEditForm();';", '"<scr" . "ipt>$func</script>"'),
		'modules/LanguageSupport/LanguageTabs.module' => array("setupLanguageTabs(\$('#\$id'));", '"<script>$func</script>"'),
		'modules/Process/ProcessPageEditImageSelect/ProcessPageEditImageSelect.module' => array('$(document).ready(function() { setupProcessSave('),
	);
	foreach($needles as $file => $list) {
		$src = is_file($wire . $file) ? (string) file_get_contents($wire . $file) : '';
		foreach($list as $needle) check("core still prints the string the theme rewrites ($file)", $src !== '' && strpos($src, $needle) !== false, $needle);
	}
}

echo $fails ? "\n$fails FAILED\n" : "\nall passed\n";
exit($fails ? 1 : 0);

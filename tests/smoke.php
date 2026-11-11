<?php namespace ProcessWire;

/**
 * Smoke test for the Bridge bootstrap: boots a sandbox install whose wire/ and site/ live at
 * non-default locations and checks that the core sees the layout correctly.
 *
 * Usage: php tests/smoke.php /path/to/sandbox/root
 * The sandbox is produced by tools/sandbox-site.sh (own DB copy, own site copy).
 * Writes to the sandbox's own database copy only, and refuses any other (exit 2, audit SE5):
 * the files move round trip saves a fixture page, the probes write files to the cache directory.
 * Needs the theme, BridgeCsp and the fixture pages (tools/sandbox-admin.php, tools/sandbox-fixture.php):
 * without them the run fails rather than skipping what it cannot check (audit BG9).
 */

$root = $argv[1] ?? (getenv('BRIDGE_SANDBOX') ?: '');
if($root === '') exit("Usage: php tests/smoke.php /path/to/sandbox/root (needs index.php + project.php)\n");
require dirname(__DIR__) . '/tools/lib/sandbox-guard.php';
$root = bridgeSandboxRoot($root);

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
bridgeSandboxBooted($config, $root);
/** @var ProcessWire $wire */
/** @var Config $config */
/** @var Modules $modules */
/** @var Pages $pages */
/** @var Templates $templates */

check('booted: $wire is a ProcessWire instance', isset($wire) && $wire instanceof ProcessWire);
check('index version seen by core is 303', PROCESSWIRE === 303);

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
foreach(array('AdminThemeBoss', 'SettingsFactory', 'StaticPages', 'WireMailSmtp', 'ProcessBridgeDemo') as $name) {
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
	// 97 kB raw since the admin title rules (0.30.0, raised by the owner; 90 kB since the page tree and
	// history drawers, 0.25.0); 18 kB gzip, the budget in check-css.mjs, raised by the owner for the
	// appearance seams (0.30.0)
	check('theme.css under 97 kB raw (the gzip budget in check-css.mjs is the binding one)', strlen($css) < 97 * 1024, (string) strlen($css));
	check('theme.css under 18 kB gzip', strlen(gzencode($css, 9)) <= 18 * 1024, (string) strlen(gzencode($css, 9)));
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
	// 0.29.0: an extension's stylesheets (manifest key `styles`) after fields.css, with the nonce
	$extStylesLine = '';
	foreach(explode("\n", $head) as $headLine) {
		if(strpos($headLine, "data-bridge-styles='") !== false) $extStylesLine = $headLine;
	}
	$posExtStyles = strpos($head, "data-bridge-styles='");
	check('_head.php prints the extension stylesheets after fields.css and before the modulepreloads, with the nonce', $posExtStyles !== false && $posFields !== false && $posExtStyles > $posFields
		&& $posExtStyles < (int) strpos($head, "rel='modulepreload'") && strpos($extStylesLine, '$nonce') !== false && strpos($extStylesLine, '$plan->extensionStyles') !== false, $extStylesLine);
	check('assetPlan() fills extensionStyles for every layout', strpos((string) file_get_contents($themeDir . 'lib/AdminThemeBridgeHead.php'), "\t\t\$plan->extensionStyles = \$this->extensionStyles();\n") !== false);
}
// the classic scripts' sources (0.9.0: runtime/src/classic/, built minified into scripts/); the
// source checks below read them, the presence checks the built files
$classicDir = is_dir(dirname(__DIR__) . '/runtime/src/classic') ? dirname(__DIR__) . '/runtime/src/classic/' : $themeDir . 'scripts/';
// notices from a page save time out (scripts/main.js); behaviour is checked in a browser
$mainJs = (string) @file_get_contents($classicDir . 'main.js');
$styleOrderSrc = (string) strstr((string) strstr($mainJs, 'setupStyleOrder: function'), 'var same = function', true);
check('setupStyleOrder leaves an extension stylesheet (data-bridge-styles) in place', strpos($styleOrderSrc, "node.hasAttribute('data-bridge-styles')") !== false);
check('theme script times out page-save notices', strpos($mainJs, 'this.setupNoticeTimeout();') !== false && strpos($mainJs, "addEventListener('pw-page-saved', arm)") !== false);
// the checks below need the theme: a sandbox without it fails here instead of skipping them (BG9)
check('AdminThemeBridge is installed in this sandbox (tools/sandbox-admin.php)', $modules->isInstalled('AdminThemeBridge'));
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
check('the UIkit stand-in is printed before every module script', strpos($themeSource, '$uikitLayer = array($this->themeAssetUrl(\'scripts/uikit-layer.js\'));') !== false);
// 0.24.1: upstream's slide-in panels (window.pwPanels) come with the legacy stack, as in AdminThemeUikit
check('panel.js is asked for as AdminThemeUikit does, panel.css goes with the stack', strpos($themeSource, "\$jqueryUI->use('panel');") !== false
	&& strpos((string) @file_get_contents($themeDir . 'lib/AdminThemeBridgeHead.php'), "\$panelCss = \$config->urls('JqueryUI') . 'panel.css';") !== false);
$faCssFile = glob($themeDir . 'assets/fonts/fa-*/fa.css');
$faCssText = $faCssFile ? (string) file_get_contents($faCssFile[0]) : '';
check('Font Awesome subsets carry a content hash', $faCssText === '' || (bool) preg_match('/url\(fa-solid-900-subset\.[0-9a-f]{8}\.woff2\)/', $faCssText));
// 0.29.1: chunks.json is the list of the released chunks (version, chunks, previous); a build keeps them,
// `npm run release-chunks` moves it on, `prune-chunks.mjs --check` (release-module.sh) checks the rest
$chunkList = json_decode((string) @file_get_contents($themeDir . 'assets/dist/chunks.json'), true);
$chunkListVersion = preg_match("/^[ 	]*'version' => '([0-9.]+)',/m", $themeSource, $clv) ? $clv[1] : '';
check('chunks.json lists the released chunks and the release before (version, chunks, previous)', is_array($chunkList)
	&& isset($chunkList['version']) && is_array($chunkList['chunks'] ?? null) && is_array($chunkList['previous'] ?? null) && count($chunkList['chunks']) > 0);
$chunkListMissing = is_array($chunkList) ? array_filter(array_merge((array) ($chunkList['chunks'] ?? array()), (array) ($chunkList['previous'] ?? array())), function($f) use($themeDir) { return !is_file($themeDir . 'assets/dist/chunks/' . $f); }) : array('(no list)');
check('every chunk chunks.json lists is a file in chunks/', !$chunkListMissing, implode(', ', $chunkListMissing));
check('chunks.json is released for the theme version (npm run release-chunks at the version bump)', is_array($chunkList) && $chunkListVersion !== '' && ($chunkList['version'] ?? '') === $chunkListVersion, ($chunkList['version'] ?? '') . ' vs ' . $chunkListVersion);
check('the build runs the prune self-test and has the release step; the release script checks the list before the split', strpos((string) @file_get_contents(dirname(__DIR__) . '/runtime/package.json'), '"release-chunks": "node scripts/prune-chunks.mjs --release"') !== false
	&& strpos((string) @file_get_contents(dirname(__DIR__) . '/runtime/package.json'), 'node scripts/prune-chunks.mjs --self-test && vite build && node scripts/prune-chunks.mjs &&') !== false
	&& ($relSh = (string) @file_get_contents(dirname(__DIR__) . '/tools/release-module.sh')) !== ''
	&& strpos($relSh, 'prune-chunks.mjs --check') !== false && strpos($relSh, 'prune-chunks.mjs --check') < strpos($relSh, 'git subtree split --prefix'));
// 0.11.7: cores before 3.0.265 have no $config->adminIcons and load Font Awesome 4.7 (family FontAwesome)
$faFamilies = preg_match_all('/"Font Awesome 6 Free"(?!\s*,\s*FontAwesome)/', $themeCss, $m);
check('theme glyphs fall back to Font Awesome 4 (FontAwesome)', $faFamilies === 0, (string) $faFamilies);
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
	// Add New skips the template step when the template is auto-selected (0.13.0)
	$fresh = $modules->wire(new AdminThemeBridge());
	check('"Step 2 if template auto-selected" is off by default', empty($fresh->pageAddSkipTemplate));
	check('the page-add hook is there', method_exists($bridge, 'hookPageAddBuildForm') && method_exists($bridge, 'pageAddAutoTemplate'));
	$allTemplates = array();
	foreach($templates as $t) $allTemplates[$t->id] = $t;
	$uniform = $mixed = null;
	foreach($pages->find('children.count>1, include=all, limit=200') as $p) {
		$n = $pages->count("parent_id=$p->id, templates_id!={$p->child('include=all, sort=sort')->template->id}, include=all");
		if(!$n && !$uniform) $uniform = $p;
		if($n && !$mixed) $mixed = $p;
		if($uniform && $mixed) break;
	}
	if($uniform) {
		list($t, $why) = $bridge->pageAddAutoTemplate($uniform, $allTemplates);
		check('children of one template: it is auto-selected', $t && $why === 'siblings' && $t->id == $uniform->child('include=all')->template->id, "$uniform->path: $why");
		$pageAdd = $config->pageAdd;
		$config->pageAdd = array('noSuggestTemplates' => $uniform->template->name);
		list($t,) = $bridge->pageAddAutoTemplate($uniform, $allTemplates);
		check('not when noSuggestTemplates names the parent template', !$t);
		$config->pageAdd = $pageAdd;
		list($t,) = $bridge->pageAddAutoTemplate($uniform, array_diff_key($allTemplates, array($uniform->child('include=all')->template->id => 1)));
		check('not when the children\'s template is not allowed', !$t);
	} else {
		warn('no parent with children of one template in the sandbox');
	}
	if($mixed) {
		list($t,) = $bridge->pageAddAutoTemplate($mixed, $allTemplates);
		check('children of mixed templates: none auto-selected', !$t, $mixed->path);
	} else {
		warn('no parent with children of mixed templates in the sandbox');
	}
	$only = $templates->get('basic-page') ?: reset($allTemplates);
	list($t, $why) = $bridge->pageAddAutoTemplate($pages->get('/'), array($only->id => $only));
	check('the only allowed template is auto-selected', $t && $t->id == $only->id && $why === 'only');
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
		// 0.26.0: compat classes for AdminPageTool, AdminPageDealers, PageTableNext, AgentTools
		check("AdminPageTool's pager needs no layer", $uikitScan("<ul class='MarkupPagerNav uk-pagination pw-pagination apt-pager'><li class='MarkupPagerNavSeparator uk-disabled pw-disabled'><span>&hellip;</span></li><li class='MarkupPagerNavOn uk-active pw-active'><a href='./'><span>2</span></a></li></ul>") === array());
		check("AdminPageDealers' table and button group need no layer", $uikitScan("<table class='uk-table uk-table-justify uk-table-responsive uk-table-divider'><tr><td><div class='uk-button-group'><a class='uk-button uk-button-default uk-button-small' href='#'>Edit</a></div></td></tr></table>") === array());
		$c1Added = array('uk-margin-large-top', 'uk-margin-large-bottom', 'uk-margin-medium-top', 'uk-padding-remove-top', 'uk-text-italic', 'uk-button-default', 'uk-button-group', 'uk-pagination', 'uk-disabled', 'uk-table-justify', 'uk-table-responsive', 'uk-list-bullet', 'uk-child-width-expand@m', 'uk-width-1-3@s', 'uk-width-2-3@s', 'uk-divider');
		$c1Covered = $bridge->getUikitCovered();
		$c1Missing = array_values(array_filter($c1Added, function($c) use($c1Covered) { return !isset($c1Covered[$c]); }));
		check('the covered list has the 16 classes added in 0.26.0 (127 or more in all)', !$c1Missing && count($c1Covered) >= 127, implode(',', $c1Missing) . ' / ' . count($c1Covered));
		check("C4 RockMigrations' striped table needs no layer", $uikitScan("<table class='uk-table uk-table-small uk-table-striped'><tr><td>x</td></tr></table>") === array());
		// 0.26.0: a uk-icon the compat rules draw is no reason
		$coveredJson = json_decode((string) file_get_contents($themeDir . 'assets/dist/uikit-covered.json'), true);
		check('uikit-covered.json has classes and icons, the manifest both lists', !empty($coveredJson['classes']) && !empty($coveredJson['icons']) && in_array('pencil', $coveredJson['icons'], true)
			&& is_array($c2Manifest = include($themeDir . 'assets/dist/manifest.php')) && $c2Manifest['uikitIcons'] === $coveredJson['icons'] && $c2Manifest['uikitCovered'] === $coveredJson['classes']);
		check('a covered uk-icon needs no layer: "icon: NAME", "NAME", data-uk-icon with options', $uikitScan('<span uk-icon="icon: pencil"></span><span uk-icon="pencil"></span><a data-uk-icon="icon: pencil; ratio: 2" href="#"></a><i uk-icon=\'trash;ratio: 1\'></i>') === array());
		check('an unknown icon name, or a spelling the compat rules do not match, is a reason', $uikitScan('<span uk-icon="icon: zzz"></span>') === array('Markup:uk-icon') && $uikitScan('<span uk-icon="icon:pencil"></span>') === array('Markup:uk-icon') && $uikitScan('<span data-uk-icon></span>') === array('Markup:uk-icon'));
		check('an icon value is read from the uk-icon attribute, not from another value', $uikitScan('<a title=\'uk-icon="icon: pencil"\' uk-icon="icon: zzz">x</a>') === array('Markup:uk-icon') && $uikitScan('<a title="uk-icon=zzz" uk-icon="icon: pencil">x</a>') === array());
		check("PageTableNext's row and button row need no layer (templates/ptn-content.php, InputfieldPageTableNext)", $uikitScan('<div class="ptn"><div class="ptn_meta uk-flex uk-flex-middle"><div class="ptn_label"><span class="ptn_label_icon" uk-icon="icon: chevron-right; ratio: 1"></span><span class="ptn_label_icon" uk-icon="icon: chevron-down; ratio: 1"></span>Title</div>'
			. "<div class=\"ptn_actions uk-margin-auto-left\">\n\t<a\n\t\tclass=\"uk-icon-button uk-icon ptn_actions_unpub\"\n\t\thref=\"#\"\n\t\ttitle=\"Public/Unpublish\"\n\t><i class=\"fa fa-toggle-on\"></i></a>\n\t<a\n\t\tclass=\"uk-icon-button uk-icon ptn_actions_copy\"\n\t\thref=\"#\"\n\t\tuk-icon=\"icon: copy; ratio: .8\"\n\t\ttitle=\"Copy\"\n\t></a>\n\t<a class=\"uk-icon-button uk-icon ptn_actions_delete\" href=\"#\" uk-icon=\"icon: trash; ratio: .8\" title=\"Delete\"></a>\n</div></div></div>"
			. "<hr class='uk-margin-medium-top'><div class='InputfieldPageTableButtons uk-divider uk-margin-top uk-margin-remove-bottom uk-flex uk-flex-wrap uk-child-width-expand@m' style='gap: 20px'><div class='InputfieldPageTableButtonsColumn uk-margin-small-top'><h6 class='uk-margin-small-bottom uk-text-muted uk-text-italic'>Add</h6><small class=\"uk-flex uk-flex-wrap\" style=\"gap: 5px\"></small></div></div>") === array());
		$uikitLayerJs = (string) file_get_contents($themeDir . 'scripts/uikit-layer.js');
		check('the client scan checks uk-icon against the icons and copies data-uk-icon', strpos($uikitLayerJs, '/^(?:icon: )?([\w-]+)(?:;|$)/') !== false && strpos($uikitLayerJs, '[data-uk-icon]:not([uk-icon])') !== false);
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
	// 0.26.0 C4: a jQuery script naming UIkit (RockMigrations.js on every davinci screen) asks for
	// the UIkit layer only where it is printed; deferred with the stack it is no reason
	$rmFile = $config->paths->cache . 'bridge-smoke-rm.js';
	$rmUrl = $config->urls->cache . 'bridge-smoke-rm.js';
	file_put_contents($rmFile, "\$(document).ready(function() { \$('.rm-hints input').each(function(i, el) { UIkit.tooltip(el); }); });");
	$config->scripts->add($rmUrl);
	$rmReason = function($legacy) use($modules) {
		$probe = $modules->wire(new AdminThemeBridge());
		if($legacy) $probe->needLegacy('Smoke:C4');
		$probe->settleUikitAssets();
		return count(array_filter(array_keys($probe->getUikitReasons()), function($r) { return strpos($r, 'Script:') === 0 && strpos($r, 'bridge-smoke-rm.js') !== false; }));
	};
	check('C4 a deferred jQuery script naming UIkit is no UIkit reason; printed with the stack it is', $bridge->isDeferredScript($rmUrl) && $rmReason(false) === 0 && $rmReason(true) === 1);
	$config->scripts->remove($rmUrl);
	@unlink($rmFile);
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
	// 0.24.0 (theoretic/bridge#3): a File/Image subclass borrows the core widget by declaration
	$srcOfEarly = function($rel) { return (string) @file_get_contents(dirname(__DIR__) . '/runtime/src/' . $rel); };
	if(!class_exists('ProcessWire\\BridgeSmokeSubImage', false)) {
		eval('namespace ProcessWire; class BridgeSmokeSubImage extends InputfieldImage {} class BridgeSmokeSubImageBare extends InputfieldImage {}');
	}
	$probe = $modules->wire(new AdminThemeBridge());
	$probe->addHookAfter('nativeMap', function(HookEvent $e) {
		$map = $e->return;
		$map['BridgeSmokeSubImage'] = array('kind' => 'field', 'widget' => 'InputfieldImage');
		$map['BridgeSmokeSubImageBare'] = array('kind' => 'field');
		$map['BridgeSmokeSubMarkup'] = array('kind' => 'wrapper', 'widget' => 'InputfieldImage');
		$e->return = $map;
	});
	$mark = new \ReflectionMethod($probe, 'markInputfield');
	$subImage = $modules->wire(new BridgeSmokeSubImage());
	$bareImage = $modules->wire(new BridgeSmokeSubImageBare());
	$coreImage = $modules->get('InputfieldImage');
	$subMarkup2 = $modules->wire(new BridgeSmokeSubMarkup());
	foreach(array($subImage, $bareImage, $coreImage, $subMarkup2) as $f) $mark->invoke($probe, $f, false);
	check('a File/Image subclass with `widget` keeps its class and gets the core widget', $subImage->wrapAttr('data-bridge-component') === 'BridgeSmokeSubImage'
		&& $subImage->wrapAttr('data-bridge-widget') === 'InputfieldImage', json_encode(array($subImage->wrapAttr('data-bridge-component'), $subImage->wrapAttr('data-bridge-widget'))));
	check('no widget without the key, for core itself, or for a class that is not a file field', $bareImage->wrapAttr('data-bridge-widget') === null
		&& $coreImage->wrapAttr('data-bridge-widget') === null && $coreImage->wrapAttr('data-bridge-component') === 'InputfieldImage' && $subMarkup2->wrapAttr('data-bridge-widget') === null);
	check('moves between fields stay with the core classes', strpos($srcOfEarly('fields/file.ts'), "export const CORE_FIELD = '.Inputfield[data-bridge-component=\"InputfieldFile\"], .Inputfield[data-bridge-component=\"InputfieldImage\"]'") !== false
		&& strpos($srcOfEarly('fields/file.ts'), '!inputfield.matches(CORE_FIELD)') !== false && strpos($srcOfEarly('fields/files-move.ts'), 'const FIELD = CORE_FIELD;') !== false);
	check('the registry starts the core widgets for a borrowing subclass', strpos($srcOfEarly('fields/registry.ts'), '.Inputfield[data-bridge-widget="InputfieldImage"]') !== false
		&& strpos($srcOfEarly('fields/registry.ts'), '.Inputfield[data-bridge-widget="InputfieldFile"]') !== false);
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
	$sortRows = $bridge->get('dataTableSortRows');
	$bridge->set('dataTableSortRows', 2);
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
	// 0.17.0: the dataTableSortRows threshold (default 10), for every table
	check('sortable rows threshold defaults to 10', $modules->wire(new AdminThemeBridge())->getDataTableSortRows() === 10);
	$bridge->set('dataTableSortRows', 10);
	check('a core table below the threshold does not sort', !$bridge->sortableDataTable($makeTable(array('A', 'B', 'C'), 9), $coreMaker));
	check('a core table at the threshold sorts', $bridge->sortableDataTable($makeTable(array('A', 'B', 'C'), 10), $coreMaker) === true);
	$sorted = function($rows) use($makeTable, $bridge) {
		$t = $makeTable(array('A', 'B', 'C'), $rows);
		$t->setSortable(true);
		$bridge->hookDataTableRenderBefore(new HookEvent(array('object' => $t)));
		return strpos($t->render(), 'AdminDataTableSortable') !== false;
	};
	check('a table made sortable stops sorting below the threshold', !$sorted(9));
	check('a table made sortable still sorts at the threshold', $sorted(10));
	$bridge->set('dataTableSortRows', 0);
	check('threshold 0: a core table still needs two rows', !$bridge->sortableDataTable($makeTable(array('A', 'B', 'C'), 1), $coreMaker) && $sorted(1));
	$bridge->set('dataTableSortRows', $sortRows);
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
	check('page-load chunks (guards, image upload) retry once, so a page being left logs nothing (0.26.0)', strpos((string) file_get_contents($rt . 'index.ts'), "importAgain(() => import('./guards'))") !== false
		&& strpos((string) file_get_contents($rt . 'fields/image.ts'), "importAgain(() => import('./image-upload'))") !== false);
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
	check('U2 focusable elements get a ring', strpos($themeCss, ':focus-visible{outline:var(--ring-width) solid var(--ring)') !== false);
	$rt = dirname(__DIR__) . '/runtime/src/';
	check('R7 sortable lists move by Alt+arrow', strpos((string) file_get_contents($rt . 'util/sortable.ts'), "e.key !== 'ArrowUp' && e.key !== 'ArrowDown'") !== false);
	check('R7 repeater controls and the language toggle are keyboard buttons', strpos((string) file_get_contents($rt . 'fields/repeater.ts'), 'keyButton(i, title)') !== false && strpos((string) file_get_contents($rt . 'inputfields/langtabs.ts'), 'keyButton(toggle') !== false);
	check('U3 dropdown toggles report aria-expanded', strpos((string) file_get_contents($themeDir . 'scripts/main.js'), 'aria-expanded') !== false);
}

// 0.10.1 (audit 2026-10-27, phase 5: architecture)
if(isset($bridge) && $bridge) {
	$traits = class_uses($bridge);
	// fourteen until 0.24.x; one per lib/ file that declares a trait since the drawers (0.25.0)
	$traitFiles = count(array_filter((array) glob($themeDir . 'lib/*.php'), function($f) { return (bool) preg_match('/^trait AdminThemeBridge\w+ \{/m', (string) file_get_contents($f)); }));
	check('PA1 the theme class uses every trait in lib/ (at least fifteen)', $traitFiles >= 15 && count(array_filter(array_keys($traits), function($t) { return strpos($t, 'ProcessWire\\AdminThemeBridge') === 0; })) === $traitFiles, implode(', ', array_keys($traits)));
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
	// 0.11.6: nesting (/bridge-nesting/ from tools/sandbox-fixture.php): a FieldsetPage has no inner
	// card; on touch screens item controls sit beside the label; on phones nested cards and depth
	// indents are smaller and checkbox tables wrap
	check('a FieldsetPage item has no card of its own', strpos($themeCss, '.InputfieldRepeaterSingle>.InputfieldContent>.Inputfields>.InputfieldRepeaterItem{background:none;outline:0}') !== false);
	check('touch: repeater item controls beside the label, not over it', (bool) preg_match('/@media ?\(hover:none\)\{[^@]*\.InputfieldRepeaterHeaderInit>\.InputfieldRepeaterItemControls\{[^}]*position:static/', $themeCss));
	check('phone: nested cards and repeater depth take less width', strpos($themeCss, '.InputfieldRepeaterItem[data-depth="1"]{padding-left:1rem!important}') !== false && strpos($themeCss, ':is(.InputfieldFieldset:not(.WireTab),.InputfieldItemList) .Inputfields{--pw-field-pad:') !== false);
	check('phone: checkbox table labels wrap', strpos($themeCss, '.InputfieldCheckboxes table label{white-space:normal}') !== false);
	// 0.11.8: thinner focus rings from two tokens; skip to content focuses <main> and rings its head
	check('focus rings take their widths from --ring-width and --ring-halo', strpos($themeCss, '--ring-width:') !== false && strpos($themeCss, '0 0 0 var(--ring-halo) var(--ring-50)') !== false && strpos($themeCss, 'outline:2px solid var(--ring)') === false && strpos($themeCss, '0 0 0 3px var(--ring-50)') === false);
	check('skip to content shows where it lands', strpos($mainJs, 'setupSkipLink:function') !== false && strpos($mainJs, 'pw-skip-landing') !== false && strpos($themeCss, '.pw-skip-landing{outline:') !== false);
	// 0.11.10: the page tree's extras chevron is centred in its pill, flipped or not
	check('the extras chevron is centred, without upstream margins', strpos($themeCss, '.PageList .PageListActionExtras>a>i{position:relative;top:.1em;left:-.045em;margin:0}') !== false && strpos($themeCss, '.PageList .PageListActionExtras>a>i.fa-flip-horizontal{left:.045em}') !== false);
	// 0.13.1: the dragged page tree item is a rounded band one row high, without the dashed outline
	check('the dragged tree item is a rounded, centred band', strpos($themeCss, '.PageList .PageListItem.PageListSortPlaceholder{display:flex;align-items:center;box-sizing:border-box;height:auto;min-height:1.875rem;') !== false && strpos($themeCss, 'outline:1px dashed var(--pw-primary-40)') === false);
	// 0.13.3: no dotted or dashed borders from the theme; upstream's are turned solid where they show
	$fieldsCss = (string) @file_get_contents($themeDir . 'assets/dist/fields.css');
	$dotted = '/(?:border|outline)[a-z-]*:[^;}]*\b(?:dotted|dashed)\b/';
	check('no dotted or dashed border in theme.css or fields.css', !preg_match($dotted, $themeCss) && !preg_match($dotted, $fieldsCss));
	check('upstream dashed borders turned solid (tables on phones, image tiles, crop grid, JSON slots)', strpos($themeCss, 'table.AdminDataTableResponsive tbody tr td{border-top:1px solid var(--pw-line)}') !== false
		&& strpos($fieldsCss, '.gridImage,.gridImage.InputfieldFileItemHidden{border-style:solid!important}') !== false
		&& strpos($fieldsCss, '.cropper-dashed{border-style:solid}') !== false && strpos($fieldsCss, 'div.jsoneditor-empty{border-color:var(--border);border-style:solid;') !== false);
	// 0.12.0: a save waits for uploads and other requests to the edit screen, then clicks again
	$pageEditJs = (string) @file_get_contents($themeDir . 'scripts/page-edit.js');
	$saveWaitJs = (string) @file_get_contents($themeDir . 'scripts/save-wait.js');
	check('a save waits for the page\'s requests', strpos($saveWaitJs, 'pw-uploading') !== false && strpos($saveWaitJs, 'gridImageUploading') !== false && strpos($saveWaitJs, 'submit_delete') !== false && strpos($saveWaitJs, 'loadend') !== false);
	check('save-wait.js is printed for the edit screens, deferred', strpos((string) @file_get_contents($themeDir . 'lib/AdminThemeBridgeHead.php'), "themeAssetUrl('scripts/save-wait.js')") !== false
		&& strpos((string) file_get_contents($themeDir . 'AdminThemeBridge.module.php'), "'scripts/save-wait.js', 'scripts/page-save.js'") !== false);
	check('the native upload confirm leaves a waiting save alone', strpos($pageEditJs, 'saveWait.claims(') !== false);
	check("runtime label 'saveWaiting' exists", isset($bridge->runtimeLabels()['saveWaiting']));
	$fieldsCss = (string) @file_get_contents($themeDir . 'assets/dist/fields.css');
	check('image upload: no spinner, progress bar in the primary', strpos($fieldsCss, '.gridImageUploading .gridImage__resize>.fa-spinner{display:none}') !== false && strpos($fieldsCss, '.gridImage__progress[value]::-webkit-progress-value{background:var(--primary)') !== false);
	// 0.12.1: an image marked for deletion has a 2px red ring, not a red padding
	check('image marked for deletion: 2px red ring', strpos($fieldsCss, '.gridImage--delete{background-color:var(--card);box-shadow:var(--shadow-sm),inset 0 0 0 .125rem var(--destructive)}') !== false);
	check('image tile buttons have rounded corners', strpos($fieldsCss, '.gridImage__btn{background:var(--card);color:var(--muted-foreground);border-radius:var(--radius-sm)}') !== false);
	check('image tile hover overlay has rounded corners', strpos($fieldsCss, '.gridImage__inner{border-radius:var(--radius-sm)}') !== false);
}

// 0.14.0: several items selected and dragged together; files moved between fields (ADR 0018)
if(isset($bridge) && $bridge) {
	$rt = dirname(__DIR__) . '/runtime/src/';
	$sortableSrc = (string) @file_get_contents($rt . 'util/sortable.ts');
	check('selection: util/selection.ts makes lists selectable', strpos((string) @file_get_contents($rt . 'util/selection.ts'), 'export function makeSelectable(') !== false);
	check('sortable: groups travel together, a handler may take the drag outside', strpos($sortableSrc, 'group?: (item: HTMLElement) => HTMLElement[]') !== false && strpos($sortableSrc, 'outside?: (item: HTMLElement') !== false && strpos($sortableSrc, 'export function edgeScroll(') !== false);
	check('file and image fields select and drag out', strpos((string) @file_get_contents($rt . 'fields/file.ts'), 'export function dragOut(') !== false && strpos((string) @file_get_contents($rt . 'fields/image.ts'), 'dragOut(inputfield, grid)') !== false);
	$movesSrc = (string) @file_get_contents($rt . 'fields/files-move.ts');
	check('a file move held on a closed tab header opens it after 600 ms, never Delete (0.26.0)', strpos($movesSrc, "const TAB = 'ul.WireTabs a[role=\"tab\"]:not(.on):not(#_ProcessPageEditDelete)';") !== false
		&& strpos($movesSrc, 'header.click(); }, 600)') !== false);
	check('files from the desktop held on a closed tab header open it (0.26.0)', strpos((string) @file_get_contents($rt . 'inputfields/forms.ts'), "closest?.<HTMLElement>('ul.WireTabs a[role=\"tab\"]:not(.on):not(#_ProcessPageEditDelete)')") !== false);
	$pagelistMoveSrc = (string) @file_get_contents($rt . 'fields/pagelist-move.ts');
	check('a touch hold released without moving is a held gesture, in sortable lists and tree moves (0.26.0)', strpos($sortableSrc, 'held?: (item: HTMLElement, e: PointerEvent) => void;') !== false
		&& strpos($sortableSrc, 'if (wasStill && options.held) options.held(item, e);') !== false
		&& strpos($pagelistMoveSrc, 'held?: (li: HTMLElement, e: PointerEvent) => void;') !== false
		&& strpos($pagelistMoveSrc, 'if (wasStill && c.held) c.held(li, e);') !== false);
	$selectionSrc = (string) @file_get_contents($rt . 'util/selection.ts');
	$pagelistSrc = (string) @file_get_contents($rt . 'fields/pagelist.ts');
	check('touch selection: a hold toggles the item; with a selection a tap toggles and does nothing else; a tap outside or on the background clears (0.26.0)',
		strpos($selectionSrc, 'held: item => {') !== false
		&& strpos($selectionSrc, 'if (item && sel.size && tapped(e) && !(touchIgnore && t.closest(touchIgnore))) {') !== false
		&& strpos($selectionSrc, 'e.stopImmediatePropagation();') !== false
		&& strpos($selectionSrc, "document.addEventListener('pointerup', e => {") !== false
		&& strpos($selectionSrc, 'if (!inst.container.contains(t) || inst.blank(t)) inst.api.clear();') !== false);
	check('touch selection is wired: file rows, image tiles and tree rows pass held to the selection (0.26.0)',
		substr_count((string) @file_get_contents($rt . 'fields/file.ts'), 'held: item => { if (state.select) state.select.held(item); },') === 1
		&& substr_count((string) @file_get_contents($rt . 'fields/image.ts'), 'held: item => { if (state.select) state.select.held(item); },') === 1
		&& strpos($pagelistSrc, 'held: li => select.held(li),') !== false
		&& strpos($pagelistMoveSrc, 'if (f.ripe && c.held) { swallowClick(); c.held(f.row, e); }') !== false);
	check('touch: the menu of several tree rows shows at the row a finger toggled (0.26.0)',
		strpos($pagelistSrc, 'loadGroup().then(g => g.showFor(li))') !== false
		&& strpos((string) @file_get_contents($rt . 'fields/pagelist-group.ts'), 'showFor: li => {') !== false);
	check('touch: a hold on a file row or an image tile opens no callout (0.26.0)', strpos($fieldsCss, '@media(pointer:coarse){.InputfieldFileList>.InputfieldFileItem>.InputfieldFileInfo{-webkit-touch-callout:none;') !== false
		&& strpos($fieldsCss, '@media(pointer:coarse){.gridImage .gridImage__overflow,.gridImage .gridImage__hover{-webkit-touch-callout:none;') !== false);
	check('files-move posts bridgeFilesMove, meta as JSON', strpos($movesSrc, "body.append('bridgeFilesMove', '1')") !== false && strpos($movesSrc, "body.append('meta', JSON.stringify(meta))") !== false);
	check('the page tree\'s moves are their own chunk, loaded with the tree', is_file($rt . 'fields/pagelist-move.ts') && strpos((string) @file_get_contents($rt . 'fields/pagelist.ts'), "import('./pagelist-move')") !== false && strpos((string) @file_get_contents($rt . 'fields/pagelist.ts'), "root, 0, true).then(() => loadMove())") !== false);
	check('the tree takes an empty sort answer as success', strpos((string) @file_get_contents($rt . 'fields/pagelist-move.ts'), 'if (!text && res.ok) return {};') !== false);
	// 0.14.1: one band and one menu for several selected tree rows
	$groupSrc = (string) @file_get_contents($rt . 'fields/pagelist-group.ts');
	check('several tree rows get one menu, without View, Edit (0.15.2) and Move (0.16.0), loaded when a second row is selected', strpos($groupSrc, "if (action.cn === 'View' || action.cn === 'Edit' || action.cn === 'Move') return;") !== false
		&& strpos((string) @file_get_contents($rt . 'fields/pagelist.ts'), "import('./pagelist-group')") !== false);
	check('the group menu decides AJAX or a dialog per row (Copy differs by children, 0.15.3)', strpos($groupSrc, 'const ajax = rows.filter(li => { const a = actionOf(li, cn); return !!a && !!a.ajax; });') !== false);
	check('the group menu finds extras by cn, not by their key', strpos($groupSrc, 'Object.values(action.extras).find(x => x.cn === cn)') !== false);
	// 0.16.0: no Move action in the native tree; a row the server gave Move is dragged by its title
	$treeSrc = (string) @file_get_contents($rt . 'fields/pagelist.ts');
	$treeMoveSrc = (string) @file_get_contents($rt . 'fields/pagelist-move.ts');
	check('the native tree shows no Move action, which only marks a row movable', strpos($treeSrc, "if (name === 'Move') return;") !== false
		&& strpos($treeSrc, "canMove: li => (actionsData.get(li) || []).some(a => a.cn === 'Move'),") !== false && strpos($treeSrc, '.PageListActionMove') === false);
	check('a tree row drags from its title, count or note, after 4 px or a 400 ms touch hold, never with a modifier', strpos($treeMoveSrc, "const GRIP = 'a.PageListPage, .PageListNumChildren, .PageListNote';") !== false
		&& strpos($treeMoveSrc, 'const THRESHOLD = 4;') !== false && strpos($treeMoveSrc, 'const HOLD = 400;') !== false && strpos($treeMoveSrc, 'e.ctrlKey || e.metaKey || e.shiftKey || e.altKey') !== false);
	check('a tree drag swallows its click and posts nothing when nothing changed', strpos($treeMoveSrc, 'swallowClick();') !== false && strpos($treeMoveSrc, 'if (unchanged()) { cancelMove(); return; }') !== false);
	check('a press on the group menu keeps the selection', strpos((string) @file_get_contents($rt . 'util/selection.ts'), ".pw-drag-ghost, .pw-group-actions';") !== false);
	foreach(array('nextPage', 'discardChanges', 'trashPages', 'groupFailed') as $key) check("runtime label '$key' exists", isset($bridge->runtimeLabels()[$key]));
	$treeGroupSrc = (string) @file_get_contents($rt . 'fields/pagelist-group.ts');
	check('group extras post each row quietly and report the failures in one alert (0.26.0)', strpos($treeGroupSrc, 'await c.ajaxAction(link, true)') !== false
		&& strpos($treeGroupSrc, "if (failed.length) c.alertMsg(label('groupFailed'") !== false
		&& strpos((string) @file_get_contents($rt . 'fields/pagelist.ts'), 'if (!quiet) alertMsg(') !== false);
	check('moves go through ProcessPageEdit::ajaxSave', strpos($themeSource, "addHookBefore('ProcessPageEdit::ajaxSave', \$this, 'hookPageEditAjaxSave')") !== false);
	check('moveFiles, moveFileAllowed, filesMoved are hookable', method_exists($bridge, '___moveFiles') && method_exists($bridge, '___moveFileAllowed') && method_exists($bridge, '___filesMoved'));
	foreach(array('selectedCount', 'moveTo', 'moveButton', 'moveGoes', 'moveBadExt', 'moveNoRoom', 'moveReplace', 'moveSwap', 'moveSkip', 'moveWait') as $key) {
		check("runtime label '$key' exists", isset($bridge->runtimeLabels()[$key]));
	}
	$fieldsCss = (string) @file_get_contents($themeDir . 'assets/dist/fields.css');
	$themeCss = (string) @file_get_contents($themeDir . 'assets/dist/theme.css');
	check('fields.css: band, selection, ghost, drop states, move dialog', strpos($fieldsCss, '.pw-marquee{position:fixed;') !== false && strpos($fieldsCss, '.gridImage.pw-selected{') !== false
		&& strpos($fieldsCss, '.pw-drag-ghost{position:fixed;') !== false && strpos($fieldsCss, '.Inputfield.pw-drop-no{') !== false && strpos($fieldsCss, 'dialog.pw-ask-move li{') !== false);
	check('theme.css rings a field that takes the dragged files', strpos($themeCss, '.Inputfield:is(.pw-drag-in-file,.pw-drop-ok){') !== false);
	check('selected tree rows stay inside the branch and join into one band', strpos($fieldsCss, '.PageList .PageListItem.pw-selected{--pw-sel-line:') !== false
		&& strpos($fieldsCss, '.PageList .PageListItem.pw-selected:has(+.PageListItem.pw-selected){') !== false && strpos($fieldsCss, 'margin:0 -8px;padding-left:8px') === false);
	check('the group menu has the action pills\' look', strpos($themeCss, '.pw-group-actions a{') !== false || strpos($themeCss, ',.pw-group-actions a{') !== false);
	// a real round trip on the fixture page (tools/sandbox-fixture.php): bf_files -> bf_docs and back
	$np = $pages->get('/bridge-native/');
	$su = $wire->users->get('name=bridge');
	if($np->id && $np->template->hasField('bf_docs') && $su && $su->id) {
		$guest = $wire->user;
		$wire->users->setCurrentUser($su);
		$np->of(false);
		$fg = $np->template->fieldgroup;
		$first = $np->bf_files->first();
		if($first) {
			$name = $first->basename;
			$desc = (string) $first->description;
			$r = $bridge->moveFiles($np, $fg->getFieldContext('bf_files'), $fg->getFieldContext('bf_docs'), array($name));
			$pages->uncache($np);
			$np = $pages->get($np->id);
			$np->of(false);
			$moved = $np->bf_docs->getFile($name);
			check('moveFiles moves a file to another field of the page, saved, the file still there', $r['ok'] && $moved && is_file($moved->filename) && !$np->bf_files->getFile($name), json_encode($r));
			$r = $bridge->moveFiles($np, $fg->getFieldContext('bf_docs'), $fg->getFieldContext('bf_files'), array($name), array('index' => 0));
			$pages->uncache($np);
			$np = $pages->get($np->id);
			$np->of(false);
			$back = $np->bf_files->first();
			check('moveFiles moves it back to the start, with its description', $r['ok'] && $back && $back->basename === $name && (string) $back->description === $desc && is_file($back->filename), json_encode($r));
			$r = $bridge->moveFiles($np, $fg->getFieldContext('bf_files'), $fg->getFieldContext('bf_images'), array($name));
			check('moveFiles refuses what an upload would refuse (a .txt for an image field)', !$r['ok'] && count($r['errors']) === 1 && $np->bf_files->getFile($name), json_encode($r));
		}
		// audit SE3: a swap asks moveFileAllowed() for the file going back too
		$img = $np->template->hasField('bf_image') && $np->template->hasField('bf_images') ? $np->bf_images->first() : null;
		if($img && $np->bf_image->count()) {
			$before = $np->bf_images->implode(',', 'basename') . '|' . $np->bf_image->implode(',', 'basename');
			$refuse = $bridge->addHookAfter('moveFileAllowed', function(HookEvent $e) {
				if($e->arguments(1)->name === 'bf_images') $e->return = 'smoke: not back';
			});
			$r = $bridge->moveFiles($np, $fg->getFieldContext('bf_images'), $fg->getFieldContext('bf_image'), array($img->basename), array('resolve' => array($img->basename => 'swap')));
			$bridge->removeHook($refuse);
			$pages->uncache($np);
			$np = $pages->get($np->id);
			$np->of(false);
			$after = $np->bf_images->implode(',', 'basename') . '|' . $np->bf_image->implode(',', 'basename');
			check('SE3 a swap asks moveFileAllowed() for the file going back', !$r['ok'] && count($r['errors']) === 1 && strpos($r['errors'][0]['message'], 'smoke: not back') !== false && $after === $before, json_encode($r));
			// output formatting comes back when a hook throws in the middle of a move
			$throw = $bridge->addHookBefore('moveFileAllowed', function(HookEvent $e) { throw new WireException('smoke: thrown'); });
			$np->of(true);
			$threw = false;
			try {
				$bridge->moveFiles($np, $fg->getFieldContext('bf_images'), $fg->getFieldContext('bf_image'), array($img->basename), array('resolve' => array($img->basename => 'swap')));
			} catch(WireException $e) {
				$threw = $e->getMessage() === 'smoke: thrown';
			}
			$bridge->removeHook($throw);
			check('SE3 moveFiles() restores output formatting when a hook throws', $threw && $np->of() === true);
			$np->of(false);
		} else {
			check('the fixture page has a file in bf_image (tools/sandbox-fixture.php)', false);
		}
		$wire->users->setCurrentUser($guest);
	} else {
		check('the sandbox has the fixture pages (tools/sandbox-fixture.php)', false);
	}
	$filesSrc = (string) file_get_contents($themeDir . 'lib/AdminThemeBridgeFiles.php');
	check('SE3 the move endpoint asks ProcessPageEdit::ajaxEditable() for the page and both fields', strpos($filesSrc, '!$process->ajaxEditable($page)') !== false
		&& strpos($filesSrc, '!$process->ajaxEditable($page, $from->name) || !$process->ajaxEditable($page, $to->name)') !== false);
	check('SE3 the move endpoint answers no raw exception text', strpos($filesSrc, "catch(\\Throwable \$e)") !== false && strpos($filesSrc, "get_class(\$e) === WireException::class") !== false);

	// audit 2026-11-01, R4: server hardening and bugs
	check('SE6 <html lang> is escaped and translated in the shell\'s textdomain', $bridge->shellLabel('lang') === 'en'
		&& strpos((string) file_get_contents($themeDir . '_main.php'), "entities(\$adminTheme->shellLabel('lang'))") !== false);
	$navHook = $bridge->addHookAfter('getUserNavArray', function(HookEvent $e) {
		$items = $e->return;
		$items[] = array('url' => '/x/', 'title' => 'Smoke', "onclick' data-evil='1" => 'x', 'data-smoke' => 'y', 'onclick' => 'return true', 'style' => 'color:red');
		$e->return = $items;
	});
	$nav = $bridge->renderUserNav();
	$bridge->removeHook($navHook);
	$nav = preg_match('~<a [^>]*>Smoke</a>~', $nav, $navItem) ? $navItem[0] : $nav;
	check('SE6 user nav prints attribute names it can name, as core documents them', strpos($nav, "data-smoke='y'") !== false && strpos($nav, "onclick='return true'") !== false
		&& strpos($nav, 'data-evil') === false && strpos($nav, 'style=') === false, $nav);
	check('BG4 another theme\'s assets are dropped by its module, not by a name prefix',
		$bridge->isOtherThemeAsset($config->urls->modules . 'AdminTheme/AdminThemeUikit/uikit/dist/css/uikit.pw.min.css')
		&& $bridge->isOtherThemeAsset($config->urls->siteModules . 'AdminThemeBoss/styles/x.css')
		&& !$bridge->isOtherThemeAsset($config->urls->siteModules . 'AdminThemeCustomizer/x.js')
		&& !$bridge->isOtherThemeAsset($config->urls->siteModules . 'AdminThemeBridgeX/x.js')
		&& !$bridge->isOtherThemeAsset($config->urls->adminTemplates . 'styles/AdminTheme.css'));
	$printScriptsWas = $bridge->get('printScripts');
	$list = new \ReflectionMethod($bridge, 'printScriptsList');
	$bridge->set('printScripts', "/a.js");
	$first = $list->invoke($bridge);
	$bridge->set('printScripts', "/b.js");
	$second = $list->invoke($bridge);
	$bridge->set('printScripts', $printScriptsWas);
	check('BG2 a new printScripts value drops the parsed list', $first === array('/a.js') && $second === array('/b.js'), json_encode(array($first, $second)));
	check('BG2 the head prints the clamped maximum width', strpos((string) file_get_contents($themeDir . 'lib/AdminThemeBridgeHead.php'), '$plan->maxWidth = (int) $this->getMaxWidth();') !== false
		&& strpos((string) file_get_contents($themeDir . '_head.php'), '(int) $adminTheme->maxWidth') === false);
	check('BG3 the breadcrumbs compare the Process by name, as core does', strpos((string) file_get_contents($themeDir . 'lib/AdminThemeBridgeShell.php'), '$process = (string) $this->wire()->page->process;') !== false);
	$serverWas = $_SERVER;
	$_SERVER['HTTP_SEC_FETCH_SITE'] = 'cross-site';
	$_SERVER['HTTP_SEC_FETCH_DEST'] = 'document';
	$cross = $bridge->pageAddSameOrigin();
	$_SERVER['HTTP_SEC_FETCH_SITE'] = 'same-origin';
	$_SERVER['HTTP_SEC_FETCH_DEST'] = 'image';
	$image = $bridge->pageAddSameOrigin();
	$_SERVER['HTTP_SEC_FETCH_DEST'] = 'document';
	$nav2 = $bridge->pageAddSameOrigin();
	unset($_SERVER['HTTP_SEC_FETCH_SITE'], $_SERVER['HTTP_SEC_FETCH_DEST']);
	$_SERVER['HTTP_REFERER'] = 'https://elsewhere.example/page';
	$foreign = $bridge->pageAddSameOrigin();
	$_SERVER = $serverWas;
	check('SE6 Add New quick-adds only for a navigation from this site', !$cross && !$image && $nav2 && !$foreign, json_encode(array($cross, $image, $nav2, $foreign)));
}

// 0.15.0: risky action warnings (ADR 0019)
if(isset($bridge) && $bridge) {
	$fresh = $modules->wire(new AdminThemeBridge());
	check('"Warn before risky actions" is on by default', !empty($fresh->dangerWarn));
	$found = false;
	$configFields = $modules->wire(new InputfieldWrapper());
	$bridge->getModuleConfigInputfields($configFields);
	foreach($configFields->getAll() as $f) if($f->attr('name') === 'dangerWarn') $found = true;
	check('the setting is in the module config', $found);
	// 0.25.0: page tree drawer, history and its cap, in Features after Extended breadcrumbs
	check('"Page tree on each page" and "Show history" are on by default, 100 history steps', (int) $fresh->pageTreeDrawer === 1 && (int) $fresh->history === 1 && $fresh->getHistorySteps() === 100);
	$steps = array();
	foreach(array(0, 'abc', 5, 10001, -3) as $v) {
		$fresh->set('historySteps', $v);
		$steps[] = $fresh->getHistorySteps();
	}
	check('history steps out of range or garbage give 100, 5 gives 5', $steps === array(100, 100, 5, 100, 100), json_encode($steps));
	$featureNames = array();
	$featuresFs = $configFields->getChildByName('_features');
	if($featuresFs) foreach($featuresFs->getAll() as $f) $featureNames[] = $f->attr('name');
	$at = array_search('extendedBreadcrumbs', $featureNames, true);
	check('Features: extendedBreadcrumbs, pageTreeDrawer, history, historySteps in this order', $at !== false
		&& array_slice($featureNames, $at, 4) === array('extendedBreadcrumbs', 'pageTreeDrawer', 'history', 'historySteps'), implode(', ', $featureNames));
	check('the history steps field is an integer within 1..10000', ($hs = $configFields->getChildByName('historySteps')) && $hs instanceof InputfieldInteger
		&& (int) $hs->attr('min') === 1 && (int) $hs->attr('max') === 10000);
	$labels = $bridge->runtimeLabels();
	foreach(array('warnThisField', 'warnReplaceTitle', 'warnReplace', 'warnReplaceNow', 'warnReplaceImage', 'warnOverwriteTitle', 'warnOverwrite',
		'warnSaveReplaceTitle', 'warnSaveReplace', 'warnVariationTitle', 'warnVariationsTitle', 'warnVariations', 'warnUninstallTitle', 'warnUninstall', 'warnRemoveDbTitle',
		'warnRemoveDb', 'warnCommentTitle', 'warnComment', 'warnActionTitle', 'warnAction', 'warnRenameTitle', 'warnRename', 'warnTrashTitle', 'warnTrash',
		'warnTrashMany', 'warnTrashKids', 'warnMoveImagesTitle', 'warnMoveImages', 'warnNewItemTitle', 'warnNewItem', 'warnVerbReplace', 'warnVerbOverwrite',
		'warnVerbDelete', 'warnVerbUninstall', 'warnVerbRemove', 'warnVerbApply', 'warnVerbSave', 'warnVerbTrash', 'warnVerbMove') as $key) {
		check("runtime label '$key' exists", isset($labels[$key]));
	}
	check('the warnings reach the runtime with the path history flag', strpos((string) file_get_contents($themeDir . 'lib/AdminThemeBridgeHead.php'), "\$bridgeJs['dangerWarn'] = (bool) \$this->dangerWarn;") !== false);
	$rt = dirname(__DIR__) . '/runtime/src/';
	$guardsSrc = (string) @file_get_contents($rt . 'guards.ts');
	foreach(array('drop', 'change', 'click', 'submit') as $type) {
		check("guards: a capture listener on window for $type", strpos($guardsSrc, "window.addEventListener('$type', on") !== false);
	}
	check('the guards load only while the setting is on', strpos((string) @file_get_contents($rt . 'index.ts'), "dangerWarn) importAgain(() => import('./guards'))") !== false);
	$left = array();
	foreach(array('fields/pagelist-group.ts', 'fields/repeater.ts', 'classic/page-edit.js', 'classic/lister.js', 'classic/setup.js') as $file) {
		if(strpos((string) @file_get_contents($rt . $file), 'window.confirm(') !== false) $left[] = $file;
	}
	check('no window.confirm left in the runtime\'s own confirms', !count($left), implode(', ', $left));
	$chunks = array_map('basename', (array) glob($themeDir . 'assets/dist/chunks/*.js'));
	foreach(array('guards', 'ask', 'danger') as $chunk) {
		check("the $chunk chunk is built", count(preg_grep('/^' . $chunk . '-[\w-]+\.js$/', $chunks)) > 0);
	}
	// 0.15.1: the page tree's rubber band starts beside the tree, at its height
	$selSrc = (string) @file_get_contents($rt . 'util/selection.ts');
	check('a band may start beside a selectable list (marqueeStrip), the page tree opts in', strpos($selSrc, 'if (inst.container.contains(t) || inst.strip(e)) lastActive = inst;') !== false
		&& strpos($selSrc, 'if (e.clientY < r.top || e.clientY > r.bottom) return false;') !== false && strpos((string) @file_get_contents($rt . 'fields/pagelist.ts'), 'marqueeStrip: true,') !== false);
	$themeCss = (string) @file_get_contents($themeDir . 'assets/dist/theme.css');
	check('theme.css has the warning dialog and its red button', strpos($themeCss, '.pw-ask-danger .pw-ask-message .fa{') !== false && strpos($themeCss, '.ui-button.pw-button-danger{') !== false);
}

// 0.18.0: the Content-Security-Policy nonce (ADR 0020)
if(isset($bridge) && $bridge) {
	$resetNonce = function() use($bridge) { (new \ReflectionProperty($bridge, 'nonceValue'))->setValue($bridge, null); };
	$resetNonce();
	check('CSP nonce() is empty unhooked, and so are the attribute and the meta', $bridge->cspNonce() === '' && $bridge->nonceAttr() === '' && $bridge->cspMeta() === '');
	check('CSP without a nonce the rewrites print what they printed before', $bridge->nonceScriptTag('<script>') === '<script>'
		&& $bridge->nativeInlineScripts("<script>\$(document).ready(function() { ProcessTemplateInitFields(); });</script>") === "<script>(window.jQuery ? jQuery : function(f) { document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', f) : f(); })(function() { ProcessTemplateInitFields(); });</script>");
	$smokeNonce = 'c21va2Utbm9uY2U+/A==';
	$nonceHook = $bridge->addHookAfter('nonce', function(HookEvent $e) use($smokeNonce) { $e->return = $smokeNonce . "' onload='x"; });
	$resetNonce();
	$attr = " nonce='$smokeNonce'";
	check('CSP a hook sets the nonce; characters outside base64 are dropped', $bridge->cspNonce() === $smokeNonce . 'onload=x', $bridge->cspNonce());
	$bridge->removeHook($nonceHook);
	$nonceHook = $bridge->addHookAfter('nonce', function(HookEvent $e) use($smokeNonce) { $e->return = $smokeNonce; });
	$resetNonce();
	check('CSP nonceAttr() and cspMeta() carry it', $bridge->nonceAttr() === $attr && $bridge->cspMeta() === "<meta property='csp-nonce'$attr />");
	check('CSP the nonce is asked once per request', (function() use($bridge, $smokeNonce) {
		$hook = $bridge->addHookAfter('nonce', function(HookEvent $e) { $e->return = 'changed'; });
		$same = $bridge->cspNonce() === $smokeNonce;
		$bridge->removeHook($hook);
		return $same;
	})());
	check('CSP nonceScriptTag() adds the nonce once, keeps attributes, leaves a nonce alone',
		$bridge->nonceScriptTag('<script>') === "<script$attr>"
		&& $bridge->nonceScriptTag("<script type='text/javascript'>") === "<script$attr type='text/javascript'>"
		&& $bridge->nonceScriptTag("<script nonce='other'>") === "<script nonce='other'>");
	check('SE1 data-nonce is not a nonce', $bridge->nonceScriptTag("<script data-nonce='x'>") === "<script$attr data-nonce='x'>");
	// audit SE1: known by the whole text, never by how it starts
	$foreign = array(
		"ProcessWire.config['Inputfield_x'] = {\"a\":1}; alert(1); y={};",
		"InputfieldSubmitDropdown.init('#s', null, false); alert(1);",
		"setupLanguageTabs($('#f'));alert(1)",
		"\$(document).ready(function() { alert(1); });",
		"window.CKEDITOR_BASEPATH='/x/';alert(1)",
		"vex.defaultOptions.className='vex-theme-default';alert(1);",
		"ProcessLister.initialized = true; alert(1);",
	);
	$stamped = array();
	foreach($foreign as $body) if(AdminThemeBridge::isKnownInlineScript($body)) $stamped[] = $body;
	check('SE1 a script that only begins like a core one is not known', !count($stamped), implode(' | ', $stamped));
	$known = array(
		"ProcessWire.config['Inputfield_metrics_repeater1224'] = {\"a\":[1,2],\"b\":\"<\\/script>\"};",
		"InputfieldSubmitDropdown.init('#submit_save', null, true);",
		"setupLanguageTabs($('#ProcessPageEdit'));",
		"\$(document).ready(function() { ProcessTemplateInitFields(); });",
		"jQuery(document).ready(function() { Inputfields.find('#Inputfield_title'); });",
		"\$(document).ready(function() { setupProcessSave('images', '0', 1); });",
		"vex.defaultOptions.className='vex-theme-default';vex.dialog.buttons.YES.text='Ok';vex.dialog.buttons.NO.text='Cancel';",
		"window.CKEDITOR_BASEPATH='/wire/modules/Inputfield/InputfieldCKEditor/ckeditor-4.19.0/';",
		"if(typeof AdminDataTable != 'undefined') AdminDataTable.initTable($('#ProcessFieldList'));",
		'initPageEditForm();', 'ProcessLister.initialized = true;',
	);
	$unknown = array();
	foreach($known as $body) if(!AdminThemeBridge::isKnownInlineScript($body)) $unknown[] = $body;
	check('SE1 core\'s own scripts are known', !count($unknown), implode(' | ', $unknown));
	$needleFiles = array_keys(AdminThemeBridge::upstreamNeedles());
	check('SE1 every known script\'s core file is watched by upstreamNeedles()', !count(array_diff(array_unique(array_values(AdminThemeBridge::knownInlineScripts())), $needleFiles)),
		implode(', ', array_diff(array_unique(array_values(AdminThemeBridge::knownInlineScripts())), $needleFiles)));
	// the rewrites vouch for the core scripts they rewrite, and only those
	$rewritten = $bridge->nativeInlineScripts("<script>\$(document).ready(function() { ProcessTemplateInitFields(); });</script><script>other();</script>" .
		"<script>\$(document).ready(function() { alert(1); });</script>");
	check('CSP nativeInlineScripts() stamps core\'s script, not the other', strpos($rewritten, "<script$attr>(window.jQuery") === 0 && strpos($rewritten, '<script>other();</script>') !== false, $rewritten);
	check('SE1 nativeInlineScripts() rewrites a foreign ready() but does not vouch for it', strpos($rewritten, "<script>(window.jQuery ? jQuery : function(f) { document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', f) : f(); })(function() { alert(1); });</script>") !== false, $rewritten);
	$vex = "vex.defaultOptions.className='vex-theme-default';vex.dialog.buttons.YES.text='Ok';vex.dialog.buttons.NO.text='Cancel';";
	check('CSP deferLegacyInline() stamps core\'s vex script, wrapped or not', $bridge->deferLegacyInline("<script>$vex</script>") === ($bridge->useLegacyStack()
		? "<script$attr>$vex</script>"
		: "<script$attr>ProcessWireAdminTheme.legacy.later(function(){{$vex}});</script>"));
	check('SE1 deferLegacyInline() wraps a foreign vex script but does not vouch for it', strpos($bridge->deferLegacyInline('<script>vex.x=1;alert(1)</script>'), "<script$attr>") === false);
	check('CSP deferLegacyInline() stamps core\'s CKEditor base path, not another head script',
		$bridge->deferLegacyInline("<script>window.CKEDITOR_BASEPATH='/x/';</script><script>other();</script>") === "<script$attr>window.CKEDITOR_BASEPATH='/x/';</script><script>other();</script>");
	$hookOut = function($method, $html) use($bridge) {
		$e = new HookEvent(array('object' => $bridge, 'method' => 'render', 'arguments' => array()));
		$e->return = $html;
		$bridge->$method($e);
		return $e->return;
	};
	$form = "<form id='f'><script>setupLanguageTabs($('#f'));</script><div><script>ProcessWire.config['Inputfield_x'] = {\"a\":1};</script>" .
		"<script>ProcessLister.initialized = true;</script><script>InputfieldSubmitDropdown.init('#s', null, false);</script><script>alert(1)</script></div></form>";
	$formOut = $hookOut('hookFormRender', $form);
	check('CSP hookFormRender() stamps LanguageTabs, the repeater config, the Lister line and the submit dropdown',
		strpos($formOut, "<script$attr>window.jQuery && setupLanguageTabs(jQuery('#f'));</script>") !== false
		&& strpos($formOut, "<script$attr>InputfieldSubmitDropdown.init('#s', null, false);</script>") !== false
		&& strpos($formOut, "<script$attr>ProcessWire.config['Inputfield_x']") !== false
		&& strpos($formOut, "<script$attr>ProcessLister.initialized = true;</script>") !== false, $formOut);
	check('CSP hookFormRender() leaves an unknown inline script without the nonce', strpos($formOut, '<script>alert(1)</script>') !== false);
	$evil = "<form id='g'><script>ProcessWire.config['Inputfield_x'] = {\"a\":1}; alert(2);</script><script>InputfieldSubmitDropdown.init('#s', null, false); alert(3);</script></form>";
	check('SE1 hookFormRender() gives no nonce to a script that only begins like core\'s', strpos($hookOut('hookFormRender', $evil), $attr) === false);
	$tableEvil = $hookOut('hookDataTableRender', "<script>if(typeof AdminDataTable != 'undefined') AdminDataTable.initTable($('#t')); alert(1);</script>");
	check('SE1 hookDataTableRender() gives no nonce to a longer script', strpos($tableEvil, $attr) === false, $tableEvil);
	check('CSP hookFormRender() on a nested wrapper stamps once', $hookOut('hookFormRender', $formOut) === $formOut);
	check('CSP hookFormRender() is hooked on every wrapper (the repeater item is one)', strpos($moduleSrc, "addHookAfter('InputfieldWrapper::render', \$this, 'hookFormRender'") !== false);
	$tableOut = $hookOut('hookDataTableRender', "<table id='t'></table>\n<script>if(typeof AdminDataTable != 'undefined') AdminDataTable.initTable($('#t'));</script>");
	check('CSP hookDataTableRender() stamps the table script', strpos($tableOut, "<script$attr>if(typeof AdminDataTable != 'undefined') AdminDataTable.initTable(window.jQuery ? jQuery('#t') : document.getElementById('t'));</script>") !== false, $tableOut);
	$editOut = $hookOut('hookPageEditExecute', "<form></form><script>initPageEditForm();</script>");
	check('CSP hookPageEditExecute() stamps the editor init', strpos($editOut, "<script$attr>typeof initPageEditForm === 'function'") !== false, $editOut);
	$bridge->removeHook($nonceHook);
	$resetNonce();
	check('CSP the theme asks for the nonce before the Process runs (AJAX responses get X-Bridge-Nonce)', strpos($themeSource, "public function hookProcessExecuteBefore(HookEvent \$event) {\n\t\t\$this->cspNonce();") !== false);

	// every <script>, <style> and modulepreload link the templates print carries the nonce
	$unstamped = array();
	foreach(glob($themeDir . '_*.php') as $f) {
		foreach(file($f, FILE_IGNORE_NEW_LINES) as $line) {
			// comments name the tags without printing them
			if(preg_match('~^\s*(//|\*|/\*)~', $line)) continue;
			// a tag up to its own closing bracket: an arrow or an embedded PHP block inside it does not end it
			if(!preg_match_all("~<(?:script|style)(?=[\s>'<])(?:<\?php.*?\?>|->|[^>])*>|<link rel='modulepreload'(?:->|[^>])*>~", $line, $m)) continue;
			foreach($m[0] as $tag) {
				if(strpos($tag, 'nonce') === false) $unstamped[] = basename($f) . ': ' . $tag;
			}
		}
	}
	check('CSP every script, style and modulepreload tag in the templates carries the nonce', !count($unstamped), implode(' | ', $unstamped));
	check('CSP the meta comes first in the head', preg_match('~\?>\s*<\?php echo \$adminTheme->cspMeta\(\); \?>\s*<meta http-equiv="content-type"~', (string) file_get_contents($themeDir . '_head.php')) === 1);
	$rewriteSrc = (string) file_get_contents($themeDir . 'lib/AdminThemeBridgeRewrites.php') . (string) file_get_contents($themeDir . 'lib/AdminThemeBridgeTables.php');
	check('SE1 no blanket pass over the page: the rewrites stamp only through nonceKnownScript()',
		substr_count($rewriteSrc, 'nonceScriptTag(') === 0 && substr_count($rewriteSrc, 'nonceKnownScript(') === 5, substr_count($rewriteSrc, 'nonceScriptTag(') . '/' . substr_count($rewriteSrc, 'nonceKnownScript('));
	// audit BG1: a pattern that fails leaves the markup as it came, and a failed verdict is no verdict
	$limit = ini_get('pcre.backtrack_limit');
	$jit = ini_get('pcre.jit');
	ini_set('pcre.jit', '0');
	ini_set('pcre.backtrack_limit', '1');
	$big = '<script>' . str_repeat('x', 2000) . '</script>';
	$deferOut = $bridge->deferLegacyInline($big);
	$verdict = AdminThemeBridge::needsJquery('/* ' . str_repeat('c', 2000) . ' */ var a = 1;');
	$failedPreg = preg_last_error() !== PREG_NO_ERROR;
	ini_set('pcre.backtrack_limit', $limit);
	ini_set('pcre.jit', $jit);
	check('BG1 a failed pattern leaves the head markup as it came', $deferOut === $big);
	check('BG1 a failed pattern answers "needs jQuery" and says it failed', $verdict === true && $failedPreg);
	check('BG1 isJqueryScript() keeps no verdict from a failed scan', strpos((string) file_get_contents($themeDir . 'lib/AdminThemeBridgeScripts.php'), "if(preg_last_error() !== PREG_NO_ERROR) return \$verdict;") !== false);
}

// 0.18.0: BridgeCsp (ADR 0020)
$cspFile = dirname(__DIR__) . '/modules/BridgeCsp/BridgeCsp.module.php';
check('CSP BridgeCsp ships', is_file($cspFile));
if(is_file($cspFile) && $modules->isInstalled('BridgeCsp')) {
	$csp = $modules->getModule('BridgeCsp', array('noInit' => true, 'noPermissionCheck' => true));
	check('CSP BridgeCsp defaults: off, the nonce policy with Trusted Types', $csp instanceof BridgeCsp
		&& strpos(BridgeCsp::defaultPolicy, "'nonce-{nonce}' 'strict-dynamic'") !== false
		&& strpos(BridgeCsp::defaultPolicy, "require-trusted-types-for 'script'; trusted-types bridge;") !== false);
	if($csp instanceof BridgeCsp) {
		$csp->set('mode', 'off');
		$offInactive = !$csp->active();
		$csp->set('mode', 'report-only');
		$reportActive = $csp->active();
		(new \ReflectionProperty($csp, 'nonce'))->setValue($csp, 'abc=');
		check('CSP BridgeCsp is active in report-only and enforce only, and fills in the nonce', $offInactive && $reportActive
			&& $csp->policyFor("script-src 'nonce-{nonce}';\n  object-src 'none';") === "script-src 'nonce-abc='; object-src 'none';");
	}
	check('CSP BridgeCsp sends its policy only under AdminThemeBridge', strpos((string) file_get_contents($cspFile), "\$theme->className() !== 'AdminThemeBridge'") !== false);
	$cspSrc = (string) file_get_contents($cspFile);
	check('TT BridgeCsp enforces only on screens without the legacy stack (the login screen stays report only)',
		strpos($cspSrc, "\$enforce = \$this->get('mode') === self::modeEnforce && !\$this->legacyScreen(\$theme);") !== false
		&& strpos($cspSrc, "addHookAfter('ProcessController::execute', \$this, 'sendPolicy')") !== false);
	check('SE6 BridgeCsp adds its policy next to a site\'s own, never in its place', strpos((string) file_get_contents($cspFile), 'header("$name: $policy", false);') !== false);
	check('CSP the sandbox installs BridgeCsp and junctions it', strpos((string) file_get_contents(__DIR__ . '/../tools/sandbox-admin.php'), "'BridgeCsp'") !== false
		&& strpos((string) file_get_contents(__DIR__ . '/../tools/sandbox-site.sh'), 'for m in AdminThemeBridge BridgeDemo BridgeCsp BridgeSample BridgeAdminAccessControl; do') !== false);
} else {
	check('BridgeCsp is installed in this sandbox (tools/sandbox-csp.php installs it)', false);
}
check('CSP tools/csp-check.js ships', is_file(dirname(__DIR__) . '/tools/csp-check.js'));
// audit SE2: fragments run only the scripts their response vouched for
$srcOf = function($rel) { return (string) @file_get_contents(dirname(__DIR__) . '/runtime/src/' . $rel); };
check('SE2 the theme script runs a fragment\'s script only with its response\'s nonce', strpos($srcOf('classic/main.js'), "if(page && (!want || (old.nonce || old.getAttribute('nonce') || '') !== want)) { skipped++; continue; }") !== false
	&& strpos($srcOf('classic/main.js'), 'if(page) live.nonce = page;') !== false);
check('SE2 the runtime\'s own runner has the same rule', strpos($srcOf('util/scripts.ts'), 'export function responseNonce(') !== false
	&& strpos($srcOf('util/scripts.ts'), "if (page && (!options.nonce || (old.nonce || old.getAttribute('nonce') || '') !== options.nonce))") !== false);
$loaders = array('inputfields/collapse.ts' => 'nonce: responseNonce(res)', 'inputfields/facade.ts' => 'nonce = responseNonce(r)',
	'fields/repeater.ts' => 'nonces.set(doc, responseNonce(res, doc))', 'classic/lister.js' => "res.headers.get('X-Bridge-Nonce')", 'classic/page-save.js' => 'runScripts(body, docNonce(doc))');
$noNonce = array();
foreach($loaders as $rel => $needle) if(strpos($srcOf($rel), $needle) === false) $noNonce[] = $rel;
check('SE2 every fragment loader passes its response\'s nonce', !count($noNonce), implode(', ', $noNonce));
check('SE2 the built theme script carries the rule', strpos((string) @file_get_contents($themeDir . 'scripts/main.js'), 'csp-nonce') !== false);

// 0.18.4: Trusted Types (ADR 0020 decisions 1, 2, 4, 7, 8)
$builtMain = (string) @file_get_contents($themeDir . 'scripts/main.js');
check('TT the theme script creates the one bridge policy', strpos($builtMain, 'createPolicy("bridge"') !== false || strpos($builtMain, "createPolicy('bridge'") !== false);
check('TT the runtime delegates to it and has its own only alone', strpos($srcOf('util/trusted.ts'), "createPolicy('bridge'") !== false && strpos($srcOf('util/trusted.ts'), 'ProcessWireAdminTheme') !== false);
$built = '';
foreach(array_merge((array) glob($themeDir . 'scripts/*.js'), (array) glob($themeDir . 'assets/dist/chunks/*.js'), array($themeDir . 'assets/dist/runtime.js')) as $file) $built .= (string) @file_get_contents($file);
check('TT no document.write and no javascript: URL in the built scripts', strpos($built, 'document.write') === false && strpos($built, 'javascript:') === false);
check('TT the build refuses a sink past the policy (check-sinks.mjs)', is_file(dirname(__DIR__) . '/runtime/scripts/check-sinks.mjs')
	&& strpos((string) file_get_contents(dirname(__DIR__) . '/runtime/package.json'), 'node scripts/check-sinks.mjs') !== false);
$handlersIn = "<button type='submit' name='delete' value='X' onclick=\"return confirm('Delete X?')\">Delete</button>" .
	"<input type='checkbox' onclick=\"return false\" /><a onclick=\"other()\">o</a>";
$handlersOut = isset($bridge) && $bridge ? $bridge->nativeInlineHandlers($handlersIn) : '';
check('TT core\'s inline confirm and click guard become data attributes, nothing else does', strpos($handlersOut, 'data-pw-confirm="Delete X?"') !== false
	&& strpos($handlersOut, "<input type='checkbox' data-pw-noclick />") !== false && strpos($handlersOut, 'onclick="other()"') !== false
	&& strpos($handlersOut, 'return confirm') === false, $handlersOut);
check('TT the setup script asks for them with the theme\'s dialog', strpos($srcOf('classic/setup.js'), "closest('[data-pw-confirm], [data-pw-noclick]')") !== false);
// 0.22.0: each user's own colour (the picker in the user menu, the user page's meta)
if(isset($bridge) && $bridge) {
	$memo = new \ReflectionProperty($bridge, 'userColorsValue');
	check('a colour is #rrggbb or nothing', AdminThemeBridge::hexColor(' #7C3AED ') === '#7c3aed' && AdminThemeBridge::hexColor('red') === '' && AdminThemeBridge::hexColor('#7c3aedff') === '');
	$memo->setValue($bridge, null);
	check('the colour in use is ringed, the site\'s too', strpos($srcOf('util/colors.ts'), "classList.toggle('pw-color-current'") !== false);
	check('a guest gets the site\'s colour and no picker', $bridge->userColors() === null && $bridge->renderColorPicker() === '' && $bridge->getVariant() === $bridge->siteVariant());
	$guest = $wire->user;
	$cu = $wire->users->get('name=bridge');
	if($cu && $cu->id) {
		$was = $cu->meta(AdminThemeBridge::userColorsMeta);
		$wire->users->setCurrentUser($cu);
		$cu->meta(AdminThemeBridge::userColorsMeta, array('variant' => 'custom', 'color' => '#7c3aed'));
		$memo->setValue($bridge, null);
		$picker = $bridge->renderColorPicker();
		check('a user\'s own custom colour is the page\'s, printed before first paint', $bridge->getVariant() === 'custom' && $bridge->getPrimaryColor() === '#7c3aed'
			&& strpos($bridge->renderHtmlAttributes(), "style='--pw-primary:#7c3aed'") !== false, $bridge->renderHtmlAttributes());
		check('the picker: five named presets, a custom colour, the site default, the CSRF token', substr_count($picker, "' data-pw-variant='") === 5
			&& strpos($picker, "data-pw-variant-pick='custom' value='#7c3aed'") !== false && strpos($picker, "class='pw-color-reset' data-pw-variant-pick=''") !== false
			&& strpos($picker, 'data-token-name=') !== false && strpos($picker, "pw-color-custom pw-color-current'") !== false);
		$cu->meta(AdminThemeBridge::userColorsMeta, array('variant' => 'purple', 'color' => ''));
		$memo->setValue($bridge, null);
		check('an unknown saved preset falls back to the site\'s colour', $bridge->userColors() === null && $bridge->getVariant() === $bridge->siteVariant());
		$bridge->set('userColors', 0);
		$cu->meta(AdminThemeBridge::userColorsMeta, array('variant' => 'pink', 'color' => ''));
		$memo->setValue($bridge, null);
		check('with "Users choose their own colour" off, the site\'s colour and no picker', $bridge->getVariant() === $bridge->siteVariant() && $bridge->renderColorPicker() === '');
		$bridge->set('userColors', 1);
		if(is_array($was)) $cu->meta(AdminThemeBridge::userColorsMeta, $was); else $cu->meta()->remove(AdminThemeBridge::userColorsMeta);
		$wire->users->setCurrentUser($guest);
		$memo->setValue($bridge, null);
	}
	check('the picker saves through the admin, before the Process runs', strpos((string) file_get_contents($themeDir . 'AdminThemeBridge.module.php'), "addHookBefore('ProcessController::execute', \$this, 'hookUserColorsSave')") !== false
		&& strpos((string) file_get_contents($themeDir . 'lib/AdminThemeBridgeUserColors.php'), '$this->wire()->session->CSRF->hasValidToken()') !== false);
}
// 0.25.0: the page tree and history drawers beside the logo
if(isset($bridge) && $bridge) {
	$loggedIn = new \ReflectionProperty($bridge, 'isLoggedIn');
	$guest = $wire->user;
	check('a guest gets no drawer buttons and no drawers', $bridge->renderDrawerButtons() === '' && $bridge->renderDrawers() === '');
	$su = $wire->users->get('name=bridge');
	if($su && $su->id && $su->isSuperuser()) {
		$wire->users->setCurrentUser($su);
		$loggedInWas = $loggedIn->getValue($bridge);
		$loggedIn->setValue($bridge, true);
		// the theme's own drawers: no extension's (BridgeSample is installed on the sandbox, 0.27.0)
		$drawerExtList = new \ReflectionProperty($bridge, 'extensionsList');
		$drawerSlotCache = new \ReflectionProperty($bridge, 'slotPartsCache');
		$drawerExtList->setValue($bridge, array());
		$drawerSlotCache->setValue($bridge, array());
		$settingsWas = array($bridge->pageTreeDrawer, $bridge->history);
		$bridge->set('pageTreeDrawer', 1);
		$bridge->set('history', 1);
		$buttons = $bridge->renderDrawerButtons();
		check('drawer buttons: the tree, then the history, icon-only and named', strpos($buttons, "<div class='pw-drawer-buttons'>") === 0
			&& strpos($buttons, "data-pw-drawer='tree' aria-controls='pw-drawer-tree' aria-expanded='false'") !== false
			&& strpos($buttons, "data-pw-drawer='history' aria-controls='pw-drawer-history'") > strpos($buttons, "data-pw-drawer='tree'")
			&& strpos($buttons, 'fa-sitemap') !== false && strpos($buttons, 'fa-history') !== false && substr_count($buttons, 'aria-label=') === 2, $buttons);
		$drawers = $bridge->renderDrawers();
		check('one dialog.pw-drawer per button, each with a named close button and a body', substr_count($drawers, "<dialog class='pw-drawer'") === 2
			&& strpos($drawers, "id='pw-drawer-tree'") !== false && strpos($drawers, "id='pw-drawer-history'") !== false
			&& substr_count($drawers, "class='pw-drawer-close' aria-label=") === 2 && substr_count($drawers, "<div class='pw-drawer-body'></div>") === 2, $drawers);
		$tplAt = strpos($drawers, "<template class='pw-drawer-template'>");
		check('the tree drawer holds the template the script clones', substr_count($drawers, "<template class='pw-drawer-template'>") === 1
			&& $tplAt > strpos($drawers, "id='pw-drawer-tree'") && $tplAt < strpos($drawers, "id='pw-drawer-history'"));
		$clearAt = strpos($drawers, "<button type='button' class='pw-drawer-action pw-history-clear' data-token-name='" . $session->CSRF->getTokenName() . "' data-token-value='" . $session->CSRF->getTokenValue() . "'>");
		check('the history drawer\'s head has a Clear button with the CSRF token, before its close button; the tree drawer none (0.26.0)', substr_count($drawers, 'pw-history-clear') === 1
			&& $clearAt > strpos($drawers, "id='pw-drawer-history'") && $clearAt < strrpos($drawers, "class='pw-drawer-close'")
			&& strpos($drawers, 'data-pw-drawer=') === false, $drawers);
		$bridge->set('pageTreeDrawer', 0);
		check('with "Page tree on each page" off, only the history button', $bridge->drawerNames() === array('history')
			&& strpos($bridge->renderDrawerButtons(), "data-pw-drawer='tree'") === false && substr_count($bridge->renderDrawers(), '<dialog') === 1);
		$bridge->set('history', 0);
		check('with both off, nothing', $bridge->renderDrawerButtons() === '' && $bridge->renderDrawers() === '');
		$bridge->set('pageTreeDrawer', 1);
		$bridge->set('history', 1);
		$pageWas = $wire->page;
		$treePage = $pages->get($config->adminRootPageID)->child('name=page, include=all');
		if($treePage->id) {
			$wire->wire('page', $treePage);
			check('the page tree screen itself shows no tree button, the history one', $bridge->drawerNames() === array('history'));
			$wire->wire('page', $pageWas);
		}
		// the drawer's tree: its own root-tree options, the global config untouched
		$jsWas = $config->js('ProcessPageList');
		$sharedWas = array_key_exists('ProcessPageList', $config->js());
		$opts = $bridge->treeDrawerOptions();
		check('the drawer tree: root 0 with the home page shown, the tree\'s URLs, no pre-rendered branches', $opts['rootPageID'] === 0 && $opts['showRootPage'] === true
			&& substr((string) $opts['ajaxURL'], -10) === 'page/list/' && $opts['openPageData'] === array() && isset($opts['moreLabel']), json_encode($opts));
		check('the global ProcessPageList config stays as it was (null stays null, not shared)', $config->js('ProcessPageList') === $jsWas
			&& array_key_exists('ProcessPageList', $config->js()) === $sharedWas, json_encode(array($jsWas, $sharedWas)));
		$config->js('ProcessPageList', array('rootPageID' => 1234, 'showRootPage' => false));
		$opts = $bridge->treeDrawerOptions();
		check('with the Children tab\'s tree in the global config, the drawer still gets a root tree and the config keeps the tab\'s', $opts['rootPageID'] === 0
			&& $opts['showRootPage'] === true && $config->js('ProcessPageList') === array('rootPageID' => 1234, 'showRootPage' => false), json_encode($config->js('ProcessPageList')));
		$config->set('ProcessPageList', $jsWas);
		// the cookie as the browser sent it (a set() would send a Set-Cookie header)
		$cookieData = new \ReflectionProperty('ProcessWire\WireInputData', 'data');
		$cookiesWas = $cookieData->getValue($wire->input->cookie);
		$cookieData->setValue($wire->input->cookie, array_merge($cookiesWas, array(AdminThemeBridge::treeDrawerCookie => "1-0,$treePage->id,999999999-0,abc,1-0")));
		$open = $bridge->treeDrawerOptions()['openPageIDs'];
		check('open branches from the drawer\'s own cookie: existing, listable, once, "id-start"; the cookie for the whole admin', $bridge->treeDrawerOptions()['cookieName'] === 'bridge_tree_open'
			&& $bridge->treeDrawerOptions()['cookiePath'] === $config->urls->admin &&  $open === array('1-0', "$treePage->id-0"), json_encode($open));
		$cookieData->setValue($wire->input->cookie, $cookiesWas);
		$tpl = $bridge->renderDrawers();
		check('the template holds a tree container with its options and the CSRF token, not #PageListContainer', strpos($tpl, "<div class='PageListContainer PageListContainerRoot pw-drawer-tree' data-pw-tree='{") !== false
			&& strpos($tpl, "data-token-name='" . $session->CSRF->getTokenName() . "'") !== false && strpos($tpl, "id='PageListContainer'") === false);
		$wire->input->get->modal = 1;
		check('a modal window (?modal=1) prints no drawers, no Clear button', $bridge->drawerNames() === array() && $bridge->renderDrawers() === '');
		$wire->input->get->remove('modal');
		$bridge->set('pageTreeDrawer', $settingsWas[0]);
		$bridge->set('history', $settingsWas[1]);
		$loggedIn->setValue($bridge, $loggedInWas);
		$wire->users->setCurrentUser($guest);
		$drawerExtList->setValue($bridge, null);
		$drawerSlotCache->setValue($bridge, array());
	}
	$headSrc = (string) file_get_contents($themeDir . 'lib/AdminThemeBridgeHead.php');
	check('the drawers script is printed where a drawer is, deferred', strpos($headSrc, "if(count(\$this->drawerNames())) \$print[] = \$this->themeAssetUrl('scripts/drawers.js');") !== false
		&& strpos((string) file_get_contents($themeDir . 'AdminThemeBridge.module.php'), "'scripts/page-save.js', 'scripts/drawers.js');") !== false && is_file($themeDir . 'scripts/drawers.js'));
	$mastheadSrc = (string) file_get_contents($themeDir . '_masthead.php');
	$logoAt = strpos($mastheadSrc, "class='pw-logo-link'");
	$buttonsAt = strpos($mastheadSrc, 'renderDrawerButtons()');
	check('the masthead prints the buttons after the logo, before the nav toggle, and the drawers after the header', $logoAt !== false && $buttonsAt > $logoAt
		&& $buttonsAt < strpos($mastheadSrc, "class='pw-nav-toggle'") && strpos($mastheadSrc, "</header>\n<?php echo \$adminTheme->renderDrawers(); ?>") !== false);
	check('theme.css has the drawers', strpos((string) @file_get_contents($themeDir . 'assets/dist/theme.css'), 'dialog.pw-drawer::backdrop') !== false);
}
// 0.25.0: the visit history (the user page's meta, newest first, a visit again counts, capped)
if(isset($bridge) && $bridge) {
	$guest = $wire->user;
	$proc = function($name) use($modules) { return $modules->getModule($name, array('noInit' => true, 'noPermissionCheck' => true)); };
	$historyWas = $bridge->history;
	$bridge->set('history', 1);
	check('history: a guest records nothing', !$bridge->historyRecord($proc('ProcessTemplate')) && $bridge->historyEntries() === array());
	$moduleSrc = (string) file_get_contents($themeDir . 'AdminThemeBridge.module.php');
	check('history: recorded after the Process, its table answered before it, only while the setting is on', (bool) preg_match('/if\(\$this->history\) \{\s*\$this->addHookBefore\(\'ProcessController::execute\', \$this, \'hookHistoryFragment\'\);\s*\$this->addHookAfter\(\'ProcessController::execute\', \$this, \'hookHistoryRecord\'\);/', $moduleSrc)
		&& method_exists($bridge, '___historyEntry'));
	check('history: a headline as text, ProcessModule\'s icon token out', AdminThemeBridge::historyName('<icon-plug> Some &amp; <b>Module</b>') === 'Some & Module');
	$hu = $wire->users->get('name=bridge');
	$admin = $pages->get($config->adminRootPageID);
	$setupPage = $admin->child('name=setup, include=all');
	$tplPage = $setupPage->id ? $setupPage->child('name=template, include=all') : new NullPage();
	$fieldPage = $setupPage->id ? $setupPage->child('name=field, include=all') : new NullPage();
	$modPage = $admin->child('name=module, include=all');
	$tpl = null;
	foreach($wire->templates as $histTpl) if(!($histTpl->flags & Template::flagSystem) && $histTpl->name !== '') { $tpl = $histTpl; break; }
	if($hu && $hu->id && $tplPage->id && $fieldPage->id && $modPage->id && $tpl) {
		$wire->users->setCurrentUser($hu);
		$histMetaWas = $hu->meta(AdminThemeBridge::historyMeta);
		$serverWas = $_SERVER;
		$pageWas = $wire->page;
		$headWas = $wire->wire('processHeadline');
		$stepsWas = $bridge->historySteps;
		$ajaxWas = $config->ajax;
		$visit = function($adminPage, array $get, $headline, $segment = '') use($wire) {
			$wire->wire('page', $adminPage);
			foreach(array_keys($wire->input->get->getArray()) as $k) $wire->input->get->remove($k);
			foreach($get as $k => $v) $wire->input->get->$k = $v;
			$wire->input->setUrlSegments($segment === '' ? array() : array($segment));
			$wire->wire('processHeadline', $headline);
		};
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$bridge->set('historySteps', 100);
		$bridge->historyClear();
		$visit($tplPage, array('id' => $tpl->id, 'modal' => '', 's' => 2), "Edit Template: $tpl->name", 'edit');
		$entry = $bridge->historyEntry($proc('ProcessTemplate'), $tplPage);
		check('history: a template editor visit is a "template" entry with its headline and its editor\'s URL', is_array($entry) && $entry['type'] === 'template'
			&& $entry['name'] === "Edit Template: $tpl->name" && substr($entry['url'], -strlen("setup/template/edit?id=$tpl->id")) === "setup/template/edit?id=$tpl->id"
			&& strpos($entry['url'], '/') !== 0, json_encode($entry));
		$bridge->historyRecord($proc('ProcessTemplate'));
		$bridge->historyRecord($proc('ProcessTemplate'));
		$entries = $bridge->historyEntries();
		check('history: the same screen twice is one entry with two visits', count($entries) === 1 && reset($entries)['visits'] === 2, json_encode($entries));
		$visit($fieldPage, array(), 'Fields');
		$bridge->historyRecord($proc('ProcessField'));
		$visit($modPage, array('name' => 'AdminThemeBridge'), '<icon-paint-brush> Bridge');
		$bridge->historyRecord($proc('ProcessModule'));
		$entries = array_values($bridge->historyEntries());
		check('history: newest first; the fields list is a "screen", a module\'s settings a "module" without the icon token', count($entries) === 3
			&& $entries[0]['type'] === 'module' && $entries[0]['name'] === 'Bridge' && $entries[1]['type'] === 'screen' && $entries[2]['type'] === 'template', json_encode($entries));
		$bridge->set('historySteps', 2);
		$visit($fieldPage, array('id' => 1), 'Edit Field: title', 'edit');
		$bridge->historyRecord($proc('ProcessField'));
		$entries = array_values($bridge->historyEntries());
		check('history: with 2 steps the oldest go before the new one is kept', count($entries) === 2 && $entries[0]['type'] === 'field' && $entries[1]['type'] === 'module', json_encode($entries));
		$bridge->set('historySteps', 100);
		$before = count($bridge->historyEntries());
		$visit($tplPage, array('id' => $tpl->id), "Edit Template: $tpl->name", 'edit');
		$_SERVER['REQUEST_METHOD'] = 'POST';
		$post = $bridge->historyRecord($proc('ProcessTemplate'));
		$_SERVER['REQUEST_METHOD'] = 'GET';
		$config->ajax = true;
		$ajax = $bridge->historyRecord($proc('ProcessTemplate'));
		$config->ajax = $ajaxWas;
		$wire->input->get->modal = 1;
		$modal = $bridge->historyRecord($proc('ProcessTemplate'));
		$wire->input->get->remove('modal');
		$wire->input->get->render = 'JSON';
		$json = $bridge->historyRecord($proc('ProcessTemplate'));
		$wire->input->get->remove('render');
		check('history: a POST, an AJAX request, a modal window and ?render= output record nothing', !$post && !$ajax && !$modal && !$json && count($bridge->historyEntries()) === $before);
		check('history: the login, search and Add New screens are skipped', $bridge->historyEntry($proc('ProcessLogin'), $tplPage) === null
			&& $bridge->historyEntry($proc('ProcessPageSearch'), $tplPage) === null && $bridge->historyEntry($proc('ProcessPageAdd'), $tplPage) === null);
		$visit($tplPage, array('id' => $tpl->id, 'q' => str_repeat('x', 300)), 'Long', 'edit');
		check('history: a URL over 250 characters is not a key', $bridge->historyEntry($proc('ProcessTemplate'), $tplPage) === null);
		$visit($tplPage, array('z' => '1', 'id' => $tpl->id, $session->CSRF->getTokenName() => 'x'), 'Sorted', 'edit');
		$sorted = $bridge->historyEntry($proc('ProcessTemplate'), $tplPage);
		check('history: the query sorted, the CSRF token dropped', is_array($sorted) && substr($sorted['url'], -strlen("edit?id=$tpl->id&z=1")) === "edit?id=$tpl->id&z=1", json_encode($sorted));
		// 0.26.0: request-only parameters leave the key; the drawer marks the key historyEntry() returns
		$bridge->historyClear();
		$visit($modPage, array('reset' => 2), 'Modules');
		$bridge->historyRecord($proc('ProcessModule'));
		$visit($modPage, array(), 'Modules');
		$bridge->historyRecord($proc('ProcessModule'));
		$entries = array_values($bridge->historyEntries());
		check('history: module/?reset=2 and module/ are one entry with two visits', count($entries) === 1 && $entries[0]['visits'] === 2
			&& substr($entries[0]['url'], -7) === 'module/', json_encode($entries));
		$visit($fieldPage, array('login' => 1), 'Fields');
		$loginEntry = $bridge->historyEntry($proc('ProcessField'), $fieldPage);
		$visit($modPage, array('uninstalled' => 'X'), 'Modules');
		$uninstEntry = $bridge->historyEntry($proc('ProcessModule'), $modPage);
		check('history: ?login= and ?uninstalled= are dropped from the key', is_array($loginEntry) && substr($loginEntry['url'], -12) === 'setup/field/'
			&& is_array($uninstEntry) && substr($uninstEntry['url'], -7) === 'module/', json_encode(array($loginEntry, $uninstEntry)));
		$currentKey = new \ReflectionMethod($bridge, 'historyCurrentKey');
		$visit($fieldPage, array(), 'Fields');
		$plainKey = $currentKey->invoke($bridge, $proc('ProcessField'));
		$rewriteHook = $wire->addHookAfter('AdminThemeBridge::historyEntry', function(HookEvent $e) {
			if(is_array($e->return)) $e->return = array_merge($e->return, array('url' => 'bridge-rewritten/key'));
		});
		$rewrittenKey = $currentKey->invoke($bridge, $proc('ProcessField'));
		$loginKey = $currentKey->invoke($bridge, $proc('ProcessLogin'));
		$wire->removeHook($rewriteHook);
		$hu->meta(AdminThemeBridge::historyMeta, array(
			'bridge-rewritten/key' => array('name' => 'Rewritten', 'type' => 'screen', 'url' => 'bridge-rewritten/key', 'visits' => 1, 'last' => 1000),
			'setup/field/' => array('name' => 'Fields', 'type' => 'screen', 'url' => 'setup/field/', 'visits' => 1, 'last' => 2000),
		));
		$rewrittenTable = $bridge->renderHistoryTable($rewrittenKey);
		check('history: the drawer marks the key a historyEntry hook rewrote, the plain URL when the screen records nothing', $rewrittenKey === 'bridge-rewritten/key'
			&& substr($plainKey, -12) === 'setup/field/' && $loginKey === $plainKey && substr_count($rewrittenTable, "aria-current='page'") === 1
			&& strpos($rewrittenTable, "bridge-rewritten/key' aria-current='page'") !== false, json_encode(array($plainKey, $rewrittenKey, $loginKey)));
		$bridge->historyClear();
		$bridge->set('history', 0);
		$visit($tplPage, array('id' => $tpl->id), 'Off', 'edit');
		check('history: with "Show history" off, nothing is recorded', !$bridge->historyRecord($proc('ProcessTemplate')));
		// the drawer's table (step 6)
		$hu->meta(AdminThemeBridge::historyMeta, array(
			'setup/field/' => array('name' => 'Fields', 'type' => 'screen', 'url' => 'setup/field/', 'visits' => 3, 'last' => 1000),
			"setup/template/edit?id=$tpl->id" => array('name' => 'A <b>bold</b> & "quoted" one', 'type' => 'template', 'url' => "setup/template/edit?id=$tpl->id", 'visits' => 1, 'last' => 2000),
		));
		$table = $bridge->renderHistoryTable('setup/field/');
		$adminUrl = $config->urls->admin;
		check('history table: two rows, newest first, the name escaped, the type translated, visits with the last visit', substr_count($table, '<tr><td>') === 2
			&& strpos($table, "setup/template/edit?id=$tpl->id") < strpos($table, "href='{$adminUrl}setup/field/'")
			&& strpos($table, 'A &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; one') !== false && strpos($table, '<b>') === false
			&& strpos($table, "<td class='pw-history-visits' title='") !== false && strpos($table, '>3</td>') !== false && strpos($table, "<caption class='pw-sr-only'>") !== false, $table);
		check('history table: the current screen\'s entry is aria-current, the other is not', substr_count($table, "aria-current='page'") === 1
			&& strpos($table, "href='{$adminUrl}setup/field/' title='setup/field/' aria-current='page'") !== false, $table);
		$hu->meta(AdminThemeBridge::historyMeta, array(
			"page/edit/?id=1&q=a'b<c" => array('name' => "Home <'x'>", 'type' => 'page', 'url' => "page/edit/?id=1&q=a'b<c", 'visits' => 1, 'last' => 1000),
			'page/edit/?id=2' => array('name' => "Home <'x'>", 'type' => 'page', 'url' => 'page/edit/?id=2', 'visits' => 1, 'last' => 2000),
		));
		$sameTable = $bridge->renderHistoryTable();
		check('history table: each name link has its key as title, escaped, so same-named rows differ (0.26.0)',
			strpos($sameTable, "title='page/edit/?id=1&amp;q=a&#039;b&lt;c'>Home &lt;&#039;x&#039;&gt;</a>") !== false
			&& strpos($sameTable, "title='page/edit/?id=2'>Home &lt;&#039;x&#039;&gt;</a>") !== false && strpos($sameTable, "a'b<c") === false, $sameTable);
		check('history table: an unknown type prints as it is, escaped', $bridge->historyTypeLabel('x<y') === 'x<y' && $bridge->historyTypeLabel('pages') !== 'pages');
		// 0.26.0: the drawer's Clear button POSTs bridgeHistory=clear with the CSRF token
		$clearSeed = array('setup/field/' => array('name' => 'Fields', 'type' => 'screen', 'url' => 'setup/field/', 'visits' => 1, 'last' => 1000));
		$tokenName = $session->CSRF->getTokenName();
		$fragment = function($method, array $post, array $get = array()) use($wire, $bridge, $config) {
			$_SERVER['REQUEST_METHOD'] = $method;
			foreach(array_keys($wire->input->post->getArray()) as $k) $wire->input->post->remove($k);
			foreach(array_keys($wire->input->get->getArray()) as $k) $wire->input->get->remove($k);
			foreach($post as $k => $v) $wire->input->post->$k = $v;
			foreach($get as $k => $v) $wire->input->get->$k = $v;
			$config->ajax = true;
			$e = new HookEvent(array('object' => $wire->wire(new ProcessController()), 'method' => 'execute', 'arguments' => array()));
			$bridge->hookHistoryFragment($e);
			// the CLI reads no status code once output began: a refusal is the 403's ' ' answer
			$out = array('replace' => $e->replace, 'refused' => $e->return === ' ', 'return' => $e->return);
			foreach(array_keys($wire->input->post->getArray()) as $k) $wire->input->post->remove($k);
			$_SERVER['REQUEST_METHOD'] = 'GET';
			return $out;
		};
		$bridge->set('history', 1);
		$visit($fieldPage, array(), 'Fields');
		$hu->meta(AdminThemeBridge::historyMeta, $clearSeed);
		$noToken = $fragment('POST', array('bridgeHistory' => 'clear'));
		$badToken = $fragment('POST', array('bridgeHistory' => 'clear', $tokenName => 'wrong'));
		check('history Clear: a POST without a valid token is refused (403) and the history stays', $noToken['replace'] && $noToken['refused']
			&& $badToken['refused'] && count($bridge->historyEntries()) === 1, json_encode(array($noToken, $badToken)));
		$getClear = $fragment('GET', array(), array('bridgeHistory' => 'clear'));
		check('history Clear: a GET with bridgeHistory=clear only reads the table', !$getClear['refused'] && strpos((string) $getClear['return'], "<table class='pw-history'>") === 0
			&& count($bridge->historyEntries()) === 1, json_encode($getClear));
		$bridge->set('history', 0);
		$offClear = $fragment('POST', array('bridgeHistory' => 'clear', $tokenName => $session->CSRF->getTokenValue()));
		$bridge->set('history', 1);
		check('history Clear: with "Show history" off, refused and nothing cleared', $offClear['refused'] && count($bridge->historyEntries()) === 1, json_encode($offClear));
		$okClear = $fragment('POST', array('bridgeHistory' => 'clear', $tokenName => $session->CSRF->getTokenValue()));
		check('history Clear: with the token the history is gone and the answer is the empty sentence', $okClear['replace'] && !$okClear['refused']
			&& $hu->meta(AdminThemeBridge::historyMeta) === null && strpos((string) $okClear['return'], "<p class='pw-history-empty'>") === 0, json_encode($okClear));
		$config->ajax = $ajaxWas;
		$bridge->historyClear();
		check('history: historyClear() forgets it', $bridge->historyEntries() === array());
		check('history table: none yet, a sentence instead', strpos($bridge->renderHistoryTable(), "<p class='pw-history-empty'>") === 0);
		// put everything back
		$visit($pageWas, array(), (string) $headWas);
		$wire->wire('page', $pageWas);
		$_SERVER = $serverWas;
		$bridge->set('historySteps', $stepsWas);
		if(is_array($histMetaWas)) $hu->meta(AdminThemeBridge::historyMeta, $histMetaWas); else $hu->meta()->remove(AdminThemeBridge::historyMeta);
		$wire->users->setCurrentUser($guest);
	} else {
		warn('history: no bridge user, Setup > Templates/Fields, Modules or site template: history checks skipped');
	}
	$bridge->set('history', $historyWas);
}
check('the picker\'s work is a runtime chunk; editors follow a colour change', strpos($srcOf('index.ts'), "import('./util/colors')") !== false
	&& strpos($srcOf('classic/main.js'), "document.addEventListener('pw-variant-change'") !== false);

// 0.23.0: users' requests: the scale in percent, the tree pager top left, the fields list's
// checkboxes on demand, text links in the link colour, code with a ground
$themeCss023 = (string) @file_get_contents($themeDir . 'assets/dist/theme.css');
if(isset($bridge) && $bridge) {
	$controls = $bridge->renderViewControls();
	check('the scale in percent follows the larger button', (bool) preg_match("/data-pw-scale='1'.*?<\/button><button [^>]*data-pw-scale-reset[^>]*>100%<\/button>/s", $controls));
}
check('the theme script shows the scale and goes back to 100 %', strpos($srcOf('classic/main.js'), "shown[j].textContent = Math.round(v * 100) + '%'") !== false
	&& strpos($srcOf('classic/main.js'), "e.target.closest('[data-pw-scale-reset]')") !== false);
check('the tree pager sits top left and stays in view', strpos($themeCss023, '.PageList>ul[data-pagination]{') !== false
	&& (bool) preg_match('/\.PageList>ul\[data-pagination\]\{[^}]*margin:[^;}]*auto[^;}]* 0!important[^}]*position:sticky/', $themeCss023));
check('the fields list\'s checkboxes and Delete wait for Select', strpos($srcOf('classic/setup.js'), "button.id = 'pw-select-fields'") !== false
	&& strpos($themeCss023, 'body.pw-select-off table:has(.checkbox-ids)') !== false && strpos($themeCss023, 'body.pw-select-off #submit_delete{display:none}') !== false);
check('text links take the link colour, underlined with the black preset', preg_match('/--pw-text-link: ?color-mix\(/', $themeCss023)
	&& preg_match('/\[data-pw-variant=black\]\{--pw-text-link-line: ?underline\}/', $themeCss023) && strpos($themeCss023, ':where(#main) a:not([class])') !== false);
check('code and code blocks have a ground and rounded corners', (bool) preg_match('/body\.AdminThemeBridge :not\(pre\)>code\{[^}]*background:var\(--muted\)/', $themeCss023)
	&& (bool) preg_match('/body\.AdminThemeBridge pre\{[^}]*border-radius:var\(--radius-md\)[^}]*background:var\(--muted\)/', $themeCss023));

// 0.23.1 (theoretic/bridge#2): in an image field's list view the checkerboard is on the image only
check('list view: no checkerboard around the thumbnail', strpos((string) @file_get_contents($themeDir . 'assets/dist/fields.css'), '.InputfieldImageEditAll .gridImage__overflow{background:none}') !== false);

// 0.21.1: every icon the shell shows on every screen is in the subsets
$faCssShipped = (string) @file_get_contents($themeDir . 'assets/fonts/fa-6.7.2/fa.css');
$solidRange = preg_match('/font-family:"Font Awesome 6 Free";font-style:normal;font-weight:900;font-display:block;src:url\(fa-solid-900-subset[^)]*\)[^;]*;unicode-range:([^}]+)\}/', $faCssShipped, $fm) ? $fm[1] : '';
$inRange = function($cp) use($solidRange) {
	foreach(explode(',', $solidRange) as $part) {
		$ab = explode('-', strtolower(str_replace('U+', '', trim($part))));
		if($cp >= hexdec($ab[0]) && $cp <= hexdec($ab[1] ?? $ab[0])) return true;
	}
	return false;
};
check('PF3 tools/fa-coverage.js reads the hashed subset names', strpos((string) file_get_contents(dirname(__DIR__) . '/tools/fa-coverage.js'), '/-subset(\.[0-9a-f]+)?\.woff2/') !== false);
check('PF3 the scale buttons\' icons (search-minus, search-plus) are in the solid subset', $faCssShipped === '' || ($solidRange !== '' && $inRange(0xf010) && $inRange(0xf00e)));
check('the drawer buttons\' icons (sitemap, history) are in the solid subset', $faCssShipped === '' || ($solidRange !== '' && $inRange(0xf0e8) && $inRange(0xf1da)));

// docs that follow the code (audit BG10)
$themeInfo = (string) file_get_contents($themeDir . 'AdminThemeBridge.module.php');
$themeVersion = preg_match("/'version' => '([0-9.]+)'/", $themeInfo, $vm) ? $vm[1] : '';
check('BG10 the README and the CHANGELOG name the module\'s version', $themeVersion !== ''
	&& strpos((string) file_get_contents(dirname(__DIR__) . '/README.md'), "AdminThemeBridge $themeVersion;") !== false
	&& strpos((string) file_get_contents(dirname(__DIR__) . '/CHANGELOG.md'), "## AdminThemeBridge $themeVersion:") !== false, $themeVersion);
$aclExtDoc = (string) file_get_contents(dirname(__DIR__) . '/docs/extensions.md');
check('ACL docs: BridgeAdminAccessControl in section 7 of docs/extensions.md and in the README', preg_match('/\n## 7\. Bundled extensions\n.*?\| `BridgeAdminAccessControl`.*?\n## 8\. /s', $aclExtDoc) === 1
	&& strpos((string) file_get_contents(dirname(__DIR__) . '/README.md'), 'BridgeAdminAccessControl') !== false);
check('ACL docs: the conformance suite opens the module\'s config screen', strpos((string) file_get_contents(dirname(__DIR__) . '/conformance/screens.txt'), "{admin}module/edit?name=BridgeAdminAccessControl\n") !== false);
check('BG10 the files from upstream code say so', strpos((string) file_get_contents(dirname(__DIR__) . '/bootstrap/Bootstrap.php'), 'Mozilla Public License 2.0') !== false
	&& strpos($srcOf('fields/asmselect.ts'), 'Copyright (c) 2009-2019 by Ryan Cramer, licensed under the MIT license') !== false);

// 0.21.0: architecture (audit AR1, AR2, AR3, AR5)
$themeLib = $themeDir . 'lib/';
$traitMembers = array();
foreach(glob($themeLib . 'AdminThemeBridge*.php') as $f) {
	if(basename($f) === 'AdminThemeBridgeAssetPlan.php') continue;
	if(preg_match_all('/^\t(?:(?:protected|public|private)(?:\s+static)?\s+\$\w+|const\s+\w+)/m', (string) file_get_contents($f), $m)) $traitMembers[] = basename($f) . ': ' . implode(', ', $m[0]);
}
check('AR1 the traits declare no properties or constants: they stay in the module file', !count($traitMembers), implode(' | ', $traitMembers));
$moduleSrc = (string) file_get_contents($themeDir . 'AdminThemeBridge.module.php');
$firstMethod = strpos($moduleSrc, "\n\tpublic function __construct()");
check('AR1 the module file declares its properties before its methods', $firstMethod !== false
	&& !preg_match('/^\t(?:protected|public|private)\s+\$\w+/m', substr($moduleSrc, $firstMethod)));
$headSrc = (string) file_get_contents($themeDir . '_head.php');
check('AR1 _head.php prints the asset plan and decides nothing', strpos($headSrc, '$plan = $adminTheme->assetPlan($layout);') !== false
	&& strpos($headSrc, 'extract(') === false && strpos($headSrc, 'is_file(') === false && strpos($headSrc, 'manifest(') === false);
if(isset($bridge) && $bridge) {
	$plan = $bridge->assetPlan('');
	check('AR1 assetPlan() returns the plan with the theme stylesheet and script', $plan instanceof AdminThemeBridgeAssetPlan
		&& strpos($plan->themeCss, 'assets/dist/theme.css?v=') !== false
		&& count(array_filter($plan->scripts, function($s) { return strpos($s['url'], 'scripts/main.js?v=') !== false && !$s['defer']; })) === 1);
	check('AR2 stripQuery() and one verdict path for jQuery and UIkit scripts', AdminThemeBridge::stripQuery('/a/b.js?v=1#x') === '/a/b.js'
		&& AdminThemeBridge::localScriptPath('//cdn.example/x.js') === '' && AdminThemeBridge::localScriptPath('/site/x.js?v=2') === '/site/x.js'
		&& strpos((string) file_get_contents($themeLib . 'AdminThemeBridgeUikit.php'), "return \$this->scriptVerdict(\$path, 'uikit');") !== false);
	$bridge->set('nativeOverrides', "ProcessFoo=native\n# a comment\nnot a rule\nProcessBar = legacy");
	check('AR2 one parser for the native overrides setting', $bridge->getNativeOverrides() === array('ProcessFoo' => 'native', 'ProcessBar' => 'legacy')
		&& $bridge->nativeOverrideErrors() === array('not a rule'));
	$bridge->set('nativeOverrides', '');
}
check('AR2 the classic scripts share $, $$ and flash() from the theme object', strpos($srcOf('classic/main.js'), "flash: function(el, ms) {") !== false
	&& strpos($srcOf('classic/setup.js'), 'function $(sel, root)') === false && strpos($srcOf('classic/lister.js'), 'function $(sel, root)') === false);
check('AR2 one el() and one file name reader in the runtime', strpos($srcOf('util/dom.ts'), 'export function el<') !== false
	&& strpos($srcOf('fields/pagelist.ts'), 'function el<') === false && strpos($srcOf('guards.ts'), 'function basename(') === false);
$runtimeDir = dirname(__DIR__) . '/runtime/';
check('AR3 the classic scripts are type-checked in the build', strpos((string) @file_get_contents($runtimeDir . 'package.json'), 'tsc -p tsconfig.classic.json') !== false
	&& is_file($runtimeDir . 'types/classic.d.ts') && strpos((string) @file_get_contents($runtimeDir . 'tsconfig.classic.json'), '"checkJs": true') !== false);
check('AR5 tools/ci.sh runs every step and fails on any', is_file(dirname(__DIR__) . '/tools/ci.sh')
	&& strpos((string) file_get_contents(dirname(__DIR__) . '/tools/ci.sh'), 'exit ${#failed[@]}') !== false);
check('AR5 conformance fails when no screen rendered under either theme, and gate1 sees a server under MSYS_NO_PATHCONV',
	strpos((string) file_get_contents(dirname(__DIR__) . '/conformance/run.php'), '$noneRendered = $total && $siteFails === $total;') !== false
	&& strpos((string) file_get_contents(dirname(__DIR__) . '/tools/gate1.sh'), "curl -s -o /dev/null") === false);

// 0.20.2: the runtime's own words translated, one rule for asking (audit UX6, UX7)
$englishLeft = array();
foreach(array('fields/image.ts' => "setAttribute('aria-label', 'Thumbnail size')", 'fields/upload.ts' => 'is a invalid file extension', 'fields/datetime.ts' => 'aria-label="month"',
	'fields/pagelistselect.ts' => "data.message || 'Error')") as $rel => $needle) {
	if(strpos($srcOf($rel), $needle) !== false) $englishLeft[] = $rel;
}
check('UX6 no English-only words left in the runtime\'s own controls', !count($englishLeft), implode(', ', $englishLeft));
if(isset($bridge) && $bridge) {
	$missing = array_diff(array('thumbSize', 'add', 'month', 'year', 'hour', 'minute', 'second', 'error', 'badExt', 'tooBig'), array_keys($bridge->runtimeLabels()));
	check('UX6 their labels are runtime labels', !count($missing), implode(', ', $missing));
}
check('UX7 several pages dropped on the trash always ask, one asks with the setting on', strpos($srcOf('fields/pagelist-move.ts'), "const ok = await (one ? guard : (o: Parameters<typeof guard>[0]) => confirm({ danger: true, ...o }))({") !== false
	&& strpos($srcOf('fields/pagelist-group.ts'), "if (cn !== 'Trash') { run(); return; }\n\t\tvoid confirm({") !== false);

// 0.20.1: keyboard moves, reduced motion, touch, contrast and stacking (audit UX2-UX5)
check('UX2 the page tree moves a row with Alt+Arrow keys; selections take Ctrl+Space and Shift+Space', strpos($srcOf('fields/pagelist-move.ts'), "root.addEventListener('keydown', e => {") !== false
	&& strpos($srcOf('util/selection.ts'), "if (e.key === ' ' && (e.ctrlKey || e.shiftKey) && !e.altKey && !e.metaKey) {") !== false);
$motionLeft = array();
foreach(new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(dirname(__DIR__) . '/runtime/src', \FilesystemIterator::SKIP_DOTS)) as $f) {
	$rel = str_replace('\\', '/', substr($f->getPathname(), strlen(dirname(__DIR__) . '/runtime/src/')));
	if(!preg_match('/\.(ts|js)$/', $rel) || $rel === 'util/motion.ts') continue;
	$code = (string) file_get_contents($f->getPathname());
	if(strpos($rel, 'classic/') === 0) {
		// a classic script that animates asks still() first
		if(preg_match('/\.animate\(/', $code) && strpos($code, 'ProcessWireAdminTheme.still()') === false && $rel !== 'classic/main.js') $motionLeft[] = $rel;
		if(strpos($code, "behavior: 'smooth'") !== false && strpos($code, "still ? 'auto' : 'smooth'") === false) $motionLeft[] = $rel . ' (smooth scroll)';
	} else if(preg_match('/\w\.animate\(|behavior: \'smooth\'/', $code)) {
		$motionLeft[] = $rel;
	}
}
check('UX3 every flash, fade and smooth scroll follows prefers-reduced-motion', !count($motionLeft), implode(', ', $motionLeft));
$widgetsCss = (string) @file_get_contents(dirname(__DIR__) . '/runtime/src/styles/fields/12-widgets.css');
check('UX4 whole items drag after a touch hold; only handles take the finger at once', strpos($srcOf('util/sortable.ts'), "if (e.pointerType === 'touch' && getComputedStyle(grip).touchAction !== 'none') {") !== false
	&& strpos($widgetsCss, '.asmListSortable .asmListItem, .pw-sortable-item { touch-action: none; }') === false && strpos($widgetsCss, '.InputfieldRepeaterDrag { touch-action: none; }') !== false);
$tokensCss = (string) @file_get_contents(dirname(__DIR__) . '/runtime/src/styles/00-tokens.css');
check('UX5 neutral control edges (the owner\'s call, 0.22.0) and one stacking scale', strpos($tokensCss, '--input: #e5e5e5;') !== false && strpos($tokensCss, '--pw-z-popup: 80;') !== false
	&& strpos($widgetsCss, '.pw-group-actions { position: fixed; z-index: var(--pw-z-popup);') !== false);

// 0.20.0: dialogs, drawer and tabs (audit UX1); the browser side is tools/a11y-check.js
check('UX1 the dialog asks before a dismissal throws away unsaved changes, and focuses its window', strpos($srcOf('elements/pw-dialog.ts'), "private async dismiss(): Promise<void>") !== false
	&& strpos($srcOf('elements/pw-dialog.ts'), "dialog.addEventListener('cancel', e => {") !== false
	&& strpos($srcOf('elements/pw-dialog.ts'), 'this.frame?.contentWindow?.focus()') !== false);
check('UX1 every dialog is named', strpos($srcOf('util/choose.ts'), "d.setAttribute('aria-labelledby', title.id);") !== false
	&& strpos($srcOf('fields/files-move.ts'), "d.setAttribute('aria-labelledby', message.id);") !== false
	&& strpos($srcOf('util/lightbox.ts'), "d.setAttribute('aria-label',") !== false
	&& strpos($srcOf('classic/debug-tools.js'), "dialog.setAttribute('aria-labelledby', 'pw-debug-title');") !== false);
check('UX1 the drawer closes on Escape and gives the focus back', strpos($srcOf('classic/main.js'), "if(e.key === 'Escape' && drawerOpen() && !document.querySelector('dialog[open]')) drawer(false, true);") !== false);
check('UX1 WireTabs and language tabs are tablists with arrow keys', strpos($srcOf('classic/wire-tabs.js'), "list.setAttribute('role', 'tablist');") !== false
	&& strpos($srcOf('classic/wire-tabs.js'), "ArrowRight: i + 1") !== false
	&& strpos($srcOf('inputfields/langtabs.ts'), "if (ul) ul.setAttribute('role', 'tablist');") !== false);
if(isset($bridge) && $bridge) {
	$labels = $bridge->runtimeLabels();
	$missing = array_diff(array('image', 'remove', 'moreActions', 'imageViewList', 'imageViewLeft', 'imageViewGrid', 'pickDate'), array_keys($labels));
	check('UX1 the new names are runtime labels', !count($missing), implode(', ', $missing));
}

// 0.19.0: performance (audit PF1, PF2)
if(isset($bridge) && $bridge) {
	$shellSrc = (string) file_get_contents($themeDir . 'lib/AdminThemeBridgeShell.php');
	check('PF1 the primary nav is kept in the session and dropped when it may change', strpos($shellSrc, "\$session->setFor(\$this, \$key, \$out);") !== false
		&& strpos((string) file_get_contents($themeDir . 'AdminThemeBridge.module.php'), "addHookAfter('saved', \$this, 'hookClearNavCache')") !== false);
	// the page editor's admin page lies under Pages: Pages is the one current section
	$pagesSection = $pages->get((int) $config->adminRootPageID)->child('name=page, include=all');
	$editScreen = $pagesSection->id ? $pagesSection->child('name=edit, include=all') : new NullPage();
	$navMarked = $bridge->markCurrentNavItem("<li class='pw-nav-item pw-nav-item-top page-{$pagesSection->id}-'><a href='/x/'>Pages</a></li>" .
		"<li class='pw-nav-item pw-nav-item-top page-22-'><a href='/y/'>Setup</a></li>", $editScreen);
	check('PF1 the current section is still marked after the session\'s copy', $editScreen->id
		&& strpos($navMarked, "page-{$pagesSection->id}- pw-current'><a aria-current='true' href=") !== false && substr_count($navMarked, 'pw-current') === 1, $navMarked);
	check('PF1 the runtime labels are kept per language and version', strpos($shellSrc, 'public function sessionLabels()') !== false && $bridge->sessionLabels() === $bridge->runtimeLabels());
	check('PF1 urlToFile() and componentClass() remember their answers', strpos((string) file_get_contents($themeDir . 'lib/AdminThemeBridgeScripts.php'), 'if(isset($this->urlFiles[$path])) return $this->urlFiles[$path];') !== false
		&& strpos((string) file_get_contents($themeDir . 'lib/AdminThemeBridgeComponents.php'), '$this->componentClasses[$class]') !== false);
}
check('PF2 a node that only moved is no new content to the runtime', strpos($srcOf('index.ts'), '!moved.has(node)') !== false
	&& strpos($srcOf('util/removal.ts'), 'if (!n.isConnected) { fn(); return; }') !== false);

// 0.18.6: listeners that outlived their element, selectors built from values (audit BG7, BG8)
check('BG7 a reloaded page tree\'s group menu listeners go with the old tree', strpos($srcOf('fields/pagelist-group.ts'), "{ capture: true, signal: gone.signal }") !== false);
check('BG7 one ResizeObserver per frame in the setup screens', strpos($srcOf('classic/setup.js'), 'if(frame.pwFit) frame.pwFit.disconnect();') !== false);
check('BG7 the image window takes its reloaded handler off the opener once used', strpos($srcOf('classic/image-select.js'), "pj('.Inputfield').off('reloaded.pwImageSelect')") !== false);
check('BG7 a notice band\'s pause listeners are bound once', strpos($srcOf('classic/main.js'), 'notices.pwTimed = true;') !== false);
$unescaped = array();
foreach(array('classic/setup.js', 'classic/screens.js', 'classic/page-save.js', 'fields/pagename.ts') as $rel) {
	if(preg_match('~\[(?:name|value)="\' \+ (?!CSS\.escape)|\[name="\$\{(?!CSS\.escape)~', $srcOf($rel))) $unescaped[] = $rel;
}
check('BG8 attribute selectors built from values are escaped', !count($unescaped), implode(', ', $unescaped));
check('BG8 Enter in the image window is blocked only where it would submit', strpos($srcOf('classic/image-select.js'), "e.target.matches('input:not([type=button]):not([type=submit]), select')") !== false);
check('BG6 a closed notice may be said again', strpos($srcOf('util/notice.ts'), 'if ((shown && shown.isConnected) || !document.body) return;') !== false);

// 0.18.5: runtime failures that left a screen stuck (audit BG6)
check('BG6 a classic save stopped by the browser\'s validation leaves no bypass behind', strpos($srcOf('classic/page-save.js'), "\t\t\t} finally {\n\t\t\t\tbypass = false;") !== false);
check('BG6 the Lister drops an answer older than the last request', strpos($srcOf('classic/lister.js'), 'var seq = ProcessLister.seq = (ProcessLister.seq || 0) + 1;') !== false
	&& strpos($srcOf('classic/lister.js'), 'if(seq === ProcessLister.seq) ProcessLister._submitSuccess(html, nonce);') !== false);
check('BG6 the page tree takes clicks again whatever its answer', strpos($srcOf('fields/pagelist.ts'), "\t\t} finally {\n\t\t\tloading.remove();\n\t\t\tignoreClicks = false;") !== false);
check('BG6 Escape stops a held save only outside a dialog, and says so', strpos($srcOf('classic/save-wait.js'), "document.querySelector('dialog[open]')") !== false
	&& isset($bridge) && $bridge && isset($bridge->runtimeLabels()['saveWaitStopped']));
check('BG6 one repeater adding an item does not lock the others', strpos($srcOf('fields/repeater.ts'), 'const adding = new WeakSet<HTMLElement>();') !== false && strpos($srcOf('fields/repeater.ts'), 'let adding') === false);
$voids = array();
foreach(array('index.ts', 'fields/page.ts', 'fields/pagelistselect.ts', 'fields/image.ts', 'fields/pagelist.ts') as $rel) {
	if(preg_match('~void (import\(|focus\(\)|reloadOptions\(|getJSON\(|loadGroup\()~', $srcOf($rel))) $voids[] = $rel;
}
check('BG6 no promise that can reject is left without a catch', !count($voids), implode(', ', $voids));
check('TT the handlers are rewritten only where the setup script runs', strpos((string) file_get_contents($themeDir . 'lib/AdminThemeBridgeLegacy.php'), "in_array('scripts/setup.js', \$this->processScripts(\$process->className()), true)") !== false);

// audit 2026-11-01, R0: the tools
$toolsDir = dirname(__DIR__) . '/tools/';
$read = function($rel) { return (string) @file_get_contents(dirname(__DIR__) . '/' . $rel); };
check('SE5 the sandbox guard refuses a foreign database', bridgeSandboxProblem((object) array('dbName' => 'atispro', 'paths' => (object) array('root' => "$root/")), $root) !== ''
	&& bridgeSandboxProblem((object) array('dbName' => 'x_bridge', 'paths' => (object) array('root' => dirname(__DIR__) . '/')), $root) !== ''
	&& bridgeSandboxProblem($config, $root) === '');
check('SE5 the sandbox guard refuses a directory outside sandbox/', bridgeSandboxRootProblem(dirname(__DIR__) . '/bootstrap') !== '');
$guarded = array();
foreach(array('tools/sandbox-admin.php', 'tools/sandbox-modules.php', 'tools/sandbox-csp.php', 'tools/sandbox-fixture.php',
	'tools/bench/switch-theme.php', 'conformance/run.php', 'tests/smoke.php') as $rel) {
	$src = $read($rel);
	if(strpos($src, 'lib/sandbox-guard.php') === false || strpos($src, 'bridgeSandboxRoot(') === false || strpos($src, 'bridgeSandboxBooted($config, $root)') === false) $guarded[] = $rel;
}
check('SE5 every tool that writes to a sandbox loads the guard before and after the boot', !count($guarded), implode(', ', $guarded));
$cleanSrc = $read('tools/sandbox-clean.php');
check('tools/sandbox-clean.php loads the sandbox guard, calls both guard functions and deletes with $pages->delete() only under --delete', strpos($cleanSrc, "require __DIR__ . '/lib/sandbox-guard.php';") !== false
	&& strpos($cleanSrc, 'bridgeSandboxRoot($rootArg)') !== false && strpos($cleanSrc, 'bridgeSandboxBooted($config, $root)') !== false
	&& strpos($cleanSrc, 'if($delete) {') !== false && strpos($cleanSrc, '$pages->delete($page)') !== false && strpos($cleanSrc, 'trash(') === false);
$site = $read('tools/sandbox-site.sh');
check('SE5 sandbox-site.sh stops on a failed pipe and checks the database by its config', strpos($site, 'set -euo pipefail') !== false && strpos($site, 'lib/sandbox-dbname.php') !== false);
$literal = array();
foreach(array_merge((array) glob($toolsDir . '*.js'), (array) glob($toolsDir . 'bench/*.mjs')) as $file) {
	if(preg_match('~localhost:\d+/[a-z0-9]{8,}/~i', (string) file_get_contents($file))) $literal[] = basename($file);
}
check('SE4 no tool names an admin path', !count($literal), implode(', ', $literal));
check('SE4 the sandbox records its admin path for the browser tools', strpos($read('tools/sandbox-admin.php'), "'admin=' . \$config->urls->admin") !== false
	&& strpos($read('tools/lib/sandbox.cjs'), "line.startsWith('admin=')") !== false);
check('BG9 page-save-check and dropdown-stress fail on a failure', strpos($read('tools/page-save-check.js'), 'process.exitCode = 1') !== false
	&& strpos($read('tools/dropdown-stress.js'), 'process.exitCode = 1') !== false);
check('BG9 gate1.sh exits with the number of failed sites', strpos($read('tools/gate1.sh'), 'exit "$failed"') !== false);
check('BG9 conformance fails on a lost session and on no screens', strpos($read('conformance/run.php'), "\$d['login'] =") !== false
	&& strpos($read('conformance/run.php'), '|| !$total || $noneRendered || ') !== false);
// 0.26.0 C3: the runner records the UIkit layer per Bridge screen; unexpected ones fail under --uikit-strict
$run = $read('conformance/run.php');
check('C3 conformance records the UIkit layer per screen (link, reasons) and prints UIKIT lines', strpos($run, "\$d['uikit'] = uikitDigest(\$html, \$xp)") !== false
	&& strpos($run, "//link[@data-pw-uikit]") !== false && strpos($run, "['AdminThemeBridge']['uikit']['reasons']") !== false
	&& strpos($run, 'echo "UIKIT $url ') !== false && strpos($run, 'screens load the UIkit layer, $uikitUnexpected unexpected') !== false);
check('C3 an unexpected UIkit screen fails the run only with --uikit-strict', strpos($run, "\$arg === '--uikit-strict'") !== false
	&& strpos($run, '($uikitStrict && $uikitUnexpected)) ? 1 : 0') !== false);
check('C3 conformance/uikit-allow.txt exists and is read by the runner', is_file(dirname(__DIR__) . '/conformance/uikit-allow.txt')
	&& strpos($run, "__DIR__ . '/uikit-allow.txt'") !== false);
check('C4 uikit-allow.txt takes reason: globs (every reason of a screen must match), RockMigrations is one; gate1.sh passes UIKIT_STRICT=1 on',
	strpos($run, "if(strpos(\$line, 'reason:') === 0) \$uikitAllowReasons[] = substr(\$line, 7);") !== false
	&& strpos($run, "if(uikitReasonsAllowed(\$layer['reasons'], \$uikitAllowReasons)) \$unexpected = false;") !== false
	&& strpos($read('conformance/uikit-allow.txt'), "\nreason:Script:*/RockMigrations/RockMigrations.js\n") !== false
	&& strpos($read('tools/gate1.sh'), '[ "${UIKIT_STRICT:-}" = 1 ] && STRICT=(--uikit-strict)') !== false);
check('BG9 release-module.sh never overwrites a published tag', strpos($read('tools/release-module.sh'), 'push -f') === false);

// audit 2026-11-01, R1: the bootstrap
$indexSrc = $read('bootstrap/index.php');
check('SE7 bootstrap/index.php builds, then boots, as upstream index 303', strpos($indexSrc, "new ProcessWire(\$config, '/', false);") !== false
	&& strpos($indexSrc, '$wire->boot($config);') !== false && strpos($indexSrc, "\$config->dbType !== 'sqlite'") !== false);
$resolved = BridgeBootstrap::resolvePaths($layout, $root);
check('SE7 resolvePaths() gives the directories the boot uses', $resolved['wire'] === $config->paths->wire && $resolved['site'] === $config->paths->site
	&& $resolved['assets'] === $config->paths->assets && $resolved['templates'] === $config->paths->templates
	&& $resolved['siteModules'] === $config->paths->siteModules && $resolved['sessions'] === $config->paths->sessions, json_encode($resolved));
// the .htaccess generator on a layout that moves every directory, against upstream's rule lines
$htDir = $config->paths->cache . 'bridge-htaccess-' . getmypid() . '/';
@mkdir($htDir, 0755, true);
file_put_contents($htDir . 'project.php', "<?php\nreturn array('bridge' => " . var_export(dirname(__DIR__) . '/bootstrap', true) . ", 'wire' => __DIR__ . '/vendor/processwire/wire', 'site' => __DIR__ . '/app',\n" .
	"'assets' => __DIR__ . '/data/assets', 'sessions' => __DIR__ . '/data/sessions', 'templates' => __DIR__ . '/views', 'siteModules' => __DIR__ . '/ext/modules', 'classes' => '/elsewhere/classes');\n");
$rules = array(
	'(^|/)(site|site-[^/]+)/assets/(cache|logs|backups|sessions|config|database|install|tmp)($|/.*$) [NC,OR]',
	'(^|/)(site|site-[^/]+)/install($|/.*$) [NC,OR]', '(^|/)(site|site-[^/]+)/assets.*/-.+/.* [NC,OR]',
	'(^|/)(wire|site|site-[^/]+)/(config|index\.config|config-dev)\.php($|/) [NC,OR]',
	'(^|/)(wire|site|site-[^/]+)/templates-admin($|/|/.*\.(php|html?|tpl|inc))($|/) [NC,OR]',
	'(^|/)(site|site-[^/]+)/templates($|/|/.*\.(php|html?|tpl|inc))($|/) [NC,OR]', '(^|/)(site|site-[^/]+)/classes($|/.*) [NC,OR]',
	'(^|/)(site|site-[^/]+)/assets($|/|/.*\.ph(p|ps|tml|p[0-9]))($|/) [NC,OR]',
	'(^|/)wire/(core|modules)/.*\.(php|inc|tpl|module|info\.json)($|/) [NC,OR]',
	'(^|/)(site|site-[^/]+)/modules/.*\.(php|inc|tpl|module|info\.json)$ [NC,OR]',
	'(^|/)(site|site-[^/]+)/(config[^/]*/?|[^/]+\.php.*)$ [NC,OR]',
	'(^|/)(wire/|site[-/]).+\.(bak|old|sql|sw[op]|(bak|php|sql)[./]+.*)[\d.]*$ [NC,OR]',
);
$ht = "  # Prevent all the following rules from blocking images in site install directories\n  # Block access to the /site/install/ directories\n";
foreach($rules as $r) $ht .= "  RewriteCond %{REQUEST_URI} $r\n";
file_put_contents($htDir . 'htaccess.txt', $ht . "  RewriteRule ^.*$ - [F,L]\n");
file_put_contents($htDir . 'stub.txt', "  # Prevent all the following rules from blocking images in site install directories\n");
$runTool = function($source) use($htDir) {
	$proc = proc_open(array(PHP_BINARY, dirname(__DIR__) . '/tools/bootstrap-htaccess.php', $htDir, $source, '--dry-run'), array(1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes);
	$out = stream_get_contents($pipes[1]);
	stream_get_contents($pipes[2]);
	fclose($pipes[1]);
	fclose($pipes[2]);
	return array(proc_close($proc), $out);
};
list($code, $out) = $runTool($htDir . 'htaccess.txt');
check('SE7 bootstrap-htaccess points every rule at a layout that moves every directory', $code === 0 && strpos($out, '(data/sessions)($|/)') !== false
	&& strpos($out, '(views)($|/|') !== false && strpos($out, '(ext/modules)/') !== false && strpos($out, '(data/assets)/(cache|logs') !== false
	&& strpos($out, '(site|site-') === false && strpos($out, 'RewriteRule ^(?!vendor/processwire/wire/)vendor/ - [F,L]') !== false
	&& strpos($out, 'RewriteRule ^project\.php$ - [F,L]') !== false, "exit $code");
list($code) = $runTool($htDir . 'stub.txt');
check('SE7 bootstrap-htaccess fails when upstream rules are missing', $code === 1, "exit $code");
foreach((array) glob($htDir . '*') as $file) @unlink($file);
@rmdir($htDir);
$upstreamHt = getenv('BRIDGE_HTACCESS') ?: dirname($config->paths->wire) . '/htaccess.txt';
if(is_file($upstreamHt)) {
	$proc = proc_open(array(PHP_BINARY, dirname(__DIR__) . '/tools/bootstrap-htaccess.php', $root, $upstreamHt, '--dry-run'), array(1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes);
	stream_get_contents($pipes[1]);
	$err = trim((string) stream_get_contents($pipes[2]));
	fclose($pipes[1]);
	fclose($pipes[2]);
	check('SE7 bootstrap-htaccess knows every rule of the installed core\'s htaccess.txt', proc_close($proc) === 0, $err);
} else {
	warn('upstream htaccess.txt not found: set BRIDGE_HTACCESS to check the generator against it');
}
// 0.24.0 (theoretic/bridge#3): Bridge.sortable for components, a handled key sort stays in its
// list, file items get the wrappers' script treatment
check('Bridge.sortable loads the shared sortable chunk', strpos($srcOf('index.ts'), "import('./util/sortable').then(m => m.makeSortable(list, options))") !== false);
check('a handled Alt+arrow sort does not move a list around it', (bool) preg_match('/e\.preventDefault\(\);\s*(\/\/[^\n]*\n\s*)*e\.stopPropagation\(\);\s*if \(options\.start\) options\.start\(item, block\);/', $srcOf('util/sortable.ts')));
check('file items get the same nonce handling as wrappers', strpos((string) file_get_contents($themeDir . 'AdminThemeBridge.module.php'), "addHookAfter('InputfieldFile::renderItem', \$this, 'hookFormRender'") !== false);
// 0.26.1: the autocomplete menu floats over repeaters (behaviour: tools/autocomplete-check.js e, f)
check('the autocomplete menu has the popup z-index', strpos($themeCss, '.ui-autocomplete{z-index:var(--pw-z-popup)') !== false);
// 0.27.0: the extension contract (docs/extensions.md; sprint extension-kit, step 1)
check('BridgeExtension declares one method, getBridgeExtension()', interface_exists('ProcessWire\\BridgeExtension')
	&& array_map(function($m) { return $m->getName(); }, (new \ReflectionClass('ProcessWire\\BridgeExtension'))->getMethods()) === array('getBridgeExtension'));
check('the theme module loads the interface as defensively as BridgeComponent', strpos((string) file_get_contents($themeDir . 'AdminThemeBridge.module.php'), "if(!interface_exists('ProcessWire\\\\BridgeExtension', false)) require_once(__DIR__ . '/BridgeExtension.php');") !== false);
check('extensionContract is a version string (x.y or x.y.z)', (bool) preg_match('/^\d+\.\d+(\.\d+)?$/', AdminThemeBridge::extensionContract), AdminThemeBridge::extensionContract);
$rangeCases = array(array('^0.1', '0.1', true), array('^0.1', '0.1.9', true), array('^0.1', '0.2', false), array('^1.2', '1.9', true), array('^1.2', '2.0', false),
	array('~1.2', '1.3', false), array('>=0.1 <1', '0.9', true), array('>=0.1 <1', '1.0', false), array('^1 || ^0.1', '0.1', true), array('*', '3.4.5', true), array('bogus', '0.1', false));
$rangeBad = array();
foreach($rangeCases as $c) if(AdminThemeBridge::contractSatisfies($c[0], $c[1]) !== $c[2]) $rangeBad[] = "$c[0] vs $c[1]";
check('contractSatisfies() reads caret, tilde, comparisons, lists and alternatives', !count($rangeBad), implode(', ', $rangeBad));
check('contractRangeValid() takes a range and refuses an empty or unreadable one', AdminThemeBridge::contractRangeValid('^0.1') && !AdminThemeBridge::contractRangeValid('') && !AdminThemeBridge::contractRangeValid('soon'));
if(isset($bridge)) {
	$surface = $bridge->extensionSurface();
	$declared = array();
	foreach((new \ReflectionClass($bridge))->getMethods() as $m) {
		if(strpos($m->getName(), '___') === 0 && $m->getDeclaringClass()->getName() === get_class($bridge)) $declared[] = substr($m->getName(), 3);
	}
	$listed = $surface['hooks'];
	sort($declared);
	sort($listed);
	check('extensionSurface() hooks are every ___ method the theme declares', $declared === $listed, 'missing: ' . implode(',', array_diff($declared, $listed)) . ' extra: ' . implode(',', array_diff($listed, $declared)));
	check('extensionSurface() contract is extensionContract', $surface['contract'] === AdminThemeBridge::extensionContract);
	// 0.29.0: contract 0.2 (sprint extension-styles-bridge-custom, step 1)
	$contractsBad = array_filter($surface['contracts'], function($v) { return !preg_match('/^\d+\.\d+(\.\d+)?$/', $v); });
	check('extensionSurface() contracts is extensionContracts, the current one last, each a version', $surface['contracts'] === AdminThemeBridge::extensionContracts
		&& end($surface['contracts']) === AdminThemeBridge::extensionContract && !count($contractsBad), json_encode($surface['contracts']));
	$tokenCss = (string) @file_get_contents(dirname(__DIR__) . '/runtime/src/styles/00-tokens.css');
	$tokensBad = array();
	foreach($surface['tokens'] as $token) {
		if(!preg_match('/(?<![\w-])' . preg_quote($token, '/') . '\s*:/', $tokenCss)) $tokensBad[] = $token;
	}
	check('extensionSurface() tokens are declared in 00-tokens.css', count($surface['tokens']) > 0 && !count($tokensBad), implode(', ', $tokensBad));
	check('extensionSurface() tokens has no duplicates', count($surface['tokens']) === count(array_unique($surface['tokens'])));
	check('the four metric tokens are published', !count(array_diff(array('--pw-font-size', '--pw-line-height', '--pw-field-pad', '--pw-field-pad-bottom'), $surface['tokens'])));
	check('internal tokens are not on the surface', !count(array_intersect(array('--pw-input-radius', '--pw-tiny', '--pw-masthead-h', '--ring-50'), $surface['tokens'])));
	// 0.30.0: label size, control height and the login background are tokens
	$newTokens030 = array('--pw-label-size', '--pw-control-height', '--pw-login-bg');
	$newTokensBad030 = array();
	foreach($newTokens030 as $token) {
		if(!in_array($token, $surface['tokens'], true) || !preg_match('/(?<![\w-])' . preg_quote($token, '/') . '\s*:/', $tokenCss)) $newTokensBad030[] = $token;
	}
	check('--pw-label-size, --pw-control-height and --pw-login-bg are on the surface and declared in 00-tokens.css', !count($newTokensBad030), implode(', ', $newTokensBad030));
	check('00-tokens.css declares --pw-control-height in rem (2.25rem) and --pw-label-size .875rem', preg_match('/--pw-control-height:\s*2\.25rem/', $tokenCss) && preg_match('/--pw-label-size:\s*\.875rem/', $tokenCss));
	$themeCss030 = (string) @file_get_contents($themeDir . 'assets/dist/theme.css');
	check('theme.css uses the three tokens: control min-height, label font-size, login background', strpos($themeCss030, 'min-height:var(--pw-control-height)') !== false
		&& strpos($themeCss030, 'font-size:var(--pw-label-size)') !== false && strpos($themeCss030, 'background:var(--pw-login-bg)') !== false);
	// 0.30.0: tokenOverrides() and the printed token style (sprint bridge-customizer, step 2)
	check('tokenOverrides is a hook and tokenCss a read on the surface', in_array('tokenOverrides', $surface['hooks'], true) && in_array('tokenCss', $surface['reads'], true));
	check('tokenCss() is empty with no hook and default settings', $bridge->tokenCss() === '', $bridge->tokenCss());
	$tokHook = $bridge->addHookAfter('tokenOverrides', function(HookEvent $e) {
		$r = $e->return;
		$r['all']['--radius'] = '4px';
		$r['light']['--background'] = '#fefefe';
		$r['light']['--not-a-token'] = 'red';
		$r['light']['--foreground'] = 'red;}x';
		$r['dark']['--background'] = '#101010';
		$e->return = $r;
	});
	$tokOut = $bridge->tokenCss();
	$bridge->removeHook($tokHook);
	check('tokenCss() prints all, light, dark in order and drops an unknown name and an unsafe value', $tokOut === ':root:root{--radius:4px}:root:not([data-pw-scheme=dark]){--background:#fefefe}:root[data-pw-scheme=dark]{--background:#101010}', $tokOut);
	$tokValues = array(
		'url(/site/assets/x/login-bg.jpg?v=12) center / cover no-repeat #f5f5f5' => true,
		'#f5f5f5<' => false, '#f5f5f5;' => false, 'red}' => false, 'a\\b' => false, '"x"' => false, "'x'" => false,
		str_repeat('a', 300) => true, str_repeat('a', 301) => false, "red\n" => false, '' => false,
	);
	$tokValuesBad = array();
	foreach($tokValues as $tokValue => $tokKept) {
		$tokHook = $bridge->addHookAfter('tokenOverrides', function(HookEvent $e) use($tokValue) {
			$r = $e->return;
			$r['light']['--pw-login-bg'] = (string) $tokValue;
			$e->return = $r;
		});
		$tokGot = $bridge->tokenCss();
		$bridge->removeHook($tokHook);
		$tokWant = $tokKept ? ':root:not([data-pw-scheme=dark]){--pw-login-bg:' . $tokValue . '}' : '';
		if($tokGot !== $tokWant) $tokValuesBad[] = json_encode(substr((string) $tokValue, 0, 40)) . " => $tokGot";
	}
	check('tokenCss() keeps a login-bg image value and drops <, ;, }, backslash, quotes, a newline, empty and over 300 characters', !count($tokValuesBad), implode(' | ', $tokValuesBad));
	$tokWarnings = array();
	set_error_handler(function($no, $str) use(&$tokWarnings) { $tokWarnings[] = $str; return true; });
	$tokHook = $bridge->addHookAfter('tokenOverrides', function(HookEvent $e) { $e->return = 'nonsense'; });
	$tokOutString = $bridge->tokenCss();
	$bridge->removeHook($tokHook);
	$tokHook = $bridge->addHookAfter('tokenOverrides', function(HookEvent $e) { $e->return = array('all' => 'x', 'dark' => array('--radius' => 4, 5 => 'x')); });
	$tokOutGroups = $bridge->tokenCss();
	$bridge->removeHook($tokHook);
	restore_error_handler();
	check('tokenCss() is empty for a string return, a non-array group, a missing group, a non-string value or name, without a PHP warning', $tokOutString === '' && $tokOutGroups === '' && !count($tokWarnings), $tokOutString . $tokOutGroups . implode(' | ', $tokWarnings));
	$tokHeadSrc = (string) file_get_contents($themeDir . '_head.php');
	$tokPos = strpos($tokHeadSrc, 'data-pw-tokens');
	$tokLine = '';
	foreach(explode("\n", $tokHeadSrc) as $tokHeadLine) {
		if(strpos($tokHeadLine, '<style data-pw-keep data-pw-tokens') !== false) $tokLine = $tokHeadLine;
	}
	check('_head.php prints style[data-pw-tokens] after fields.css and before the extension stylesheets, with the nonce, only when not empty', $tokPos !== false && $tokPos > (int) strpos($tokHeadSrc, 'data-pw-fields />')
		&& $tokPos < (int) strpos($tokHeadSrc, "data-bridge-styles='") && strpos($tokLine, '$nonce') !== false && strpos($tokLine, "if(\$plan->tokenCss !== '')") === 0, $tokLine);
	check('assetPlan() fills tokenCss for every layout', strpos((string) file_get_contents($themeDir . 'lib/AdminThemeBridgeHead.php'), "\t\t\$plan->tokenCss = \$this->tokenCss();\n") !== false);
	check('_head.php paints the canvas with var(--background, #0a0a0a) before the stylesheets', substr_count($tokHeadSrc, 'background: var(--background, #0a0a0a);') === 2 && strpos($tokHeadSrc, 'background: #0a0a0a;') === false);
	// 0.30.0: settings labelSize and controlHeight (sprint bridge-customizer, step 3)
	$sizeKept = array($bridge->get('labelSize'), $bridge->get('controlHeight'));
	$bridge->set('labelSize', 14);
	$bridge->set('controlHeight', 36);
	check('labelSize and controlHeight at their defaults (14, 36) print no token style', $bridge->getLabelSize() === 14 && $bridge->getControlHeight() === 36 && $bridge->tokenCss() === '', $bridge->tokenCss());
	$bridge->set('labelSize', 16);
	$bridge->set('controlHeight', 44);
	$sizeOut = $bridge->tokenCss();
	check('labelSize 16 and controlHeight 44 print --pw-label-size:1rem and --pw-control-height:2.75rem on :root:root', $sizeOut === ':root:root{--pw-label-size:1rem;--pw-control-height:2.75rem}', $sizeOut);
	$bridge->set('labelSize', 15);
	$bridge->set('controlHeight', 36);
	$sizeOut15 = $bridge->tokenCss();
	check('labelSize 15 prints 0.9375rem and controlHeight 36 nothing', $sizeOut15 === ':root:root{--pw-label-size:0.9375rem}', $sizeOut15);
	$sizeRange = array();
	foreach(array(array(99, 14, 'getLabelSize'), array(11, 14, 'getLabelSize'), array('x', 14, 'getLabelSize'), array(12, 12, 'getLabelSize'), array(20, 20, 'getLabelSize'),
		array(27, 36, 'getControlHeight'), array(57, 36, 'getControlHeight'), array(28, 28, 'getControlHeight'), array(56, 56, 'getControlHeight')) as $sizeCase) {
		list($sizeIn, $sizeWant, $sizeGetter) = $sizeCase;
		$bridge->set($sizeGetter === 'getLabelSize' ? 'labelSize' : 'controlHeight', $sizeIn);
		if($bridge->$sizeGetter() !== $sizeWant) $sizeRange[] = "$sizeGetter($sizeIn) = " . $bridge->$sizeGetter();
		$bridge->set('labelSize', 14);
		$bridge->set('controlHeight', 36);
	}
	check('getLabelSize() keeps 12..20 else 14, getControlHeight() 28..56 else 36', !count($sizeRange), implode(' | ', $sizeRange));
	$bridge->set('labelSize', $sizeKept[0]);
	$bridge->set('controlHeight', $sizeKept[1]);
	check('getLabelSize/getControlHeight are reads and labelSize/controlHeight settings on the surface', in_array('getLabelSize', $surface['reads'], true) && in_array('getControlHeight', $surface['reads'], true)
		&& in_array('labelSize', $surface['settings'], true) && in_array('controlHeight', $surface['settings'], true) && count($surface['settings']) === 22, count($surface['settings']));
	$sizeConfigSrc = (string) file_get_contents($themeDir . 'lib/AdminThemeBridgeConfig.php');
	check('the config screen has the fields labelSize and controlHeight after maxWidth', strpos($sizeConfigSrc, "attr('name', 'labelSize')") > (int) strpos($sizeConfigSrc, "attr('name', 'maxWidth')")
		&& strpos($sizeConfigSrc, "attr('name', 'controlHeight')") > (int) strpos($sizeConfigSrc, "attr('name', 'labelSize')"));
	// 0.30.0: appearance(), extensions override the Appearance settings; body classes at render time (sprint bridge-customizer, step 4)
	check('appearance is a hook and isLoginScreen a read on the surface', in_array('appearance', $surface['hooks'], true) && in_array('isLoginScreen', $surface['reads'], true));
	$apStored = $bridge->appearance();
	check('appearance() returns the eight stored Appearance settings, in order', is_array($apStored)
		&& array_keys($apStored) === array('variant', 'primaryColor', 'colorScheme', 'logoURL', 'logoURLDark', 'maxWidth', 'labelSize', 'controlHeight')
		&& $apStored['variant'] === $bridge->get('variant') && $apStored['maxWidth'] === $bridge->get('maxWidth'), json_encode($apStored));
	$apBase = array('siteVariant' => $bridge->siteVariant(), 'sitePrimaryColor' => $bridge->sitePrimaryColor(), 'getColorScheme' => $bridge->getColorScheme(),
		'getMaxWidth' => $bridge->getMaxWidth(), 'getLabelSize' => $bridge->getLabelSize(), 'getControlHeight' => $bridge->getControlHeight(),
		'renderLogo' => $bridge->renderLogo(), 'renderHtmlAttributes' => $bridge->renderHtmlAttributes());
	$apSet = function(array $values) use($bridge) {
		return $bridge->addHookAfter('appearance', function(HookEvent $e) use($values) { $e->return = array_merge($e->return, $values); });
	};
	$apHook = $apSet(array('variant' => 'custom', 'primaryColor' => '#AA3300'));
	$apAttrs = $bridge->renderHtmlAttributes();
	check('an appearance() hook sets the site colour: custom #AA3300 → siteVariant custom, #aa3300 on <html>', $bridge->siteVariant() === 'custom' && $bridge->sitePrimaryColor() === '#aa3300'
		&& strpos($apAttrs, "data-pw-variant='custom'") !== false && strpos($apAttrs, '--pw-primary:#aa3300') !== false, $apAttrs);
	$bridge->removeHook($apHook);
	$apHook = $apSet(array('variant' => 'custom', 'primaryColor' => 'red'));
	check('an appearance() hook with custom and no valid colour gives blue', $bridge->siteVariant() === 'blue' && $bridge->sitePrimaryColor() === '');
	$bridge->removeHook($apHook);
	$apHook = $apSet(array('logoURL' => 'site/assets/x/logo.svg?v=3', 'logoURLDark' => ''));
	$apLogo = $bridge->renderLogo();
	check('an appearance() hook sets the logo: renderLogo() prints it under the site root', strpos($apLogo, "src='" . $config->urls->root . "site/assets/x/logo.svg?v=3'") !== false
		&& strpos($apLogo, "class='pw-logo pw-logo-custom ") !== false, $apLogo);
	$bridge->removeHook($apHook);
	$apHook = $apSet(array('maxWidth' => 99999, 'labelSize' => 16, 'controlHeight' => 99, 'colorScheme' => 'dark'));
	check('appearance() values are validated: maxWidth 99999 → 4000, labelSize 16, controlHeight 99 → 36, scheme dark', $bridge->getMaxWidth() === 4000
		&& $bridge->getLabelSize() === 16 && $bridge->getControlHeight() === 36 && $bridge->getColorScheme() === 'dark');
	$bridge->removeHook($apHook);
	$apWarnings = array();
	set_error_handler(function($no, $str) use(&$apWarnings) { $apWarnings[] = $str; return true; });
	$apReadAll = function() use($bridge) {
		return array('siteVariant' => $bridge->siteVariant(), 'sitePrimaryColor' => $bridge->sitePrimaryColor(), 'getColorScheme' => $bridge->getColorScheme(),
			'getMaxWidth' => $bridge->getMaxWidth(), 'getLabelSize' => $bridge->getLabelSize(), 'getControlHeight' => $bridge->getControlHeight(),
			'renderLogo' => $bridge->renderLogo(), 'renderHtmlAttributes' => $bridge->renderHtmlAttributes());
	};
	$apHook = $bridge->addHookAfter('appearance', function(HookEvent $e) { $e->return = null; });
	$apNull = $apReadAll();
	$bridge->removeHook($apHook);
	$apHook = $bridge->addHookAfter('appearance', function(HookEvent $e) { $e->return = array('variant' => array('x'), 'logoURL' => new \stdClass()); });
	$apOdd = $apReadAll();
	$bridge->removeHook($apHook);
	$apHook = $bridge->addHookAfter('appearance', function(HookEvent $e) { $e->return = array(); });
	$apEmpty = $apReadAll();
	$bridge->removeHook($apHook);
	restore_error_handler();
	check('an appearance() hook returning null or an array without the keys leaves every reader at the stored value, without a PHP warning', $apNull === $apBase && $apEmpty === $apBase && !count($apWarnings),
		implode(' | ', $apWarnings));
	check('appearance() values of the wrong type are validated without a PHP warning (an array variant is blue, an object logo is none)', $apOdd['siteVariant'] === 'blue'
		&& ($apOdd['renderLogo'] === $bridge->renderNativeLogo() || trim((string) $apStored['logoURLDark']) !== ''), $apOdd['renderLogo']);
	check('with no hook every reader is as before the hooks (nothing cached)', $apReadAll() === $apBase);
	// a user's own colour stays above the site's, whoever sets the site's
	$apUser = $wire->users->get('name=bridge');
	if($apUser && $apUser->id) {
		$apGuest = $wire->user;
		$apWas = $apUser->meta(AdminThemeBridge::userColorsMeta);
		$apUserColors = $bridge->get('userColors');
		$apMemo = new \ReflectionProperty($bridge, 'userColorsValue');
		$bridge->set('userColors', 1);
		$wire->users->setCurrentUser($apUser);
		$apUser->meta(AdminThemeBridge::userColorsMeta, array('variant' => 'pink', 'color' => ''));
		$apMemo->setValue($bridge, null);
		$apHook = $apSet(array('variant' => 'custom', 'primaryColor' => '#aa3300'));
		check('a user\'s own colour wins over an appearance() hook: getVariant() pink, siteVariant() custom', $bridge->getVariant() === 'pink' && $bridge->siteVariant() === 'custom'
			&& $bridge->sitePrimaryColor() === '#aa3300', $bridge->getVariant() . ' / ' . $bridge->siteVariant());
		$bridge->removeHook($apHook);
		if(is_array($apWas)) $apUser->meta(AdminThemeBridge::userColorsMeta, $apWas); else $apUser->meta()->remove(AdminThemeBridge::userColorsMeta);
		$bridge->set('userColors', $apUserColors);
		$wire->users->setCurrentUser($apGuest);
		$apMemo->setValue($bridge, null);
	}
	// the config screen shows and saves the stored values and says which ones an extension sets
	$apConfigSrc = (string) file_get_contents($themeDir . 'lib/AdminThemeBridgeConfig.php');
	check('the config screen reads the stored Appearance values, not the effective ones', strpos($apConfigSrc, '$stored = $this->storedAppearance();') !== false
		&& strpos($apConfigSrc, "attr('value', \$this->getMaxWidth())") === false && strpos($apConfigSrc, "attr('value', \$this->getColorScheme())") === false
		&& strpos($apConfigSrc, "attr('value', \$this->getLabelSize())") === false && strpos($apConfigSrc, "attr('value', \$this->getControlHeight())") === false
		&& strpos($apConfigSrc, 'An extension sets this for the admin: %s. The value saved here applies when no extension sets one.') !== false);
	$apWidth = (int) $apStored['maxWidth'] === 900 ? 901 : 900;
	$apHook = $apSet(array('variant' => 'custom', 'primaryColor' => '#aa3300', 'maxWidth' => $apWidth));
	$apFields = $modules->wire(new InputfieldWrapper());
	$bridge->getModuleConfigInputfields($apFields);
	$bridge->removeHook($apHook);
	$apField = function($name) use($apFields) { $f = $apFields->getChildByName($name); return $f ? $f : null; };
	$apNoteOk = $apField('variant') && $apField('maxWidth') && $apField('colorScheme') && $apField('labelSize')
		&& (string) $apField('variant')->attr('value') === (in_array($apStored['variant'], array('blue', 'vibrant', 'black', 'pink', 'green', 'custom'), true) ? $apStored['variant'] : 'blue')
		&& (int) $apField('maxWidth')->attr('value') === max(0, min(4000, (int) $apStored['maxWidth']))
		&& strpos((string) $apField('variant')->notes, 'An extension sets this for the admin: custom.') !== false
		&& strpos((string) $apField('primaryColor')->notes, 'An extension sets this for the admin: #aa3300.') !== false
		&& strpos((string) $apField('maxWidth')->notes, "An extension sets this for the admin: $apWidth.") !== false
		&& strpos((string) $apField('colorScheme')->notes, 'Each user can override this') === 0 && strpos((string) $apField('colorScheme')->notes, 'An extension sets') === false
		&& strpos((string) $apField('labelSize')->notes, 'An extension sets') === false;
	check('with an appearance() hook the config screen keeps the stored values and notes the overridden fields only', $apNoteOk);
	// body classes: added at render time, once each
	$apModuleSrc = (string) file_get_contents($themeDir . 'AdminThemeBridge.module.php');
	$apShellSrc = (string) file_get_contents($themeDir . 'lib/AdminThemeBridgeShell.php');
	check('init() no longer adds pw-variant-/pw-scheme- body classes; getBodyClass() in the Shell trait does', strpos($apModuleSrc, "addBodyClass('pw-variant-") === false
		&& strpos($apModuleSrc, "addBodyClass('pw-scheme-") === false && strpos($apShellSrc, 'public function getBodyClass() {') !== false
		&& strpos($apShellSrc, "'pw-variant-' . \$this->getVariant()") !== false && strpos($apShellSrc, "'pw-scheme-' . \$this->getColorScheme()") !== false);
	if($wire->page && $wire->page->id) {
		$apHook = $apSet(array('variant' => 'green'));
		$bridge->getBodyClass();
		$apBody = ' ' . $bridge->getBodyClass() . ' ';
		$bridge->removeHook($apHook);
		$apBody2 = ' ' . $bridge->getBodyClass() . ' ';
		check('getBodyClass() twice: one pw-variant- and one pw-scheme- class, following appearance()', preg_match_all('/ pw-variant-/', $apBody) === 1 && preg_match_all('/ pw-scheme-/', $apBody) === 1
			&& strpos($apBody, ' pw-variant-green ') !== false && preg_match_all('/ pw-variant-/', $apBody2) === 1 && strpos($apBody2, ' pw-variant-' . $bridge->getVariant() . ' ') !== false, $apBody . '|' . $apBody2);
	}
	// 0.30.0: adminTitle($place) and faviconUrl() (sprint bridge-customizer, step 5)
	check('adminTitle and faviconUrl are hooks (21) and renderAdminTitle a read on the surface', in_array('adminTitle', $surface['hooks'], true) && in_array('faviconUrl', $surface['hooks'], true)
		&& in_array('renderAdminTitle', $surface['reads'], true) && count($surface['hooks']) === 21, count($surface['hooks']));
	check('no hook: renderAdminTitle() and faviconUrl() are empty', $bridge->renderAdminTitle('masthead') === '' && $bridge->renderAdminTitle('login') === '' && $bridge->faviconUrl() === '');
	$atHook = $bridge->addHookAfter('adminTitle', function(HookEvent $e) { if($e->arguments(0) === 'masthead') $e->return = 'Acme <b>'; });
	$atMast = $bridge->renderAdminTitle('masthead');
	$atLogin = $bridge->renderAdminTitle('login');
	$bridge->removeHook($atHook);
	check('an adminTitle() hook for masthead only: escaped span there, nothing on the login card', $atMast === "<span class='pw-admin-title'>Acme &lt;b&gt;</span>" && $atLogin === '', $atMast . '|' . $atLogin);
	$atWarnings = array();
	set_error_handler(function($no, $str) use(&$atWarnings) { $atWarnings[] = $str; return true; });
	$atHook = $bridge->addHookAfter('adminTitle', function(HookEvent $e) { $e->return = $e->arguments(0) === 'login' ? array('x') : '   '; });
	$atOdd = $bridge->renderAdminTitle('login') . $bridge->renderAdminTitle('masthead');
	$bridge->removeHook($atHook);
	restore_error_handler();
	check('adminTitle() returning blanks or an array prints nothing, without a PHP warning', $atOdd === '' && !count($atWarnings), $atOdd . implode('; ', $atWarnings));
	if($wire->page && $wire->page->id) {
		$atTitleBefore = $bridge->getBrowserTitle();
		$atHook = $bridge->addHookAfter('adminTitle', function(HookEvent $e) { if($e->arguments(0) === 'browser') $e->return = 'Acme & Co'; });
		$atTitle = $bridge->getBrowserTitle();
		$bridge->removeHook($atHook);
		$atTitleAfter = $bridge->getBrowserTitle();
		check('an adminTitle() hook for browser takes the place of Bridge in the browser title (escaped); none → Bridge again',
			(strpos($atTitle, '• Acme &amp; Co') !== false || strpos($atTitle, '&bull; Acme &amp; Co') !== false) && strpos($atTitle, 'Bridge') === false
			&& strpos($atTitleBefore, 'Bridge') !== false && $atTitleAfter === $atTitleBefore, $atTitleBefore . ' | ' . $atTitle);
	}
	$atShellSrc = (string) file_get_contents($themeDir . 'lib/AdminThemeBridgeShell.php');
	check('getBrowserTitle() leaves a custom browserTitle alone (only the " • ProcessWire" form is rewritten)', strpos($atShellSrc, "str_replace(array(' • ProcessWire', ' &bull; ProcessWire'), \$replace, \$title)") !== false);
	$atMastSrc = (string) file_get_contents($themeDir . '_masthead.php');
	$atContentSrc = (string) file_get_contents($themeDir . '_content.php');
	$atHeadSrc = (string) file_get_contents($themeDir . '_head.php');
	check('_masthead.php prints the masthead title inside the logo link', strpos($atMastSrc, "<a class='pw-logo-link' href='<?php echo \$adminTheme->wire()->sanitizer->entities(\$homeUrl); ?>'><?php echo \$adminTheme->renderLogo() . \$adminTheme->renderAdminTitle('masthead'); ?></a>") !== false);
	check('_content.php prints the login title after the logo link, before the screen-reader headline', strpos($atContentSrc, "\$adminTheme->renderLogo() . \"</a>\" . \$adminTheme->renderAdminTitle('login') . \"<span class='pw-sr-only'>\$headline</span></h1>\"") !== false);
	$atTitlePos = strpos($atHeadSrc, '<title>');
	$atIconPos = strpos($atHeadSrc, "if(\$plan->favicon !== '') echo \"\\t<link rel='icon' href='\" . \$attr(\$plan->favicon) . \"' />\\n\";");
	check('_head.php prints <link rel=icon> right after <title>, escaped, only when the plan has a favicon', $atTitlePos !== false && $atIconPos !== false && $atIconPos > $atTitlePos
		&& strpos(substr($atHeadSrc, $atTitlePos, $atIconPos - $atTitlePos), '<script') === false);
	$atHeadLib = (string) file_get_contents($themeDir . 'lib/AdminThemeBridgeHead.php');
	check('assetPlan() sets the favicon from faviconUrl(), a URL without // under the site root', strpos($atHeadLib, '$favicon = $this->faviconUrl();') !== false
		&& strpos($atHeadLib, "if(\$favicon !== '' && strpos(\$favicon, '//') === false) \$favicon = \$this->wire()->config->urls->root . ltrim(\$favicon, '/');") !== false
		&& strpos($atHeadLib, '$plan->favicon = $favicon;') !== false && property_exists('ProcessWire\\AdminThemeBridgeAssetPlan', 'favicon'));
	$atFav = array();
	foreach(array('', 'site/assets/x/fav.png?v=2', 'https://cdn.example/f.ico', array('x')) as $atValue) {
		$atHook = $bridge->addHookAfter('faviconUrl', function(HookEvent $e) use($atValue) { $e->return = $atValue; });
		try { $atFav[] = $bridge->assetPlan('default')->favicon; } catch(\Throwable $t) { $atFav[] = 'ERR ' . $t->getMessage(); }
		$bridge->removeHook($atHook);
	}
	check('assetPlan() favicon: none → empty, site/assets/… → under the site root, https://… as it is, an array → empty', $atFav === array('', $config->urls->root . 'site/assets/x/fav.png?v=2', 'https://cdn.example/f.ico', ''), json_encode($atFav));
	$atCss = (string) @file_get_contents($themeDir . 'assets/dist/theme.css');
	check('theme.css styles .pw-admin-title in the masthead and on the login card, hidden in the masthead below 768px', strpos($atCss, '.pw-masthead .pw-admin-title{') !== false
		&& strpos($atCss, '#pw-content-title .pw-admin-title{display:block') !== false && preg_match('/@media\s*\(max-width:\s*767px\)\{[^@]*\.pw-masthead \.pw-admin-title\{display:none\}/', $atCss) === 1);
	$readsBad = array();
	foreach($surface['reads'] as $name) {
		if(!method_exists($bridge, $name) || !(new \ReflectionMethod($bridge, $name))->isPublic() || method_exists($bridge, "___$name")) $readsBad[] = $name;
	}
	check('extensionSurface() reads are public, non-hookable theme methods', !count($readsBad), implode(', ', $readsBad));
	preg_match('/public function __construct\(\) \{(.*?)\n\t\}/s', (string) file_get_contents($themeDir . 'AdminThemeBridge.module.php'), $ctor);
	preg_match_all("/\\\$this->set\('(\w+)'/", $ctor[1] ?? '', $ctorKeys);
	$settings = $surface['settings'];
	sort($settings);
	$ctorKeys = $ctorKeys[1];
	sort($ctorKeys);
	check('extensionSurface() settings are the keys __construct() sets', count($ctorKeys) > 0 && $settings === $ctorKeys, 'missing: ' . implode(',', array_diff($ctorKeys, $settings)) . ' extra: ' . implode(',', array_diff($settings, $ctorKeys)));
	// docs that follow the code (BG10): section 3 of docs/extensions.md lists the surface word for word
	$extDoc = (string) @file_get_contents(dirname(__DIR__) . '/docs/extensions.md');
	$docSurface = array();
	if(preg_match('/\n## 3\. The surface\n(.*?)(\n## |$)/s', $extDoc, $sec)) {
		preg_match_all('/^- \*\*(\w+)\*\*: (.*)$/m', $sec[1], $rows, PREG_SET_ORDER);
		foreach($rows as $row) {
			preg_match_all('/`([^`]+)`/', $row[2], $items);
			$docSurface[$row[1]] = $row[1] === 'contract' ? ($items[1][0] ?? '') : $items[1];
		}
	}
	check('docs/extensions.md section 3 is extensionSurface(), word for word', $docSurface === $surface, json_encode(array_keys($docSurface)));
	// step 3: the client side (runtime/src/extensions.ts, a chunk of its own)
	$rtIndex = (string) @file_get_contents($runtimeSrc . 'index.ts');
	$rtExt = (string) @file_get_contents($runtimeSrc . 'extensions.ts');
	$bridgeKeys = array();
	if(preg_match('/\nexport const Bridge = \{\n(.*?)\n\};/s', $rtIndex, $bm)) {
		preg_match_all('/^\t(\w+)(?:: |\(|,$)/m', $bm[1], $bk);
		$bridgeKeys = $bk[1];
	}
	$rtMissing = array_diff($surface['runtime'], $bridgeKeys);
	check('extensionSurface() runtime keys are keys of window.Bridge (index.ts)', count($bridgeKeys) > 0 && !count($rtMissing), implode(', ', $rtMissing));
	check('Bridge.extensions has list(), loaded(), reload()', (bool) preg_match('/\textensions: \{\n\t\tlist: .*\n\t\tloaded: .*\n\t\treload: /', $rtIndex));
	preg_match_all("/new CustomEvent\('(pw-[\w-]+)'/", $rtExt, $extEvents);
	check('the extensions chunk fires pw-extension-loaded and pw-extensions-ready, both on the surface', $extEvents[1] === array('pw-extension-loaded', 'pw-extensions-ready')
		&& !count(array_diff($extEvents[1], $surface['events'])), implode(', ', $extEvents[1]));
	check('extension modules load through components.load() (one registry, retry, failure notice)', strpos($rtExt, "import { load, loaded as componentsLoaded, ComponentModule } from './components';") !== false && strpos($rtExt, 'import(') === false);
	check('the runtime imports the extensions chunk only when the page lists extensions', strpos($rtIndex, "if (extensionList().length) importAgain(() => import('./extensions'))") !== false && !preg_match("/^import (?!type )[^\n]*from '\.\/extensions';/m", $rtIndex));
	check('an incompatible extension is not imported', strpos($rtExt, 'if (!ext.compatible) return Promise.resolve();') !== false);
	$distRt = $themeDir . 'assets/dist/';
	$rtBuilt = (string) @file_get_contents($distRt . 'runtime.js');
	preg_match_all('/from\s*["\']\.\/(chunks\/[^"\']+)["\']/', $rtBuilt, $rtStatic);
	foreach($rtStatic[1] as $part) $rtBuilt .= (string) @file_get_contents($distRt . $part);
	$extChunks = glob($distRt . 'chunks/extensions-*.js') ?: array();
	$extBuilt = false;
	foreach($extChunks as $f) if(strpos((string) file_get_contents($f), 'pw-extensions-ready') !== false) $extBuilt = true;
	check('built: the extensions chunk exists and is not part of the runtime entry', $extBuilt && strpos($rtBuilt, 'pw-extensions-ready') === false && (bool) preg_match('/import\(["\']\.\/extensions-[\w-]+\.js["\']\)/', $rtBuilt));
	check('docs/extensions.md section 5 documents the client API and the DOM-event bus', strpos($extDoc, "\n## 5. Client\n") !== false && strpos($extDoc, '`Bridge.extensions.reload(name)`') !== false && strpos($extDoc, 'The bus is DOM events, and no other.') !== false);
	// the client list: signed-in users only; no extension on the sandbox until the bundled ones declare themselves (step 6)
	$initSrc = (string) file_get_contents($themeDir . 'init.php');
	check('init.php hands the client the extensions and the contract', strpos($initSrc, "'extensions' => \$adminTheme->extensionsClientConfig(),") !== false && strpos($initSrc, "'extensionContract' => AdminThemeBridge::extensionContract,") !== false);
	check('a guest gets no extension list', $wire->user->isGuest() && $bridge->extensionsClientConfig() === array());
	check('a guest gets no extension stylesheets', $wire->user->isGuest() && $bridge->extensionStyles() === array());
	$eu = $wire->users->get('name=bridge');
	if($eu && $eu->id) {
		$guest = $wire->user;
		$wire->users->setCurrentUser($eu);
		$extList = $bridge->extensionsClientConfig();
		$extStyles = $bridge->extensionStyles();
		$wire->users->setCurrentUser($guest);
		// BridgeSample is the bundled styles fixture (0.29.0): its one stylesheet, with its module version
		check('extensionStyles() lists the stylesheets of a signed-in user\'s extensions', $extStyles === array(array('extension' => 'BridgeSample', 'url' => $config->urls->siteModules . 'BridgeSample/BridgeSample.css?v=0.1.0')), json_encode($extStyles));
		// the four bundled extensions (step 6): BridgeCsp and BridgeAdminAccessControl by the 'bridge' info key, ProcessBridgeDemo and BridgeSample by the interface; ties by class name
		$extByName = array_column($extList, null, 'name');
		check('the sandbox lists the four bundled extensions, compatible, with their module URLs', array_column($extList, 'name') === array('BridgeAdminAccessControl', 'BridgeCsp', 'BridgeSample', 'ProcessBridgeDemo')
			&& count(array_filter(array_column($extList, 'compatible'))) === 4
			&& $extByName['BridgeCsp']['module'] === ''
			&& $extByName['BridgeSample']['module'] === $config->urls->siteModules . 'BridgeSample/BridgeSample.mjs?v=0.1.0'
			&& $extByName['ProcessBridgeDemo']['module'] === $config->urls->siteModules . 'BridgeDemo/ProcessBridgeDemo.mjs?v=' . $modules->getModuleInfoProperty('ProcessBridgeDemo', 'version'), json_encode($extList));
		$cspExt = $modules->getModuleInfo('BridgeCsp');
		check('BridgeCsp declares itself by the bridge info key: hooks nonce, reads useLegacyStack', isset($cspExt['bridge']) && $cspExt['bridge']['hooks'] === array('nonce') && $cspExt['bridge']['reads'] === array('useLegacyStack')
			&& !in_array('AdminThemeBridge', (array) $modules->getModuleInfoProperty('BridgeCsp', 'requires'), true));
		check('ProcessBridgeDemo is a component and an extension (reads nonceAttr, page-edit)', is_subclass_of(__NAMESPACE__ . '\ProcessBridgeDemo', __NAMESPACE__ . '\BridgeExtension')
			&& is_subclass_of(__NAMESPACE__ . '\ProcessBridgeDemo', __NAMESPACE__ . '\BridgeComponent')
			&& isset($bridge->extensions()['ProcessBridgeDemo']) && $bridge->extensions()['ProcessBridgeDemo']['reads'] === array('nonceAttr') && $bridge->extensions()['ProcessBridgeDemo']['permission'] === 'page-edit');
	}
	$probe = $bridge->extensionInfo('ProcessBridgeDemo', array('contract' => '^0.1', 'module' => 'x.mjs', 'priority' => '7', 'slots' => array('footer' => 'f', 3 => 'g'), 'hooks' => array('nonce', 'nonce', ''), 'oops' => 1));
	check('extensionInfo() normalises a manifest', $probe['name'] === 'ProcessBridgeDemo' && $probe['compatible'] === true && $probe['priority'] === 7 && $probe['slots'] === array('footer' => 'f')
		&& $probe['hooks'] === array('nonce') && $probe['unknown'] === array('oops') && $probe['permission'] === '' && $probe['module'] === $config->urls('ProcessBridgeDemo') . 'x.mjs?v=' . $modules->getModuleInfoProperty('ProcessBridgeDemo', 'version'), json_encode($probe));
	// 0.29.0: contract 0.2 (sprint extension-styles-bridge-custom, step 1); 0.1 stays honoured through extensionContracts
	$compatBad = array();
	foreach(array('^0.1' => true, '^0.2' => true, '^0.3' => false, '~0.1' => true, '>=0.2' => true, '<0.2' => true) as $range => $want) {
		if($bridge->extensionInfo('ProcessBridgeDemo', array('contract' => $range))['compatible'] !== $want) $compatBad[] = $range;
	}
	check('extensionInfo() compatible: a range takes any contract the theme honours', !count($compatBad), implode(', ', $compatBad));
	$probe = $bridge->extensionInfo('ProcessBridgeDemo', array('contract' => '^0.2', 'styles' => array('a.css', '', 7, '/x/b.css', 'https://cdn/c.css'), 'tokens' => array('--foreground', '', '--foreground')));
	check('extensionInfo() normalises styles and tokens, both known keys', $probe['styles'] === array($config->urls('ProcessBridgeDemo') . 'a.css?v=' . $modules->getModuleInfoProperty('ProcessBridgeDemo', 'version'), '/x/b.css', 'https://cdn/c.css')
		&& $probe['tokens'] === array('--foreground') && $probe['unknown'] === array(), json_encode($probe));
	// 0.29.1: an absolute or root-relative `module` keeps its place and gets ?v= unless it has a query (docs/extensions.md 2; sprint fix-leftovers, step 5)
	$demoVersion = rawurlencode((string) $modules->getModuleInfoProperty('ProcessBridgeDemo', 'version'));
	$moduleUrls = array();
	foreach(array('https://cdn/m.mjs', '/x/m.mjs', 'https://cdn/m.mjs?a=1') as $u) $moduleUrls[] = $bridge->extensionInfo('ProcessBridgeDemo', array('contract' => '^0.2', 'module' => $u))['module'];
	check('extensionInfo(): an absolute or root-relative module URL gets ?v=<version> unless it has a query', $moduleUrls === array("https://cdn/m.mjs?v=$demoVersion", "/x/m.mjs?v=$demoVersion", 'https://cdn/m.mjs?a=1'), json_encode($moduleUrls));
}
// 0.27.0: shell slots (docs/extensions.md 4; sprint extension-kit, step 2)
$tplSrc = array();
foreach(array('_main.php', '_masthead.php', '_content.php', '_footer.php', 'lib/AdminThemeBridgeShell.php') as $f) $tplSrc[$f] = (string) file_get_contents($themeDir . $f);
check('slots in the frame: head and body after upstream\'s extra markup', strpos($tplSrc['_main.php'], "renderExtraMarkup('head'));\n\techo \$adminTheme->renderSlot('head');") !== false
	&& strpos($tplSrc['_main.php'], "echo \$adminTheme->renderExtraMarkup('body');\n\techo \$adminTheme->renderSlot('body');") !== false);
check('slots in the masthead: masthead-right before the display controls, masthead after the extra markup', strpos($tplSrc['_masthead.php'], "echo \$adminTheme->renderSlot('masthead-right');\n\t\t\techo \$adminTheme->renderViewControls();") !== false
	&& strpos($tplSrc['_masthead.php'], "echo \$adminTheme->renderExtraMarkup('masthead');\necho \$adminTheme->renderSlot('masthead');") !== false);
check('slots in the content head, the footer and the user menu', strpos($tplSrc['_content.php'], "<div id='pw-content-head-buttons'><?php echo \$adminTheme->renderAddNewButton() . \$adminTheme->renderSlot('content-head-buttons'); ?></div>") !== false
	&& strpos($tplSrc['_footer.php'], "</p>\n\t\t<?php\n\t\techo \$adminTheme->renderSlot('footer');") !== false
	&& strpos($tplSrc['lib/AdminThemeBridgeShell.php'], "\$out\" . \$this->renderSlot('user-nav') . \$this->renderColorPicker()") !== false);
if(isset($bridge) && $bridge) {
	$slotNames = array_keys($bridge->slotTags());
	check('the surface lists the slots', $bridge->extensionSurface()['slots'] === $slotNames && count($slotNames) === 8);
	$su = $wire->users->get('name=bridge');
	$loggedIn = new \ReflectionProperty($bridge, 'isLoggedIn');
	$extList = new \ReflectionProperty($bridge, 'extensionsList');
	$extModules = new \ReflectionProperty($bridge, 'extensionModules');
	$slotCache = new \ReflectionProperty($bridge, 'slotPartsCache');
	$resetSlots = function() use($bridge, $extList, $extModules, $slotCache) {
		$extList->setValue($bridge, null);
		$extModules->setValue($bridge, array());
		$slotCache->setValue($bridge, array());
	};
	// a guest, with BridgeSample installed (0.27.0): still nothing
	$resetSlots();
	$empty = '';
	foreach($slotNames as $s) $empty .= $bridge->renderSlot($s);
	check('a guest gets no slot markup', $empty === '' && $bridge->extensionDrawers() === array());
	if($su && $su->id) {
		$guest = $wire->user;
		$wire->users->setCurrentUser($su);
		$loggedInWas = $loggedIn->getValue($bridge);
		$loggedIn->setValue($bridge, true);
		$resetSlots();
		$extList->setValue($bridge, array());
		$empty = '';
		foreach($slotNames as $s) $empty .= $bridge->renderSlot($s);
		check('signed in, with no extension filling a slot, no slot markup at all (no empty wrappers)', $empty === '' && $bridge->extensionDrawers() === array()
			&& strpos($bridge->renderUserNav() . $bridge->renderDrawers(), 'data-bridge-slot') === false);
		// a probe extension: its manifest normalised as discovery would, its instance in the per-request cache
		$probeModule = new class extends WireData {
			public function part($slot) { return "<span class='probe-$slot'>&lt;$slot&gt;</span>"; }
			public function drawer($slot) { return array('content' => "<p class='probe-drawer'>in</p>", 'label' => 'Probe <b>', 'icon' => 'flask'); }
			public function nothing($slot) { return null; }
			public function boom($slot) { throw new WireException('probe slot failure'); }
			public function wrong($slot) { return 42; }
		};
		$probeSlots = array('drawer' => 'drawer');
		foreach($slotNames as $s) if($s !== 'drawer') $probeSlots[$s] = 'part';
		$probeInfo = $bridge->extensionInfo('ProcessBridgeDemo', array('name' => 'Probe', 'contract' => '^0.1', 'slots' => $probeSlots));
		$failInfo = $bridge->extensionInfo('BridgeCsp', array('name' => 'Failing', 'contract' => '^0.1', 'priority' => 50,
			'slots' => array('footer' => 'boom', 'masthead' => 'missing', 'body' => 'wrong', 'head' => 'nothing')));
		$oldInfo = $bridge->extensionInfo('InputfieldBridgeText', array('name' => 'Old', 'contract' => '^1.0', 'slots' => array('footer' => 'part')));
		$setProbe = function(array $infos) use($bridge, $extList, $extModules, $slotCache, $probeModule) {
			$list = array();
			$mods = array();
			foreach($infos as $info) {
				$list[$info['name']] = $info;
				$mods[$info['class']] = $probeModule;
			}
			$extList->setValue($bridge, $list);
			$extModules->setValue($bridge, $mods);
			$slotCache->setValue($bridge, array());
		};
		$setProbe(array($failInfo, $probeInfo, $oldInfo));
		$logFile = $config->paths->logs . 'bridge-extensions.txt';
		$logWas = is_file($logFile) ? (string) file_get_contents($logFile) : '';
		$tags = $bridge->slotTags();
		$slotBad = array();
		foreach($slotNames as $s) {
			if($s === 'drawer') continue;
			$inner = "<span class='probe-$s'>&lt;$s&gt;</span>";
			$want = $tags[$s] === '' ? $inner : "<{$tags[$s]} data-bridge-slot='$s' data-bridge-extension='Probe'>$inner</{$tags[$s]}>";
			if($bridge->renderSlot($s) !== $want) $slotBad[] = "$s: " . $bridge->renderSlot($s);
		}
		check('each slot prints the extension\'s part in its element (head as given, user-nav an <li>), the failing ones left out', !count($slotBad), implode(' | ', $slotBad));
		$logNew = substr(is_file($logFile) ? (string) file_get_contents($logFile) : '', strlen($logWas));
		check('a slot method that throws, is missing or returns a non-string is logged to bridge-extensions; null is not', strpos($logNew, 'Failing: ProcessWire\WireException: probe slot failure') !== false
			&& strpos($logNew, 'Failing: slot masthead: no method missing()') !== false && strpos($logNew, 'Failing: slot body: wrong() returned integer') !== false
			&& strpos($logNew, 'nothing') === false, $logNew);
		check('an extension whose contract range does not take the theme\'s fills no slot', strpos($bridge->renderSlot('footer'), "data-bridge-extension='Old'") === false);
		$drawers = $bridge->extensionDrawers();
		check('the drawer slot: a drawer named ext-<name>, its label and icon', array_keys($drawers) === array('ext-probe') && $drawers['ext-probe']['label'] === 'Probe <b>' && $drawers['ext-probe']['icon'] === 'flask');
		$names = $bridge->drawerNames();
		$buttons = $bridge->renderDrawerButtons();
		$dialogs = $bridge->renderDrawers();
		check('an extension drawer comes after the theme\'s, with its button and dialog, label escaped, body as given', end($names) === 'ext-probe'
			&& strpos($buttons, "data-pw-drawer='ext-probe' aria-controls='pw-drawer-ext-probe'") !== false && strpos($buttons, 'fa-flask') !== false && strpos($buttons, "aria-label='Probe &lt;b&gt;'") !== false
			&& strpos($dialogs, "id='pw-drawer-ext-probe' aria-label='Probe &lt;b&gt;' data-pw-drawer-name='ext-probe' data-bridge-slot='drawer' data-bridge-extension='Probe'>") !== false
			&& strpos($dialogs, "<div class='pw-drawer-body'><p class='probe-drawer'>in</p></div>") !== false, $buttons . $dialogs);
		$hookId = $bridge->addHookAfter('drawerNames', function(HookEvent $e) { $e->return = array_values(array_diff($e->return, array('ext-probe'))); });
		check('drawerNames() is hookable: an after hook that drops the drawer drops its button and dialog', strpos($bridge->renderDrawerButtons() . $bridge->renderDrawers(), 'ext-probe') === false);
		$bridge->removeHook($hookId);
		$hookId = $bridge->addHookAfter('drawerNames', function(HookEvent $e) { $e->return = array_merge($e->return, array('nowhere')); });
		check('a drawer name a hook adds with nothing behind it prints no button and no dialog', strpos($bridge->renderDrawerButtons() . $bridge->renderDrawers(), 'nowhere') === false);
		$bridge->removeHook($hookId);
		$wire->input->get->modal = 1;
		$slotCache->setValue($bridge, array());
		check('in a modal window only head and body', $bridge->renderSlot('footer') === '' && $bridge->renderSlot('user-nav') === '' && $bridge->extensionDrawers() === array()
			&& $bridge->renderSlot('head') !== '' && $bridge->renderSlot('body') !== '');
		$wire->input->get->remove('modal');
		$setProbe(array(array_merge($probeInfo, array('permission' => 'bridge-no-such-permission'))));
		$wire->users->setCurrentUser($guest);
		$loggedIn->setValue($bridge, true); // a signed-in user without the permission: the guest role has none
		check('an extension the user may not have fills no slot', $bridge->renderSlot('footer') === '');
		$loggedIn->setValue($bridge, $loggedInWas);
		$resetSlots();
	}
}
// 0.27.0: the scaffold and its sample (sprint extension-kit, step 4)
// audit A1.1: a rebuilt sandbox installs the fixtures the smoke and ci.sh expect, not a hand install
check('the sandbox installs BridgeSample with the other fixtures (tools/sandbox-admin.php)', strpos((string) file_get_contents(dirname(__DIR__) . '/tools/sandbox-admin.php'),
	"array('ProcessBridgeDemo', 'BridgeCsp', 'BridgeSample', 'BridgeAdminAccessControl')") !== false);
$aclAdmin = (string) file_get_contents(dirname(__DIR__) . '/tools/sandbox-admin.php');
$aclSite = (string) file_get_contents(dirname(__DIR__) . '/tools/sandbox-site.sh');
check('a rebuilt sandbox has BridgeAdminAccessControl: junctioned by sandbox-site.sh, installed by sandbox-admin.php', strpos($aclSite, 'BridgeSample BridgeAdminAccessControl; do') !== false
	&& strpos($aclAdmin, "'BridgeSample', 'BridgeAdminAccessControl')) as \$theme") !== false);
$aclCi = (string) @file_get_contents(dirname(__DIR__) . '/tools/ci.sh');
check('tools/ci.sh runs acl-check after autocomplete-check and exports CUSTOM_MENU_ID', strpos($aclCi, 'autocomplete-check acl-check') !== false && strpos($aclCi, 'CUSTOM_MENU_ID="${CUSTOM_MENU_ID:-}"') !== false);
check('tools/ci.sh runs a failed browser check once more, says so, and lists a pass on retry in the summary', strpos($aclCi, 'RETRY $t ($browser)') !== false && strpos($aclCi, 'retried+=(') !== false && strpos($aclCi, 'passed ONLY ON RETRY') !== false && strpos($aclCi, 'exit ${#failed[@]}') !== false);
$aclPageSave = (string) @file_get_contents(dirname(__DIR__) . '/tools/page-save-check.js');
check('tools/page-save-check.js saves and deletes nothing in section F without a new item', strpos($aclPageSave, 'if(all1 > all0) {') !== false && strpos($aclPageSave, 'if(persisted) {') !== false);
check('tools/sandbox-acl.php goes through the sandbox guard and has the five presets',strpos((string) @file_get_contents(dirname(__DIR__) . '/tools/sandbox-acl.php'), "require __DIR__ . '/lib/sandbox-guard.php';") !== false
	&& strpos((string) @file_get_contents(dirname(__DIR__) . '/tools/sandbox-acl.php'), "array('clear', 'deny-tree-modules', 'deny-pages', 'deny-all-menus', 'two-roles')") !== false);
$scaffold = dirname(__DIR__) . '/tools/scaffold-extension.php';
$sampleDir = dirname(__DIR__) . '/modules/BridgeSample/';
$scaffoldSrc = (string) @file_get_contents($scaffold);
if(isset($bridge) && $bridge && preg_match("/const BRIDGE_SCAFFOLD_SLOTS = array\(([^)]*)\);/", $scaffoldSrc, $sm)) {
	preg_match_all("/'([\w-]+)'/", $sm[1], $smSlots);
	check('the scaffold knows the slots of the theme (slotTags())', $smSlots[1] === array_keys($bridge->slotTags()), implode(',', $smSlots[1]));
} else {
	check('the scaffold lists its slots in BRIDGE_SCAFFOLD_SLOTS', false);
}
$runScaffold = function(array $args) {
	$proc = proc_open(array_merge(array(PHP_BINARY, dirname(__DIR__) . '/tools/scaffold-extension.php'), $args), array(1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes);
	$out = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
	fclose($pipes[1]);
	fclose($pipes[2]);
	return array(proc_close($proc), $out);
};
// the scaffold never drifts from the committed sample: regenerate with the command the sample names
preg_match('/Generated by: php tools\/scaffold-extension\.php (.+)\n/', (string) @file_get_contents($sampleDir . 'BridgeSample.module.php'), $genCmd);
$scaffoldTmp = sys_get_temp_dir() . '/bridge-scaffold-' . getmypid();
@mkdir($scaffoldTmp);
list($scCode, $scOut) = $runScaffold(array_merge(isset($genCmd[1]) ? explode(' ', trim($genCmd[1])) : array('BridgeSample'), array('--dir=' . $scaffoldTmp)));
$drift = array();
$sampleFiles = array_values(array_diff(scandir($sampleDir), array('.', '..')));
$genFiles = is_dir("$scaffoldTmp/BridgeSample") ? array_values(array_diff(scandir("$scaffoldTmp/BridgeSample"), array('.', '..'))) : array();
if($sampleFiles !== $genFiles) $drift[] = 'files: ' . implode(',', $genFiles);
foreach($genFiles as $f) if(@file_get_contents("$scaffoldTmp/BridgeSample/$f") !== @file_get_contents($sampleDir . $f)) $drift[] = $f;
check('the scaffold regenerates modules/BridgeSample byte for byte', $scCode === 0 && isset($genCmd[1]) && count($sampleFiles) === 5 && !count($drift), "exit $scCode " . implode(', ', $drift));
list($scCode2, $scOut2) = $runScaffold(array('BridgeSample', '--dir=' . $scaffoldTmp));
check('the scaffold refuses a directory that exists', $scCode2 === 1 && strpos($scOut2, 'exists') !== false, trim($scOut2));
list($scCode3) = $runScaffold(array('BridgeOther', '--slots=sidebar', '--dir=' . $scaffoldTmp));
check('the scaffold refuses an unknown slot and writes nothing', $scCode3 === 1 && !file_exists("$scaffoldTmp/BridgeOther"));
foreach(array_merge(glob("$scaffoldTmp/*/*") ?: array()) as $f) @unlink($f);
foreach(glob("$scaffoldTmp/*") ?: array() as $d) @rmdir($d);
@rmdir($scaffoldTmp);
$sampleSrc = (string) @file_get_contents($sampleDir . 'BridgeSample.module.php');
check('BridgeSample requires the theme, loads the interface defensively, contract ^0.2', strpos($sampleSrc, "'requires' => 'AdminThemeBridge',") !== false
	&& strpos($sampleSrc, 'if(!interface_exists("ProcessWire\\\\BridgeExtension", false)) {') !== false && strpos($sampleSrc, "'contract' => '^0.2',") !== false);
// the sample fills six slots on the sandbox, signed in (step 2's criterion; step 5's harness repeats it)
if(isset($bridge) && $bridge && $wire->modules->isInstalled('BridgeSample')) {
	$su = $wire->users->get('name=bridge');
	$loggedIn = new \ReflectionProperty($bridge, 'isLoggedIn');
	$smList = new \ReflectionProperty($bridge, 'extensionsList');
	$smCache = new \ReflectionProperty($bridge, 'slotPartsCache');
	$guest = $wire->user;
	$wire->users->setCurrentUser($su);
	$loggedInWas = $loggedIn->getValue($bridge);
	$loggedIn->setValue($bridge, true);
	$smList->setValue($bridge, null);
	$smCache->setValue($bridge, array());
	$tags = $bridge->slotTags();
	foreach(array('masthead-right', 'user-nav', 'content-head-buttons', 'footer', 'body') as $s) {
		$part = $bridge->renderSlot($s);
		check("BridgeSample fills the $s slot", $part === "<{$tags[$s]} data-bridge-slot='$s' data-bridge-extension='BridgeSample'><pw-bridgesample data-slot='$s'>BridgeSample</pw-bridgesample></{$tags[$s]}>", $part);
	}
	check('BridgeSample has a drawer, and no head or masthead part', array_keys($bridge->extensionDrawers()) === array('ext-bridgesample')
		&& strpos($bridge->renderDrawers(), "<div class='pw-drawer-body'><pw-bridgesample data-slot='drawer'>") !== false
		&& $bridge->renderSlot('head') === '' && $bridge->renderSlot('masthead') === '');
	$loggedIn->setValue($bridge, $loggedInWas);
	$wire->users->setCurrentUser($guest);
	$smList->setValue($bridge, null);
	$smCache->setValue($bridge, array());
} else {
	check('BridgeSample is installed on the sandbox (php tools/sandbox-modules.php <sandbox> BridgeSample)', false);
}
// 0.27.0: the contract tests (sprint extension-kit, step 5)
$extCheck = dirname(__DIR__) . '/tools/extension-check.php';
$extCheckSrc = (string) @file_get_contents($extCheck);
$extTraitSrc = (string) @file_get_contents(dirname(__DIR__) . '/modules/AdminThemeBridge/lib/AdminThemeBridgeExtensions.php');
$knownKeys = function($src) {
	if(!preg_match('/\$known = array\(([^)]*)\);/', $src, $m)) return array();
	preg_match_all("/'(\w+)'/", $m[1], $k);
	return $k[1];
};
check('extension-check.php knows the manifest keys extensionInfo() knows', count($knownKeys($extCheckSrc)) > 5 && $knownKeys($extCheckSrc) === $knownKeys($extTraitSrc),
	implode(',', $knownKeys($extCheckSrc)) . ' vs ' . implode(',', $knownKeys($extTraitSrc)));
// 0.29.0: styles and tokens (sprint extension-styles-bridge-custom, step 3)
check('extension-check.php checks styles and tokens, takes the contract through contractCompatible()',
	strpos($extCheckSrc, '"$ext: styles $entry is a file"') !== false
	&& strpos($extCheckSrc, '"$ext: tokens \'$token\' is a token of the theme\'s surface"') !== false
	&& strpos($extCheckSrc, 'AdminThemeBridge::contractCompatible($contract)') !== false
	&& strpos($extCheckSrc, "which the manifest's tokens do not declare") !== false
	&& strpos($extCheckSrc, 'uses the internal token $token (not on the surface)') !== false
	&& strpos($extCheckSrc, 'is linked in a modal window') !== false && strpos($extCheckSrc, "'page/?modal=1'") !== false);
check('extension-check.php --self-test expects six faults, the two of 0.2 among them',
	strpos($extCheckSrc, "'tokens' => array('--no-such-token'), 'styles' => array('missing.css')") !== false
	&& strpos($extCheckSrc, "\"styles missing.css is a file\",") !== false
	&& strpos($extCheckSrc, "count(\$failLines) === 6") !== false);
check('extension-check.php looks for slot parts as renderSlot() and renderDrawers() print them',
	strpos($extCheckSrc, "\"data-bridge-slot='\$slot' data-bridge-extension='\$entity'\"") !== false
	&& strpos($extTraitSrc, "data-bridge-slot='\" . \$sanitizer->entities(\$name) . \"' data-bridge-extension='") !== false
	&& strpos((string) @file_get_contents(dirname(__DIR__) . '/modules/AdminThemeBridge/lib/AdminThemeBridgeDrawers.php'), "\" data-bridge-slot='drawer' data-bridge-extension='\"") !== false);
$extDoc6 = (string) @file_get_contents(dirname(__DIR__) . '/docs/extensions.md');
check('docs/extensions.md section 6 documents the contract tests', strpos($extDoc6, "\n## 6. Contract tests\n") !== false
	&& strpos($extDoc6, 'php tools/extension-check.php sandbox/atispro --self-test') !== false);
check('extension-check.js takes the manifests from extension-check.php --json', strpos((string) @file_get_contents(dirname(__DIR__) . '/tools/extension-check.js'), "'extension-check.php'), SANDBOX, target, '--json']") !== false);
if($wire->modules->isInstalled('BridgeSample')) {
	$runExtCheck = function(array $args) use($extCheck, $root) {
		$proc = proc_open(array_merge(array(PHP_BINARY, $extCheck, $root), $args), array(1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes);
		$out = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
		fclose($pipes[1]);
		fclose($pipes[2]);
		return array(proc_close($proc), $out);
	};
	list($ecCode, $ecOut) = $runExtCheck(array('BridgeSample', '--no-http'));
	check('extension-check.php BridgeSample --no-http: exit 0, no FAIL', $ecCode === 0 && strpos($ecOut, "\nFAIL ") === false && strpos($ecOut, 'all passed') !== false, "exit $ecCode");
	list($ecCode, $ecOut) = $runExtCheck(array('BridgeSample', '--json'));
	$ecJson = json_decode(substr($ecOut, (int) strpos($ecOut, '[')), true);
	check('extension-check.php --json: BridgeSample, its module, its stylesheet, six slots filled', $ecCode === 0 && is_array($ecJson) && count($ecJson) === 1 && $ecJson[0]['name'] === 'BridgeSample'
		&& strpos((string) $ecJson[0]['module'], 'BridgeSample.mjs?v=') !== false && array_keys(array_filter($ecJson[0]['slots'])) === array('masthead-right', 'user-nav', 'content-head-buttons', 'footer', 'drawer', 'body')
		&& isset($ecJson[0]['styles']) && count($ecJson[0]['styles']) === 1 && substr((string) $ecJson[0]['styles'][0], -strlen('BridgeSample/BridgeSample.css?v=0.1.0')) === 'BridgeSample/BridgeSample.css?v=0.1.0', trim($ecOut));
	list($ecCode, $ecOut) = $runExtCheck(array('NoSuchExtensionDir'));
	check('extension-check.php refuses a name that is neither a module nor a directory', $ecCode === 1 && strpos($ecOut, 'FAIL NoSuchExtensionDir') !== false, trim($ecOut));
}
// 0.27.0: the compatibility checker (sprint extension-kit, step 7)
$surfaceJson = json_decode((string) @file_get_contents($themeDir . 'assets/dist/extension-surface.json'), true);
if(isset($bridge)) {
	check('assets/dist/extension-surface.json is extensionSurface() (rebuild the runtime after a surface change)', is_array($surfaceJson) && $surfaceJson === $bridge->extensionSurface(),
		is_array($surfaceJson) ? json_encode(array_keys($surfaceJson)) : 'missing');
}
check('the runtime build writes extension-surface.json from the theme source', strpos((string) @file_get_contents(dirname(__DIR__) . '/runtime/scripts/manifest.mjs'), "writeFileSync(dist + 'extension-surface.json'") !== false);
$extCompat = dirname(__DIR__) . '/tools/extension-compat.php';
$runCompat = function(array $args) use($extCompat) {
	$proc = proc_open(array_merge(array(PHP_BINARY, $extCompat), $args), array(1 => array('pipe', 'w'), 2 => array('pipe', 'w')), $pipes);
	$out = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
	fclose($pipes[1]);
	fclose($pipes[2]);
	return array(proc_close($proc), $out);
};
list($ccCode, $ccOut) = $runCompat(array());
$ccOk = function($out, $name) { return (bool) preg_match('/^' . $name . ' .* ok\s*$/m', $out); };
check('extension-compat.php on this checkout: the four bundled extensions, 0 incompatible, exit 0', $ccCode === 0 && strpos($ccOut, "\n4 extensions, 0 incompatible") !== false
	&& $ccOk($ccOut, 'BridgeAdminAccessControl') && $ccOk($ccOut, 'BridgeCsp') && $ccOk($ccOut, 'ProcessBridgeDemo') && $ccOk($ccOut, 'BridgeSample'), "exit $ccCode: " . trim($ccOut));
$ccTmp = sys_get_temp_dir() . '/bridge-compat-' . getmypid();
@mkdir("$ccTmp/old", 0777, true);
@mkdir("$ccTmp/ext/CompatDynamic", 0777, true);
@mkdir("$ccTmp/ext/CompatPlain", 0777, true);
if(is_array($surfaceJson)) {
	$edited = $surfaceJson;
	$edited['contract'] = '1.0';
	$edited['contracts'] = array('1.0');
	$edited['slots'] = array_values(array_diff($edited['slots'], array('footer')));
	file_put_contents("$ccTmp/surface.json", json_encode($edited));
	list($ccCode, $ccOut) = $runCompat(array("--surface=$ccTmp/surface.json"));
	check('extension-compat.php against contract 1.0 without footer: all four incompatible, BridgeSample also on its slot, exit 4', $ccCode === 4
		&& substr_count($ccOut, 'INCOMPATIBLE  contract ^0.1 takes none of 1.0') === 3 && (bool) preg_match('/^BridgeSample .*INCOMPATIBLE  contract \^0\.2 takes none of 1\.0; .*slots footer not on the target surface$/m', $ccOut), "exit $ccCode: " . trim($ccOut));
}
file_put_contents("$ccTmp/old/AdminThemeBridge.module.php", "<?php namespace ProcessWire;\nclass AdminThemeBridge {}\n");
list($ccCode, $ccOut) = $runCompat(array("--bridge=$ccTmp/old", dirname(__DIR__) . '/modules'));
check('extension-compat.php against a Bridge without an extension contract: all incompatible', $ccCode === 4 && substr_count($ccOut, 'the target has no extension contract') === 4, "exit $ccCode");
file_put_contents("$ccTmp/ext/CompatDynamic/CompatDynamic.module.php", "<?php namespace ProcessWire;\nclass CompatDynamic extends WireData implements Module, BridgeExtension {\n\tpublic static function getModuleInfo() { return array('requires' => 'AdminThemeBridge'); }\n\tpublic function getBridgeExtension() { \$m = array('contract' => '^0.1'); return \$m; }\n}\n");
file_put_contents("$ccTmp/ext/CompatPlain/CompatPlain.module.php", "<?php namespace ProcessWire;\nclass CompatPlain extends WireData implements Module {\n\tpublic static function getModuleInfo() { return array('requires' => 'AdminThemeBridge'); }\n}\n");
list($ccCode, $ccOut) = $runCompat(array("$ccTmp/ext"));
check('extension-compat.php: a manifest built at run time is incompatible, a module without one is skipped, not listed', $ccCode === 1
	&& strpos($ccOut, 'manifest not readable statically') !== false && strpos($ccOut, 'CompatPlain') === false && strpos($ccOut, '(1 module without a manifest skipped)') !== false, "exit $ccCode: " . trim($ccOut));
list($ccVCode, $ccVOut) = $runCompat(array('--verbose', "$ccTmp/ext"));
check('extension-compat.php --verbose: lists the skipped module with its directory and reason, same table, summary and exit', $ccVCode === 1
	&& (bool) preg_match('/^CompatPlain +\S*CompatPlain +no manifest$/m', $ccVOut) && strpos($ccVOut, "\nSkipped ") !== false
	&& strpos($ccVOut, 'manifest not readable statically') !== false && substr($ccVOut, -strlen('(1 module without a manifest skipped)' . "\n")) === '(1 module without a manifest skipped)' . "\n", "exit $ccVCode: " . trim($ccVOut));
check('extension-compat.php without --verbose prints no skipped list', strpos($ccOut, 'Skipped') === false && strpos($ccOut, 'no manifest') === false);
list($ccVCode, $ccVOut) = $runCompat(array('--verbose', "$ccTmp/ext", "$ccTmp/old", "$ccTmp/ext"));
check('extension-compat.php --verbose: a module found twice and the theme itself are listed, not counted', $ccVCode === 1
	&& (bool) preg_match('/^CompatPlain +\S+ +found twice, counted in /m', $ccVOut) && (bool) preg_match('/^AdminThemeBridge +\S+ +the theme itself$/m', $ccVOut)
	&& strpos($ccVOut, '(1 module without a manifest skipped)') !== false, "exit $ccVCode: " . trim($ccVOut));
list($ccCode, $ccOut) = $runCompat(array("--bridge=$ccTmp/nowhere"));
check('extension-compat.php: an unreadable target exits 255', $ccCode === 255);
// copy precedence: the module's own file wins over a copy ProcessWire would also see (in a
// module-named subdirectory, Aaa/ holding Aaa.module, sorting before the own file), with no manifest
@mkdir("$ccTmp/prec/CompatCopy/Aaa", 0777, true);
file_put_contents("$ccTmp/prec/CompatCopy/CompatCopy.module.php", "<?php namespace ProcessWire;\nclass CompatCopy extends WireData implements Module {\n\tpublic static function getModuleInfo() { return array('version' => 2, 'bridge' => array('contract' => '^0.1')); }\n}\n");
file_put_contents("$ccTmp/prec/CompatCopy/Aaa/Aaa.module", "<?php namespace ProcessWire;\nclass Aaa extends WireData implements Module {\n\tpublic static function getModuleInfo() { return array('version' => 1); }\n}\n");
file_put_contents("$ccTmp/prec/CompatCopy/Aaa/CompatCopy.module", "<?php namespace ProcessWire;\nclass CompatCopy extends WireData implements Module {\n\tpublic static function getModuleInfo() { return array('version' => 1); }\n}\n");
list($ccVCode, $ccVOut) = $runCompat(array('--verbose', "$ccTmp/prec"));
check('extension-compat.php: a directory\'s own module file wins over a copy in a module-named subdirectory (the copy is the one found twice)', $ccVCode === 0
	&& (bool) preg_match('#^CompatCopy +2 +\S*/prec/CompatCopy +\^0\.1 +ok$#m', $ccVOut)
	&& (bool) preg_match('#^CompatCopy +\S*/prec/CompatCopy/Aaa +found twice, counted in \S*/prec/CompatCopy$#m', $ccVOut)
	&& strpos($ccVOut, "\n1 extension, 0 incompatible (1 module without a manifest skipped)\n") !== false, "exit $ccVCode: " . trim($ccVOut));
// ProcessWire's discovery rule (ModulesFiles.php:137): below the top level only a directory holding a
// module named after it is entered, so Alpha/legacy/Beta.module is not seen and Beta counts from Beta/
@mkdir("$ccTmp/sib/Alpha/legacy", 0777, true);
@mkdir("$ccTmp/sib/Beta", 0777, true);
file_put_contents("$ccTmp/sib/Alpha/Alpha.module", "<?php namespace ProcessWire;\nclass Alpha extends WireData implements Module {\n\tpublic static function getModuleInfo() { return array('version' => 1); }\n}\n");
file_put_contents("$ccTmp/sib/Alpha/legacy/Beta.module", "<?php namespace ProcessWire;\nclass Beta extends WireData implements Module {\n\tpublic static function getModuleInfo() { return array('version' => 1); }\n}\n");
file_put_contents("$ccTmp/sib/Beta/Beta.module", "<?php namespace ProcessWire;\nclass Beta extends WireData implements Module {\n\tpublic static function getModuleInfo() { return array('version' => 2, 'bridge' => array('contract' => '^0.1')); }\n}\n");
list($ccVCode, $ccVOut) = $runCompat(array('--verbose', "$ccTmp/sib"));
check('extension-compat.php follows ProcessWire\'s discovery rule: a copy in a directory not named like a module (Alpha/legacy/) is not seen, Beta counts from Beta/', $ccVCode === 0
	&& (bool) preg_match('#^Beta +2 +\S*/sib/Beta +\^0\.1 +ok$#m', $ccVOut) && strpos($ccVOut, 'legacy') === false && strpos($ccVOut, 'found twice') === false
	&& (bool) preg_match('#^Alpha +\S*/sib/Alpha +no manifest$#m', $ccVOut)
	&& strpos($ccVOut, "\n1 extension, 0 incompatible (1 module without a manifest skipped)\n") !== false, "exit $ccVCode: " . trim($ccVOut));
// contract 0.2: `tokens` on the target surface, relative `styles` files exist (as `module`)
@mkdir("$ccTmp/tok/CompatStyled", 0777, true);
file_put_contents("$ccTmp/tok/CompatStyled/CompatStyled.module", "<?php namespace ProcessWire;\nclass CompatStyled extends WireData implements Module {\n\tpublic static function getModuleInfo() { return array('version' => 1, 'bridge' => array('contract' => '^0.2', 'tokens' => array('--foreground', '--nope'), 'styles' => array('gone.css', '/x/abs.css'))); }\n}\n");
list($ccCode, $ccOut) = $runCompat(array("$ccTmp/tok"));
check('extension-compat.php: an unknown token and a missing styles file make an extension INCOMPATIBLE with both problems, exit 1', $ccCode === 1
	&& (bool) preg_match('/^CompatStyled .*INCOMPATIBLE  tokens --nope not on the target surface; styles file gone\.css missing$/m', $ccOut)
	&& strpos($ccOut, 'abs.css') === false && strpos($ccOut, "\n1 extension, 1 incompatible") !== false, "exit $ccCode: " . trim($ccOut));
// the contract versions a target honours: the surface's `contracts`, else its `contract` alone
@mkdir("$ccTmp/c01/CompatOld", 0777, true);
file_put_contents("$ccTmp/c01/CompatOld/CompatOld.module", "<?php namespace ProcessWire;\nclass CompatOld extends WireData implements Module {\n\tpublic static function getModuleInfo() { return array('version' => 1, 'bridge' => array('contract' => '^0.1')); }\n}\n");
file_put_contents("$ccTmp/with.json", json_encode(array('contract' => '0.2', 'contracts' => array('0.1', '0.2'))));
file_put_contents("$ccTmp/without.json", json_encode(array('contract' => '0.2')));
list($ccCode, $ccOut) = $runCompat(array("--surface=$ccTmp/with.json", "$ccTmp/c01"));
list($ccCode2, $ccOut2) = $runCompat(array("--surface=$ccTmp/without.json", "$ccTmp/c01"));
check('extension-compat.php: a --surface with contract 0.2 and contracts [0.1, 0.2] takes a ^0.1 manifest; without contracts it does not', $ccCode === 0
	&& $ccOk($ccOut, 'CompatOld') && $ccCode2 === 1 && (bool) preg_match('/^CompatOld .*INCOMPATIBLE  contract \^0\.1 takes none of 0\.2$/m', $ccOut2),
	"exit $ccCode / $ccCode2: " . trim($ccOut) . ' | ' . trim($ccOut2));
foreach(array("$ccTmp/ext/CompatDynamic/CompatDynamic.module.php", "$ccTmp/ext/CompatPlain/CompatPlain.module.php", "$ccTmp/old/AdminThemeBridge.module.php", "$ccTmp/surface.json",
	"$ccTmp/prec/CompatCopy/CompatCopy.module.php", "$ccTmp/prec/CompatCopy/Aaa/Aaa.module", "$ccTmp/prec/CompatCopy/Aaa/CompatCopy.module",
	"$ccTmp/sib/Alpha/Alpha.module", "$ccTmp/sib/Alpha/legacy/Beta.module", "$ccTmp/sib/Beta/Beta.module",
	"$ccTmp/tok/CompatStyled/CompatStyled.module", "$ccTmp/c01/CompatOld/CompatOld.module", "$ccTmp/with.json", "$ccTmp/without.json") as $f) @unlink($f);
foreach(array("$ccTmp/ext/CompatDynamic", "$ccTmp/ext/CompatPlain", "$ccTmp/ext", "$ccTmp/old",
	"$ccTmp/prec/CompatCopy/Aaa", "$ccTmp/prec/CompatCopy", "$ccTmp/prec",
	"$ccTmp/sib/Alpha/legacy", "$ccTmp/sib/Alpha", "$ccTmp/sib/Beta", "$ccTmp/sib",
	"$ccTmp/tok/CompatStyled", "$ccTmp/tok", "$ccTmp/c01/CompatOld", "$ccTmp/c01", $ccTmp) as $d) @rmdir($d);
check('extension-compat.php smoke fixtures removed', !is_dir($ccTmp), $ccTmp);
$extDoc8 = (string) @file_get_contents(dirname(__DIR__) . '/docs/extensions.md');
check('docs/extensions.md section 8 documents the compatibility checker', strpos($extDoc8, "\n## 8. Compatibility\n") !== false && strpos($extDoc8, 'php tools/extension-compat.php [--bridge=') !== false);
check('docs/extensions.md section 8 documents --verbose', strpos($extDoc8, '[--surface=<json>] [--verbose] [<dir>...]') !== false && strpos($extDoc8, 'With `--verbose` it also lists') !== false);
// 0.27.0: dev mode for an extension's JS (docs/extensions.md 9; sprint extension-kit, step 8)
$devModuleSrc = (string) file_get_contents($themeDir . 'AdminThemeBridge.module.php');
$devConfigSrc = (string) file_get_contents($themeDir . 'lib/AdminThemeBridgeConfig.php');
check('extensionDev: a setting, off by default, a checkbox under Features', strpos($devModuleSrc, "\$this->set('extensionDev', 0);") !== false
	&& strpos($devConfigSrc, "\$f->attr('name', 'extensionDev');") !== false && strpos($devConfigSrc, "__('Extension development', __FILE__)") !== false
	&& strpos($devConfigSrc, "'extensionDev'") > strpos($devConfigSrc, "'_features'") && strpos($devConfigSrc, "'extensionDev'") < strpos($devConfigSrc, "'_legacy'"));
if(isset($bridge) && $bridge && $modules->isInstalled('BridgeSample') && $modules->isInstalled('InputfieldBridgeText')) {
	$devSu = $wire->users->get('name=bridge');
	$devGuest = $wire->user;
	$devTimes = new \ReflectionProperty($bridge, 'extensionDevTimes');
	$devDb = function() use($wire) {
		$q = $wire->database->prepare('SELECT data FROM modules WHERE class=:c');
		$q->execute(array(':c' => 'AdminThemeBridge'));
		$data = json_decode((string) $q->fetchColumn(), true);
		return is_array($data) && !empty($data['extensionDev']);
	};
	$devUrls = function() use($bridge, $modules, $devTimes, $wire) {
		$devTimes->setValue($bridge, array());
		$out = array();
		foreach(array('BridgeSample', 'ProcessBridgeDemo') as $n) {
			$m = $modules->getModule($n, array('noPermissionCheck' => true, 'noInit' => true));
			$out[$n] = $bridge->extensionInfo($n, $m->getBridgeExtension())['module'];
		}
		$out['InputfieldBridgeText'] = $bridge->componentInfo($modules->getModule('InputfieldBridgeText', array('noPermissionCheck' => true)))['module'];
		$out['core'] = $bridge->extensionInfo('ProcessBridgeDemo', array('contract' => '^0.1', 'module' => $wire->config->urls->modules . 'Process/ProcessPageList/x.mjs'))['module'];
		// a `styles` entry resolves as `module` does: BridgeSample's own stylesheet
		$out['styles'] = $bridge->extensionInfo('BridgeSample', array('contract' => '^0.2', 'styles' => array('BridgeSample.css')))['styles'][0];
		return $out;
	};
	$devVersions = array();
	foreach(array('BridgeSample', 'ProcessBridgeDemo', 'InputfieldBridgeText') as $n) $devVersions[$n] = '?v=' . $modules->getModuleInfoProperty($n, 'version');
	$devEnds = function($url, $end) { return substr((string) $url, -strlen($end)) === $end; };
	$devFile = $config->paths->siteModules . 'BridgeSample/BridgeSample.mjs';
	$devConfigWas = (array) $modules->getConfig('AdminThemeBridge');
	$devWas = $bridge->get('extensionDev');
	check('extensionDev is off on the sandbox before the dev-mode lines', !$devWas && !$devDb());
	$wire->users->setCurrentUser($devSu);
	$off = $devUrls();
	check('dev mode off: module URLs carry the module version', $off['BridgeSample'] === $config->urls->siteModules . 'BridgeSample/BridgeSample.mjs' . $devVersions['BridgeSample']
		&& $devEnds($off['ProcessBridgeDemo'], $devVersions['ProcessBridgeDemo']) && $devEnds($off['InputfieldBridgeText'], $devVersions['InputfieldBridgeText'])
		&& $devEnds($off['core'], $devVersions['ProcessBridgeDemo']), json_encode($off));
	check('dev mode off: a site module\'s `styles` entry carries the module version', $off['styles'] === $config->urls->siteModules . 'BridgeSample/BridgeSample.css' . $devVersions['BridgeSample'], $off['styles']);
	try {
		// toggled on the sandbox (saved in its database, as the settings screen does) and on the running theme
		$modules->saveConfig('AdminThemeBridge', 'extensionDev', 1);
		$bridge->set('extensionDev', 1);
		check('extensionDev saved on in the sandbox database', $devDb());
		$on = $devUrls();
		check('dev mode on, superuser: BridgeSample\'s URL ends in ?v=<10-digit file time>', $on['BridgeSample'] === $config->urls->siteModules . 'BridgeSample/BridgeSample.mjs?v=' . filemtime($devFile)
			&& (bool) preg_match('/\?v=\d{10}$/', $on['BridgeSample']), $on['BridgeSample']);
		check('dev mode on: ProcessBridgeDemo\'s module and InputfieldBridgeText\'s component carry their file time too', (bool) preg_match('/\.mjs\?v=\d{10}$/', $on['ProcessBridgeDemo'])
			&& (bool) preg_match('#/pw-text\.js\?v=\d{10}$#', $on['InputfieldBridgeText']), json_encode($on));
		check('dev mode on, superuser: a site module\'s `styles` entry ends in ?v=<10-digit file time>', (bool) preg_match('/\?v=\d{10}$/', $on['styles']), $on['styles']);
		check('dev mode on: a module URL outside the site modules (core) keeps the module version', $on['core'] === $off['core'], $on['core']);
		$wire->users->setCurrentUser($devGuest);
		$onGuest = $devUrls();
		check('dev mode on, not a superuser: module versions as with it off', $onGuest === $off, json_encode($onGuest));
	} finally {
		$wire->users->setCurrentUser($devGuest);
		$modules->saveConfig('AdminThemeBridge', $devConfigWas);
		$bridge->set('extensionDev', $devWas);
		$devTimes->setValue($bridge, array());
	}
	$wire->users->setCurrentUser($devSu);
	$back = $devUrls();
	$wire->users->setCurrentUser($devGuest);
	check('extensionDev restored to off on the sandbox (database and theme), URLs as before', !$devDb() && !$bridge->get('extensionDev') && $back === $off, json_encode($back));
} else {
	check('dev mode lines need BridgeSample and InputfieldBridgeText installed on the sandbox', false);
}
$devDoc = (string) @file_get_contents(dirname(__DIR__) . '/docs/extensions.md');
$devTool = (string) @file_get_contents(dirname(__DIR__) . '/tools/extension-dev.js');
check('tools/extension-dev.js watches the module directory and calls Bridge.extensions.reload()', strpos($devTool, 'fs.watch(dir, { recursive: true }') !== false
	&& strpos($devTool, 'await Bridge.extensions.reload(name);') !== false && strpos($devTool, "-> Bridge.extensions.reload('") !== false);
check('extension-check.js reloads an edited copy of the module and looks for its version', strpos((string) @file_get_contents(dirname(__DIR__) . '/tools/extension-check.js'), 'reload() imports an edited copy, loaded() has its version') !== false);
// contract 0.2 (sprint extension-styles-bridge-custom, step 4): source checks; both need a browser
// (and extension-dev.js a file watcher), so smoke cannot run them end to end
$extCheckJs = (string) @file_get_contents(dirname(__DIR__) . '/tools/extension-check.js');
check('extension-check.js checks the styles links: after fields.css, kept after an injected sheet, loaded, in a modal window (source check)', strpos($extCheckJs, "querySelectorAll('link[data-bridge-styles]')") !== false
	&& strpos($extCheckJs, "ADMIN + 'page/?modal=1'") !== false && strpos($extCheckJs, 'Node.DOCUMENT_POSITION_FOLLOWING') !== false && strpos($extCheckJs, 'link.sheet !== null') !== false);
check('extension-dev.js swaps the href of link[data-bridge-styles] on a changed .css file, other files keep reload() (source check)', strpos($devTool, "querySelectorAll('link[data-bridge-styles]')") !== false
	&& strpos($devTool, 'const css = files.filter(f => /\.css$/i.test(f));') !== false && strpos($devTool, "url.searchParams.set('v', String(Date.now()));") !== false);
check('docs/extensions.md section 9 documents dev mode and says it is not HMR', strpos($devDoc, "\n## 9. Dev mode\n") !== false && strpos($devDoc, 'PW=<playwright-core dir> node tools/extension-dev.js modules/BridgeSample') !== false
	&& strpos($devDoc, 'it is not hot module replacement') !== false);
// 0.27.0: the kit in CI and in the docs (sprint extension-kit, step 9)
$ciSrc = (string) @file_get_contents(dirname(__DIR__) . '/tools/ci.sh');
check('tools/ci.sh runs the compatibility checker and both contract tests on the four bundled extensions', strpos($ciSrc, 'EXTENSIONS="BridgeCsp BridgeDemo BridgeSample BridgeAdminAccessControl"') !== false
	&& strpos($ciSrc, '"$PHP" tools/extension-compat.php') !== false && strpos($ciSrc, '"$PHP" tools/extension-check.php "$SANDBOX" "$m"') !== false
	&& strpos($ciSrc, 'node tools/extension-check.js "$PW" "$browser" "$m"') !== false && strpos($ciSrc, 'failed+=("extensions")') !== false);
check('docs/extensions.md documents the scaffold and what contract 0.2 leaves out', strpos($devDoc, "\n## 10. Scaffold\n") !== false && strpos($devDoc, "\n## 11. Not in contract 0.2\n") !== false
	&& strpos($devDoc, 'php tools/scaffold-extension.php <Name> [--dir=modules] [--slots=footer,user-nav] [--module] [--styles]') !== false
	&& strpos($devDoc, '`BridgeSample --slots=masthead-right,user-nav,content-head-buttons,footer,drawer,body --module --styles`') !== false);
// 0.29.0: contract 0.2 in the docs (sprint extension-styles-bridge-custom, step 6)
check('docs/extensions.md: contract 0.2 in the title, styles and tokens keys, six self-test faults, the dev watcher\'s .css branch, section 12', strpos($devDoc, "# Bridge extensions, contract 0.2\n") === 0
	&& strpos($devDoc, "\n## 12. Styling extensions\n") !== false && strpos($devDoc, '| `styles` | array |') !== false && strpos($devDoc, '| `tokens` | array |') !== false
	&& strpos($devDoc, 'writes a module with six faults') !== false && strpos($devDoc, 'A changed `.css` file takes no') !== false
	&& strpos($devDoc, "data-bridge-styles='<name>'") !== false);
// 0.29.1: the three doc nits of the styles work (sprint fix-leftovers, step 5)
$sec12 = (string) strstr($devDoc, "\n## 12. Styling extensions\n");
check('docs/extensions.md 12: a site copy of _head.php on headPlan() prints no extension stylesheets; the loop over extensionStyles() shown', strpos($sec12, "head from `headPlan()` prints no extension stylesheets") !== false
	&& strpos($sec12, 'over `AdminThemeBridge::extensionStyles()`') !== false
	&& strpos($sec12, "foreach(\$adminTheme->extensionStyles() as \$style) {\n\techo \"\\n\\t<link type='text/css' href='\" . \$sanitizer->entities(\$style['url']) . \"' rel='stylesheet' data-bridge-styles='\" .\n\t\t\$sanitizer->entities(\$style['extension']) . \"'\" . \$adminTheme->nonceAttr() . \" />\";\n}") !== false);
$sec6 = preg_match('/\n## 6\. Contract tests\n(.*?)\n## 7\. /s', $devDoc, $m6) ? $m6[1] : '';
check('docs/extensions.md 6: each relative or root-relative styles entry a file that exists', strpos($sec6, "each relative or root-relative `styles` entry a file that exists\n  (absolute URLs are noted, not checked)") !== false);
check('docs/extensions.md 2: styles states its own rule (not "resolved as module is"), absolute and root-relative without ?v=, module with ?v= unless a query', strpos($devDoc, 'resolved as `module` is') === false
	&& strpos($devDoc, 'absolute URLs and root-relative paths are printed as given, without `?v=` (unlike `module`)') !== false && strpos($devDoc, 'Every one gets `?v=<module version>` unless it has a query already') !== false
	&& strpos((string) file_get_contents(dirname(__DIR__) . '/tools/extension-check.php'), 'resolved as `module` is') === false);
$contractDoc = (string) @file_get_contents(dirname(__DIR__) . '/docs/contract.md');
$docTokens = array();
if(preg_match('/\n(Components may use the tokens [^\n]*)\n/', $contractDoc, $tokPara)) {
	preg_match_all('/`(--[\w-]+)`/', $tokPara[1], $tokMatch);
	$docTokens = array_values(array_unique($tokMatch[1]));
}
$surfaceTokens = isset($bridge) && $bridge ? $bridge->extensionSurface()['tokens'] : array();
check('docs/contract.md 4.0: every token its paragraph names is on the surface, --secondary-foreground and the four metric tokens among them', count($docTokens) > 40 && count($surfaceTokens) === 76
	&& !array_diff($docTokens, $surfaceTokens) && !array_diff(array('--secondary-foreground', '--pw-font-size', '--pw-line-height', '--pw-field-pad', '--pw-field-pad-bottom'), $docTokens),
	'off the surface: ' . implode(',', array_diff($docTokens, $surfaceTokens)));
check('ADR 0022 exists and the README says extension contract 0.2', is_file(dirname(__DIR__) . '/docs/decisions/0022-styling-extensions-styles-and-tokens.md')
	&& strpos((string) file_get_contents(dirname(__DIR__) . '/README.md'), '(extension contract 0.2, ADR 0021, 0022)') !== false
	&& strpos((string) file_get_contents(dirname(__DIR__) . '/README.md'), 'the extension contract is 0.2.') !== false);
check('README links docs/extensions.md and ADR 0021 exists', strpos((string) file_get_contents(dirname(__DIR__) . '/README.md'), "\n## Extensions\n") !== false
	&& strpos((string) file_get_contents(dirname(__DIR__) . '/README.md'), '[docs/extensions.md](docs/extensions.md)') !== false
	&& is_file(dirname(__DIR__) . '/docs/decisions/0021-extensions-are-modules-on-a-published-surface.md'));
// 0.27.1: content of draggable rows centred vertically (template field list, repeater item header)
if(isset($bridge) && $bridge) {
	$themeCss = (string) @file_get_contents($themeDir . 'assets/dist/theme.css');
	$fieldsCss = (string) @file_get_contents($themeDir . 'assets/dist/fields.css');
	check('draggable rows: repeater item controls and asmSelect description centred on the row', strpos($themeCss, '.InputfieldRepeaterHeaderInit:not(.InputfieldRepeaterItemOOB)>.InputfieldRepeaterItemControls{display:flex;flex-direction:row-reverse;align-items:center;top:0;bottom:0;height:auto;margin-top:0}') !== false
		&& strpos($themeCss, '.InputfieldRepeaterItemControls>i.toggle-icon{margin-top:0}') !== false
		&& strpos($fieldsCss, '.asmList .asmListItem span.asmListItemDesc{top:50%;transform:translateY(-50%);line-height:1}') !== false);
}

// access-control fixtures: installed by the sandbox builder, the baseline before any rule
$aclAdminSrc = (string) @file_get_contents(dirname(__DIR__) . '/tools/sandbox-admin.php');
check('ACL fixtures: tools/sandbox-admin.php makes the roles and the users', strpos($aclAdminSrc, "'acl-editor'") !== false && strpos($aclAdminSrc, "'acl-restricted'") !== false
	&& strpos($aclAdminSrc, "'acl'") !== false && strpos($aclAdminSrc, "'acl2'") !== false);
check('ACL fixtures: tools/sandbox-fixture.php makes bridge-custom-menu', strpos((string) @file_get_contents(dirname(__DIR__) . '/tools/sandbox-fixture.php'), 'bridge-custom-menu') !== false);
$aclCredentials = (string) @file_get_contents("$root/.credentials");
check('ACL fixtures: .credentials has the acl and acl2 lines', (bool) preg_match('/^acl:.+$/m', $aclCredentials) && (bool) preg_match('/^acl2:.+$/m', $aclCredentials));
$aclUser = $users->get('name=acl');
$aclUser2 = $users->get('name=acl2');
$aclRoleNames = function(Page $u) {
	$names = array_values(array_diff($u->roles->explode('name'), array('guest'))); // every user has guest
	sort($names);
	return implode(' ', $names);
};
check('ACL fixtures: acl has exactly acl-editor, on AdminThemeBridge', $aclUser->id && $aclRoleNames($aclUser) === 'acl-editor' && $aclUser->admin_theme === 'AdminThemeBridge', $aclRoleNames($aclUser));
check('ACL fixtures: acl2 has exactly acl-editor + acl-restricted, on AdminThemeUikit', $aclUser2->id && $aclRoleNames($aclUser2) === 'acl-editor acl-restricted' && $aclUser2->admin_theme === 'AdminThemeUikit', $aclRoleNames($aclUser2));
$aclTree = $pages->get('/bridge-tree/');
$aclAdminRoot = $pages->get($config->adminRootPageID);
$aclCustom = $aclAdminRoot->child('name=bridge-custom-menu, include=all');
check('ACL fixtures: the tree page and the custom menu item exist', $aclTree->id && $aclCustom->id && $aclCustom->template->name === 'admin' && (string) $aclCustom->process === 'ProcessBridgeDemo');
if($aclUser->id && $aclTree->id && $aclCustom->id) {
	$aclCurrent = $wire->user;
	$wire->users->setCurrentUser($aclUser);
	$aclModule = $aclAdminRoot->child('name=module, include=all');
	check('ACL baseline as acl: the tree page is editable and addable', $aclTree->editable() && $aclTree->addable());
	check('ACL baseline as acl: Modules is not viewable, the custom menu item is', $aclModule->id && !$aclModule->viewable() && $aclCustom->viewable());
	$wire->users->setCurrentUser($aclCurrent);
}
$aclIdsOut = array();
exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(dirname(__DIR__) . '/tools/lib/sandbox-ids.php') . ' ' . escapeshellarg($root), $aclIdsOut);
check('ACL fixtures: tools/lib/sandbox-ids.php prints CUSTOM_MENU_ID', $aclCustom->id && in_array("CUSTOM_MENU_ID={$aclCustom->id}", $aclIdsOut, true), implode(' ', $aclIdsOut));

// screens-check opens Add Page with the template given, so no quick add creates a page (sprint fix-leftovers, step 2)
$addParent = $pages->get('path=/bridge-native-parent/, include=all');
$addChild = $addParent->id ? $addParent->child('include=all') : null;
check('tools/lib/sandbox-ids.php prints ADD_TEMPLATE_ID, the template of the first child of /bridge-native-parent/',
	$addChild && $addChild->id && in_array("ADD_TEMPLATE_ID={$addChild->template->id}", $aclIdsOut, true)
	&& strpos((string) file_get_contents(dirname(__DIR__) . '/tools/lib/sandbox-ids.php'), 'ADD_TEMPLATE_ID') !== false, implode(' ', $aclIdsOut));
$addScreens = (string) file_get_contents(dirname(__DIR__) . '/tools/screens-check.js');
check('tools/screens-check.js opens Add Page with &template_id= only, and names a missing ADD_TEMPLATE_ID',
	strpos($addScreens, "'&template_id=' + ADD_TEMPLATE") !== false && strpos($addScreens, 'A the add form opened (no page was created)') !== false
	&& preg_match_all('/page\/add/', $addScreens) === preg_match_all('/page\/add[^\n]*template_id/', $addScreens)
	&& strpos($addScreens, 'needs ADD_TEMPLATE_ID') !== false);
// screens-check F measures the theme's own bar without the access-control fixture's top item (step 2b)
check('tools/screens-check.js section F removes the bridge-custom-menu top item before measuring the bar',
	preg_match('/const fits = await wide\.evaluate\(async \(\) => \{[^}]*data-bridge-extension.*?bridge-custom-menu.*?pw-nav-overflow/s', $addScreens) === 1);
check('tools/ci.sh exports ADD_TEMPLATE_ID with the other fixture ids', preg_match('/^\s*export NATIVE_ID=[^\n]*ADD_TEMPLATE_ID="\$\{ADD_TEMPLATE_ID:-\}"/m', (string) file_get_contents(dirname(__DIR__) . '/tools/ci.sh')) === 1);

// BridgeAdminAccessControl: the rules engine and the theme's navCacheKey (sprint bridge-admin-access-control, step 1)
$aclName = 'BridgeAdminAccessControl';
check('ACL the module is installed in this sandbox', $modules->isInstalled($aclName));
$aclModuleSrc = (string) @file_get_contents(dirname(__DIR__) . "/modules/$aclName/$aclName.module.php");
check('ACL the manifest is the bridge info key, hooks navCacheKey and drawerNames, no dependency on the theme', strpos($aclModuleSrc, "'hooks' => array('navCacheKey', 'drawerNames')") !== false
	&& strpos($aclModuleSrc, "'contract' => '^0.1'") !== false && strpos($aclModuleSrc, "'requires' => 'ProcessWire>=3.0.227, PHP>=8.1'") !== false
	&& strpos($aclModuleSrc, 'getBridgeExtension') === false && strpos($aclModuleSrc, "'autoload' => 'template=admin'") !== false);
$aclEditor = $wire->roles->get('acl-editor');
$aclRestricted = $wire->roles->get('acl-restricted');
$aclNative = $pages->get('/bridge-native/');
if($modules->isInstalled($aclName) && $aclUser->id && $aclUser2->id && $aclTree->id && $aclNative->id && $aclEditor->id && $aclRestricted->id && $aclCustom->id) {
	$acl = $modules->get($aclName);
	$aclSaved = $modules->getConfig($aclName);
	$aclVersion = (int) $acl->get('rulesVersion');
	$aclSuper = $users->get('name=bridge');
	$aclChildren = $aclTree->children('limit=2, include=all');
	$aclX = $aclChildren->first();
	$aclSibling = $aclChildren->last();
	$aclHome = $pages->get(1);
	$aclRoot = $pages->get((int) $config->adminRootPageID);
	$aclModules = $pages->get(21);
	$aclRule = function($role, $page, $mode, $inherit = true) { return array('role' => $role->id, 'page' => $page->id, 'mode' => $mode, 'inherit' => $inherit); };
	$aclSet = function(array $list) use($acl, $wire) {
		$rules = $wire->wire(new BridgeAccessRules())->fromConfig(array());
		foreach($list as $rule) $rules->add($rule);
		$acl->saveRules($rules);
	};
	$aclRefused = function(array $rule) use($wire) {
		try {
			$wire->wire(new BridgeAccessRules())->fromConfig(array())->add($rule);
		} catch(WireException $e) {
			return true;
		}
		return false;
	};
	$ALLOW = BridgeAdminAccessControl::ALLOW;
	$DENY = BridgeAdminAccessControl::DENY;
	$PASS = BridgeAdminAccessControl::DENY_PASS;
	try {
		$aclSet(array());
		check('ACL engine: without rules, allow for home, the tree page and the admin root', $acl->verdict($aclHome, $aclUser) === $ALLOW && $acl->verdict($aclTree, $aclUser) === $ALLOW && $acl->verdict($aclRoot, $aclUser) === $ALLOW);

		$aclVersionBefore = (int) $acl->get('rulesVersion');
		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny')));
		check('ACL engine: every change bumps rulesVersion, written to the config', (int) $acl->get('rulesVersion') === $aclVersionBefore + 1 && (int) $modules->getConfig($aclName, 'rulesVersion') === $aclVersionBefore + 1);
		check('ACL engine: deny + inherit denies the page and its child, not another page', $acl->verdict($aclTree, $aclUser) === $DENY && $acl->verdict($aclX, $aclUser) === $DENY && $acl->verdict($aclNative, $aclUser) === $ALLOW);
		check('ACL engine: roleVerdict() is the role\'s, deniedRoots() names the page with inherit', $acl->roleVerdict($aclX, $aclEditor) === $DENY && $acl->roleVerdict($aclX, $aclRestricted) === $ALLOW && $acl->deniedRoots($aclUser) === array($aclTree->id => true));

		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny'), $aclRule($aclEditor, $aclX, 'allow')));
		check('ACL engine: an allow below a deny: pass-through above, allow on it, deny on its sibling', $acl->verdict($aclTree, $aclUser) === $PASS && $acl->verdict($aclX, $aclUser) === $ALLOW && $acl->verdict($aclSibling, $aclUser) === $DENY);

		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny', false)));
		check('ACL engine: a deny without inherit leaves the child allowed', $acl->verdict($aclTree, $aclUser) === $DENY && $acl->verdict($aclX, $aclUser) === $ALLOW && $acl->deniedRoots($aclUser) === array($aclTree->id => false));

		$aclSet(array($aclRule($aclRestricted, $aclNative, 'deny')));
		check('ACL engine, two roles: a deny of one role denies acl2, not acl', $acl->verdict($aclNative, $aclUser2) === $DENY && $acl->verdict($aclNative, $aclUser) === $ALLOW);
		$aclSet(array($aclRule($aclRestricted, $aclNative, 'deny'), $aclRule($aclEditor, $aclNative, 'allow')));
		check('ACL engine, two roles: another role\'s allow does not lift the deny', $acl->verdict($aclNative, $aclUser2) === $DENY && $acl->verdict($aclNative, $aclUser) === $ALLOW);
		$aclSet(array($aclRule($aclRestricted, $aclTree, 'deny'), $aclRule($aclEditor, $aclX, 'allow')));
		check('ACL engine, two roles: an allow another role denies makes no pass-through', $acl->verdict($aclTree, $aclUser2) === $DENY && $acl->verdict($aclX, $aclUser2) === $DENY);

		$aclSet(array($aclRule($aclEditor, $aclHome, 'deny'), $aclRule($aclEditor, $aclNative, 'allow')));
		check('ACL engine: a deny on home with an allow below: content follows, the admin does not', $acl->verdict($aclHome, $aclUser) === $PASS && $acl->verdict($aclNative, $aclUser) === $ALLOW && $acl->verdict($aclTree, $aclUser) === $DENY
			&& $acl->verdict($aclRoot, $aclUser) === $ALLOW && $acl->verdict($aclModules, $aclUser) === $ALLOW && !$acl->menuDenied($aclModules, $aclUser));

		foreach(array('superuser', 'guest') as $aclRoleName) {
			check("ACL rules: a rule for $aclRoleName is refused", $aclRefused($aclRule($wire->roles->get($aclRoleName), $aclTree, 'deny')));
		}
		$aclTemplates = $pages->get('parent=22, name=template, include=all');
		foreach(array(2 => 'the admin root', 7 => 'the trash', 23 => 'Login', 304 => 'Profile') as $aclId => $aclLabel) {
			check("ACL rules: a rule on $aclLabel is refused", $aclRefused(array('role' => $aclEditor->id, 'page' => $aclId, 'mode' => 'deny', 'inherit' => true)));
		}
		check('ACL rules: a rule on a child of Setup is refused', $aclTemplates->id && $aclRefused($aclRule($aclEditor, $aclTemplates, 'deny')), (string) $aclTemplates->id);
		check('ACL rules: a rule on a custom top-level item is refused', $aclRefused($aclRule($aclEditor, $aclCustom, 'deny')));
		check('ACL rules: an unknown mode and a missing page are refused', $aclRefused($aclRule($aclEditor, $aclTree, 'maybe')) && $aclRefused(array('role' => $aclEditor->id, 'page' => 99999999, 'mode' => 'deny')));
		$aclIds = array_keys($acl->coreMenus());
		check('ACL rules: coreMenus() is exactly the four, not the custom items', $aclIds === array(3, 22, 21, 28) && !in_array(1139, $aclIds, true) && !in_array($aclCustom->id, $aclIds, true), implode(',', $aclIds));
		$aclList = $wire->wire(new BridgeAccessRules())->fromConfig(array());
		$aclStored = $aclList->add(array('role' => $aclEditor->id, 'page' => 21, 'mode' => 'allow', 'inherit' => false));
		check('ACL rules: a rule on Modules comes back as deny + inherit', $aclStored['mode'] === 'deny' && $aclStored['inherit'] === true);
		$aclList->add($aclRule($aclEditor, $aclTree, 'deny'));
		$aclList->add($aclRule($aclEditor, $aclTree, 'allow', false));
		$aclRows = $aclList->rules();
		check('ACL rules: one rule per role and page, the newer replaces', count($aclRows) === 2 && $aclRows[1]['mode'] === 'allow' && $aclRows[1]['inherit'] === false);
		check('ACL rules: remove() takes the index', $aclList->remove(0) && !$aclList->remove(5) && count($aclList->rules()) === 1);
		$aclStale = $wire->wire(new BridgeAccessRules())->fromConfig(array('rules' => array(
			array('role' => 99999999, 'page' => $aclTree->id, 'mode' => 'deny', 'inherit' => true),
			array('role' => $aclEditor->id, 'page' => $aclTree->id, 'mode' => 'deny', 'inherit' => true),
			'not a rule',
		)));
		check('ACL rules: a role that no longer exists is ignored by forRoles() and pruned by toConfig()', count($aclStale->forRoles(array(99999999, $aclEditor->id))) === 1 && count($aclStale->toConfig()['rules']) === 1);

		$aclSet(array($aclRule($aclEditor, $aclModules, 'deny')));
		check('ACL engine: menuDenied() on the item with a deny, not for a user without it or another item', $acl->menuDenied($aclModules, $aclUser) && !$acl->menuDenied($pages->get(3), $aclUser) && !$acl->menuDenied($aclCustom, $aclUser) && !$acl->menuDenied($aclModules, $aclSuper));
		$aclSuper->roles->add($aclEditor);
		$acl->set('rules', $acl->get('rules'));
		check('ACL engine: rulesFor() a superuser is empty, whatever role they hold', $acl->rulesFor($aclSuper) === array() && count($acl->rulesFor($aclUser)) === 1);
		$aclSuper->roles->remove($aclEditor);

		$aclProbe = new Page();
		$aclProbe->template = $aclX->template;
		$aclProbe->parent = $aclTree;
		$aclProbe->name = 'acl-prune-probe';
		$aclProbe->save();
		$aclSet(array($aclRule($aclEditor, $aclProbe, 'deny'), $aclRule($aclEditor, $aclTree, 'deny')));
		$aclVersionBefore = (int) $acl->get('rulesVersion');
		$pages->delete($aclProbe);
		$aclRows = $modules->getConfig($aclName, 'rules');
		check('ACL engine: a deleted page\'s rules are pruned, the stamp bumped', is_array($aclRows) && count($aclRows) === 1 && (int) $aclRows[0]['page'] === $aclTree->id && (int) $acl->get('rulesVersion') === $aclVersionBefore + 1);
		check('ACL bridgeThemePresent(): the theme of this checkout is new enough', $acl->bridgeThemePresent());
	} finally {
		$modules->saveConfig($aclName, $aclSaved);
		$acl->set('rules', isset($aclSaved['rules']) ? $aclSaved['rules'] : array());
		$acl->set('rulesVersion', $aclVersion);
	}
	check('ACL the config is left as found', $modules->getConfig($aclName) === $aclSaved);
}
if(isset($bridge) && $bridge) {
	$aclSurface = $bridge->extensionSurface();
	check('navCacheKey is on the surface and declared by the class', in_array('navCacheKey', $aclSurface['hooks'], true) && method_exists($bridge, '___navCacheKey') && $bridge->navCacheKey() === 'prnav');
	$aclJson = json_decode((string) @file_get_contents($themeDir . 'assets/dist/extension-surface.json'), true);
	check('navCacheKey is in assets/dist/extension-surface.json', is_array($aclJson) && in_array('navCacheKey', $aclJson['hooks'], true));
	check('the extension contract is extensionContract', $aclSurface['contract'] === AdminThemeBridge::extensionContract);
	$aclShell = (string) file_get_contents($themeDir . 'lib/AdminThemeBridgeShell.php');
	check('renderPrimaryNav() keeps the nav under navCacheKey()', strpos($aclShell, '$key = (string) $this->navCacheKey();') !== false && strpos($aclShell, '$session->getFor($this, $key)') !== false && strpos($aclShell, '$session->setFor($this, $key, $out)') !== false
		&& strpos($aclShell, '$session->setFor($this, \'prnavKey\', $key)') !== false && strpos($aclShell, 'removeFor($this, (string) $this->navCacheKey())') !== false);
	check('the theme version is 0.30.0', $themeVersion === '0.30.0', $themeVersion);
	$aclSession = $wire->session;
	// a fixed nav: the key is what is tested, and $aclBuilt counts the misses
	$aclBuilt = 0;
	$aclNav = $bridge->addHookBefore('getPrimaryNavArray', function(HookEvent $e) use(&$aclBuilt) {
		$aclBuilt++;
		$e->replace = true;
		$e->return = array(array('id' => 3, 'parent_id' => 2, 'url' => '/probe/', 'name' => 'page', 'title' => 'Probe', 'children' => array()));
	});
	$aclSession->removeFor($bridge, 'prnav');
	$aclSession->removeFor($bridge, 'prnavKey');
	$bridge->renderPrimaryNav();
	$aclPlain = (string) $aclSession->getFor($bridge, 'prnav');
	$aclHook = $bridge->addHookAfter('navCacheKey', function(HookEvent $e) { $e->return .= '-probe'; });
	$bridge->renderPrimaryNav();
	check('a hook on navCacheKey is a cache miss: the nav moves to the new key, the old one is dropped', $aclPlain !== '' && $aclBuilt === 2 && (string) $aclSession->getFor($bridge, 'prnav-probe') !== '' && $aclSession->getFor($bridge, 'prnav') === null && $aclSession->getFor($bridge, 'prnavKey') === 'prnav-probe');
	$bridge->removeHook($aclHook);
	$bridge->renderPrimaryNav();
	check('back to the plain key: the stamped one is dropped', (string) $aclSession->getFor($bridge, 'prnav') !== '' && $aclSession->getFor($bridge, 'prnav-probe') === null);
	$aclSession->removeFor($bridge, 'prnav');
	$aclSession->removeFor($bridge, 'prnavKey');
	$bridge->removeHook($aclNav);
}
$aclDoc = (string) @file_get_contents(dirname(__DIR__) . '/docs/access-control.md');
check('docs/access-control.md has Model, Storage, Covered, Not covered', (bool) preg_match('/^## Model$/m', $aclDoc) && (bool) preg_match('/^## Storage$/m', $aclDoc) && (bool) preg_match('/^## Covered$/m', $aclDoc) && (bool) preg_match('/^## Not covered$/m', $aclDoc));

// BridgeAdminAccessControl: page predicates, the menu gate, the nav array (sprint bridge-admin-access-control, step 2)
check('ACL enforcement: every Page:: hook is added after, with priority 200', substr_count($aclModuleSrc, 'addHookAfter("Page::$method", $this, $handler, array(\'priority\' => 200))') === 1
	&& preg_match_all('/addHook\w*\(["\']Page::/', $aclModuleSrc) === 1);
check('ACL enforcement: the gate is a before-hook on ProcessController::execute', strpos($aclModuleSrc, "addHookBefore('ProcessController::execute', \$this, 'hookControllerExecute')") !== false);
check('ACL enforcement: the hooks on the nav array, navCacheKey and ProcessHome are there', strpos($aclModuleSrc, "addHookAfter('AdminThemeFramework::getPrimaryNavArray'") !== false
	&& strpos($aclModuleSrc, "addHookAfter('AdminThemeBridge::navCacheKey'") !== false && strpos($aclModuleSrc, "addHookBefore('ProcessHome::execute'") !== false);
$aclBranch = preg_match('/if\(\$this->bridgeThemePresent\(\)\) \{(.*?)\n\t\t\}/s', $aclModuleSrc, $aclMatch) ? $aclMatch[1] : '';
check('ACL enforcement: navCacheKey and drawerNames are hooked inside the bridgeThemePresent() branch, nothing else is', substr_count($aclBranch, 'addHook') === 2 && strpos($aclBranch, "addHookAfter('AdminThemeBridge::navCacheKey'") !== false && strpos($aclBranch, "addHookAfter('AdminThemeBridge::drawerNames'") !== false
	&& substr_count($aclModuleSrc, "'AdminThemeBridge::") === 2 && substr_count($aclModuleSrc, 'bridgeThemePresent()) {') === 1);
if($modules->isInstalled($aclName) && isset($acl, $aclEditor, $aclRestricted, $aclSuper, $aclRule, $aclSet, $aclX, $bridge) && $bridge) {
	$aclPredicates = array('listable', 'viewable', 'editable', 'publishable', 'addable', 'moveable', 'deleteable', 'deletable', 'trashable', 'restorable', 'sortable', 'cloneable');
	$aclHooksOn = function($method) use($wire, $acl, $aclTree) {
		return array_values(array_filter($wire->hooks->getHooks($aclTree, $method), function($h) use($acl) { return $h['toObject'] === $acl; }));
	};
	$aclGuestHooks = 0;
	foreach($aclPredicates as $aclMethod) $aclGuestHooks += count($aclHooksOn($aclMethod));
	check('ACL enforcement: a user without rules gets no hook at all', $aclGuestHooks === 0, (string) $aclGuestHooks);
	$acl->addEnforcementHooks();
	$acl->addEnforcementHooks();
	$aclPriorities = true;
	foreach($aclPredicates as $aclMethod) {
		$aclFound = $aclHooksOn($aclMethod);
		if(count($aclFound) !== 1 || (int) $aclFound[0]['options']['priority'] !== 200 || empty($aclFound[0]['options']['after'])) $aclPriorities = false;
	}
	check('ACL enforcement: the twelve predicates have one after-hook each, priority 200', $aclPriorities);

	// a default language not named `default` reports isDefault() only on the object $languages holds;
	// a reloaded copy on the user breaks the finds the nav runs (docs/upstream/language-isdefault.md)
	$aclLanguages = $wire->languages;
	$aclLanguageWas = array();
	$aclBecome = function(User $u) use($wire, $aclLanguages, &$aclLanguageWas) {
		if($aclLanguages) {
			$aclDefault = $aclLanguages->getDefault();
			if(!isset($aclLanguageWas[$u->id])) $aclLanguageWas[$u->id] = $u->language;
			if($u->language && (int) $u->language->id === (int) $aclDefault->id) $u->setLanguage($aclDefault);
		}
		$wire->users->setCurrentUser($u);
	};
	$aclPredicateValues = function(Page $p) use($aclPredicates) {
		$out = array();
		foreach($aclPredicates as $m) $out[$m] = (bool) $p->$m();
		return $out;
	};
	$aclNavIds = function() use($bridge) { return array_map('intval', array_column($bridge->getPrimaryNavArray(), 'id')); };
	$aclHas = function(array $ids, array $wanted) { return !array_diff($wanted, $ids); };
	$aclHasNone = function(array $ids, array $unwanted) { return !array_intersect($unwanted, $ids); };
	$aclFirst = $aclTree->children('limit=1, include=all')->first();
	$aclRootPage = $pages->get((int) $config->adminRootPageID);
	$aclTemplatesPage = $pages->get('parent=22, name=template, include=all');
	$aclMenuRules = function($role) use($pages, $aclRule) {
		$out = array();
		foreach(array(3, 22, 21, 28) as $id) $out[] = $aclRule($role, $pages->get($id), 'deny');
		return $out;
	};
	$aclAsWas = $wire->user;
	$aclSavedStep2 = $modules->getConfig($aclName);
	$aclVersionStep2 = (int) $acl->get('rulesVersion');
	$aclLoggedIn = new \ReflectionProperty($bridge, 'isLoggedIn');
	$aclLoggedInWas = $aclLoggedIn->getValue($bridge);
	$aclDrawerSettings = array($bridge->pageTreeDrawer, $bridge->history);
	try {
		// the values with no rule, as acl and as the superuser, hooks in place
		$aclSet(array());
		$aclBecome($aclSuper);
		$aclSuperTree = $aclPredicateValues($aclTree);
		$aclSuperNav = $aclNavIds();
		$aclSuperKey = $bridge->navCacheKey();
		$aclBecome($aclUser);
		$aclNativeBefore = $aclPredicateValues($aclNative);
		$aclTreeBefore = $aclPredicateValues($aclTree);
		$aclModulesViewable = $pages->get(21)->viewable();
		$aclRootViewable = $aclRootPage->viewable();
		$aclNavBefore = $aclNavIds();
		// Access is not there: acl-editor has none of the permissions of its children
		check('ACL enforcement: no rules, acl: the nav has the custom item and the core menus it may see', $aclHas($aclNavBefore, array(3, 22, (int) $aclCustom->id)) && !in_array(21, $aclNavBefore, true), implode(',', $aclNavBefore));
		check('ACL enforcement: no rules, acl: navCacheKey() is the plain key', $bridge->navCacheKey() === 'prnav', (string) $bridge->navCacheKey());

		// all four core menus denied
		$aclSet($aclMenuRules($aclEditor));
		$aclNav = $aclNavIds();
		check('ACL menus: all four denied: the nav has the custom item, none of the four', in_array((int) $aclCustom->id, $aclNav, true) && $aclHasNone($aclNav, array(3, 22, 21, 28)), implode(',', $aclNav));
		check('ACL menus: the gate leaves the custom item alone, refuses a page under Setup', !$acl->menuGateDenies($aclCustom, $aclUser) && $aclTemplatesPage->id && $acl->menuGateDenies($aclTemplatesPage, $aclUser), (string) $aclTemplatesPage->id);
		check('ACL menus: the gate leaves the admin root, Login and Profile alone', !$acl->menuGateDenies($aclRootPage, $aclUser) && !$acl->menuGateDenies($pages->get(23), $aclUser) && !$acl->menuGateDenies($pages->get(304), $aclUser));

		// a subtree denied
		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny')));
		$aclDeniedOk = function(Page $p) use($aclPredicateValues) {
			$v = $aclPredicateValues($p);
			return !$v['listable'] && !$v['viewable'] && !$v['editable'] && !$v['addable'] && !$v['moveable'] && !$v['trashable'];
		};
		check('ACL pages: a denied subtree: the tree page and its first child are closed', $aclDeniedOk($aclTree) && $aclDeniedOk($aclFirst));
		check('ACL pages: another page is as it was', $aclPredicateValues($aclNative) === $aclNativeBefore);
		check('ACL pages: the deny is the only change, the baseline allowed these', $aclTreeBefore['listable'] && $aclTreeBefore['editable'] && $aclTreeBefore['addable']);
		$aclBecome($aclUser2);
		check('ACL pages, AdminThemeUikit user: the same verdicts as for acl', $aclUser2->admin_theme === 'AdminThemeUikit' && $acl->verdict($aclTree, $aclUser2) === $acl->verdict($aclTree, $aclUser) && $acl->verdict($aclFirst, $aclUser2) === $acl->verdict($aclFirst, $aclUser)
			&& $acl->verdict($aclNative, $aclUser2) === $acl->verdict($aclNative, $aclUser) && $aclDeniedOk($aclTree));
		$aclBecome($aclUser);

		// an allow below the deny: pass-through
		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny'), $aclRule($aclEditor, $aclFirst, 'allow')));
		$aclPass = $aclPredicateValues($aclTree);
		check('ACL pages: pass-through: listable and viewable as without the rule, nothing else', $aclPass['listable'] && $aclPass['viewable'] === $aclTreeBefore['viewable'] && !$aclPass['editable'] && !$aclPass['addable'] && !$aclPass['moveable'] && !$aclPass['trashable']);
		check('ACL pages: the allowed child can be edited', $aclFirst->listable() && $aclFirst->editable());

		// Modules denied
		$aclSet(array($aclRule($aclEditor, $aclModules, 'deny')));
		check('ACL menus: Modules denied: menuDenied() and the gate', $acl->menuDenied($aclModules, $aclUser) && $acl->menuGateDenies($aclModules, $aclUser));
		$aclNav = $aclNavIds();
		check('ACL menus: Modules denied: no Modules in the nav, every other item as without the rule', !in_array(21, $aclNav, true) && $aclNav === $aclNavBefore && $aclHas($aclNav, array(3, 22)), implode(',', $aclNav));
		check('ACL menus: viewable() of admin pages is untouched', $pages->get(21)->viewable() === $aclModulesViewable && $aclRootPage->viewable() === $aclRootViewable);
		$aclStamp = (int) $acl->get('rulesVersion');
		check('ACL menus: navCacheKey() as acl with rules has the stamp and the user', $bridge->navCacheKey() === "prnav-acl$aclStamp-{$aclUser->id}", (string) $bridge->navCacheKey());

		// a menu acl does have, so the filter is seen to drop something
		$aclSet(array($aclRule($aclEditor, $pages->get(22), 'deny')));
		$aclNav = $aclNavIds();
		check('ACL menus: Setup denied: dropped from the nav, every other item as it was', $aclNav === array_values(array_diff($aclNavBefore, array(22))), implode(',', $aclNav));

		// the tree drawer's button: gone with the Pages menu, the other drawers stay
		$aclLoggedIn->setValue($bridge, true);
		$bridge->set('pageTreeDrawer', 1);
		$bridge->set('history', 1);
		$aclSet(array());
		$aclDrawersBefore = $bridge->drawerNames();
		check('ACL drawers: no rules, acl: the tree button and the history one', in_array('tree', $aclDrawersBefore, true) && in_array('history', $aclDrawersBefore, true)
			&& strpos($bridge->renderDrawerButtons(), "data-pw-drawer='tree'") !== false, implode(',', $aclDrawersBefore));
		$aclSet(array($aclRule($aclEditor, $pages->get(22), 'deny')));
		check('ACL drawers: another menu denied: the same drawers', $bridge->drawerNames() === $aclDrawersBefore, implode(',', $bridge->drawerNames()));
		$aclSet(array($aclRule($aclEditor, $pages->get(3), 'deny')));
		$aclDrawersDenied = $bridge->drawerNames();
		check('ACL drawers: Pages denied: no tree button or dialog, every other drawer stays', $aclDrawersDenied === array_values(array_diff($aclDrawersBefore, array('tree')))
			&& strpos($bridge->renderDrawerButtons(), "data-pw-drawer='tree'") === false && strpos($bridge->renderDrawerButtons(), "data-pw-drawer='history'") !== false
			&& strpos($bridge->renderDrawers(), "id='pw-drawer-tree'") === false && strpos($bridge->renderDrawers(), "id='pw-drawer-history'") !== false, implode(',', $aclDrawersDenied));
		$aclBecome($aclSuper);
		check('ACL drawers: Pages denied to a role: the superuser keeps the tree button', in_array('tree', $bridge->drawerNames(), true), implode(',', $bridge->drawerNames()));
		$aclBecome($aclUser);
		$aclSet(array($aclRule($aclRestricted, $pages->get(3), 'deny')));
		check('ACL drawers, two roles: acl, without the denying role, keeps the tree button', in_array('tree', $bridge->drawerNames(), true), implode(',', $bridge->drawerNames()));
		$aclBecome($aclUser2);
		check('ACL drawers, two roles: a deny held by one role drops the tree button', !in_array('tree', $bridge->drawerNames(), true) && in_array('history', $bridge->drawerNames(), true), implode(',', $bridge->drawerNames()));
		$aclBecome($aclUser);

		// the deny of one role, on a user with two
		$aclSet(array($aclRule($aclRestricted, $aclModules, 'deny')));
		$aclBecome($aclUser2);
		$aclNav = $aclNavIds();
		check('ACL menus, two roles: a deny held by one role counts', $acl->menuDenied($aclModules, $aclUser2) && !in_array(21, $aclNav, true) && $aclHas($aclNav, array(3, 22)), implode(',', $aclNav));
		$aclBecome($aclUser);
		check('ACL menus, two roles: acl, without that role, is not denied, and has no stamp', !$acl->menuDenied($aclModules, $aclUser) && $bridge->navCacheKey() === 'prnav', (string) $bridge->navCacheKey());

		// the superuser, with every kind of rule on the role they would hold
		$aclSet(array_merge($aclMenuRules($aclEditor), array($aclRule($aclEditor, $aclTree, 'deny'))));
		$aclBecome($aclSuper);
		check('ACL exempt: for the superuser every value is the no-rule value', $aclPredicateValues($aclTree) === $aclSuperTree && $aclNavIds() === $aclSuperNav && $bridge->navCacheKey() === $aclSuperKey && $aclSuperKey === 'prnav'
			&& !$acl->menuGateDenies($aclTemplatesPage, $aclSuper));
	} finally {
		$aclLoggedIn->setValue($bridge, $aclLoggedInWas);
		$bridge->set('pageTreeDrawer', $aclDrawerSettings[0]);
		$bridge->set('history', $aclDrawerSettings[1]);
		$wire->users->setCurrentUser($aclAsWas);
		foreach(array($aclUser, $aclUser2, $aclSuper) as $aclU) {
			if(isset($aclLanguageWas[$aclU->id])) $aclU->setLanguage($aclLanguageWas[$aclU->id]);
		}
		$modules->saveConfig($aclName, $aclSavedStep2);
		$acl->set('rules', isset($aclSavedStep2['rules']) ? $aclSavedStep2['rules'] : array());
		$acl->set('rulesVersion', $aclVersionStep2);
	}
	check('ACL enforcement: the config is left as found', $modules->getConfig($aclName) === $aclSavedStep2);
}

// BridgeAdminAccessControl: find-based screens and the guard on saves (sprint bridge-admin-access-control, step 3)
check('ACL finds: after-hooks on ProcessPageSearch::findReady and ProcessPageLister::getSelector, InputfieldPage untouched', strpos($aclModuleSrc, "addHookAfter('ProcessPageSearch::findReady', \$this, 'hookFindSelector')") !== false
	&& strpos($aclModuleSrc, "addHookAfter('ProcessPageLister::getSelector', \$this, 'hookFindSelector')") !== false && strpos($aclModuleSrc, 'getSelectablePages') === false);
check('ACL guard: before-hooks on Pages::saveReady, saveFieldReady, trashReady, restoreReady and deleteReady, from one loop', strpos($aclModuleSrc, 'addHookBefore("Pages::$method", $this, \'hookPageGuard\')') !== false && strpos($aclModuleSrc, "array('saveReady', 'saveFieldReady', 'trashReady', 'restoreReady', 'deleteReady')") !== false
	&& substr_count($aclModuleSrc, "'hookPageGuard'") === 1);
$aclDocs = (string) @file_get_contents(dirname(__DIR__) . '/docs/access-control.md');
check('ACL docs: a move counts as adding under the new parent', strpos($aclDocs, 'A move counts as adding under the new parent') !== false);
check('ACL docs: saveField() and saveFields() are stopped, a noHooks save is the remaining limit (0.1.1)', strpos($aclDocs, 'does not pass through these hooks') === false
	&& strpos($aclDocs, '`Pages::saveField()` and `Pages::saveFields()` are stopped too') !== false && strpos($aclDocs, '`noHooks`') !== false);
check('ACL docs: the find selectors, the guard, the bookmark limit and the pickers', strpos($aclDocs, 'rR=(id!=R, has_parent!=R), rR=(id=E), rR=(has_parent=E)') !== false && strpos($aclDocs, '`Pages::saveReady`') !== false && strpos($aclDocs, '`Pages::saveFieldReady`') !== false && strpos($aclDocs, '`apiGuard`') !== false
	&& strpos($aclDocs, 'lister bookmark') !== false && strpos($aclDocs, 'getSelectablePages') !== false);
if($modules->isInstalled($aclName) && isset($acl, $aclEditor, $aclRestricted, $aclSuper, $aclRule, $aclSet, $aclX, $aclSibling, $aclBecome)) {
	$aclIds = function($selector) use($pages) { return array_map('intval', $pages->find($selector)->explode('id')); };
	$aclThrows = function(callable $f) {
		try {
			$f();
		} catch(WirePermissionException $e) {
			return true;
		}
		return false;
	};
	$aclAsWas = $wire->user;
	$aclSavedStep3 = $modules->getConfig($aclName);
	$aclVersionStep3 = (int) $acl->get('rulesVersion');
	$aclAdminWas = $config->admin;
	$aclGuardWas = $acl->get('apiGuard');
	$T = (int) $aclTree->id;
	$E = (int) $aclX->id;
	$S = (int) $aclSibling->id;
	$N = (int) $aclNative->id;
	try {
		$aclBecome($aclUser);
		$aclSet(array());
		check('ACL finds: no rules: the clause is empty', $acl->selectorClause($aclUser) === '');
		check('ACL guard: on by default', (int) $aclGuardWas === 1 && strpos($aclModuleSrc, "\$this->set('apiGuard', 1)") !== false);

		// the shapes, as docs/access-control.md gives them
		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny')));
		check('ACL finds: a deny with inherit', $acl->selectorClause($aclUser) === ", id!=$T, has_parent!=$T", $acl->selectorClause($aclUser));
		$aclHomeKids = "parent=1, include=all";
		check('ACL finds: without the clause the tree page is found, with it not', in_array($T, $aclIds($aclHomeKids), true) && !in_array($T, $aclIds($aclHomeKids . $acl->selectorClause($aclUser)), true) && in_array($N, $aclIds($aclHomeKids . $acl->selectorClause($aclUser)), true));
		check('ACL finds: nor its child', !in_array($E, $aclIds("id=$E, include=all" . $acl->selectorClause($aclUser)), true));
		$aclSuperClause = $acl->selectorClause($aclSuper);
		check('ACL finds: the superuser has no clause', $aclSuperClause === '', $aclSuperClause);
		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny', false)));
		check('ACL finds: a deny without inherit', $acl->selectorClause($aclUser) === ", id!=$T", $acl->selectorClause($aclUser));
		check('ACL finds: without inherit the child is found', $aclIds("id=$E|$T, include=all" . $acl->selectorClause($aclUser)) === array($E));

		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny'), $aclRule($aclEditor, $aclX, 'allow')));
		$aclClause = $acl->selectorClause($aclUser);
		check('ACL finds: a deny with an exception', $aclClause === ", r$T=(id!=$T, has_parent!=$T), r$T=(id=$E), r$T=(has_parent=$E)", $aclClause);
		$aclFound = $aclIds("id=$T|$E|$S|$N, include=all" . $aclClause);
		sort($aclFound);
		$aclWanted = array($E, $N);
		sort($aclWanted);
		check('ACL finds: the exception is found, its sibling and the denied page are not, other pages are', $aclFound === $aclWanted, implode(',', $aclFound));
		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny'), $aclRule($aclEditor, $aclX, 'allow', false)));
		$aclClause = $acl->selectorClause($aclUser);
		check('ACL finds: an allow without inherit: no has_parent', $aclClause === ", r$T=(id!=$T, has_parent!=$T), r$T=(id=$E)", $aclClause);

		// the hook's group name: random per request, so a posted filter cannot join the group
		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny'), $aclRule($aclEditor, $aclX, 'allow')));
		$aclPlain = $acl->selectorClause($aclUser);
		$aclReq = $acl->requestClause($aclUser);
		$aclSuffixOk = preg_match("/^, (r{$T}_[0-9a-f]{16})=\(/", $aclReq, $aclReqMatch) === 1;
		$aclGroup = $aclSuffixOk ? $aclReqMatch[1] : '';
		check('ACL finds: the hook names the group rR_<16 hex>', $aclSuffixOk, $aclReq);
		check('ACL finds: apart from that name the clause is the documented one', $aclSuffixOk && str_replace($aclGroup, "r$T", $aclReq) === $aclPlain, $aclReq);
		check('ACL finds: the same name within a request', $acl->requestClause($aclUser) === $aclReq);
		$aclSuffixProp = new \ReflectionProperty($acl, 'groupSuffix');
		$aclSuffixProp->setValue($acl, '');
		check('ACL finds: another request gets another name', $acl->requestClause($aclUser) !== $aclReq);
		check('ACL finds: the hook appends requestClause, not the bare clause', strpos($aclModuleSrc, '$clause = $this->requestClause($this->wire()->user);') !== false);
		$aclForged = "id=$T|$E|$S|$N, include=all, r$T=(id>0)";
		$aclFound = $aclIds($aclForged . $aclPlain);
		check('ACL finds: a forged group joins the bare name (what the suffix is for)', in_array($S, $aclFound, true), implode(',', $aclFound));
		$aclFound = $aclIds($aclForged . $acl->requestClause($aclUser));
		sort($aclFound);
		$aclWanted = array($E, $N);
		sort($aclWanted);
		check('ACL finds: a forged group cannot join the suffixed name', $aclFound === $aclWanted, implode(',', $aclFound));

		// two denied pages must not open each other (groups of different names AND)
		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny'), $aclRule($aclEditor, $aclX, 'allow'), $aclRule($aclEditor, $aclNative, 'deny')));
		$aclClause = $acl->selectorClause($aclUser);
		check('ACL finds: two denied pages: one part each', $aclClause === ", r$T=(id!=$T, has_parent!=$T), r$T=(id=$E), r$T=(has_parent=$E), id!=$N, has_parent!=$N", $aclClause);
		check('ACL finds: two denied pages: only the exception is left', $aclIds("id=$T|$E|$S|$N, include=all" . $aclClause) === array($E));

		// a deny on home
		$aclSet(array($aclRule($aclEditor, $aclHome, 'deny'), $aclRule($aclEditor, $aclNative, 'allow'), $aclRule($aclEditor, $aclTree, 'deny')));
		$aclClause = $acl->selectorClause($aclUser);
		check('ACL finds: a deny on home: the admin root is an exception, then the allow rules', strpos($aclClause, ", r1=(id!=1, has_parent!=1), r1=(id=2), r1=(has_parent=2), r1=(id=$N), r1=(has_parent=$N)") === 0, $aclClause);
		$aclFound = $aclIds("id=1|2|29|41|$T|$E|$N, include=all" . $aclClause);
		sort($aclFound);
		$aclWanted = array(2, 29, 41, $N);
		sort($aclWanted);
		check('ACL finds: a deny on home keeps the admin and the exception, drops the rest', $aclFound === $aclWanted, implode(',', $aclFound));

		// two roles: any deny wins
		$aclSet(array($aclRule($aclRestricted, $aclTree, 'deny'), $aclRule($aclEditor, $aclX, 'allow')));
		$aclBecome($aclUser2);
		check('ACL finds, two roles: an allow held by another role is no exception', $acl->selectorClause($aclUser2) === ", id!=$T, has_parent!=$T", $acl->selectorClause($aclUser2));
		$aclBecome($aclUser);
		check('ACL finds, two roles: acl has no denied page there', $acl->selectorClause($aclUser) === '', $acl->selectorClause($aclUser));
		// the same exception held by both roles, inherit by one only: what is below it stays denied
		$aclSet(array($aclRule($aclRestricted, $aclTree, 'deny'), $aclRule($aclRestricted, $aclX, 'allow', false), $aclRule($aclEditor, $aclTree, 'deny'), $aclRule($aclEditor, $aclX, 'allow')));
		$aclBecome($aclUser2);
		check('ACL finds, two roles: an allow with inherit does not reach below for the role without it', $acl->selectorClause($aclUser2) === ", r$T=(id!=$T, has_parent!=$T), r$T=(id=$E)", $acl->selectorClause($aclUser2));
		$aclBecome($aclUser);

		// the guard
		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny')));
		$aclQuiet = array('quiet' => true, 'noFields' => true);
		$aclSave = function($p) use($pages, $aclQuiet) { $of = $p->of(); $p->of(false); try { $pages->save($p, $aclQuiet); } finally { $p->of($of); } };
		$aclNewUnder = function($parent) use($wire) { $p = $wire->wire(new Page($parent->template)); $p->parent = $parent; $p->name = 'acl-guard-probe'; return $p; };
		$aclTitle = $wire->fields->get('title');
		$aclFieldReady = function($p) use($pages, $aclTitle) { return function() use($pages, $aclTitle, $p) { $pages->saveFieldReady($p, $aclTitle); }; };
		$config->admin = false;
		check('ACL guard: outside an admin request nothing is stopped', !$aclThrows(function() use($pages, $aclTree) { $pages->saveReady($aclTree); }));
		check('ACL guard, saveFieldReady: outside an admin request nothing is stopped (0.1.1)', !$aclThrows($aclFieldReady($aclTree)));
		$config->admin = true;
		check('ACL guard: saving a denied page throws', $aclThrows(function() use($aclSave, $aclTree) { $aclSave($aclTree); }));
		check('ACL guard: saving another page does not', !$aclThrows(function() use($aclSave, $aclNative) { $aclSave($aclNative); }));
		check('ACL guard, saveFieldReady: a denied page throws, an allowed one does not (0.1.1)', $aclThrows($aclFieldReady($aclTree)) && !$aclThrows($aclFieldReady($aclNative)));
		// the public call, not the hook method: nothing reaches the database
		$aclTitleRow = function() use($wire, $T) {
			$q = $wire->database->prepare('SELECT * FROM field_title WHERE pages_id=:id');
			$q->bindValue(':id', $T, \PDO::PARAM_INT);
			$q->execute();
			return json_encode($q->fetchAll(\PDO::FETCH_ASSOC));
		};
		$aclTitleWas = $aclTitleRow();
		$aclTitleOld = $pages->getFresh($T)->getUnformatted('title');
		$aclFieldSaveError = '';
		$aclFieldSaveThrew = $aclThrows(function() use($pages, $T, &$aclFieldSaveError) {
			$p = $pages->getFresh($T);
			$p->of(false);
			$p->set('title', 'acl-guard-probe ' . time());
			try {
				$pages->saveField($p, 'title', array('quiet' => true));
			} catch(WirePermissionException $e) {
				throw $e;
			} catch(\Throwable $e) {
				$aclFieldSaveError = get_class($e) . ': ' . $e->getMessage();
			}
		});
		$aclTitleKept = $aclTitleRow() === $aclTitleWas;
		if(!$aclTitleKept) {
			// a regressed guard let the probe through: put the title back before reporting it
			$p = $pages->getFresh($T);
			$p->of(false);
			$p->set('title', $aclTitleOld);
			$pages->saveField($p, 'title', array('quiet' => true, 'noHooks' => true));
		}
		check('ACL guard: Pages::saveField() on a denied page throws, the stored title is unchanged (0.1.1)', $aclFieldSaveThrew && $aclTitleKept && $aclTitleWas !== '[]', $aclFieldSaveError);
		check('ACL guard: trashing or deleting a denied page throws, nothing is touched', $aclThrows(function() use($pages, $aclX) { $pages->trashReady($aclX); }) && $aclThrows(function() use($pages, $aclX) { $pages->deleteReady($aclX); }) && $pages->get($E)->id === $E && !$pages->get($E)->isTrash());
		check('ACL guard: a page added under a denied parent throws, under another does not', $aclThrows(function() use($pages, $aclNewUnder, $aclTree) { $pages->saveReady($aclNewUnder($aclTree)); }) && !$aclThrows(function() use($pages, $aclNewUnder, $aclNative) { $pages->saveReady($aclNewUnder($aclNative)); }));
		$aclHomeAddable = $aclHome->addable();
		check('ACL guard: the rules decide for an added page, not addable(): a parent the core refuses, no rule on it', !$aclHomeAddable && !$aclThrows(function() use($pages, $aclNewUnder, $aclHome) { $pages->saveReady($aclNewUnder($aclHome)); }));
		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny'), $aclRule($aclEditor, $aclX, 'allow')));
		check('ACL guard: a pass-through page is refused, the allowed child is not', $aclThrows(function() use($pages, $aclTree) { $pages->saveReady($aclTree); }) && !$aclThrows(function() use($pages, $aclX) { $pages->saveReady($aclX); }));

		// a move counts as adding under the new parent (audit 1 A1.1); fresh copies, nothing is saved
		$aclTrash = $pages->get($config->trashPageID);
		$aclFixturePage = $pages->get('/bridge-fixture/');
		$aclMoved = function($id, $to, $from = null) use($pages) {
			$p = $pages->getFresh($id);
			if($from) $p->parentPrevious = $from;
			$p->parent = $to;
			return $p;
		};
		$aclReady = function($p) use($pages) { return function() use($pages, $p) { $pages->saveReady($p); }; };
		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny')));
		$aclCopy = $pages->getFresh($N);
		$aclAsked = array($aclCopy->editable(), $aclCopy->moveable($aclTree), $aclTree->addable());
		check('ACL guard, move: the predicates asked first (the memo is filled)', $aclAsked === array(true, false, false), json_encode($aclAsked));
		$aclCopy->parent = $aclTree;
		check('ACL guard, move: into a denied branch throws, though editable() answered yes before the move', $acl->verdict($aclCopy) === BridgeAdminAccessControl::ALLOW && $aclThrows($aclReady($aclCopy)));
		check('ACL guard, move: the verdict afterwards is the new place\'s', $acl->verdict($aclCopy) === BridgeAdminAccessControl::DENY);
		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny'))); // verdict() just memoised the copy in its new place
		$aclCopy = $aclMoved($N, $aclTree);
		$aclCopy->parent = $aclHome;
		check('ACL guard, move: a parent set and set back is no move', !$aclThrows($aclReady($aclCopy)));
		check('ACL guard, move: to another allowed parent passes', $aclFixturePage->id > 0 && !$aclThrows($aclReady($aclMoved($N, $aclFixturePage))));
		check('ACL guard, move: a denied page does not get out, nor into the trash', $aclThrows($aclReady($aclMoved($E, $aclHome))) && $aclThrows($aclReady($aclMoved($E, $aclTrash))));
		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny'), $aclRule($aclEditor, $aclX, 'allow')));
		check('ACL guard, move: under a pass-through parent throws, under the allowed child not', $aclThrows($aclReady($aclMoved($N, $aclTree))) && !$aclThrows($aclReady($aclMoved($N, $aclX))));
		check('ACL guard, move: the allowed child does not go under its denied sibling', $aclThrows($aclReady($aclMoved($E, $aclSibling))));
		$aclSet(array($aclRule($aclEditor, $aclHome, 'deny'), $aclRule($aclEditor, $aclTree, 'allow')));
		check('ACL guard, move: a deny on home does not stop an allowed page going to the trash', !$aclThrows($aclReady($aclMoved($E, $aclTrash))));
		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny')));
		check('ACL guard, move: back from the trash is judged by the new place', $aclThrows($aclReady($aclMoved($N, $aclTree, $aclTrash))) && !$aclThrows($aclReady($aclMoved($N, $aclHome, $aclTrash))));
		$aclBecome($aclSuper);
		check('ACL guard, move: the superuser is not stopped', !$aclThrows($aclReady($aclMoved($N, $aclTree))));
		$aclBecome($aclUser);

		// a refused way out of the trash leaves the page in it: the core writes the status before
		// save() reaches saveReady (audit 2 A2.1); real pages, deleted in the finally
		$aclProbes = array();
		$aclTrashed = function($name) use($wire, $pages, $aclBecome, $aclSuper, $aclUser, $aclTree, &$aclProbes) {
			$aclBecome($aclSuper);
			$p = $wire->wire(new Page($wire->templates->get('bridge_pt_item')));
			$p->parent = $aclTree;
			$p->name = $name;
			$p->title = $name;
			$pages->save($p);
			$aclProbes[] = (int) $p->id;
			$p = $pages->getFresh($p->id); // a new page's sort is -1, and the trash name of that is not restorable
			$p->of(false);
			$pages->trash($p);
			$aclBecome($aclUser);
			$p = $pages->getFresh($p->id);
			$p->of(false);
			return $p;
		};
		$aclStillTrashed = function($id) use($pages, $config) { $p = $pages->getFresh($id); return $p->hasStatus(Page::statusTrash) && (int) $p->parent_id === (int) $config->trashPageID; };
		try {
			$aclSet(array($aclRule($aclEditor, $aclTree, 'deny')));
			$aclP = $aclTrashed('acl-guard-restore-save');
			$aclP->set('parent_id', $T);
			check('ACL guard, restore: a save into a denied branch throws and the page stays in the trash, flag included', $aclThrows(function() use($pages, $aclP) { $pages->save($aclP); }) && $aclStillTrashed($aclP->id));
			$aclP = $aclTrashed('acl-guard-restore-api');
			check('ACL guard, restore: Pages::restore() to a denied original parent throws and the page stays in the trash, flag included', $aclThrows(function() use($pages, $aclP) { $pages->restore($aclP); }) && $aclStillTrashed($aclP->id));
			$aclSet(array($aclRule($aclEditor, $aclNative, 'deny')));
			$aclP = $aclTrashed('acl-guard-restore-ok');
			$aclRestored = $pages->restore($aclP);
			$aclBack = $pages->getFresh($aclP->id);
			check('ACL guard, restore: to an allowed parent it goes through', $aclRestored === true && !$aclBack->hasStatus(Page::statusTrash) && (int) $aclBack->parent_id === $T);
		} finally {
			$aclBecome($aclSuper);
			foreach($aclProbes as $aclProbeId) {
				$aclProbe = $pages->getFresh($aclProbeId);
				if($aclProbe->id) $pages->delete($aclProbe, true);
			}
			$aclBecome($aclUser);
		}
		check('ACL guard, restore: the probe pages are gone', !$pages->count('name%=acl-guard-restore, include=all'));
		$aclSet(array($aclRule($aclEditor, $aclTree, 'deny'), $aclRule($aclEditor, $aclX, 'allow')));

		$acl->set('apiGuard', 0);
		check('ACL guard, move: with the setting off nothing throws', !$aclThrows($aclReady($aclMoved($N, $aclTree))));
		check('ACL guard: with the setting off nothing throws', !$aclThrows(function() use($aclSave, $aclTree) { $aclSave($aclTree); }) && !$aclThrows(function() use($pages, $aclTree) { $pages->trashReady($aclTree); })
			&& !$aclThrows($aclFieldReady($aclTree)));
		$acl->set('apiGuard', 1);
		$aclBecome($aclSuper);
		check('ACL guard: the superuser is not stopped', !$aclThrows(function() use($aclSave, $aclTree) { $aclSave($aclTree); }));
		$aclBecome($aclUser);
	} finally {
		$config->admin = $aclAdminWas;
		$acl->set('apiGuard', $aclGuardWas);
		$wire->users->setCurrentUser($aclAsWas);
		foreach(array($aclUser, $aclUser2, $aclSuper) as $aclU) {
			if(isset($aclLanguageWas[$aclU->id])) $aclU->setLanguage($aclLanguageWas[$aclU->id]);
		}
		$modules->saveConfig($aclName, $aclSavedStep3);
		$acl->set('rules', isset($aclSavedStep3['rules']) ? $aclSavedStep3['rules'] : array());
		$acl->set('rulesVersion', $aclVersionStep3);
	}
	check('ACL finds: the config is left as found', $modules->getConfig($aclName) === $aclSavedStep3);

	// The rule editor on the module's config screen (step 4): the form as built, a save of it, the lockout guard
	$aclSavedStep4 = $modules->getConfig($aclName);
	$aclVersionStep4 = (int) $acl->get('rulesVersion');
	$R = (int) $aclEditor->id;
	$R2 = (int) $aclRestricted->id;
	$T = (int) $aclTree->id;
	$aclAllMenus = array(3, 22, 21, 28);
	// a save of the config screen: what ProcessModule does, with the form's POST
	$aclPost = function(array $post, $submit = true) use($wire, $modules, $aclName, $R, $aclAllMenus) {
		$post += array("_acl_role_$R" => $R);
		if(!array_key_exists("_acl_menus_$R", $post)) $post["_acl_menus_$R"] = $aclAllMenus;
		if($submit) $post['submit_save_module'] = 1;
		foreach($post as $k => $v) $wire->input->post->set($k, $v);
		try {
			$modules->saveConfig($aclName, $modules->getConfig($aclName));
		} finally {
			foreach(array_keys($post) as $k) $wire->input->post->remove($k);
		}
		return $modules->getConfig($aclName);
	};
	$aclPageRule = function($roleId, $pageId, $mode = 'deny', $inherit = true) { return array('role' => (int) $roleId, 'page' => (int) $pageId, 'mode' => $mode, 'inherit' => $inherit); };
	$aclForm = function() use($wire, $acl) {
		$form = $wire->wire(new InputfieldWrapper());
		$acl->getModuleConfigInputfields($form);
		return $form;
	};
	$aclHeldRole = $aclUser->roles->get("id=$R");
	$aclEditorHadPermission = $aclHeldRole->hasPermission('module-admin');
	$aclMadePermission = null;
	try {
		$aclBecome($aclSuper);
		$aclSet(array());
		$aclF = $aclForm();
		$aclNames = array();
		foreach($aclF->getAll() as $aclField) $aclNames[] = (string) $aclField->attr('name');
		check('ACL editor: every input but apiGuard is transient (the core stores none of them)', in_array('apiGuard', $aclNames, true) && !count(array_filter($aclNames, function($n) { return $n !== 'apiGuard' && strpos($n, '_') !== 0; })), implode(' ', $aclNames));
		check('ACL editor: a fieldset per role, none for superuser or guest', $aclF->getChildByName("_acl_set_$R") && $aclF->getChildByName("_acl_set_$R2") && !$aclF->getChildByName('_acl_set_' . (int) $config->superUserRolePageID) && !$aclF->getChildByName('_acl_set_' . (int) $config->guestUserRolePageID));
		$aclBoxes = $aclF->getChildByName("_acl_menus_$R");
		check('ACL editor: the menu boxes are the four core menus, the custom item not offered, all ticked', $aclBoxes && array_keys($aclBoxes->getOptions()) === $aclAllMenus && array_map('intval', $aclBoxes->attr('value')) === $aclAllMenus);
		check('ACL editor: collapsed for a role without rules, no Remove boxes', (int) $aclF->getChildByName("_acl_set_$R")->collapsed === Inputfield::collapsedYes && !$aclF->getChildByName("_acl_remove_$R"));
		$aclPicker = $aclF->getChildByName("_acl_page_$R");
		check('ACL editor: the picker starts at the root, deny and inherit are the defaults', $aclPicker instanceof InputfieldPageListSelect && (int) $aclPicker->parent_id === 0 && $aclF->getChildByName("_acl_mode_$R")->attr('value') === 'deny' && $aclF->getChildByName("_acl_inherit_$R")->isChecked());
		$aclSet(array($aclRule($aclEditor, $aclModules, 'deny'), $aclRule($aclEditor, $aclTree, 'deny', false)));
		$aclF = $aclForm();
		$aclBoxes = $aclF->getChildByName("_acl_menus_$R");
		$aclRemove = $aclF->getChildByName("_acl_remove_$R");
		check('ACL editor: a denied menu is unticked, open fieldset, Remove offers the page rule only (index 1)', !in_array(21, array_map('intval', $aclBoxes->attr('value')), true) && (int) $aclF->getChildByName("_acl_set_$R")->collapsed === Inputfield::collapsedNo && $aclRemove && array_keys($aclRemove->getOptions()) === array(1));
		check('ACL editor: the table lists the page rule, not the menu rule', strpos((string) $aclF->getChildByName("_acl_rules_$R")->value, $aclTree->path) !== false && substr_count((string) $aclF->getChildByName("_acl_rules_$R")->value, '<tr') === 2);

		$aclSet(array());
		$aclV = (int) $modules->getConfig($aclName, 'rulesVersion');
		$aclC = $aclPost(array("_acl_page_$R" => $T, "_acl_mode_$R" => 'deny', "_acl_inherit_$R" => 1), false);
		check('ACL save: without the form\'s submit the hook leaves the config alone', $aclC['rules'] === array() && (int) $aclC['rulesVersion'] === $aclV);
		$aclC = $aclPost(array());
		check('ACL save: nothing changed: rules [] and no new stamp', $aclC['rules'] === array() && (int) $aclC['rulesVersion'] === $aclV, json_encode($aclC));
		$aclC = $aclPost(array("_acl_page_$R" => $T, "_acl_mode_$R" => 'deny', "_acl_inherit_$R" => 1));
		check('ACL save: a picked page becomes one rule, the stamp bumps', $aclC['rules'] === array($aclPageRule($R, $T)) && (int) $aclC['rulesVersion'] === $aclV + 1, json_encode($aclC));
		check('ACL save: the transients are not in the config', !count(array_filter(array_keys($aclC), function($k) { return strpos($k, '_') === 0; })));
		check('ACL save: the running module has the new rules', $acl->verdict($aclTree, $aclUser) === $DENY && (int) $acl->get('rulesVersion') === $aclV + 1);
		$aclC = $aclPost(array("_acl_page_$R" => (int) $aclX->id, "_acl_mode_$R" => 'allow'));
		check('ACL save: allow, inherit unticked', $aclC['rules'][1] === $aclPageRule($R, $aclX->id, 'allow', false), json_encode($aclC['rules']));
		$aclC = $aclPost(array("_acl_menus_$R" => array(3, 22, 28)));
		check('ACL save: an unticked menu is a deny with inherit', in_array($aclPageRule($R, 21), $aclC['rules'], true) && count($aclC['rules']) === 3, json_encode($aclC['rules']));
		$aclC = $aclPost(array());
		check('ACL save: ticked again, that rule goes, the page rules stay', !in_array($aclPageRule($R, 21), $aclC['rules'], true) && count($aclC['rules']) === 2, json_encode($aclC['rules']));
		$aclC = $aclPost(array("_acl_remove_$R" => array(1, 0)));
		check('ACL save: Remove takes several rows at once', $aclC['rules'] === array(), json_encode($aclC['rules']));

		$aclSet(array($aclRule($aclRestricted, $aclTree, 'deny')));
		$aclC = $aclPost(array("_acl_remove_$R" => array(0)));
		check('ACL save: Remove cannot take another role\'s rule', $aclC['rules'] === array($aclPageRule($R2, $T)), json_encode($aclC['rules']));
		$aclC = $aclPost(array("_acl_role_$R2" => 0, "_acl_menus_$R2" => array()));
		check('ACL save: a role that was not on the form is left alone', $aclC['rules'] === array($aclPageRule($R2, $T)), json_encode($aclC['rules']));
		$aclSet(array());
		$aclC = $aclPost(array("_acl_menus_$R" => array(3, 22, 28), "_acl_page_$R" => (int) $aclCustom->id, "_acl_mode_$R" => 'deny', "_acl_inherit_$R" => 1));
		check('ACL save: a refused target leaves the whole role as it was', $aclC['rules'] === array(), json_encode($aclC['rules']));
		$aclC = $aclPost(array("_acl_page_$R" => $T, "_acl_mode_$R" => 'nonsense'));
		check('ACL save: a mode that is neither is refused', $aclC['rules'] === array(), json_encode($aclC['rules']));

		// the lockout guard: a user with module-admin and a role whose Modules would be denied. A default
		// install has no such permission page: made here, put on the role in memory only, deleted below.
		if(!$wire->permissions->get('module-admin')->id) $aclMadePermission = $wire->permissions->add('module-admin');
		$aclHeldRole->addPermission('module-admin');
		$aclBecome($aclUser);
		check('ACL lockout: the test user has module-admin and is no superuser', $aclUser->hasPermission('module-admin') && !$aclUser->isSuperuser());
		$aclVGuard = (int) $modules->getConfig($aclName, 'rulesVersion');
		$aclC = $aclPost(array("_acl_menus_$R" => array(3, 22, 28)));
		check('ACL lockout: denying Modules for the editor\'s own role is refused, rules unchanged', $aclC['rules'] === array() && (int) $aclC['rulesVersion'] === $aclVGuard, json_encode($aclC));
		$aclC = $aclPost(array("_acl_page_$R" => 21, "_acl_mode_$R" => 'deny'));
		check('ACL lockout: the picker cannot do it either', $aclC['rules'] === array(), json_encode($aclC));
		$aclC = $aclPost(array("_acl_menus_$R" => array(3, 21, 28)));
		check('ACL lockout: the same editor can deny another menu', in_array($aclPageRule($R, 22), $aclC['rules'], true), json_encode($aclC));
		$aclSet(array());
		$aclC = $aclPost(array("_acl_role_$R2" => $R2, "_acl_menus_$R2" => array(3, 22, 28)));
		check('ACL lockout: a role the editor does not have can be denied Modules', in_array($aclPageRule($R2, 21), $aclC['rules'], true), json_encode($aclC));
		$aclSet(array());
		$aclBecome($aclSuper);
		$aclC = $aclPost(array("_acl_menus_$R" => array(3, 22, 28)));
		check('ACL lockout: the same save by a superuser goes through', in_array($aclPageRule($R, 21), $aclC['rules'], true), json_encode($aclC));
	} finally {
		if(!$aclEditorHadPermission) $aclHeldRole->removePermission('module-admin');
		if($aclMadePermission) $wire->permissions->delete($aclMadePermission);
		$wire->users->setCurrentUser($aclAsWas);
		foreach(array($aclUser, $aclUser2, $aclSuper) as $aclU) {
			if(isset($aclLanguageWas[$aclU->id])) $aclU->setLanguage($aclLanguageWas[$aclU->id]);
		}
		$modules->saveConfig($aclName, $aclSavedStep4);
		$acl->set('rules', isset($aclSavedStep4['rules']) ? $aclSavedStep4['rules'] : array());
		$acl->set('rulesVersion', $aclVersionStep4);
	}
	check('ACL editor: the config is left as found', $modules->getConfig($aclName) === $aclSavedStep4);
}

echo $fails ? "\n$fails FAILED\n" : "\nall passed\n";
exit($fails ? 1 : 0);

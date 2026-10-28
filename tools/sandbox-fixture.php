<?php namespace ProcessWire;

/**
 * Adds a field-zoo page to a sandbox: template "bridge_fixture" with one field of each core
 * Inputfield type that has its own look (tags, rich text classic and inline, toggle, JSON,
 * datetime, page selects, options, selector, images and files with tags), and a hidden page
 * /bridge-fixture/ using it. The scheme scan (tools/scheme-scan.js) opens this page.
 *
 * Sandbox only (sandbox/<site>, never a real site). Idempotent: existing fields, template and
 * page are kept and only completed. Prints the page id.
 *
 * Also adds /bridge-native/ (template "bridge_native", milestone 3.1): only fields that are native
 * in the page editor, one custom tab, no children, so its editor loads no jQuery
 * (tools/page-edit-check.js opens it).
 *
 * Also adds /bridge-nesting/ (template "bridge_nesting"): fieldsets in fieldsets, a repeater with
 * depth holding a fieldset and a nested repeater with depth, a FieldsetPage in a tab.
 *
 * Usage: php tools/sandbox-fixture.php /path/to/sandbox/root
 */

$root = rtrim(str_replace('\\', '/', $argv[1] ?? ''), '/');
if(!is_file("$root/index.php") || !is_file("$root/project.php") || strpos($root, '/sandbox/') === false) {
	exit("Usage: php tools/sandbox-fixture.php /path/to/sandbox/root (a sandbox/ directory)\n");
}
if(empty($_SERVER['DOCUMENT_ROOT'])) $_SERVER['DOCUMENT_ROOT'] = $root;
include "$root/index.php";
/** @var Modules $modules */
/** @var Fields $fields */
/** @var Templates $templates */
/** @var Pages $pages */
/** @var Config $config */

foreach(array('InputfieldTinyMCE', 'InputfieldCKEditor', 'FieldtypeToggle', 'InputfieldToggle', 'InputfieldTextTags',
	'InputfieldJson', 'InputfieldPageAutocomplete', 'InputfieldIcon', 'FieldtypeSelector', 'FieldtypeOptions') as $name) {
	if(!$modules->isInstalled($name)) {
		try {
			$modules->install($name);
			echo "ok   installed $name\n";
		} catch(\Exception $e) {
			echo "skip $name: {$e->getMessage()}\n";
		}
	}
}

$defs = array(
	'bf_tags' => array('FieldtypeText', 'Tags', array('inputfieldClass' => 'InputfieldTextTags', 'allowUserTags' => 1,
		'tagsList' => "alpha\nbeta\ngamma\ndelta")),
	'bf_tag' => array('FieldtypeText', 'Tag (single)', array('inputfieldClass' => 'InputfieldTextTags', 'maxItems' => 1,
		'tagsList' => "alpha\nbeta\ngamma")),
	'bf_ckeditor' => array('FieldtypeTextarea', 'CKEditor', array('inputfieldClass' => 'InputfieldCKEditor', 'contentType' => 1)),
	'bf_ckeditor_inline' => array('FieldtypeTextarea', 'CKEditor inline', array('inputfieldClass' => 'InputfieldCKEditor',
		'contentType' => 1, 'inlineMode' => 1)),
	'bf_tinymce' => array('FieldtypeTextarea', 'TinyMCE', array('inputfieldClass' => 'InputfieldTinyMCE', 'contentType' => 1)),
	'bf_tinymce_inline' => array('FieldtypeTextarea', 'TinyMCE inline', array('inputfieldClass' => 'InputfieldTinyMCE',
		'contentType' => 1, 'inlineMode' => 1)),
	'bf_json' => array('FieldtypeTextarea', 'JSON', array('inputfieldClass' => 'InputfieldJson', 'useMainMenuBar' => 1)),
	'bf_toggle' => array('FieldtypeToggle', 'Toggle', array('formatType' => 0, 'inputfieldClass' => 'InputfieldToggle')),
	'bf_date' => array('FieldtypeDatetime', 'Date', array('inputType' => 'text', 'datepicker' => 3, 'dateInputFormat' => 'Y-m-d',
		'timeInputFormat' => 'H:i')),
	'bf_pages_asm' => array('FieldtypePage', 'Pages (asmSelect)', array('derefAsPage' => 0, 'inputfield' => 'InputfieldAsmSelect',
		'parent_id' => 1)),
	'bf_pages_auto' => array('FieldtypePage', 'Pages (autocomplete)', array('derefAsPage' => 0,
		'inputfield' => 'InputfieldPageAutocomplete', 'parent_id' => 1)),
	'bf_pages_list' => array('FieldtypePage', 'Pages (list select)', array('derefAsPage' => 0,
		'inputfield' => 'InputfieldPageListSelectMultiple', 'parent_id' => 1)),
	'bf_options' => array('FieldtypeOptions', 'Options (radios)', array('inputfieldClass' => 'InputfieldRadios')),
	'bf_selector' => array('FieldtypeSelector', 'Selector', array()),
	'bf_images' => array('FieldtypeImage', 'Images', array('extensions' => 'png jpg', 'useTags' => 1,
		'tagsList' => "red\ngreen\nblue", 'maxFiles' => 0)),
	'bf_files' => array('FieldtypeFile', 'Files', array('extensions' => 'txt pdf', 'useTags' => 1, 'maxFiles' => 0)),
);

$tpl = $templates->get('bridge_fixture');
if(!$tpl) {
	$fg = new Fieldgroup();
	$fg->name = 'bridge_fixture';
	$fg->add($fields->get('title'));
	$fg->save();
	$tpl = new Template();
	$tpl->name = 'bridge_fixture';
	$tpl->fieldgroup = $fg;
	$tpl->noChildren = 1;
	$tpl->save();
	echo "ok   template bridge_fixture\n";
}
foreach($defs as $name => $def) {
	list($type, $label, $settings) = $def;
	if(!$modules->isInstalled($type)) { echo "skip $name: $type not installed\n"; continue; }
	$f = $fields->get($name);
	if(!$f) {
		$f = new Field();
		$f->type = $modules->get($type);
		$f->name = $name;
		$f->label = $label;
		foreach($settings as $k => $v) $f->set($k, $v);
		$fields->save($f);
		if($name === 'bf_options') {
			$f->type->manager->setOptionsString($f, "1=One\n2=Two\n3=Three", false);
		}
		echo "ok   field $name\n";
	}
	if(!$tpl->fieldgroup->hasField($f)) {
		$tpl->fieldgroup->add($f);
		$tpl->fieldgroup->save();
	}
}

$page = $pages->get('/bridge-fixture/');
if(!$page->id) {
	$page = new Page();
	$page->template = $tpl;
	$page->parent = $pages->get('/');
	$page->name = 'bridge-fixture';
	$page->title = 'Bridge fixture';
	$page->addStatus(Page::statusHidden);
	$page->save();
	echo "ok   page /bridge-fixture/\n";
}
$page->of(false);
$page->filesManager()->path(); // creates the page's files directory
$html = "<h2>Heading</h2><p>Body text with a <a href='/'>link</a>, <strong>bold</strong> and <em>italic</em>.</p>" .
	"<blockquote><p>A quote.</p></blockquote><ul><li>One</li><li>Two</li></ul>" .
	"<table><tbody><tr><td>Cell</td><td>Cell</td></tr></tbody></table><pre>code</pre><hr>";
foreach(array('bf_ckeditor', 'bf_ckeditor_inline', 'bf_tinymce', 'bf_tinymce_inline') as $name) {
	if($page->template->hasField($name) && !$page->get($name)) $page->set($name, $html);
}
if($page->template->hasField('bf_tags') && !$page->bf_tags) $page->bf_tags = 'alpha beta';
if($page->template->hasField('bf_json') && !$page->bf_json) $page->bf_json = '{"name":"bridge","list":[1,2,3],"nested":{"on":true}}';
if($page->template->hasField('bf_pages_asm') && !count($page->bf_pages_asm)) $page->bf_pages_asm = $pages->find('parent=1, limit=3')->explode('id');
if($page->template->hasField('bf_pages_auto') && !count($page->bf_pages_auto)) $page->bf_pages_auto = $pages->find('parent=1, limit=3')->explode('id');
if($page->template->hasField('bf_pages_list') && !count($page->bf_pages_list)) $page->bf_pages_list = $pages->find('parent=1, limit=2')->explode('id');
if($page->template->hasField('bf_images') && !$page->bf_images->count() && function_exists('imagecreatetruecolor')) {
	// two generated images: an opaque one and one with transparency (shows the checkerboard)
	foreach(array('fixture-opaque.png' => false, 'fixture-alpha.png' => true) as $file => $alpha) {
		$im = imagecreatetruecolor(640, 400);
		imagesavealpha($im, true);
		imagefill($im, 0, 0, $alpha ? imagecolorallocatealpha($im, 0, 0, 0, 127) : imagecolorallocate($im, 53, 132, 234));
		imagefilledellipse($im, 320, 200, 300, 300, imagecolorallocate($im, 244, 19, 169));
		$tmp = $config->paths->tmp . $file;
		wireMkdir(dirname($tmp), true);
		imagepng($im, $tmp);
		$page->bf_images->add($tmp);
	}
	$page->bf_images->first()->description = 'Opaque image';
	$page->bf_images->first()->tags = 'red';
}
if($page->template->hasField('bf_files') && !$page->bf_files->count()) {
	$tmp = $config->paths->tmp . 'fixture-notes.txt';
	wireMkdir(dirname($tmp), true);
	file_put_contents($tmp, "fixture\n");
	$page->bf_files->add($tmp);
	$page->bf_files->first()->tags = 'notes';
}
$page->save();
echo "ok   page id {$page->id}\n";

// native-only page editor (milestone 3.1): title plus Phase 2 field types, one custom tab
$nativeDefs = array(
	'bf_text' => array('FieldtypeText', 'Text', array('maxlength' => 120, 'showCount' => 1)),
	'bf_textarea' => array('FieldtypeTextarea', 'Textarea', array('inputfieldClass' => 'InputfieldTextarea', 'rows' => 4)),
	'bf_integer' => array('FieldtypeInteger', 'Integer', array('columnWidth' => 50)),
	'bf_checkbox' => array('FieldtypeCheckbox', 'Checkbox', array('columnWidth' => 50)),
	'bf_tab' => array('FieldtypeFieldsetTabOpen', 'Extra', array()),
	// milestone 3.2: a single image (the multiple ones are bf_images and bf_files above)
	'bf_image' => array('FieldtypeImage', 'Image (single)', array('extensions' => 'png jpg', 'maxFiles' => 1, 'useTags' => 0)),
);
foreach($nativeDefs as $name => $def) {
	list($type, $label, $settings) = $def;
	if($fields->get($name)) continue;
	$f = new Field();
	$f->type = $modules->get($type);
	$f->name = $name;
	$f->label = $label;
	foreach($settings as $k => $v) $f->set($k, $v);
	$fields->save($f);
	echo "ok   field $name
";
}
$tabOpen = $fields->get('bf_tab');
$tabClose = $fields->get('bf_tab_END');
if(!$tabClose && $tabOpen) {
	$tabClose = $tabOpen->type->getFieldsetCloseField($tabOpen, true);
	echo "ok   field bf_tab_END
";
}
$order = array('title', 'bf_text', 'bf_textarea', 'bf_integer', 'bf_checkbox', 'bf_toggle', 'bf_options',
	'bf_images', 'bf_files', 'bf_image', 'bf_repeater', 'bf_repeater_depth', 'bf_pagetable',
	'bf_tab', 'bf_tags', 'bf_date', 'bf_pages_asm', 'bf_pages_auto', 'bf_pages_list', 'bf_selector', 'bf_tab_END');
// milestone 3.3: repeaters of native fields (a plain one; one with depth and limits) and a page
// table whose items live under their own parent (no Children tab on the fixture page)
$makeTemplate = function($name, array $names, array $settings = array()) use($templates, $fields) {
	$tpl = $templates->get($name);
	if($tpl) return $tpl;
	$fg = new Fieldgroup();
	$fg->name = $name;
	foreach($names as $n) if($fields->get($n)) $fg->add($fields->get($n));
	$fg->save();
	$tpl = new Template();
	$tpl->name = $name;
	$tpl->fieldgroup = $fg;
	foreach($settings as $k => $v) $tpl->set($k, $v);
	$tpl->save();
	echo "ok   template $name
";
	return $tpl;
};
foreach(array('bf_repeater' => array('Repeater', 0, 0, 0), 'bf_repeater_depth' => array('Repeater (depth)', 2, 1, 5)) as $name => $def) {
	if(!$modules->isInstalled('FieldtypeRepeater')) break;
	list($label, $depth, $min, $max) = $def;
	$f = $fields->get($name);
	if($f) continue;
	$f = new Field();
	$f->type = $modules->get('FieldtypeRepeater');
	$f->name = $name;
	$f->label = $label;
	$f->set('repeaterDepth', $depth);
	$f->set('repeaterMinItems', $min);
	$f->set('repeaterMaxItems', $max);
	$f->set('repeaterLoading', 1); // items load by AJAX when opened
	$f->set('repeaterCollapse', 1);
	$fields->save($f);
	$rtpl = $f->type->_getRepeaterTemplate($f);
	$ids = array();
	foreach(array('bf_text', 'bf_textarea') as $n) {
		$rtpl->fieldgroup->add($fields->get($n));
		$ids[] = $fields->get($n)->id;
	}
	$rtpl->fieldgroup->save();
	$f->set('repeaterFields', $ids);
	$fields->save($f);
	echo "ok   field $name
";
}
if($modules->isInstalled('FieldtypePageTable') && !$fields->get('bf_pagetable')) {
	$itemTpl = $makeTemplate('bridge_pt_item', array('title', 'bf_text'), array('noChildren' => 1));
	$ptParentTpl = $makeTemplate('bridge_pt_parent', array('title'), array('childTemplates' => array($itemTpl->id)));
	$ptParent = $pages->get('/bridge-pt-items/');
	if(!$ptParent->id) {
		$ptParent = new Page();
		$ptParent->template = $ptParentTpl;
		$ptParent->parent = $pages->get('/');
		$ptParent->name = 'bridge-pt-items';
		$ptParent->title = 'Bridge page table items';
		$ptParent->addStatus(Page::statusHidden);
		$ptParent->save();
	}
	$f = new Field();
	$f->type = $modules->get('FieldtypePageTable');
	$f->name = 'bf_pagetable';
	$f->label = 'Page table';
	$f->set('template_id', array($itemTpl->id));
	$f->set('parent_id', $ptParent->id);
	$f->set('columns', "title
bf_text");
	$f->set('nameFormat', 'Y-m-d H:i:s');
	$fields->save($f);
	echo "ok   field bf_pagetable
";
}
$ntpl = $templates->get('bridge_native');
if(!$ntpl) {
	$fg = new Fieldgroup();
	$fg->name = 'bridge_native';
	foreach($order as $name) if($fields->get($name)) $fg->add($fields->get($name));
	$fg->save();
	$ntpl = new Template();
	$ntpl->name = 'bridge_native';
	$ntpl->fieldgroup = $fg;
	$ntpl->noChildren = 1;
	$ntpl->save();
	echo "ok   template bridge_native
";
}
$npage = $pages->get('/bridge-native/');
if(!$npage->id) {
	$npage = new Page();
	$npage->template = $ntpl;
	$npage->parent = $pages->get('/');
	$npage->name = 'bridge-native';
	$npage->title = 'Bridge native';
	$npage->addStatus(Page::statusHidden);
	$npage->save();
	echo "ok   page /bridge-native/
";
}
// fields added to the order later go into an existing template after their predecessor
$prev = null;
foreach($order as $name) {
	$f = $fields->get($name);
	if(!$f) continue;
	if(!$ntpl->fieldgroup->hasField($f)) {
		if($prev) $ntpl->fieldgroup->insertAfter($f, $prev);
		else $ntpl->fieldgroup->add($f);
		$ntpl->fieldgroup->save();
		echo "ok   bridge_native gets $name
";
	}
	$prev = $f;
}
// generated content for the file fields (sandbox tmp, as above)
$npage->of(false);
$npage->filesManager()->createPath(); // a page created in this run may not have its files directory yet
$png = function($file, $color, $w = 640, $h = 400) use($config) {
	$tmp = $config->paths->tmp . $file;
	if(is_file($tmp) || !function_exists('imagecreatetruecolor')) return $tmp;
	wireMkdir(dirname($tmp), true);
	$im = imagecreatetruecolor($w, $h);
	imagefill($im, 0, 0, imagecolorallocate($im, $color[0], $color[1], $color[2]));
	imagefilledellipse($im, (int) ($w / 2), (int) ($h / 2), (int) ($h * .7), (int) ($h * .7), imagecolorallocate($im, 244, 19, 169));
	imagepng($im, $tmp);
	return $tmp;
};
if($npage->template->hasField('bf_images') && !$npage->bf_images->count()) {
	foreach(array('native-a.png' => array(53, 132, 234), 'native-b.png' => array(46, 160, 67), 'native-c.png' => array(230, 150, 30)) as $file => $color) {
		$npage->bf_images->add($png($file, $color));
	}
	$npage->bf_images->first()->description = 'First image';
}
if($npage->template->hasField('bf_image') && !$npage->getUnformatted('bf_image')->count()) {
	$npage->getUnformatted('bf_image')->add($png('native-single.png', array(120, 80, 200), 400, 640));
}
if($npage->template->hasField('bf_files') && !$npage->bf_files->count()) {
	foreach(array('native-one.txt', 'native-two.txt') as $file) {
		$tmp = $config->paths->tmp . $file;
		file_put_contents($tmp, "$file
");
		$npage->bf_files->add($tmp);
	}
}
if($npage->template->hasField('bf_repeater') && !$npage->bf_repeater->count()) {
	foreach(array('First', 'Second', 'Third') as $n => $label) {
		$item = $npage->bf_repeater->getNew();
		$item->bf_text = "$label item";
		$item->save();
		$npage->bf_repeater->add($item);
	}
}
if($npage->template->hasField('bf_repeater_depth') && !$npage->bf_repeater_depth->count()) {
	foreach(array(array('Parent', 0), array('Child', 1), array('Sibling', 0)) as $def) {
		$item = $npage->bf_repeater_depth->getNew();
		$item->bf_text = $def[0];
		$item->setDepth($def[1]); // stored as leading dashes in the item's name
		$item->save();
		$npage->bf_repeater_depth->add($item);
	}
}
if($npage->template->hasField('bf_repeater_depth')) {
	$child = $npage->bf_repeater_depth->get('bf_text=Child');
	if($child && !$child->getDepth()) {
		$child->setDepth(1);
		$child->save();
		echo "ok   bf_repeater_depth child item at depth 1
";
	}
}
if($npage->template->hasField('bf_pagetable') && !$npage->getUnformatted('bf_pagetable')->count()) {
	$ptParent = $pages->get('/bridge-pt-items/');
	foreach(array('Row one', 'Row two') as $title) {
		$row = new Page();
		$row->template = 'bridge_pt_item';
		$row->parent = $ptParent;
		$row->title = $title;
		$row->bf_text = "$title text";
		$row->save();
		$npage->getUnformatted('bf_pagetable')->add($row);
	}
}
$npage->save();
echo "ok   native page id {$npage->id}
";

// a native page with children (milestone 3.1): its editor's Children tab holds the page tree,
// which stays legacy until the page tree is native (3.4)
$ptpl = $templates->get('bridge_native_parent');
if(!$ptpl) {
	$fg = new Fieldgroup();
	$fg->name = 'bridge_native_parent';
	$fg->add($fields->get('title'));
	$fg->save();
	$ptpl = new Template();
	$ptpl->name = 'bridge_native_parent';
	$ptpl->fieldgroup = $fg;
	$ptpl->childTemplates = array($ntpl->id);
	$ptpl->save();
	echo "ok   template bridge_native_parent
";
}
$ppage = $pages->get('/bridge-native-parent/');
if(!$ppage->id) {
	$ppage = new Page();
	$ppage->template = $ptpl;
	$ppage->parent = $pages->get('/');
	$ppage->name = 'bridge-native-parent';
	$ppage->title = 'Bridge native parent';
	$ppage->addStatus(Page::statusHidden);
	$ppage->save();
	echo "ok   page /bridge-native-parent/
";
}
foreach(array('child-a' => 'Child A', 'child-b' => 'Child B') as $name => $title) {
	if($ppage->child("name=$name, include=all")->id) continue;
	$c = new Page();
	$c->template = $ntpl;
	$c->parent = $ppage;
	$c->name = $name;
	$c->title = $title;
	$c->save();
	echo "ok   page $name
";
}
echo "ok   native parent page id {$ppage->id}
";

// milestone 3.4: a branch with more children than the page tree shows at once (pagination, More,
// moves), using the page table's item template
$itemTpl = $templates->get('bridge_pt_item');
$treeTpl = $templates->get('bridge_pt_parent');
if($itemTpl && $treeTpl) {
	$tree = $pages->get('/bridge-tree/');
	if(!$tree->id) {
		$tree = new Page();
		$tree->template = $treeTpl;
		$tree->parent = $pages->get('/');
		$tree->name = 'bridge-tree';
		$tree->title = 'Bridge tree';
		$tree->addStatus(Page::statusHidden);
		$tree->save();
		echo "ok   page /bridge-tree/
";
	}
	$have = $tree->numChildren(true);
	for($n = $have + 1; $n <= 60; $n++) {
		$c = new Page();
		$c->template = $itemTpl;
		$c->parent = $tree;
		$c->name = sprintf('tree-item-%02d', $n);
		$c->title = sprintf('Tree item %02d', $n);
		$c->save();
	}
	if($have < 60) echo "ok   /bridge-tree/ has 60 children
";
	echo "ok   tree page id {$tree->id}
";
}

// milestone 3.6: a role to edit in tools/setup-check.js (permission tree), page-view only
$role = $roles->get('bridge-fixture');
if(!$role->id) {
	$role = $roles->add('bridge-fixture');
	$role->addPermission('page-view');
	$role->save();
	echo "ok   role bridge-fixture\n";
}
echo "ok   fixture role id {$role->id}\n";

// nesting (/bridge-nesting/, template "bridge_nesting"): fieldsets in fieldsets (one collapsed),
// columns inside them, a repeater with depth whose open items hold a fieldset and a nested
// repeater with depth, and a FieldsetPage in a tab that holds that nested repeater too
if(!$modules->isInstalled('FieldtypeFieldsetPage') && $modules->isInstallable('FieldtypeFieldsetPage')) {
	$modules->install('FieldtypeFieldsetPage');
	echo "ok   installed FieldtypeFieldsetPage\n";
}
$nestDefs = array(
	'bn_text' => array('FieldtypeText', 'Nested text', array()),
	'bn_col_a' => array('FieldtypeText', 'Column A', array('columnWidth' => 50)),
	'bn_col_b' => array('FieldtypeInteger', 'Column B', array('columnWidth' => 50)),
	'bn_textarea' => array('FieldtypeTextarea', 'Nested textarea', array('inputfieldClass' => 'InputfieldTextarea', 'rows' => 3)),
	'bn_fs_outer' => array('FieldsetOpen', 'Fieldset outer', array()),
	'bn_fs_inner' => array('FieldsetOpen', 'Fieldset inner', array()),
	'bn_fs_collapsed' => array('FieldsetOpen', 'Fieldset collapsed', array('collapsed' => Inputfield::collapsedYes)),
	'bn_tab' => array('FieldsetTabOpen', 'Nesting tab', array()),
);
foreach($nestDefs as $name => $def) {
	list($type, $label, $settings) = $def;
	$f = $fields->get($name);
	if(!$f) {
		$f = new Field();
		$f->type = $modules->get(strpos($type, 'Fieldtype') === 0 ? $type : "Fieldtype$type");
		$f->name = $name;
		$f->label = $label;
		foreach($settings as $k => $v) $f->set($k, $v);
		$fields->save($f);
		echo "ok   field $name\n";
	}
	if(strpos($type, 'Fieldset') !== false && !$fields->get("{$name}_END")) {
		$f->type->getFieldsetCloseField($f, true);
		echo "ok   field {$name}_END\n";
	}
}
$makeRepeater = function($name, $label, $type, array $names, $depth) use($fields, $modules) {
	$f = $fields->get($name);
	if($f) return $f;
	if(!$modules->isInstalled($type)) return null;
	$f = new Field();
	$f->type = $modules->get($type);
	$f->name = $name;
	$f->label = $label;
	if($type === 'FieldtypeRepeater') {
		$f->set('repeaterDepth', $depth);
		$f->set('repeaterLoading', 2); // rendered with the page, no AJAX
		$f->set('repeaterCollapse', 3); // items open
	}
	$fields->save($f);
	$rtpl = $f->type->_getRepeaterTemplate($f);
	$ids = array();
	foreach($names as $n) {
		$rtpl->fieldgroup->add($fields->get($n));
		$ids[] = $fields->get($n)->id;
	}
	$rtpl->fieldgroup->save();
	$f->set('repeaterFields', $ids);
	$fields->save($f);
	echo "ok   field $name\n";
	return $f;
};
$makeRepeater('bn_rep_inner', 'Inner repeater', 'FieldtypeRepeater', array('bn_text', 'bn_col_a', 'bn_col_b'), 2);
$makeRepeater('bn_rep_outer', 'Outer repeater', 'FieldtypeRepeater', array('bn_text', 'bn_col_a', 'bn_col_b',
	'bn_fs_inner', 'bn_textarea', 'bn_fs_inner_END', 'bn_rep_inner'), 2);
$makeRepeater('bn_fsp', 'Fieldset page', 'FieldtypeFieldsetPage', array('bn_text', 'bn_rep_inner'), 0);
$btpl = $makeTemplate('bridge_nesting', array('title',
	'bn_fs_outer', 'bn_text', 'bn_fs_inner', 'bn_col_a', 'bn_col_b', 'bn_fs_collapsed', 'bn_textarea', 'bn_fs_collapsed_END',
	'bn_fs_inner_END', 'bn_fs_outer_END',
	'bn_rep_outer', 'bn_tab', 'bn_fsp', 'bn_tab_END'), array('noChildren' => 1));
$bpage = $pages->get('/bridge-nesting/');
if(!$bpage->id) {
	$bpage = new Page();
	$bpage->template = $btpl;
	$bpage->parent = $pages->get('/');
	$bpage->name = 'bridge-nesting';
	$bpage->title = 'Bridge nesting';
	$bpage->addStatus(Page::statusHidden);
	$bpage->save();
	echo "ok   page /bridge-nesting/\n";
}
$bpage->of(false);
$fillInner = function(Page $item) {
	foreach(array(array('Inner parent', 0), array('Inner child', 1)) as $def) {
		$in = $item->bn_rep_inner->getNew();
		$in->bn_text = $def[0];
		$in->setDepth($def[1]);
		$in->save();
		$item->bn_rep_inner->add($in);
	}
};
if($btpl->hasField('bn_rep_outer') && !$bpage->bn_rep_outer->count()) {
	foreach(array(array('Outer parent', 0), array('Outer child', 1), array('Outer grandchild', 2)) as $def) {
		$item = $bpage->bn_rep_outer->getNew();
		$item->of(false);
		$item->bn_text = $def[0];
		$item->setDepth($def[1]);
		$item->save();
		$fillInner($item);
		$item->save();
		$bpage->bn_rep_outer->add($item);
	}
}
if($btpl->hasField('bn_fsp')) {
	$fsp = $bpage->bn_fsp;
	if($fsp && $fsp->id && !$fsp->bn_rep_inner->count()) {
		$fsp->of(false);
		$fsp->bn_text = 'Inside a fieldset page';
		$fillInner($fsp);
		$fsp->save();
	}
}
$bpage->save();
echo "ok   nesting page id {$bpage->id}\n";

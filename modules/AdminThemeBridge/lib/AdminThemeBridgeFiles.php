<?php namespace ProcessWire;

/**
 * AdminThemeBridge: moving files and images between the file fields of one page (0.14.0, ADR 0018)
 *
 * Part of the AdminThemeBridge class, split by job into traits (audit PA1); `$this` is the theme.
 * Constants and properties stay in AdminThemeBridge.module.php.
 *
 * The client (runtime fields/files-move.ts) posts to the page editor as its AJAX saves do:
 * `bridgeFilesMove=1`, `from`, `to` (field names), `ids[]` (item hashes, the `file_<hash>` of their
 * markup), `index` (where in the target, -1 = at the end), `meta` (JSON `{<hash>: {description,
 * description<language id>, tags}}`, unsaved edits), `resolve[<hash>]` (`replace` or `swap` for a
 * single-file target holding a file) and the CSRF token. The answer is JSON: `{ok, moved: [{hash, basename}], swapped: [{hash, basename}],
 * errors: [{hash, basename, message}], message}`.
 *
 * A move is accepted when an upload of the same file into the target would be: its extensions,
 * maxFiles, an image field's minimum size (and maximum with maxReject; without it the image is
 * resized as an upload is). All file fields of a page share its files directory, so a file moves by
 * reference: no copy, no new name, variations kept (dropped when an image becomes a plain file).
 *
 */
trait AdminThemeBridgeFiles {

	/**
	 * Hook before ProcessPageEdit::ajaxSave: a files move takes the request
	 *
	 * @param HookEvent $event
	 *
	 */
	public function hookPageEditAjaxSave(HookEvent $event) {
		$input = $this->wire()->input;
		if(!$input->post('bridgeFilesMove')) return;
		$event->replace = true;
		$page = $event->arguments(0);
		$result = array('ok' => false, 'moved' => array(), 'swapped' => array(), 'errors' => array(), 'message' => '');
		try {
			if(!$page instanceof Page || !$page->id) throw new WireException(__('No page to move files on', __FILE__));
			$result = $this->filesMoveRequest($page);
		} catch(\Exception $e) {
			$result['message'] = $e->getMessage();
		}
		header('Content-Type: application/json');
		// admin.php buffers AJAX output and sends it as the answer
		echo json_encode($result);
	}

	/**
	 * Read and check a files move request, then move
	 *
	 * @param Page $page
	 * @return array
	 * @throws WireException
	 *
	 */
	protected function filesMoveRequest(Page $page) {
		$input = $this->wire()->input;
		$sanitizer = $this->wire()->sanitizer;
		if($this->wire()->config->demo) throw new WireException(__('Moving files is off in demo mode', __FILE__));
		$this->wire()->session->CSRF->validate(); // throws when invalid
		$fieldgroup = $page->template->fieldgroup;
		$from = $fieldgroup->getFieldContext($sanitizer->fieldName((string) $input->post('from')));
		$to = $fieldgroup->getFieldContext($sanitizer->fieldName((string) $input->post('to')));
		if(!$from || !$to || $from->id == $to->id || !$from->type instanceof FieldtypeFile || !$to->type instanceof FieldtypeFile) {
			throw new WireException(__('These fields cannot exchange files', __FILE__));
		}
		$byHash = array();
		foreach($page->getUnformatted($from->name) as $pagefile) $byHash[$pagefile->hash] = $pagefile;
		// JSON: $config->wireInputArrayDepth keeps POST arrays one level deep
		$meta = json_decode((string) $input->post('meta'), true);
		$resolve = $input->post('resolve');
		$basenames = array();
		$metaByName = array();
		$resolveByName = array();
		$errors = array();
		foreach((array) $input->post('ids') as $hash) {
			$hash = (string) $hash;
			if(!preg_match('/^[a-f0-9]{32}$/', $hash)) continue;
			if(!isset($byHash[$hash])) {
				$errors[] = array('hash' => $hash, 'basename' => '', 'message' => __('This file is no longer in the field', __FILE__));
				continue;
			}
			$basename = $byHash[$hash]->basename;
			$basenames[] = $basename;
			if(is_array($meta) && isset($meta[$hash]) && is_array($meta[$hash])) $metaByName[$basename] = $meta[$hash];
			if(is_array($resolve) && isset($resolve[$hash])) $resolveByName[$basename] = $sanitizer->name((string) $resolve[$hash]);
		}
		$index = $input->post('index');
		$index = is_numeric($index) ? (int) $index : -1;
		$result = $this->moveFiles($page, $from, $to, $basenames, array('index' => $index, 'meta' => $metaByName, 'resolve' => $resolveByName));
		$result['errors'] = array_merge($errors, $result['errors']);
		return $result;
	}

	/**
	 * Move files from one file or image field of a page to another, and save both
	 *
	 * Hook before to change the request, after to read or change the result. Each file is checked as
	 * an upload into `$to` would be; files that fail stay where they are and are listed in `errors`.
	 *
	 * @param Page $page
	 * @param Field $from Source field, in the page's template context
	 * @param Field $to Target field, in the page's template context
	 * @param array $basenames Files of `$from` to move, in this order
	 * @param array $options
	 *  - `index` (int): where in `$to` the files go, -1 for the end
	 *  - `meta` (array): by basename, `description`, `description<language id>`, `tags` to set
	 *  - `resolve` (array): by basename, `replace` or `swap` when `$to` holds one file at most and has one
	 * @return array `ok`, `moved` and `swapped` (lists of `hash`, `basename`), `errors` (`hash`, `basename`, `message`), `message`
	 * @throws WireException when the page or the fields may not be edited
	 *
	 */
	public function ___moveFiles(Page $page, Field $from, Field $to, array $basenames, array $options = array()) {
		$options = array_merge(array('index' => -1, 'meta' => array(), 'resolve' => array()), $options);
		$result = array('ok' => false, 'moved' => array(), 'swapped' => array(), 'errors' => array(), 'message' => '');
		if($page->hasStatus(Page::statusLocked)) throw new WireException(__('This page is locked', __FILE__));
		if(!$page->editable($from->name) || !$page->editable($to->name)) {
			throw new WirePermissionException(__('You may not edit these fields', __FILE__));
		}
		$of = $page->of();
		$page->of(false);
		$src = $page->get($from->name);
		$dst = $page->get($to->name);
		if(!$src instanceof Pagefiles || !$dst instanceof Pagefiles) {
			$page->of($of);
			throw new WireException(__('These fields cannot exchange files', __FILE__));
		}
		$rules = $this->moveRules($page, $to);
		$back = $this->moveRules($page, $from);
		$index = (int) $options['index'];
		$moved = array();
		$fail = function(Pagefile $f, $message) use(&$result) {
			$result['errors'][] = array('hash' => $f->hash, 'basename' => $f->basename, 'message' => $message);
		};
		foreach($basenames as $basename) {
			$f = $src->getFile($basename);
			if(!$f) {
				$result['errors'][] = array('hash' => md5($basename), 'basename' => $basename, 'message' => __('This file is no longer in the field', __FILE__));
				continue;
			}
			$reason = $this->moveReason($f, $rules);
			if(!$reason) $reason = (string) $this->moveFileAllowed($page, $to, $f);
			if($reason) { $fail($f, $reason); continue; }
			$current = null;
			$how = isset($options['resolve'][$basename]) ? $options['resolve'][$basename] : '';
			if($rules['maxFiles'] === 1) {
				if(count($moved)) { $fail($f, __('This field holds one file', __FILE__)); continue; }
				if(count($dst)) {
					$current = $dst->first();
					if($how === 'swap') {
						$why = $this->moveReason($current, $back);
						if($why) { $fail($f, sprintf(__('No swap: %s', __FILE__), $why)); continue; }
					} else if($how !== 'replace') {
						$fail($f, __('This field holds one file: replace it or swap them', __FILE__));
						continue;
					}
				}
			} else if($rules['maxFiles'] > 1 && count($dst) >= $rules['maxFiles']) {
				$fail($f, sprintf(__('No room: this field holds %d files at most', __FILE__), $rules['maxFiles']));
				continue;
			}
			$srcIndex = 0;
			foreach($src as $item) { if($item === $f) break; $srcIndex++; }
			$wasTemp = $f->isTemp();
			// out of the source without the unlink that remove() and delete() queue for the save
			$src->removeQuietly($f);
			$new = $this->moveRetype($f, $dst);
			$this->moveMeta($new, isset($options['meta'][$basename]) ? $options['meta'][$basename] : array(), $rules['tags']);
			if($current) {
				if($how === 'swap') {
					$dst->removeQuietly($current);
					$back2 = $this->moveRetype($current, $src);
					$this->moveInsert($src, $back2, $srcIndex);
					$result['swapped'][] = array('hash' => $back2->hash, 'basename' => $back2->basename);
				} else {
					$dst->delete($current);
				}
			}
			$this->moveInsert($dst, $new, $index < 0 ? -1 : $index + count($moved));
			if($wasTemp) $dst->isTemp($new, true);
			if($rules['image'] && $new instanceof Pageimage) $this->moveFit($new, $rules);
			$moved[] = $new;
			$result['moved'][] = array('hash' => $new->hash, 'basename' => $new->basename);
		}
		if(count($moved)) {
			$page->trackChange($from->name);
			$page->trackChange($to->name);
			$page->save($from->name);
			$page->save($to->name);
			$this->filesMoved($page, $from, $to, $moved);
		}
		$page->of($of);
		$result['ok'] = count($moved) > 0;
		if(!$result['ok'] && !$result['message']) $result['message'] = __('Nothing was moved', __FILE__);
		return $result;
	}

	/**
	 * Why a file may not move to the field: '' when it may (hook after to refuse, return the reason)
	 *
	 * @param Page $page
	 * @param Field $to
	 * @param Pagefile $file
	 * @return string
	 *
	 */
	public function ___moveFileAllowed(Page $page, Field $to, Pagefile $file) {
		return '';
	}

	/**
	 * Called after files moved and both fields were saved (InputfieldFile::fileAdded does not run)
	 *
	 * @param Page $page
	 * @param Field $from
	 * @param Field $to
	 * @param Pagefile[] $moved The files as they are in `$to` now
	 *
	 */
	public function ___filesMoved(Page $page, Field $from, Field $to, array $moved) {
	}

	/**
	 * What a field accepts, as its upload does
	 *
	 * @param Page $page
	 * @param Field $field In the page's template context
	 * @return array
	 *
	 */
	protected function moveRules(Page $page, Field $field) {
		/** @var FieldtypeFile $type */
		$type = $field->type;
		$ext = $type->getValidFileExtensions($field);
		$inputfield = $field->getInputfield($page);
		$rules = array(
			'extensions' => array_values($ext['valid']),
			'maxFiles' => (int) $field->get('maxFiles'),
			'image' => $type instanceof FieldtypeImage,
			'tags' => (bool) $field->get('useTags'),
			'minWidth' => 0, 'minHeight' => 0, 'maxWidth' => 0, 'maxHeight' => 0, 'maxReject' => false, 'byAspect' => false,
		);
		if($rules['image'] && $inputfield) {
			foreach(array('minWidth', 'minHeight', 'maxWidth', 'maxHeight') as $key) $rules[$key] = (int) $inputfield->get($key);
			$rules['maxReject'] = (bool) $inputfield->get('maxReject');
			$rules['byAspect'] = (bool) $inputfield->get('dimensionsByAspectRatio');
		}
		return $rules;
	}

	/**
	 * Why a file does not fit the rules ('' when it does): InputfieldImage::fileAdded's checks
	 *
	 * @param Pagefile $f
	 * @param array $rules From moveRules()
	 * @return string
	 *
	 */
	protected function moveReason(Pagefile $f, array $rules) {
		$ext = strtolower($f->ext());
		if(!in_array($ext, $rules['extensions'], true)) {
			return sprintf(__('This field does not take .%s files', __FILE__), $ext);
		}
		if(!$rules['image'] || $ext === 'svg') return '';
		list($w, $h) = $this->moveSize($f);
		if(!$w) return __('Not an image this field can show', __FILE__);
		$portrait = $rules['byAspect'] && $w < $h;
		$minW = $portrait ? $rules['minHeight'] : $rules['minWidth'];
		$minH = $portrait ? $rules['minWidth'] : $rules['minHeight'];
		if(($minW && $w < $minW) || ($minH && $h < $minH)) {
			return sprintf(__('Smaller than this field takes (%s)', __FILE__), "{$minW}×{$minH}");
		}
		$maxW = $portrait ? $rules['maxHeight'] : $rules['maxWidth'];
		$maxH = $portrait ? $rules['maxWidth'] : $rules['maxHeight'];
		if($rules['maxReject'] && (($maxW && $w > $maxW) || ($maxH && $h > $maxH))) {
			return sprintf(__('Larger than this field takes (%s)', __FILE__), "{$maxW}×{$maxH}");
		}
		return '';
	}

	/**
	 * Width and height of a file that may be an image
	 *
	 * @param Pagefile $f
	 * @return array
	 *
	 */
	protected function moveSize(Pagefile $f) {
		if($f instanceof Pageimage) return array((int) $f->width, (int) $f->height);
		$info = @getimagesize($f->filename);
		return $info ? array((int) $info[0], (int) $info[1]) : array(0, 0);
	}

	/**
	 * The file as an item of the target field: the same object between fields of one kind, else a
	 * Pageimage or Pagefile on the same file with its data (a Pageimages takes only Pageimages)
	 *
	 * @param Pagefile $f
	 * @param Pagefiles $dst
	 * @return Pagefile
	 *
	 */
	protected function moveRetype(Pagefile $f, Pagefiles $dst) {
		$toImages = $dst instanceof Pageimages;
		if($toImages === ($f instanceof Pageimage)) {
			$f->setPagefilesParent($dst);
			return $f;
		}
		// an image becoming a plain file leaves no sized copies behind
		if($f instanceof Pageimage) $f->removeVariations();
		/** @var Pagefile $new the path is in the page's files directory: no copy */
		$new = $toImages ? $this->wire(new Pageimage($dst, $f->filename)) : $this->wire(new Pagefile($dst, $f->filename));
		foreach($f->getArray() as $key => $value) {
			if($key === 'basename' || $key === 'formatted' || $key === 'hash') continue;
			$new->set($key, $value);
		}
		$new->filedata($f->filedata());
		// sleepFile() stamps new items with now and the current user: this one keeps its own
		$new->isNew(false);
		return $new;
	}

	/**
	 * Unsaved description and tags the client sent with the file
	 *
	 * @param Pagefile $f
	 * @param array $meta `description`, `description<language id>`, `tags`
	 * @param bool $useTags The target field has tags
	 *
	 */
	protected function moveMeta(Pagefile $f, array $meta, $useTags) {
		$sanitizer = $this->wire()->sanitizer;
		$languages = $this->wire()->languages;
		foreach($meta as $key => $value) {
			if(!is_string($value)) continue;
			if($key === 'tags') {
				if($useTags) $f->tags = $sanitizer->text($value);
			} else if($key === 'description') {
				$f->set('description', $sanitizer->textarea($value));
			} else if(preg_match('/^description(\d+)$/', (string) $key, $m) && $languages && $languages->get((int) $m[1])->id) {
				$f->set("description$m[1]", $sanitizer->textarea($value));
			}
		}
		if(!$useTags && $f->tags) $f->tags = '';
	}

	/**
	 * Put an item at a position of a Pagefiles (-1 or past the end: last)
	 *
	 * @param Pagefiles $files
	 * @param Pagefile $f
	 * @param int $index
	 *
	 */
	protected function moveInsert(Pagefiles $files, Pagefile $f, $index) {
		$before = $index >= 0 && $index < count($files) ? $files->eq($index) : null;
		if($before) $files->insertBefore($f, $before);
		else $files->add($f);
	}

	/**
	 * Resize an image over the field's maximum size, as InputfieldImage::fileAdded() does an upload
	 *
	 * @param Pageimage $image
	 * @param array $rules
	 *
	 */
	protected function moveFit(Pageimage $image, array $rules) {
		if($image->ext() === 'svg' || $rules['maxReject']) return;
		list($w, $h) = $this->moveSize($image);
		$portrait = $rules['byAspect'] && $w < $h;
		$maxW = $portrait ? $rules['maxHeight'] : $rules['maxWidth'];
		$maxH = $portrait ? $rules['maxWidth'] : $rules['maxHeight'];
		if(!(($maxW && $w > $maxW) || ($maxH && $h > $maxH))) return;
		$files = $this->wire()->files;
		$image->removeVariations();
		$sized = $image->size($maxW, $maxH, array('cropping' => false));
		if($sized->filename != $image->filename) {
			$files->unlink($image->filename);
			$files->rename($sized->filename, $image->filename);
		}
		$image->getImageInfo(true);
	}
}

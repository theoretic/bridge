<?php namespace ProcessWire;

/**
 * BridgeAccessRules
 *
 * The rule list of BridgeAdminAccessControl: what a rule is, which rules are allowed and how the
 * list goes to and from the module's config. It decides nothing about a page: the module's
 * verdict() does.
 *
 * A rule is array('role' => int, 'page' => int, 'mode' => 'allow'|'deny', 'inherit' => bool).
 * One rule per role and page. A rule on one of the four core top-level admin items (a menu rule)
 * is always a deny with inherit. Any other page under the admin root is not a target.
 *
 * Original work, MIT.
 */
class BridgeAccessRules extends Wire {

	const modeAllow = 'allow';
	const modeDeny = 'deny';

	/**
	 * The four core top-level admin items, id => name: both are install constants, and the core
	 * itself hardcodes the names (`page/`, `page/list/`). An item that matches only one of the two
	 * is not a core menu.
	 *
	 */
	const coreMenuNames = array(3 => 'page', 22 => 'setup', 21 => 'module', 28 => 'access');

	/**
	 * @var array List of rules
	 */
	protected $rules = array();

	/**
	 * @var array|null id => Page (coreMenus())
	 */
	protected $coreMenus = null;

	/**
	 * @var array Role id => may it carry rules (roleUsable())
	 */
	protected $roleUsable = array();

	/**
	 * Take the rules from the module's config; a malformed entry is left out
	 *
	 * Refusals are add()'s job: a rule of a role deleted since is kept here, ignored by forRoles()
	 * and pruned by toConfig().
	 *
	 * @param array $config The module's config (key `rules`)
	 * @return $this
	 *
	 */
	public function fromConfig(array $config) {
		$this->rules = array();
		$list = isset($config['rules']) && is_array($config['rules']) ? $config['rules'] : array();
		foreach($list as $rule) {
			if(!is_array($rule)) continue;
			$role = isset($rule['role']) ? (int) $rule['role'] : 0;
			$page = isset($rule['page']) ? (int) $rule['page'] : 0;
			$mode = isset($rule['mode']) ? (string) $rule['mode'] : '';
			if($role < 1 || $page < 1 || !$this->modeValid($mode)) continue;
			$this->rules[] = array('role' => $role, 'page' => $page, 'mode' => $mode, 'inherit' => !empty($rule['inherit']));
		}
		return $this;
	}

	/**
	 * All rules, indexed from 0 (remove() takes these indexes)
	 *
	 * @return array
	 *
	 */
	public function rules() {
		return $this->rules;
	}

	/**
	 * The rules of the given roles; a role that no longer exists, superuser and guest carry none
	 *
	 * @param array $roleIds
	 * @return array
	 *
	 */
	public function forRoles(array $roleIds) {
		$roleIds = array_flip(array_map('intval', $roleIds));
		$out = array();
		foreach($this->rules as $rule) {
			if(isset($roleIds[$rule['role']]) && $this->roleUsable($rule['role'])) $out[] = $rule;
		}
		return $out;
	}

	/**
	 * Add a rule; one for the same role and page is replaced
	 *
	 * @param array $rule Keys role, page, mode, inherit (default true)
	 * @return array The rule as stored (a menu rule comes back as deny + inherit)
	 * @throws WireException When the rule is refused, with the reason
	 *
	 */
	public function add(array $rule) {
		$roleId = isset($rule['role']) ? (int) $rule['role'] : 0;
		$pageId = isset($rule['page']) ? (int) $rule['page'] : 0;
		$mode = isset($rule['mode']) ? (string) $rule['mode'] : '';
		$inherit = isset($rule['inherit']) ? (bool) $rule['inherit'] : true;
		if(!$this->roleUsable($roleId)) {
			throw new WireException($this->_('A rule needs an existing role other than superuser and guest.'));
		}
		$page = $this->wire()->pages->get($pageId);
		if(!$page->id) throw new WireException($this->_('The page of the rule does not exist.'));
		if(!$this->modeValid($mode)) throw new WireException($this->_('A rule either allows or denies.'));
		if(isset($this->coreMenus()[$pageId])) {
			$mode = self::modeDeny;
			$inherit = true;
		} else if(!$this->targetValid($page)) {
			throw new WireException($this->_('This page cannot have a rule: admin pages other than the four main menus and the trash are not targets.'));
		}
		$stored = array('role' => $roleId, 'page' => $pageId, 'mode' => $mode, 'inherit' => $inherit);
		foreach($this->rules as $index => $existing) {
			if($existing['role'] === $roleId && $existing['page'] === $pageId) {
				$this->rules[$index] = $stored;
				return $stored;
			}
		}
		$this->rules[] = $stored;
		return $stored;
	}

	/**
	 * Remove the rule at the index rules() gives
	 *
	 * @param int $index
	 * @return bool Was there one?
	 *
	 */
	public function remove(int $index) {
		if(!isset($this->rules[$index])) return false;
		array_splice($this->rules, $index, 1);
		return true;
	}

	/**
	 * Remove every rule on a page
	 *
	 * @param int $pageId
	 * @return int How many were removed
	 *
	 */
	public function removePage(int $pageId) {
		$kept = array_values(array_filter($this->rules, function($rule) use($pageId) {
			return $rule['page'] !== $pageId;
		}));
		$removed = count($this->rules) - count($kept);
		$this->rules = $kept;
		return $removed;
	}

	/**
	 * The rules for the module's config: a rule of a deleted role or page is pruned here
	 *
	 * @return array Key `rules`
	 *
	 */
	public function toConfig() {
		$pages = $this->wire()->pages;
		$out = array();
		foreach($this->rules as $rule) {
			if($this->roleUsable($rule['role']) && $pages->get($rule['page'])->id) $out[] = $rule;
		}
		return array('rules' => $out);
	}

	/**
	 * The core top-level admin items, by id and name under the admin root
	 *
	 * @return array id => Page, in the order Pages, Setup, Modules, Access
	 *
	 */
	public function coreMenus() {
		if($this->coreMenus !== null) return $this->coreMenus;
		$pages = $this->wire()->pages;
		$adminRoot = (int) $this->wire()->config->adminRootPageID;
		$this->coreMenus = array();
		foreach(self::coreMenuNames as $id => $name) {
			$page = $pages->get($id);
			if($page->id && (int) $page->parent_id === $adminRoot && $page->name === $name) $this->coreMenus[$id] = $page;
		}
		return $this->coreMenus;
	}

	/**
	 * May this role carry rules: it exists and is neither superuser nor guest
	 *
	 * @param int $roleId
	 * @return bool
	 *
	 */
	protected function roleUsable(int $roleId) {
		if(isset($this->roleUsable[$roleId])) return $this->roleUsable[$roleId];
		$config = $this->wire()->config;
		$usable = false;
		if($roleId > 0 && $roleId !== (int) $config->superUserRolePageID && $roleId !== (int) $config->guestUserRolePageID) {
			$role = $this->wire()->roles->get($roleId);
			$usable = $role instanceof Role && $role->id > 0;
		}
		return $this->roleUsable[$roleId] = $usable;
	}

	/**
	 * Is it a mode a rule can have?
	 *
	 * @param string $mode
	 * @return bool
	 *
	 */
	protected function modeValid($mode) {
		return $mode === self::modeAllow || $mode === self::modeDeny;
	}

	/**
	 * May a page rule target this page: not the trash, nothing at or under the admin root
	 * (rootParent() of a page under the admin root is the admin root, and so is its own)
	 *
	 * @param Page $page
	 * @return bool
	 *
	 */
	protected function targetValid(Page $page) {
		$config = $this->wire()->config;
		if($page->id === (int) $config->trashPageID) return false;
		return (int) $page->rootParent()->id !== (int) $config->adminRootPageID;
	}
}

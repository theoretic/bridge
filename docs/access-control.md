# Admin access control

`BridgeAdminAccessControl` is a Bridge extension that narrows, per role, what a user may do in the
page tree and which of the admin's main menus they may reach. It grants nothing: templates, roles
and permissions stay the only place where access is given.

## Model

- **A rule** belongs to one role and one page: allow or deny, with or without the page's descendants
  (inherit). One rule per role and page; a newer one replaces it.
- **Per role, the nearest rule decides**: the rule on the page, else the closest ancestor's rule
  with inherit. No rule means allow, so a role without rules is unchanged and installing the module
  changes nothing.
- **An allow rule below a deny is an exception** within that role. To deny a role everything by
  default, deny the home page with inherit and allow the branches it may have.
- **Across a user's roles, any deny wins.** An exception held by one role does not override another
  role's deny on the same page.
- **Pass-through.** A denied page with an allowed page below it (one named by an allow rule that no
  role of the user denies) stays in the tree as the way there: listable and viewable, nothing else.
  A deny without inherit leaves the children allowed, but without an allow rule below it the denied
  page itself is not a pass-through.
- **Rules never widen.** A page the core does not let the role edit stays not editable under an
  allow rule. Enforcement only ever turns the core's yes into a no.
- **Superusers and the guest role** are exempt and cannot carry rules.
- **Menu rules.** The four core top-level admin items can be denied: Pages, Setup, Modules and
  Access. Each is recognised by its id and its name under the admin root. A menu rule is always a
  deny with inherit, and covers every screen under that item. Users, Roles and Permissions are
  under Access.
- **Other admin pages are not targets.** Neither the admin root, the Login and Profile pages, the
  trash, the children of the four items, nor custom or third-party top-level items can have a rule.
  Custom top-level items are never hidden or refused. A custom item placed under one of the four
  follows that item's rule. A deny on the home page says nothing about admin pages.

## The editor

The rules are edited on the module's own configuration screen, Modules > Bridge admin access
control (`{admin}module/edit?name=BridgeAdminAccessControl`). It is the core's module editor, so it
is open to whoever has the core's `module-admin` permission. A default install has no page for that
permission: only superusers reach the screen until a site creates it. There is no menu item, no
Process page and no permission of the module's own.

There is one fieldset per role, except `superuser` and `guest`; a role without rules starts
collapsed.

- **Admin menus**: Pages, Setup, Modules and Access, ticked when allowed. A menu that is not ticked
  is denied to the role, with everything under it. Custom top-level items are not offered.
- **Page rules**: a table of the role's rules (page, allow or deny, the page only or also what is
  below it), each with a Remove box.
- **Add rule**: a page picker, Deny or Allow (Deny by default) and "Below the page" (on by default).
  The picker also lists Admin and Trash; those, like every other page that cannot be a target, are
  refused with a message when saving, and that role's rules stay as they were.

A user with `module-admin` who is not a superuser cannot deny Modules to one of their own roles:
the save is refused with a message and that role's rules stay as they were, so nobody locks
themselves out of this screen. Superusers have no rules, so this never applies to them.

The rules take effect with the save, on every signed-in user's next request.

## Storage

The rules are the module's configuration, one row read with the module and exported with a site
profile; there is no table.

- `rules`: a list of `role` (id), `page` (id), `mode` (`allow` or `deny`), `inherit` (bool).
- `rulesVersion`: a stamp, bumped on every change of the rules.
- `apiGuard`: the guard on saves in admin requests, on by default.

A rule of a deleted role is ignored and pruned on the next save. Deleting a page in an admin
request removes its rules.

## Covered

Every admin screen asks the page whether the user may list, view, edit, add, move, sort, clone,
trash or delete it, so the page tree, the editor and the page actions follow the rules. Screens
built on a find (search, autocomplete, the live search, the lister) get the same limits through
their selectors (below). Requests to a screen under a denied menu are refused, and the item leaves the
menu. With Pages denied, Bridge shows no page tree drawer button; its other drawers stay.

The hooks are the core's, so the rules hold for a user on another admin theme; the instant menu
update is Bridge's: on another theme a signed-in user's menu changes at their next login, while
the refusal of the screen applies at once.

Under Bridge a change of the rules shows in a signed-in user's menu on their next page load, with
no new login: the extension adds the rules' stamp to the theme's menu cache key
(`AdminThemeBridge::navCacheKey()`).

### Find selectors

The search, the autocomplete and the live search pass their selector through the hookable
`ProcessPageSearch::findReady`, and the lister builds its own in `ProcessPageLister::getSelector`.
The module appends one part per denied page, `R` being the id of that page. A superuser's selector
and that of a user without rules are left as they are.

| Rule | Appended |
|---|---|
| deny with inherit | `, id!=R, has_parent!=R` |
| deny without inherit | `, id!=R` |
| deny with inherit, allow with inherit on E below | `, rR=(id!=R, has_parent!=R), rR=(id=E), rR=(has_parent=E)` |
| deny with inherit, allow without inherit on E below | `, rR=(id!=R, has_parent!=R), rR=(id=E)` |
| deny with inherit on the home page | `, r1=(id!=1, has_parent!=1), r1=(id=2), r1=(has_parent=2)`, then any allow rules |

Groups of one name are alternatives; different names must all hold, so two denied pages do not
open each other. In a request the group name is not `rR` as written in the table but `rR_<16 random
hex digits>`, new on every request, so a filter a user posts cannot join the group (a `rR=(id>0)`
of their own is a separate group that must hold as well). An allow rule counts only when no role of
the user denies its page. A pass-through
page has no row in these results, only in the tree. A deny on the home page leaves the admin pages
findable (2 is the admin root), so Access > Users keeps its list.

### Guard on saves

Before-hooks on `Pages::saveReady`, `Pages::saveFieldReady`, `Pages::trashReady`,
`Pages::restoreReady` and `Pages::deleteReady` throw `WirePermissionException` for a denied or
pass-through page, during an admin request, for a user with rules. So a module or hook that saves a denied page on such a user's behalf is stopped too;
a save of an allowed page that cascades into a denied one is stopped as well. A page being added is
judged by the rules' verdict on its parent. A move counts as adding under the new parent: the page
must be allowed where it was, and the new parent and the page in its new place must be allowed, so
the page editor's Parent field, which the core saves without asking the new parent, cannot put a
page into a denied branch. Going to the trash is judged by the old place only; a page coming back
from it is judged by the new one, before the core clears its trash status, so a refused restore
leaves it in the trash as it was. The setting `apiGuard` (Guard saves in admin requests, on by
default) turns it off. `Pages::saveField()` and `Pages::saveFields()` are stopped too: they fire
`Pages::saveFieldReady`, not `Pages::saveReady`. A save made with the core's `noHooks` option passes
no hook at all, so the guard does not see it.

## Not covered

- The front end: the module loads only on admin requests.
- Files under `site/assets/files/`: the web server serves them; only `$config->pagefileSecure`
  gates them, unchanged.
- Fields: there is no field-level access.
- Option lists of page reference fields (select, checkboxes, asmSelect,
  `InputfieldPage::getSelectablePages`, deliberately not hooked): a reference is not access, and
  dropping an option would lose a stored value on save, since a select posts only what it lists.
  The autocomplete and page-list pickers follow the rules anyway, so a denied page cannot be newly
  picked there.
- Admin pages below the four menu items as targets of their own, and the trash page.
- Rules per user: rules belong to roles.

## Known limits

- The child count of a row in the page tree comes from the core and is not filtered: a parent shows
  its number of children even when some are denied and left out of the list.
- A page in the trash is no longer under its old parent, so a deny inherited from that parent does
  not reach it. A rule on the page itself still does.
- A lister bookmark saved by a user with rules stores the selector with the appended clause (the
  core's bookmarks read `getSelector()`). The clause stays in the bookmark after the rules change,
  and the current rules are appended on top of it under another group name, so both must hold. A
  stale bookmark can only show less than the current rules allow (a page allowed since it was saved
  stays out of it until it is saved again), never more.
- The visit history of the Bridge drawer keeps entries recorded before a denial. A denied visit is
  never recorded; an older row keeps its title and its link, and the link gives the denial. The
  drawer's Clear button empties it.

## Checking it

On a sandbox, `tools/sandbox-site.sh` installs the module and makes the users and roles the checks
use: `acl` with the role `acl-editor`, `acl2` with `acl-editor` and `acl-restricted`.

`tools/sandbox-acl.php <sandbox> <preset>` writes a named set of rules and prints it.

| Preset | Rules |
|---|---|
| `clear` | none |
| `deny-tree-modules` | `acl-editor`: deny `/bridge-tree/` with inherit, deny Modules |
| `deny-pages` | `acl-editor`: deny Pages |
| `deny-all-menus` | `acl-editor`: deny Pages, Setup, Modules and Access |
| `two-roles` | `acl-restricted`: deny `/bridge-native/` with inherit; `acl-editor`: allow `/bridge-native/` |

`tools/acl-check.js` drives the whole flow in a browser: rules set on the configuration screen, an
open session that gets them on its next load, refusals by direct URL and by XHR, the search, the
lister and the autocomplete, an exception, a forged lister filter, a custom top-level item under
four denied menus, two roles, another admin theme, and the cleanup. It logs in as four sandbox
users and changes the rules, so run it alone, with the sandbox server up and no rules set.
`tools/ci.sh` runs it too.

Git Bash:

```bash
php tools/sandbox-acl.php sandbox/atispro deny-tree-modules
php tools/sandbox-acl.php sandbox/atispro clear

eval "$(php tools/lib/sandbox-ids.php sandbox/atispro | grep -E '^[A-Z_]+=[0-9]+$')"
export TREE_ID NATIVE_ID FIXTURE_ID AUTO_ID CUSTOM_MENU_ID
MSYS_NO_PATHCONV=1 SANDBOX=sandbox/atispro node tools/acl-check.js <playwright-core dir> chromium
```

PowerShell:

```powershell
php tools/sandbox-acl.php sandbox/atispro deny-tree-modules
php tools/sandbox-acl.php sandbox/atispro clear

php tools/lib/sandbox-ids.php sandbox/atispro | Select-String '^[A-Z_]+=\d+$' | ForEach-Object { $k, $v = $_.Line -split '='; Set-Item "env:$k" $v }
$env:SANDBOX = 'sandbox/atispro'; node tools/acl-check.js <playwright-core dir> chromium
```

`PHP=<php>` (PowerShell: `$env:PHP = '<php>'`) names the PHP binary when `php` is not on the path.
The module's contract tests are those of any extension ([extensions.md](extensions.md), section 6).

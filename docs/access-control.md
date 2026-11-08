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
their selectors. Requests to a screen under a denied menu are refused, and the item leaves the
menu. With Pages denied, Bridge shows no page tree drawer button; its other drawers stay.

The hooks are the core's, so the rules hold for a user on another admin theme; the instant menu
update is Bridge's.

## Not covered

- The front end: the module loads only on admin requests.
- Files under `site/assets/files/`: the web server serves them; only `$config->pagefileSecure`
  gates them, unchanged.
- Fields: there is no field-level access.
- Option lists of page reference fields (select, checkboxes, asmSelect): a reference is not access,
  and dropping an option would lose a stored value on save.
- Admin pages below the four menu items as targets of their own, and the trash page.
- Rules per user: rules belong to roles.

## Known limits

- The child count of a row in the page tree comes from the core and is not filtered: a parent shows
  its number of children even when some are denied and left out of the list.
- A page in the trash is no longer under its old parent, so a deny inherited from that parent does
  not reach it. A rule on the page itself still does.

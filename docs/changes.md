# Changed elsewhere (1.6.0)

When a user comes back to an admin tab, the theme asks the server what changed since the screen
opened, in another tab, another browser or on another machine, and shows a dialog when something
the screen depends on was changed. The setting is Features > Warn about changes made elsewhere
(on by default).

## What warns where

| Screen | Warns when, since it opened... |
|---|---|
| Page edit (users, roles, permissions and other page types too) | the page's template changed (settings, name, family, files, access); a field on the page changed, also as an override on this template; fields were added to, removed from or reordered in the template; the page was saved by someone else, trashed, deleted, moved or renamed; any of these on a repeater or FieldsetPage item template inside the form, at any depth |
| Page add | the chosen template or the parent's template changed |
| Field edit | the field was saved, renamed or deleted |
| Template edit | the template, its fields or a field's override on it changed |
| Everything else (page tree, Lister, lists, module settings) | nothing: the tree drawer already refreshes on focus, and module settings keep no change trail |

Saves made in the same tab never warn. Saves by the same user in another tab do ("you, in another
tab"). Concurrent page edits only warn: nothing is locked.

## The dialog

One block per changed object, newest first: what (the field, template or page, with a link to the
field or template editor; Ctrl+click opens it in a new tab), who and when, and a table of the
settings before and after. Where it can tell, a line says what the change means here: types no
longer allowed for uploads, or which of the form's unsaved fields another save may be overwritten
by. Reload page asks first when the form has unsaved changes; Keep editing, Escape, the close
button and a click beside the dialog close it, and the changes stay listed in a banner under the
headline until the page reloads.

## Who sees what

- The check needs a logged-in user. The server re-checks everything; the screen's snapshot is
  only a list of ids to look at.
- Page edit: the page must still be editable. When it is not (template access changed, the page
  moved or deleted), the dialog says only "You can no longer save this page". A page the user may
  not list says nothing. Page add needs `page-edit`, field edit `field-admin`, template edit
  `template-admin`.
- Users with `field-admin` (for fields and overrides) or `template-admin` (for templates and
  their fields) see every changed setting with its values. Others see the values of labels,
  descriptions, extensions, max files, required, column width, collapsed and the inputfield type;
  code-like settings (show and required conditions, selectors, code, hooks, role ids) by name
  only; the rest as a count ("Other settings changed").
- The user who saved is shown by name.

## The change log

Fields, templates and fieldgroups have no "modified" time in the core, so their saves are written
to the table `bridge_changes`: one row per change with the time, the user, what changed and the
old and new values (at most 4 KB per row, long values cut). Page saves come from the admin's
page editor, the tree's moves, trash and deletes, and one-field saves such as uploads. The table
is made when the theme is installed, and again when it is missing (a plain-copy upgrade);
uninstalling the theme drops it.

- **Whichever admin theme the saving user has**: the hooks are bound on every admin request while
  the theme is installed, so a colleague on Uikit changing a field still warns a Bridge user.
- **Retention**: rows older than Features > Days the change log keeps (default 30) go, at most once
  an hour, when a row is written.
- **Off**: with the setting off nothing is written, no snapshot is printed and the runtime loads no
  check; the table and its rows stay until uninstall.

## Not covered

- **Saves outside the admin** (API scripts, migrations, cron, the command line, front-end
  editing) change fields and templates without a warning: the log is written on admin requests
  only. A page saved that way still shows as saved by someone else, from its `modified` time,
  without the details.
- **Module settings screens**, the page tree and lists show no dialog.
- **A tab that never loses focus** never asks: the check runs on the return to the tab only, not
  on a timer.

## For modules

The hook `AdminThemeBridge::changeDeps()` (on the extension surface, `docs/extensions.md` 3)
returns what the screen depends on (`screen`, `cursor`, `page`, `template`, `fieldgroup`,
`fields`, `templates`); a hook after it may add field or template ids, for a Process whose form
shows fields of other templates, or return null to print nothing.

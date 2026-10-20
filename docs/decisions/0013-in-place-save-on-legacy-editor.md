# ADR 0013: Save without reload as an enhancement of the upstream page editor

Status: accepted, 2026-10-15. Source: owner request 2026-10-15; PLAN.md lists save without reload
as the first user-visible win of the Phase 3 ProcessPageEdit, which ships it early here.

## Context

`ProcessPageEdit::processSave()` always saves, even when fields have errors. It then redirects with
302 to `edit?id=N&s=1&c=<changes>`. Notices and field errors travel in the session, and the
redirected GET renders the full editor.

The only AJAX save in core is `ProcessPageEdit::ajaxSave()`. A POST with `X-Requested-With`
reaches it, but it handles custom fields only, without name, status, template, parent or the
after-save actions.

Keeping the old form markup after a background save leaves it stale:
- file and image inputs are keyed by `md5(basename)`;
- repeater and PageTable states change on save;
- the publish buttons, the name, the URL preview and the View link change.

## Decision

- **Script:** `scripts/page-save.js`, loaded only for `ProcessPageEdit` outside modal windows.
  The `pageSaveInPlace` setting turns it off; it is on by default.
- **Submit:** it POSTs the real form with fetch: `FormData(form, submitter)`, no
  `X-Requested-With`, redirect followed. The server runs the normal save path.
- **Success:** a redirect back to the same editor URL with `s=1`. The response's form children,
  the rest of `#pw-content-body`, `#pw-content-head` and `#notices` replace the current ones.
  - The form element itself stays, so handlers bound to `.InputfieldForm` survive.
  - Inline scripts in the new content run again (`InputfieldSubmitDropdown.init`,
    `setupLanguageTabs`, `initPageEditForm`).
  - Then come the head-button copies, `legacy.initElement()` (`Inputfields.init` and `reloaded`)
    and `ProcessWireAdmin.setupNotices()`.
  - The active tab, scroll position, opened collapsed fields and focus are restored.
  - Change tracking is reset.
- **Classic submit kept for:** an after-submit action (Save + Exit / View / Add New / Next),
  Delete, a changed template, an upload in progress, the single-field editor, modal windows, and
  Shift+click on a save button.
  - Shift+click submits classically in the same tab: the browser's own Shift+submit would open
    a new window.
- **Fallbacks:**
  - no redirect (CSRF or landmark failure, server error, a hook that answered itself): the response
    is shown as it came, as on the other editors below. Until 0.8.5 the form was posted again
    classically, which saved twice when the first post had saved (a 500 after the save, a hook's
    200). Amended 2026-10-20 (audit B6);
  - no answer at all (a lost connection): a message, no second post, because the request may have
    reached the server; the user saves again knowingly;
  - a redirect elsewhere, or an exception while swapping: navigate to the response URL (the page
    is saved).
- **Events on `document`:** `pw-page-save` (cancelable; cancelling falls back to the classic save)
  and `pw-page-saved` (`detail.url`, `detail.changes`, `detail.errors`).

## Consequences

- **No server markup changes:** the conformance suite is unaffected; the script tag sits in the
  head.
- **Third-party fields:** a field whose JS initialises only on document ready, and not on
  `reloaded`, is not re-initialised after an in-place save. The setting and Shift+click are the
  escape hatches. `tools/page-save-check.js` covers the core field types in Firefox and Chromium.
- **Upstream dropdown race:** testing exposed a race in upstream main.js. The form Save button and
  its head copy share one dropdown menu, and a 1 s leave timer from one could close the menu just
  opened from the other. The theme now guards the fade of dropdown menus: no fade while the menu
  or any toggle of it is hovered (`ProcessWireAdminTheme.patchClickLeave`).

## Addendum 2026-10-16: other edit forms (milestone 3.8)

The same script, `scripts/page-save.js`, now saves other edit forms in place. The server prints it
for the Processes in `saveInPlaceProcess()`, under the same setting:
- ProcessPageEdit;
- by exact class: ProcessField, ProcessTemplate, ProcessModule, ProcessProfile, ProcessUser,
  ProcessRole, ProcessPermission.

The client knows each form by its id (`RULES`):

| Form | Save buttons (by name) | Key | Classic when |
|---|---|---|---|
| `ProcessFieldEdit` | `submit_save_field` | `id` | `#delete` checked |
| `ProcessTemplateEdit` | `submit` | `id` | `#delete` checked |
| `ModuleEditForm` | `submit_save_module` | `name` | Uninstall or Remove checked |
| `ProcessProfile` | `submit_save_profile` | none | |

Users, roles and permissions are ProcessPageEdit forms and follow the editor's rules. For them the
swap also runs `ProcessWireAdminTheme.setup.init()` again.

- **Only without jQuery:** these screens save in place only on pages without the legacy stack.
  Upstream's own scripts for them (ProcessField.js, ProcessTemplate.js and so on) bind once at
  document ready and would not set up the new markup.
- **Swapping:** a redirect back to the same screen (same path, and the same `id` or `name`) swaps
  `#pw-content-body`, the content head and the notices. Then the screen's inline scripts and its
  set-up run again (`scripts/setup.js`, `scripts/screens.js`), and the tab, open fields, scroll
  and focus are restored.
- **No second post:** a redirect elsewhere is followed. A response without a redirect is shown as
  it came (since 0.8.5 the page editor does the same): a response without a redirect may already
  have saved something, so it is never posted twice.
- **Always classic:** Save + Exit (button value `exit`) and Shift+click.
- **Events:** `pw-form-save` (cancelable) and `pw-form-saved` (`detail.form`, `detail.url`,
  `detail.errors`).
- **Coverage:** `tools/form-save-check.js` covers each screen.

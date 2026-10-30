# ADR 0019: Risky action warnings

Status: accepted, 2026-10-30 (owner decisions in the planning session of that day: every case of
tiers 1 and 2 below, the theme's own `window.confirm` calls moved to the same dialog, and the
setting off leaves the confirmations that already exist).

## Context

Some gestures in the admin destroy data that cannot be got back, and nothing asks first. The case
that started this is dropping a file onto a single-file or single-image field that already holds
one: the old item leaves the screen at once and is deleted at the next save. With the field's
overwrite setting it is deleted during the upload request itself
(`InputfieldFile::processInputAddFile()`, core 3.0.274 :987-999, saved by
`ProcessPageEdit::ajaxSave()`).

We swept the core Inputfield, Fieldtype and Process modules and the runtime for gestures that delete
or replace data. For each one we checked whether core already asks.

**Tier 1: lost for good, and core never asks**
1. A file or image for a single-file field that holds one, from a drop or the file chooser. It is
   deleted at save, or at once with overwrite on.
2. An upload into an overwrite field when a file of that name is already there. It is overwritten
   at once, and an image's variations go too (`removeVariations()`).
3. A drop on the big image of the image field's edit panel. That image is deleted at save
   (`replace_<id>`).
4. Save and Replace in the image editor (`ProcessPageEditImageSelect`). The original file is
   overwritten and its variations are made again.
5. Delete Checked in the variations window. The variations are deleted at once.
6. Uninstall in a module's settings (and Remove from the database for a module whose files are
   gone). The module's `___uninstall()` runs, and it may drop tables, fields, templates or pages.
7. A comment's status set to Delete. The comment is deleted at save.

**Tier 2: side effects that surprise**
8. Images moved into a plain file field (ADR 0018). The server drops their variations.
9. B&W, Sepia and Reduce 50% in an image's actions. Applied at save, they replace the original
   pixels.
10. Saving a published page under a new name while PagePathHistory is not installed. The old URL
    and those of its subpages stop working.
11. Trash in a tree item's extras, and a drop on the tree's Trash. The page leaves the site at once
    (restorable).
12. A new repeater item that has not been saved yet, removed after something was typed in it.

**Left alone:**
- Core already asks for these, with a form step or a confirm: the Delete tab, a template change,
  emptying the trash, removing Options, a field type change, fieldgroup changes, repeater
  "delete all", the role permission checkbox, the upload-in-progress save.
- These can still be undone before saving, or they only touch settings: the delete boxes of files
  and images (also all of them at once), Setup > Fields delete (unused fields only), page status,
  PageTable rows (they go to the trash), and page reference, tag, rich text and password fields.
- The browser draws `beforeunload` itself, so it cannot be styled.
- On a page with the legacy stack, core's `ProcessWire.confirm` takes the UIkit route; we leave it.

## Decision

- **A setting, Features > "Warn before risky actions" (`dangerWarn`), on by default.** It reaches
  the runtime as `ProcessWire.config.AdminThemeBridge.dangerWarn`. `pathHistory` says whether
  PagePathHistory is installed.
- **One dialog, `runtime/src/util/ask.ts`.** It is a native `<dialog class="pw-ask pw-ask-danger">`
  (`role=alertdialog`) with:
  - the title, with a warning icon;
  - what is lost and when, in words;
  - the names involved;
  - Cancel and OK. OK carries the action's verb (Replace, Delete, Uninstall, Move to trash) and is
    red.

  Cancel has the focus first; Esc and the backdrop cancel. The answer comes from the button's
  submit or Esc's `cancel` event, not only from `close`, because a page that is not being rendered
  gets that event late.
- **`util/danger.ts`** has two entry points, also exposed as `Bridge.confirm` / `Bridge.guard`,
  each returning a promise and taking callbacks for classic scripts:
  - `confirm()` always asks;
  - `guard()` asks only while the setting is on.

  Both load the dialog chunk on first use, so the entry chunk stays within its budget.
- **Core's gestures, `runtime/src/guards.ts`.** This lazy chunk is loaded only while the setting is
  on. It adds one capture listener on `window` per event type: `drop`, `change`, `click`,
  `submit`. A capture listener on `window` runs before every other handler: the runtime's on the
  field, and upstream's jQuery ones on a page with the legacy stack. So one rule covers both, and
  core code is never patched.
  - A match stops the event and asks. On OK the gesture is played again past the rules, once:
    - a drop: a new `DragEvent` with a `DataTransfer` of the same files;
    - a file input: a new `change`;
    - a click: `el.click()`;
    - a submit: `form.requestSubmit(submitter)`, so the in-place save and the save wait still see
      the button.
  - A select whose value already moved (a comment's status, an image action) gets the value it had
    before back on Cancel.
- **The runtime's own gestures ask inline** through `guard()`: the file move (8), the tree drop on
  Trash (11) and the repeater's new item (12).
- **The theme's earlier `window.confirm` calls now use the same dialog, whatever the setting.**
  These are the tree group's Trash and "unsaved changes" (now red), the upload-in-progress save,
  the Lister refresh, the role permission box, and the `ProcessWire.confirm` fallback on pages
  without the stack (`ProcessWireAdminTheme.confirm()` in the classic `main.js`). Their wording
  stays.

## Consequences

- With the setting off, `guards.ts` is not loaded and `guard()` says yes at once. The
  confirmations that already existed ask as before, in the new dialog.
- Name matching for overwrite (2) copies `WireUpload::validateFilename()` closely enough:
  lowercase, accents dropped, other characters to `_`, dots in the name to `_`. A name it gets
  wrong only means no warning.
- The replayed drop relies on `new DataTransfer()` with files (current Chromium, Firefox and
  Safari).
- The inline cases (8, 11 drop, 12) exist only on the native path; with the legacy stack, core's
  own scripts drive those widgets and nothing asks.
- There are no markup changes, so the conformance digests stay the same. The dialogs are covered
  by `tests/smoke.php` (setting, labels, listeners, chunks, CSS) and by `tools/native-check.js`:
  a single-image drop asks, Cancel has the focus, and Cancel keeps the image and uploads nothing.

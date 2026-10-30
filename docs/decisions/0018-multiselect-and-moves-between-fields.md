# ADR 0018: Multi-select, group drags, and moving files between fields

Status: accepted, 2026-10-30 (owner decisions in the planning session of that day).

## Context

The native lists sort one item at a time: file rows, image tiles (both `util/sortable.ts`) and the
page tree's Move (`fields/pagelist.ts`). Two requests:

1. **Multidrag.** Select several items of one kind, as in a file manager, and drag them together:
   sort files and images, move pages in the tree.
2. **Drag files and images between fields.** A page with several file or image fields should let
   items move from one to another by dragging, as it lets them be sorted inside one. Kinds mix
   where the target accepts them: an image into a file field, a file that is an image into an image
   field.

Constraints: `wire/` is not touched; upstream's markup and requests stay (`sort_<field>_<hash>`,
`delete_…`, `?InputfieldFileAjax`, `page/sort/` with one `id`); the runtime entry has no room, so
everything new is lazy.

Facts that shaped the design (core 3.0.274):
- All file fields of a page share its files directory (`PagefilesManager`). A file can change
  field without being copied, keeping its name, its variations and its item id (`file_<md5 of the
  basename>`).
- `Pagefiles::remove()` and `delete()` both queue an unlink for the page save. Moving with
  `add()` to the target and `delete()` from the source deletes the file both now point to. A move
  takes `WireArray::removeQuietly()` and `Pagefile::setPagefilesParent()` instead.
- A `Pageimages` takes only `Pageimage` items: a file entering an image field becomes a
  `Pageimage` on the same path, its data copied, `isNew(false)` so `sleepFile()` keeps its created
  date and user.
- `Pagefiles::add()` checks neither extensions nor `maxFiles`; only the upload does
  (`WireUpload`, `InputfieldFile::processInput()`, `InputfieldImage::fileAdded()`).
- `ProcessPageSort` moves one page per request; a second request whose order is already saved
  answers with an empty body.
- `$config->wireInputArrayDepth` is 1: POST arrays nested deeper are dropped.

## Decision

### Selection (`runtime/src/util/selection.ts`)

The same gestures in all three places, with the mouse or a pen:
- **Ctrl+click** (Cmd on a Mac) toggles an item, **Shift+click** selects the range from the last
  one toggled, a **rubber band** from the list's background selects what it touches (the page tree:
  also from a row's blank part). These clicks do nothing else.
- A **plain click keeps its upstream meaning** (the image editor, opening a tree row) and clears
  the selection. A press on an unselected item clears it too, so a drag that follows moves that
  item alone; a press on a selected item keeps it for the drag.
- A press outside clears it; **Esc** clears; **Ctrl+A** selects all of the list last pressed.
- Touch keeps its scroll and single drags: no multi-select on touch in this version.

Items carry `pw-selected`; the count is announced in a polite live region.

### Group drags (`util/sortable.ts`)

`group(item)` returns the items that travel with the pressed one. They are hidden while it moves
(badged with the count) and land around it at the drop in their original order: one block. Esc and a
cancelled pointer restore the order. The window scrolls near its edges.

In the page tree, Move on a selected row moves the selection (`fields/pagelist-move.ts`, split out
of the tree's chunk). Rows inside a selected row are never selected on their own. Each page is
posted on its own, as upstream's endpoint takes one; an empty answer is a success; a page the
server refuses goes back to where it was, and the messages are shown once.

Several selected tree rows (0.14.1, owner review of 0.14.0): a menu per row made the selection
useless, since a row's own menu acts on that row alone. So with two or more rows selected:
- adjacent selected rows draw **one band**, inside the branch's box (the deepest branch scrolls,
  so anything reaching past its sides is cut off);
- the rows' own menus give way to **one menu for the selection**, shown on hovering any selected
  row, after the titles and centred on the band. It holds every action of the rows except View
  (several pages cannot be viewed at once), each applying to every row that has it;
- AJAX extras are posted row by row as from the rows' own menus; actions that open a page open the
  rows in turn in the native dialog (a Next button; browsers allow one new tab per click, so tabs
  are not an option);
- Move from that menu arms the selection: a press on any selected row drags them all.

### Moves between fields: when and where

- **Saved at the drop**, like uploads and tree moves: one request to the page editor moves the
  files and saves both fields. No pending state to reconcile with the form; Crop, Focus and
  Variations work on the moved items at once. Undo is dragging them back.
- **Same page only**: fields of the edited page, or of one repeater item (its own page). Between a
  page and a repeater item the files directories differ and a physical copy would be needed; not
  in this version.

### Moves between fields: what the target accepts

**What an upload of the file into the target would accept**: its extensions, its `maxFiles`, an
image field's minimum size (and maximum with `maxReject`; without it the image is resized as an
upload is). Files that do not fit stay where they are.

The client checks extensions and room from the target's upload element and shows it while
dragging (`pw-drop-ok`, `pw-drop-partial`, `pw-drop-no`). When anything is not a plain move, the
drop asks first, item by item: moves, stays (and why), and for a **single-file target holding a
file: Replace (the old one is deleted), Swap (it goes to the source field, when that accepts it) or
Leave**. The server checks again; its answer decides.

Unsaved description and tags of a moved item travel with it. Tags are dropped when the target has
none. Custom item fields travel in `filedata`; their unsaved edits do not (this version).

### The server (`lib/AdminThemeBridgeFiles.php`)

A hook before `ProcessPageEdit::ajaxSave` takes requests marked `bridgeFilesMove=1`: core's own
checks (demo, locked, editable page and fields, CSRF) and the move. Hookable:
`___moveFiles(Page, Field $from, Field $to, array $basenames, array $options)`,
`___moveFileAllowed(Page, Field $to, Pagefile)` (a veto), `___filesMoved(…)` (after the save;
`InputfieldFile::fileAdded` does not run for a move). Unsaved metadata comes as JSON, since core
keeps POST arrays one level deep.

The client renders the moved items from the target field's own markup
(`?field=<name>&reloadInputfieldAjax=<name>`, as `Inputfields.reload()` asks), so repeater items get
their name suffixes from core.

## Consequences

- New lazy chunks: `selection` (shared by the file, image and tree widgets), `files-move` (loaded at
  the first drag of a file or image) and `pagelist-move` (loaded when the pointer first reaches the
  tree). The runtime entry is unchanged.
- The single image field gets a sortable too: one tile does not sort, but it can leave the field.
- A file moved from an image field to a file field loses its image variations.
- A third-party hook on `InputfieldFile::fileAdded` does not see moves; `filesMoved` is the hook.
- Harness sections: `tools/image-file-check.js` R to U, `tools/pagetree-check.js` H; the fixture
  has a second file field `bf_docs` (txt pdf png jpg, two at most, no tags).

Not in this version: touch multi-select; moves between a page and its repeater items; Extras
actions (hide, trash, …) on a tree selection; WireTab headers that open while dragging over them.

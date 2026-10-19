# Conformance suite

Proves the claim behind Bridge: every existing module sees the same admin under
AdminThemeBridge as under AdminThemeUikit. Two layers:

1. `run.php`: automated, HTTP-based. Logs in as the two sandbox superusers `uikit` and `bridge`
   (created by `tools/sandbox-admin.php`, differing only in `admin_theme`), fetches every screen
   from `screens.txt` under both, builds a digest of the module-facing content and diffs it.
2. Browser pass: interactive behaviours the digest cannot see (collapse, show-if, repeater add,
   uploads, pickers, save). Run by hand or through the in-app browser; results go into
   `RESULTS-<date>.md`.

## Running

```bash
# sandbox server must be up (php -S localhost:8089 -t sandbox/atispro tools/router.php)
php conformance/run.php "$PWD/sandbox/atispro" \
    --json=sandbox/conformance-atispro.json > sandbox/conformance-atispro.txt
tail -2 sandbox/conformance-atispro.txt
```

Options: `--base=http://host:port`, `--only=<substring of the screen url>`, `--json=<file>` for the
raw digests. Exit code 1 when any screen differs or fails.

`screens.txt` placeholders are resolved by bootstrapping the sandbox in CLI: one page per
non-system template, one field per fieldtype, every non-system template, up to 40
configurable modules, every admin page that runs a Process (`{admin-process-pages}`: module-provided screens included). Two contract endpoints are always added: the page list JSON
(`page/list/?id=1&render=JSON`) and the page editor in modal mode.

## What the digest holds

Per screen and theme: HTTP status; PHP error text seen in the body; `#pw-content-title`;
warnings and errors from `#notices`; every `.Inputfield` inside `#pw-content-body` (id, classes,
`data-show-if`, `data-required-if`, column width); every form control (name, type, value, select
option count); every link `href`; every button; row counts per table; registered module scripts
and stylesheets (`<script src>`, `<link rel=stylesheet>` outside the theme and jQuery paths).

## Normalisation (what is deliberately ignored)

- Version and cache-busting query strings (`?v=`, `?tm…`), `modal=1`, CSRF token names and values.
- Uikit presentation classes (`uk-*`, `InputfieldNoBorder`, `InputfieldHideBorder`, `InputfieldIs*`) and
  upstream jQuery UI classes Uikit strips (`ui-widget*`, `ui-state-*`).
- Scripts Bridge defers on a native page (`ProcessWire.config.AdminThemeBridge.legacyScripts`) count as registered.
- Column widths that differ by at most three points (`columnWidthSpacing` is a theme setting).
- Fields and controls a theme adds for itself: Uikit's per-field theme settings (`themeOffset`,
  `themeColor`, `themeBorder`, `themeInputSize`, `_adminTheme*` examples).
- Counter ids of anonymous Inputfields (`InputfieldMarkup73`), compared by position instead.
- Stylesheets are reported in the JSON but not diffed (a theme may ask modules for their
  stylesheets through `loadStyles` or not).
- On the profile screen, the user id and the user name in the title.
- Session messages (success notices); warnings and errors are compared.

- Upstream's `Inputfield_` placeholder class of nameless fields (Uikit's item template leaves it, upstream's default strips it).
- TemplateFile errors embed the theme's allowed paths; a failure is classed `SITE` when the texts match without them.

Rule for the theme: any class Bridge adds to `li.Inputfield` (wrapClass) must be added to `classList()` in `run.php` before the suite runs; today Bridge adds none (control and content classes are not compared).

Anything else that differs is a finding: either a Bridge bug, or a place where Uikit changes
module-facing markup and Bridge must decide whether to follow.

## Reading a result

```
ok   <url>                 identical digests
DIFF <url>                 followed by one line per difference
FAIL <url>                 HTTP error, PHP error text or an error notice under either theme
```

A FAIL under both themes is a site or module problem, not a theme problem; the sandbox log
`app/assets/logs/errors.txt` has the trace. A FAIL under one theme only is what the suite is for.

## Browser pass checklist

On a page editor with the richest field set (the runner's JSON lists field classes per screen):
collapse and expand a field; change a value that drives a `showIf`; add a repeater item; upload
an image; open a page picker and select; pick a date; open a `pw-modal` link; save and confirm
the notice and `?s=1`. Then the page tree: expand a branch, open the actions, move a page.
Record pass/fail per item in `RESULTS-<date>.md` with the sandbox and commit.

# ADR 0014: A field stylesheet and editor colours that follow the scheme

Status: accepted, 2026-10-15. Source: owner report 2026-10-15. In dark mode the Tags field and the
CKEditor body stayed white.

## Context

The theme recolours through tokens and through the jQuery UI classes (`.ui-state-*`,
`.ui-widget-*`). Field modules with their own stylesheets bypass both, because those sheets
hard-code light colours:
- selectize and InputfieldTextTags;
- the image grid, its tooltip and edit panel;
- the file list;
- jsoneditor (InputfieldJson);
- the CKEditor 4 skin (moono-lisa, no dark variant);
- third-party fields.

Rich-text editors paint their content in iframes, which the page CSS does not reach.

Some of these sheets arrive at runtime and are appended to `<head>`, after `theme.css`, so they
win every tie:
- jsoneditor;
- the CKEditor and TinyMCE skins;
- InputfieldToggle's colour `<style>`, which also freezes the colours of whichever scheme was on at
  load.

`theme.css` was at 11.8 of its 12 kB gzip budget.

## Decision

- **`fields.css`:** a second stylesheet, built by Vite from `runtime/src/styles/fields/`, budget
  6 kB gzip. It is printed right after `theme.css` on every admin page, because the scheme switches
  live.
  - `theme.css` keeps the admin frame and the Inputfield frame.
  - `fields.css` takes the inside of specific field modules.
  - One rule set uses the tokens in **both** schemes (owner decision), so light mode drops the
    leftover core blues and greys too.
- **Field tokens** (in `fields.css`):
  - the image checkerboard;
  - the "moved" highlight;
  - JSON value colours;
  - AdminThemeUikit's custom properties (`--pw-main-color`, `--pw-blocks-background`, …), mapped
    to the tokens, so modules written for that theme (Fluency, SeoNeo) follow the scheme unchanged.
- **Stylesheet order** (`setupStyleOrder` in `scripts/main.js`): a stylesheet or `<style>` added to
  `<head>` after the theme sheets is moved in front of `link[data-pw-theme]`. Module styles then
  always precede the theme sheets, as the server prints them, and equal specificity is enough.
  Rules that target the CKEditor skin keep an extra `html` as a fallback.
- **Editing areas** (`editors` in `scripts/main.js`): a small stylesheet built from the tokens
  resolved on `<html>`. It sets body on `--card`, text, links, borders, quotes, code and
  `color-scheme`.
  - **CKEditor:** written into each editing iframe (`instanceReady`, `contentDom`, `mode`) and into
    the dropdown panel iframes (`panelShow`). It is rewritten in place on a scheme change.
  - **TinyMCE:** `InputfieldTinyMCE.onConfig` picks `oxide-dark` / `tinymce-5-dark` in dark mode
    (unless a custom `skin_url` is set) and appends the stylesheet to `content_style`. On a scheme
    change the classic editors are saved and re-created with `resetEditors()`, because the skin is
    chosen at init.
  - **Inline editors** of both kinds edit in the page and are styled by `fields.css`.
- **`pw-scheme-change`:** dispatched on `document` when the effective scheme changes, with
  `detail.scheme`.
- **`tools/scheme-scan.js`:** finds what does not follow the scheme. It looks for light
  backgrounds in dark mode and for text below 3:1 contrast in both modes, in the page and in editor
  iframes, after a live switch too. It runs on the field-zoo page made by
  `tools/sandbox-fixture.php`.

## Consequences

- A new field module with hard-coded colours needs a rule in `fields.css`. The scan finds it, given
  a fixture field.
- A stylesheet a module injects late now loses ties to the theme, as module styles printed by the
  server always did.
- The editors' content is shown on the theme's card colour in both schemes. Content with
  hard-coded inline colours (black text spans) can lose contrast in dark mode. The stored HTML is
  unchanged.
- InputfieldToggle's colour style still runs. The theme overrides it, and it no longer decides the
  colours.

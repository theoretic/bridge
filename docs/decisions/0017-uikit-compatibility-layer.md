# ADR 0017: A UIkit compatibility layer, loaded on demand

Status: accepted, 2026-10-22. Source: the author of ProcessShowcase reported that his module looks
broken under Bridge. It uses UIkit, which AdminThemeUikit provides and Bridge does not.

## Context

AdminThemeUikit prints UIkit (CSS and JS, 3.25 in core 3.0.274) on every admin page. Third-party
modules use it in three ways:
- **Classes** (`uk-grid`, `uk-card`, `uk-section-primary`, `uk-table-striped`, ...).
- **JS components by attribute** (`uk-grid`, `uk-modal`, `uk-toggle`, `uk-switcher`, `uk-icon`).
- **The JS API** (`UIkit.modal.confirm()`, `UIkit.notification()`), sometimes from a module script
  that is the only sign the module needs UIkit.

Bridge had one answer: `95-uikit-compat.css`, about 120 hand-written rules for the utilities and
components measured on the local sites (ADR 0010 audit). It is always loaded, styled in Bridge's
look, and has no JS. Modules that go further break:
- ProcessShowcase's sections and tiles lose their backgrounds, and its grids lose their columns.
- Its UIkit page refuses to run ("The active admin theme has not loaded UIkit").

This is the same problem as the legacy jQuery stack (ADR 0002), with two differences:
- UIkit's stylesheet is global. Its Base component styles `html`, `body`, `a`, headings, lists,
  tables and form elements. Printed as it is, it restyles the whole admin.
- UIkit hard-codes a light palette. Printed as it is, it has no dark scheme.

Options considered:
1. **Stock `uikit.css` + `uikit.js` on demand.** Faithful, but the Base component bleeds into every
   Bridge component on the page, and dark mode breaks.
2. **Hand-map more `uk-*` classes onto tokens**, as `95-uikit-compat.css` does. Safe, but UIkit
   has ~90 components, and the JS components would still be missing.
3. **Derive a stylesheet from core's `uikit.css` at build time.** Keep only rules whose selectors
   name a UIkit class or attribute. Replace UIkit's palette with Bridge tokens. Put it in a cascade
   layer below the theme. Print it, with core's own `uikit.js`, only where a page needs UIkit.

## Decision

Option 3: a **UIkit layer**, loaded on demand like the legacy stack.

### The stylesheet (`assets/dist/uikit.css`)

`runtime/scripts/build-uikit.mjs` builds it from core's
`modules/AdminTheme/AdminThemeUikit/uikit/dist/css/uikit.css` (`BRIDGE_WIRE`, as for the Font
Awesome subsets). Without `BRIDGE_WIRE` the step is skipped and the committed file stays. The
build:
- **Keeps** only selectors that name a UIkit class or attribute (`.uk-*`, `[uk-*]`, `[class*="uk-"]`),
  plus the `:root` rule of UIkit's breakpoint properties, which its JS reads.
  - A selector list loses its bare element selectors (`h1, .uk-h1` keeps `.uk-h1`).
  - The Base component's element rules stay only for documents that load the admin's
    stylesheets without being a page of this theme, such as a module's preview iframe. Their scope
    is `:where(html.pw) > body:where(:not(.AdminThemeBridge))`, which adds no specificity, and
    `html` rules move to that `body`. They never match a Bridge page.
  - Every selector in the file names UIkit or is that scope (`check-css.mjs` checks).
- **Re-tokens the palette:**
  - text `#333`, `#666` and `#999` → `--foreground`, a mix of it, and `--muted-foreground`;
  - primary `#1e87f0` and its hovers → `--primary`;
  - backgrounds `#fff` → `--background`, `--card` or `--popover`, by component;
  - `#f8f8f8` → `--muted`, `#e5e5e5` → `--border`;
  - danger, success and warning, and the alert tints → Bridge's status tokens.

  The inverse rules (`.uk-light` and the primary and secondary sections, tiles and cards) keep
  UIkit's literal colours: they paint light text on a coloured ground in both schemes. Dark mode
  therefore follows Bridge's tokens with no second palette.
- **Wraps** the rest in `@layer uikit`. Unlayered styles win over layered ones whatever their
  specificity. So the theme (`theme.css`, `fields.css`, `95-uikit-compat.css`) and module
  stylesheets always win over the layer, and Bridge's own components cannot be restyled by it.
  `95-uikit-compat.css` stays the Bridge look of the common utilities on top of the layer.
- **Unlayered, after the layer:**
  - UIkit's heading classes again, the class doubled, so they beat the theme's element rules
    (`body.AdminThemeBridge h2`);
  - `src/styles/uikit-layer.css`: the theme's own rules for the layer. These are the button
    variants that `95-uikit-compat.css`'s general `.uk-button` would flatten, and media sized to
    their container (UIkit's Base did that);
  - the Inverse component. It only matches inside `.uk-light` and the coloured sections, tiles and
    cards, and there it must beat `95-uikit-compat.css`. A primary button on a primary section is
    white, not primary on primary.
- **Excludes Bridge's own hooks:** `.uk-tab` rules skip `.pw-lang-tabs`, because the theme puts
  `uk-tab` on the language tabs.

Budget: 40 kB gzip, checked by `check-css.mjs` like the others. The layer is fetched only where it
is needed.

### The script

The script is core's `uikit.min.js` and `uikit-icons.min.js` from AdminThemeUikit's directory.
Bridge ships no copy, so the script is always the version the core ships. The stylesheet records
the UIkit version it was built from, and the smoke test warns when core's version differs.
- A module that appends a UIkit script itself (from AdminThemeUikit or its own copy) keeps it.
  `isOtherThemeAsset()` no longer drops UIkit's `dist/js` files, and Bridge then adds no second
  copy.
- A module that appends stock `uikit.css` loses it: the layer takes its place.

### When it loads (setting `uikit`: `auto` (default), `always`, `never`)

In `auto` mode the server records reasons, as for the legacy stack:
- **`Markup:<name>`.** The rendered content (Process output and the theme's extra markup regions)
  has a UIkit attribute (`uk-grid`, `data-uk-modal`, ...), or a `uk-*` class that
  `95-uikit-compat.css` does not cover. The build writes the covered classes to
  `assets/dist/uikit-covered.json`. A module that only uses those classes keeps today's
  behaviour and costs nothing.
  - `uk-tooltip` is no reason. The theme script turns its text into the element's `title`, the
    browser's own tooltip. Core's module list puts `data-uk-tooltip` on every module title, and
    Fluency adds tooltip icons to every multi-language field. Neither is worth the layer.
- **`Script:<path>`.** A module script names the `UIkit` global. Verdicts are cached per file and
  modification time, like the jQuery verdicts.
- **`Asset:<url>`.** A module appended a UIkit script or stylesheet.
- **`Module:<name>`.** A module asked: `$adminTheme->needUikit('MyModule')`, when the current admin
  theme has that method.

`AdminThemeBridge::uikitReasons()` is hookable, to add or remove reasons. The reasons go to the
client in `ProcessWire.config.AdminThemeBridge.uikit.reasons`.

Where reasons exist, the head prints the layer's stylesheet, before the theme sheets, and the two
scripts right after the shared legacy scripts, before every module script (where AdminThemeUikit
prints them, a module script may run at once). Otherwise the URLs go to the client in `ProcessWire.config.AdminThemeBridge.uikit`, and
the theme script (`ProcessWireAdminTheme.uikit.load()`) loads them when one of these happens:
- **AJAX content arrives with UIkit markup.** The theme script's one body observer checks added
  elements for UIkit attributes and uncovered classes.
- **A script calls the `UIkit` global.** Until the real script is there, `window.UIkit` is a
  stand-in that records calls and replays them once UIkit is loaded. A call returns a stand-in for its result, so chains
  (`UIkit.modal('#x').show()`) and `await` work. The stand-in (`scripts/uikit-layer.js`) is
  printed on every page, before module scripts, and defines `window.UIkit` only where UIkit was
  not printed.

### Colour scheme classes

AdminThemeUikit marks its scheme with `body.light-theme` / `body.dark-theme`, and modules written
for it style against those classes. Bridge's theme script now keeps the same class on `<body>`
in sync with the effective scheme. On the layer's pages the tokens also take `.dark-theme` / `.light-theme` as
aliases of `data-pw-scheme`, so markup that sets the class itself is covered. AdminThemeUikit's
custom properties, which `fields.css` maps on `:root`, are computed there again. A document
without `data-pw-scheme` (not a Bridge page) takes its body's class on `<html>` too, so the
canvas follows. ProcessShowcase's UIkit preview, for instance, sets the class on the preview's body.

## Consequences

- Pages that need UIkit get it, coloured by the theme in both schemes. Pages that do not need it
  pay nothing. The always-on cost is the covered-class list (read by the server only when the
  content has `uk-` classes; fetched by the client only when added content has them) and the
  stand-in (1.7 kB gzip).
- The layer is UIkit's geometry in Bridge's colours (square corners, UIkit spacing), not
  AdminThemeUikit's look and not Bridge's. Where `95-uikit-compat.css` styles a class, Bridge's
  look wins.
- Bridge's element styles win over UIkit classes on the same element. For example,
  `body.AdminThemeBridge h2` beats `.uk-heading-medium`. The layer adds back what it needs with
  narrow unlayered rules (heading classes).
- Modules with uncovered UIkit markup now get the layer on their pages, where before they got the
  compat subset. On the local sites these are AgentTools (`uk-toggle`, comments), PageTableNext
  (`uk-divider`, `uk-child-width-expand@m`), SelectorTester (names `UIkit`), AdminPageTool and
  AdminPageDealers (pagination, table variants).
- Not covered:
  - RTL (`uikit-rtl.css`);
  - the inverse colours on Bridge's custom primary;
  - synchronous use of the stand-in's return value (`UIkit.util.$()` before UIkit loaded);
  - modules that test `$adminTheme instanceof AdminThemeUikit`.

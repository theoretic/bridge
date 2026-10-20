# Bridge

A ProcessWire admin built from native web components that still runs every existing
Inputfield and Process module. Based on [ProcessWire](https://processwire.com); not a fork.

"Bridge" is a working name.

## What it is

- **`AdminThemeBridge`**, an ordinary admin theme module for a stock ProcessWire 3
  (3.0.200+, PHP 8.1+). It renders the admin frame with its own markup and a small TypeScript
  runtime, without jQuery.
- **A legacy bridge.** jQuery, jQuery UI, `inputfields.js`, WireTabs and the rest of the
  upstream stack load only on screens that hold a jQuery-era Inputfield or Process module, with
  the old globals and events, so those modules keep working unchanged.
- **Native core screens.** Most core fields (text, select, checkboxes, datetime, file, image,
  repeater, page table…) and the core Process screens (page tree, page editor, Lister, setup and
  access screens) run natively. See [CHANGELOG.md](CHANGELOG.md) for the full list.
- **A component contract** ([docs/contract.md](docs/contract.md)) that third-party modules can
  implement to run natively as well.
- **A bootstrap** ([bootstrap/](bootstrap/)) for running ProcessWire from any folder layout,
  with `wire/` kept as an untouched upstream copy.

Upstream `wire/` is never edited or patched. DOM ids and classes, AJAX endpoints, module class
names and hookable methods stay as upstream defines them, so modules and hooks find what they
expect. Design decisions are recorded in [docs/decisions/](docs/decisions/).

## Compatibility

Compatibility is checked by a conformance suite ([conformance/](conformance/)), which compares
every admin screen under Uikit and Bridge on copies of real sites with widely used community
modules. Pro modules (ProFields, FormBuilder, ListerPro) have not been tested.

## Install

1. Copy `modules/AdminThemeBridge/` to `site/modules/AdminThemeBridge/`.
2. Modules > Refresh, then install **Bridge**.
3. Select it under Profile > Admin Theme. Other users stay on their current theme.

On a live site, back up the database first and follow
[docs/install-live.md](docs/install-live.md). It covers modules that break a module cache
rebuild, and AdminThemeBoss's "activate for all users" setting, which blocks the selection.

To uninstall: switch your profile back to Uikit, then uninstall the module.

## Development

```
bootstrap/                 front controller and project.php layout config
modules/AdminThemeBridge/  the admin theme; assets/dist/ holds the built runtime (committed)
modules/BridgeDemo/        native Process and Inputfield used as a test fixture
runtime/                   TypeScript runtime and stylesheets, built with Vite
conformance/               screen-by-screen comparison against Uikit
tests/smoke.php            smoke test against a sandbox install
tools/                     sandbox builders, deploy and diagnostic scripts, Playwright checks
docs/                      component contract, ADRs, install notes
```

Build the runtime after changing `runtime/src/`:

```bash
cd runtime
npm install
npm run build
```

The build also checks that `runtime.js` and `theme.css` stay within their size budgets.

### Font Awesome subsets

Core's Font Awesome 6 fonts carry every icon (about 300 kB); an admin screen shows a few dozen.
With `BRIDGE_WIRE` pointing at core's `wire/` directory, `npm run build` also cuts small subsets
of the icons in common use and writes `modules/AdminThemeBridge/assets/fonts/fa-<version>/`
(committed): `fa.css`, which the theme prints instead of core's `all.min.css`, the subsets and
copies of the full font files.

```bash
BRIDGE_WIRE=/path/to/wire npm run build
```

The subsets hold the icons used by core, by Bridge and by the names in `runtime/fa-icons.txt`.
Any other icon still renders: it comes from the full file, which the browser then fetches once.
Nothing can go missing; a rare icon only costs the full download. The theme uses the subsets
only for the Font Awesome version they were cut from and falls back to core's stylesheet
otherwise.

For one site, add its modules and the icons stored in its database (templates, fields, admin
pages) and deploy that build to it:

```bash
php tools/fa-icons-site.php /path/to/webroot > site-icons.txt
BRIDGE_WIRE=/path/to/wire BRIDGE_FA_SCAN=/path/to/webroot/site/modules \
  BRIDGE_FA_ICONS=site-icons.txt npm run build
```

`tools/fa-coverage.js` opens admin screens and lists the icons that still come from a full file.

The sandbox and test tools build disposable copies of local ProcessWire sites under
`sandbox/` (gitignored); the header of each script in `tools/` describes it. Never point the
tests at a real site's database.

## License

Own code is [MIT](LICENSE). Files derived from ProcessWire keep their MPL 2.0 header and a
modification note; each file's header is authoritative. The PHP namespace stays `ProcessWire`.

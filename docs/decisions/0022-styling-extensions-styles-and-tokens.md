# ADR 0022: Styling extensions: `styles`, `tokens` and honoured contracts

Status: accepted, 2026-11-09; built in 0.29.0 (extension contract 0.2). Source: the owner's
brief "Extension contract 0.2 for styling extensions" (2026-11-09), written from a community
styling package, and the owner's answers while planning it (2026-11-09).

## Context

The first extension made outside the project, without the brief of ADR 0021, was a styling
package: one stylesheet that restyles fields and repeaters, a small script that draws guides in
the page tree, and a few body classes as switches. It ran into two gaps of the first
contract (0.1).

1. **Its stylesheet lost to the theme.** Printed in the `head` slot, it came after `theme.css`,
   and the theme's style-order code (`setupStyleOrder()`, `scripts/main.js`) moved it in front of
   `link[data-pw-theme]`, as it moves every stylesheet a field script adds at run time: the theme
   must win over module styles. So the extension lost every cascade tie. The author worked around
   it with `data-pw-keep`, an attribute the theme puts on its own inline styles and never
   published.
2. **Its tokens were not on the surface.** The stylesheet reads the theme's custom properties
   (`--foreground`, `--muted`, `--primary`, `--pw-input-bg`, ...) and sets some
   (`--pw-font-size`, `--pw-field-pad`, ...). `extensionSurface()` had no list of them, so neither
   the contract tests nor the compatibility checker could tell when one disappeared, and several
   the package set were internal.

Its fallback script was also a plain script tag without the CSP nonce, so an enforced policy
blocked it; as the extension's ES module (`module`) it is imported by the runtime, which such a
policy (`strict-dynamic`) trusts.

## Decision

1. **A manifest key `styles`, not a documented attribute.** The theme prints the stylesheets
   itself: one `<link rel='stylesheet' data-bridge-styles='<name>'>` per entry in `<head>`, after
   `theme.css` and `fields.css`, with the nonce, in every layout (modal windows too), for the
   signed-in users and extensions the slots serve. Entries resolve as `module` does (relative to
   the module's directory with `?v=<module version>` or, in dev mode, the file time; absolute URLs
   and root-relative paths kept as given), so both tools can check that the files exist, and the
   style-order code leaves the marked links in place. An attribute would have left the place, the
   nonce, the cache-busting and the checks to each extension. `data-pw-keep` stays internal.
   `extensionStyles()` (a read) lists what a request prints.
2. **Tokens on the surface.** `extensionSurface()` gains `tokens`: the custom properties
   `docs/contract.md` 4.0 documents, read against `runtime/src/styles/00-tokens.css` (73 names).
   A manifest declares the ones its stylesheets use in `tokens`. `tools/extension-check.php`
   scans the `styles` files: a surface token used but not declared fails, so does a name the
   built `theme.css` declares that is not on the surface (internal). `tools/extension-compat.php`
   reports a declared token a target no longer has. Names are stable within a contract; values
   are not.
3. **The four metric tokens are published**: `--pw-font-size`, `--pw-line-height`,
   `--pw-field-pad`, `--pw-field-pad-bottom`. A styling extension whose job is typography and
   field spacing cannot work without them, and their names have not changed since they came.
   `--pw-gutter` was documented already. `--pw-input-radius` is declared and read nowhere: it is
   not published (and not used).
4. **The theme lists the contract versions it honours.** `contractSatisfies('^0.1', '0.2')` is
   false by design (for `0.y`, `^` keeps the minor version), and changing that would make `^0.1`
   useless as a guard. Instead `AdminThemeBridge::extensionContracts` (`'0.1'`, `'0.2'`, the
   current one last) is on the surface as `contracts`, and an extension is compatible when its
   range takes any of them (`contractCompatible()`). 0.2 only adds, so 0.1 stays honoured and the
   bundled `^0.1` manifests keep working unchanged; the compatibility checker reads the same list
   from `extension-surface.json` (a surface without it honours its `contract` alone).

## Consequences

- Contract 0.2 adds the manifest keys `styles` and `tokens`, the surface keys `contracts` and
  `tokens` and the read `extensionStyles`; nothing of 0.1 changes. The scaffold writes `^0.2`
  manifests and, with `--styles`, a stylesheet; `BridgeSample` is regenerated with it and is the
  fixture of the `styles` checks. The other bundled extensions stay at `^0.1` on purpose.
- A future 0.3 that only adds appends `'0.3'` to `extensionContracts`. A 0.3 that removes or
  changes something (a token, a hook, a slot, a key's meaning) drops the versions it breaks from
  the list: their manifests then stop loading until their authors raise the range, and the
  compatibility checker tells which ones before the release.
- Removing or renaming a token is a contract change like removing a hook. The smoke test keeps
  every surface token declared in `00-tokens.css` and the docs' list equal to the surface.
- The login screen stays out of reach of extension stylesheets, as of slots.

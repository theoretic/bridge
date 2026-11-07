# ADR 0021: Extensions are modules on a published surface

Status: accepted, 2026-11-04; built in 0.27.0 (extension contract 0.1). Source: the owner's
brief "Bridge Extension Architecture" (2026-11-03) and the owner's answers while planning the
extension kit (2026-11-04).

## Context

The brief asked how Bridge should grow: features baked into the theme, a plugin system of its
own, or ordinary modules. It assumed Bridge to be an API layer with a decoupled client, with a
request pipeline, middleware and endpoint registration as extension points.

The code is different. Bridge is an admin theme module (`AdminThemeBridge`) on an unmodified
core, a TypeScript runtime (`window.Bridge`) and a legacy bridge; the admin's URLs and JSON
contracts are upstream's and stay so (ADR 0003). There is no API server and no request pipeline
of Bridge's own: upstream's Process modules and hooks are that pipeline.

What extends the theme already existed in pieces: hookable `___` methods, upstream's
`addExtraMarkup()` regions, the component contract (`BridgeComponent`, `docs/contract.md`), the
bubbling DOM events, and two modules that use only these, `BridgeCsp` and `BridgeDemo`.

## Decision

1. **An extension is a ProcessWire module.** The module system gives packaging, install order,
   `requires`, version constraints and config screens. No parallel plugin system.
2. **It uses a published surface and declares what it uses.** The surface is
   `AdminThemeBridge::extensionSurface()`: hookables, public methods it may call (`reads`),
   settings, shell slots, DOM events and `window.Bridge` keys. The manifest
   (`BridgeExtension::getBridgeExtension()`, or the `bridge` module info key for a declarative
   extension) lists the contract range and every part of the surface the module touches.
   Confinement is a contract checked by tests and review, not a sandbox: an extension reads
   ProcessWire freely and does not alter its behaviour outside the admin.
3. **The extension contract has its own version**, `AdminThemeBridge::extensionContract`
   (`'0.1'`), apart from the module version and from the component contract (`Bridge.contract`,
   `'1'`). A manifest names the range it was written for; an incompatible extension is neither
   imported nor given its slots.
4. **Bridge's own features go through the same door.** The rule for a proposal:

   | Proposal | Where it goes |
   |---|---|
   | Changes the contract (surface, manifest, shell markup contract) | The theme |
   | Uses the contract and most sites need it | A bundled extension in `modules/` |
   | Uses the contract, niche need | A third-party extension |

5. **Bridge is one module with a server half and a client half** (the brief's first open
   question). The manifest is the glue between them: the theme reads it to print slots and
   hands it to the runtime, which imports the client module. The client bus is DOM events
   (`pw-<name>-<event>` for an extension's own), no event facade. Several extensions in one slot
   or on the client are ordered by a `priority` number, as hooks are.
6. **The API is extracted from real extensions** (rule of three): `BridgeCsp`, `ProcessBridgeDemo`
   and the scaffolded `BridgeSample`. The ACL extension the brief proposed as the first is left
   to its own release, built through the kit.

## Consequences

- Middleware, endpoint registration and response shaping have no counterpart and are not part of
  the contract; a module that needs them hooks upstream as any module does.
- Every hookable added to the theme joins the surface (a smoke line compares the surface with the
  class by reflection), and `docs/extensions.md` section 3 is the surface word for word.
- The kit: `tools/scaffold-extension.php`, the contract tests `tools/extension-check.php` and
  `tools/extension-check.js` (in `tools/ci.sh` for the bundled extensions),
  `tools/extension-compat.php` (no boot; reads `assets/dist/extension-surface.json`) and
  `tools/extension-dev.js` with the `extensionDev` setting.
- Before 1.0 the extension contract may change between minor versions; the compatibility checker
  tells which extensions a change breaks.

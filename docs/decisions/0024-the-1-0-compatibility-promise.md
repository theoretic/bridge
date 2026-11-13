# ADR 0024: The 1.0 compatibility promise

Status: accepted, 2026-11-13; takes effect with theme 1.0.0 (extension contract 1.0, component
contract version 1). Source: the owner's brief for the 1.0 readiness sprint (2026-11-13), his
answers to its open questions 1-8 (2026-11-13), the surface inventory `docs/surface-1.0.md` and
the 2026-11-13 audit's architecture items A1-A3.

## Context

Until 0.30.x Bridge was beta: the README said the component contract "may still change before
1.0", and `docs/extensions.md` said the extension contract may change between minor versions.
Semantic versioning makes 1.0.0 a promise: what is public breaks only in 2.0. Before making it,
the sprint listed everything that is public (`docs/surface-1.0.md`: the seven lists of
`AdminThemeBridge::extensionSurface()`, 182 entries at 0.30.1, and the client API that
`docs/contract.md` section 4 documents beyond them) and the owner ruled on each entry that was
not plainly stable (open question 8).

Three findings of the audit bear on what can be promised:

- A1: the theme class is assembled from about fourteen traits, and every hookable is public as
  `AdminThemeBridge::<name>`. Splitting it into services before 1.0 was declined (open question
  1); a split must stay possible later without breaking hooks.
- A2: the classic scripts (`runtime/src/classic/*.js`, built to the theme's `scripts/`) live
  next to the TypeScript runtime; their file names and internals are an accident of history.
- A3: the shell keeps text and markup contracts with an upstream core that changes a few times
  a year.

## Decision

1. **What 1.x keeps.** For every 1.x release:
   - the entries `docs/surface-1.0.md` marks `stable`: the hooks, reads, settings, slots, tokens,
     events and runtime keys of `extensionSurface()`, and the documented client API
     (`ProcessWireAdminTheme.*`, `window.Bridge.*` members and their options, the globals on
     pages without the legacy stack). As ruled in open question 8, the surface at 1.0.0 is the
     0.30.1 lists with the read `themeAssetUrl` taken out (it stays a method, documented as
     internal) and the events `pw-scheme-change`, `pw-variant-change`, `pw-scale-change`,
     `pw-tabs-change` and the tokens `--pw-range-fill`, `--pw-branch-max` added; `--ring-50`
     stays internal. An entry keeps its name, its arguments, the type and meaning of what it
     returns, and for an event its `detail` keys;
   - the documented parts of the component contract, version 1 (`docs/contract.md`):
     `BridgeComponent` and its keys, the legacy stack policy, the wrapper attributes, the
     events and the checklist;
   - the DOM ids and classes and the JSON/AJAX contracts the shell keeps from upstream
     (`Inputfield`, `InputfieldContent`, `InputfieldHeader`, `InputfieldStateCollapsed`,
     `Inputfield_<name>`, `pw-modal`, `ui-widget`, `?render=JSON`, `?modal=1`,
     `renderInputfieldAjax`; `docs/contract.md` section 1, ADR 0003);
   - each bundled module's class name, hookable (`___`) method names and `getModuleInfo()`
     keys (ADR 0004), and the extension contracts the theme honours (`extensionContracts`):
     a manifest written for `^0.1`, `^0.2` or `^1.0` stays compatible for all of 1.x.
2. **What 1.x does not cover.** These may change in any release, a patch included:
   - the classic scripts' internals and file names (audit A2): only the members
     `docs/contract.md` 4.1 documents are kept, not the files that hold them or anything else
     they define;
   - CSS custom properties that are not on `tokens` (`docs/extensions.md` section 3);
   - the markup inside the theme's own components: their shadow DOM and any `pw-*` internals the
     docs do not describe;
   - default values and the visual design: colours, sizes, spacing, the values of the tokens
     (their names are kept), the order and look of the shell;
   - the `tools/` and `tests/` scripts, their options and output;
   - anything a doc calls internal (`docs/surface-1.0.md` "Not on the surface", the public
     methods of `AdminThemeBridge` missing from `reads` and `hooks`).
3. **Thin methods (audit A1).** A job may move out of the theme class into a service or a
   helper class in a 1.x minor only if every hookable and every read stays a method of
   `AdminThemeBridge` with the same name, arguments and return, which then calls the service.
   `AdminThemeBridge::<name>` hooks keep firing, before and after, with the same
   `$event->arguments()` and `$event->return`; the smoke line that compares `hooks` with the
   class's `___` methods keeps holding.
4. **Coupling to core (audit A3).** A release is made only after the conformance suite
   (`conformance/run.php`, `tools/gate1.sh`) ran against the current upstream dev core and its
   result was looked at. The supported core range is stated in the README (today 3.0.227 and
   later, the theme's `requires`).
5. **Deprecation.** An entry leaves the surface only in a major release, after at least one
   minor in which using it writes a notice to the `bridge-extensions` log and the CHANGELOG
   names it with what to use instead.
6. **Additions.** Hooks, reads, settings, tokens, slots and events may be added in a minor, as
   0.28.0 (`navCacheKey`) and 0.30.0 (the appearance seams, ADR 0023) did; an addition is
   `stable` from the release that adds it and gets a row in `docs/surface-1.0.md`. A contract
   range cannot tell such releases apart, so an extension that needs an addition declares
   `'requires' => 'AdminThemeBridge>=<version>'`; the compatibility checker
   (`tools/extension-compat.php`) reports an entry an older surface lacks.

## Alternatives rejected

- **Splitting the theme class before 1.0.** An L refactor before a release that is meant to
  freeze, not to move code. Decision 3 keeps the split open for a 1.x minor.
- **A narrower surface.** Removing more than `themeAssetUrl` would break the bundled and the
  two known third-party extensions for little gain: every other entry has a documented use.
- **Promising the classic scripts as files.** Sites do not load them by name; modules reach
  them through `ProcessWireAdminTheme`. Freezing file names would block moving them into the
  TypeScript runtime (audit A2).
- **No stated core range.** Without one, "breaks only in 2.0" is undefined each time upstream
  changes; the range and the conformance run make it checkable.

## Consequences

- `docs/extensions.md` and `docs/contract.md` link this ADR; the README's status line drops
  "beta" (sprint step 4), and the extension contract becomes 1.0 with 0.1 and 0.2 still
  honoured (step 3).
- `docs/surface-1.0.md` stops being a one-off inventory and becomes the list a 1.x release is
  checked against: a surface addition without its row fails the smoke test.
- A removal needs a deprecation notice in code; none exists yet, so the first deprecation adds
  the logging along with it.
- Fixes that change a default value or the look are patch releases even when a site notices
  them; a fix that changes a documented return value or event `detail` waits for 2.0 or comes as
  a new entry beside the old one.

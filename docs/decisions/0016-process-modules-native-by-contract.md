# ADR 0016: Core Process screens go native by contract

Status: accepted, 2026-10-16. Supersedes ADR 0004 for Phase 3. Extends ADR 0015 from fields
to Process modules. Source: Phase 3 survey of Bridge and of core 3.0.274 (2026-10-16), owner
decision.

## Context

PLAN.md had Phase 3 replace the core Process modules with same-named, clean-sheet modules
(ADR 0004). The survey showed what that costs:

- **Duplicates default to core.** `Process` is one of `ModulesFiles::$coreTypes`, like
  `Inputfield`. After a modules refresh a same-named site module loses to `wire/modules`
  again, and superusers see the duplicate warning (ADR 0015 hit the same wall).
- **Size and hooks.** The six target screens are about 17k lines of PHP:
  - ProcessPageEdit 3.7k, ProcessTemplate 4k, ProcessField 3.7k;
  - ProcessPageLister 2.5k, ProcessModule 2.3k, ProcessPageList 0.9k plus its renderers.

  Third-party modules hook their methods by name (BatchChildEditor, VersionControl,
  SettingsFactory, AgentTools). A rewrite must match every hookable and every argument, and
  then keep matching upstream releases.
- **The jQuery need is client-side.** A scan of the atispro admin (2026-10-16) found that every
  screen loads jQuery for one reason: `hookProcessExecute()` counts every Process that is not a
  `BridgeComponent` as legacy. The PHP output is plain markup; the jQuery lives in each
  module's script (`ProcessPageEdit.js` 0.1k lines, `ProcessPageList.js` 1.5k,
  `ProcessTemplate.js` 0.7k, ...), in `JqueryWireTabs` and in `JqueryUI` modal and panel.

## Decision

1. **Upstream Process modules stay.** Their PHP, hookables and output are untouched.
   A Process is native by **exact class** (`$nativeProcesses` in the theme) once the runtime
   provides its client part, on the same DOM contract:
   - ids and classes;
   - jQuery events, which are also triggered when jQuery is present (`wiretabclick`, ...);
   - globals that other scripts call.
2. **Native status is still decided per request.** What the screen renders keeps its own
   reasons:
   - every field (ADR 0015);
   - a page tree embedded in the editor's Children tab, until the page tree is native;
   - scripts that third-party modules add.

   A native screen with one legacy field still loads the stack, and the upstream script then
   runs as before.
3. **Inline calls are guarded.** Upstream prints inline calls such as
   `<script>initPageEditForm();</script>`. The theme rewrites them to run only when the upstream
   function exists, as `deferLegacyInline()` does for vex.
4. **Replacement modules remain a last resort.** They are used only where server output must
   change, each with its own ADR (ADR 0004's naming and hook rules then apply).
5. **Gate 3 is re-scoped:**
   - The six screens load no jQuery when everything they render is native.
   - They pass behaviour checks in Chromium and Firefox.
   - Conformance stays green.
   - The third-party modules hooking into them still work: server hooks unchanged, their
     scripts loading the stack on demand.

## Consequences

- No duplicates, no hook drift, nothing to re-sync on each upstream release beyond the client
  contract (which the conformance suite and the harness check). Own code stays MIT.
- Basecoat markup arrives only in elements Bridge renders on the client (the tab bar, the
  page tree rows); the server markup is upstream's.
- The runtime grows by a chunk per screen, loaded only on that screen, like the field widgets.
- Upstream changes to a Process script's DOM or events must be tracked: each native screen
  lists the upstream script it stands in for, with the core version it was checked against.

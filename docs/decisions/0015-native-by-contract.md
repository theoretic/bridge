# ADR 0015: Core fields go native by contract, not by replacement modules

Status: accepted, 2026-10-15. Refines ADR 0004 for Phase 2. Source: Phase 2 surveys of
Bridge and of core 3.0.274 (2026-10-15), owner decision.

## Context

PLAN.md had Phase 2 replace core Inputfields with same-named modules in `modules/`. The core
survey showed what that costs in 3.0.274:

- **Duplicates default to core.** A site module with a core class name is a duplicate.
  - On a normal request the site copy happens to win.
  - After any modules refresh `ModulesDuplicates` makes core the default again
    (`ModulesFiles::getModuleFile()` prefers `wire/modules` for the `Inputfield` type). It also
    shows superusers a warning on every request until one switches the module edit screen's
    "Module file to use".
  - `$config->substituteModules` only applies to missing modules, so it cannot help.
- **Subclasses inherit the replacement.** Core and third-party classes extend the simple fields
  by name, and the class loader includes the winning file, so they all become subclasses of
  the replacement:
  - Email, URL, Name, PageName, PageTitle and Password extend Text;
  - CKEditor and TinyMCE extend Textarea;
  - Radios, SelectMultiple, Checkboxes and AsmSelect extend Select;
  - Float extends Integer, and davinci's FloatRange extends Float.

  The sandboxes alone hold 726 `modules->get('InputfieldText'|...)` call sites expecting the
  core API.
- **Licensing.** Reusing core render code makes a file MPL (D6).

The jQuery need of the simple fields is mostly not their own:
- Text, Textarea, Checkbox, Radios, Select, Integer, Float, URL, Email and Name ship no script.
- Only Text's optional character counter (`showCount`, `InputfieldTextLength.js`) uses jQuery.
- What they rely on is the shared `inputfields.js`: change tracking, the leave-page warning, the
  Enter-key guard, opening an invalid collapsed field, showIf/requiredIf, columns and collapse.
  The runtime already covers the last three (milestone 1.3).

The upstream page editor loads jQuery whatever its fields are: WireTabs, the submit dropdowns
and the inline `initPageEditForm()` call. A jQuery-free page editor is Phase 3 work.

## Decision

1. **No replacement modules for fields that ship no script of their own.** The theme treats
   them as native by **exact class name** (never `instanceof`, so subclasses with their own
   scripts stay legacy). The runtime takes over the shared behaviours they need from
   `inputfields.js`, on the same DOM contract (classes, events, ids).
2. **Fields with their own jQuery scripts get native client implementations first.**
   - Examples: Toggle, Checkboxes, the Text counter, AsmSelect.
   - A field becomes native only when its upstream script is no longer needed.
   - A same-name replacement module is a last resort, used only where server-side markup or
     behaviour must change. It is then installed explicitly (`setUseDuplicate`) and gets its own
     ADR.
3. **Fields stay legacy whenever an upstream dependency needs jQuery.** Two examples:
   - a multi-language field, until language tabs are native;
   - a field whose JS is added by another module.

   Native status is decided per rendered field, not per class.
4. **Gate 2 is re-scoped.** A native Process page (BridgeDemo grown into a field lab) built from
   every Phase 2 core field type must:
   - load no jQuery;
   - pass behaviour checks: change tracking, leave warning, Enter guard, showIf/requiredIf,
     collapse, columns, invalid-open, counter, save round trip.

   Conformance stays green. The page editor goes jQuery-free with the native ProcessPageEdit in
   Phase 3.

## Consequences

- No duplicate modules, no duplicate notices, no API drift for subclasses or third-party code.
  Own code stays MIT.
- The runtime grows. It needs a size budget, like the CSS.
- Server-side markup stays upstream's; Basecoat markup arrives only where Bridge owns the
  element (client components, Phase 3 screens).
- ADR 0004 still holds for Phase 3 Process modules, which must replace upstream.

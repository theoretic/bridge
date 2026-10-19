# ADR 0004: Replacement core modules keep class names, hookable methods and module info

Status: accepted, 2026-10-14. Source: ProcessWire Fork Review (2026-10-06), verified against core 3.0.274. Narrowed by ADR 0015 (fields) and ADR 0016 (Process screens): it now governs only the replacement modules those ADRs allow as a last resort.

## Context

Hooks are string-addressed (`'ProcessPageEdit::buildForm'`). The Modules system, `ProcessModule` and upgrade checkers read `getModuleInfo()` keys (`requires`, `installs`, `permission`). A replacement with a different name or signature silently detaches every third-party hook.

## Decision

A replacement for a core module keeps the class name, every hookable method name (`___` prefix) and the `getModuleInfo()` keys. New behaviour goes into new hookable methods. Replacements are registered twice: by `site/modules` precedence (tracked by `ModulesDuplicates` in `wire/core/Modules/`) and through `$config->substituteModules`.

## Consequences

- Two core mechanisms must break before a replacement stops loading.
- Clean-sheet implementations are preferred (ADR 0006); method names are not copyrightable expression.

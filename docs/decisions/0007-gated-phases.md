# ADR 0007: Gated phases; the legacy bridge gate decides the project

Status: accepted, 2026-10-14. Source: ProcessWire Fork Review (2026-10-06).

## Context

A solo studio building a new admin plus an ecosystem bridge is exposed to scope creep. The review identified the legacy bridge as the one deliverable that decides whether Bridge can keep its compatibility promise.

## Decision

Work proceeds in phases 0-4 (`PLAN.md`), each closed by a gate. No phase starts before the previous gate passes. Gate 1 (every locally installed and "top set" community module runs unchanged under the Bridge shell) is go/no-go: if it fails, the project ends as a published AdminTheme and phases 2-4 are dropped.

## Consequences

- Phase 1 is sized as the largest block and started before any Inputfield rewrite.
- Gate 1 currently excludes Pro modules (ADR 0009).
- Gate 0 passed 2026-10-14 (`tests/smoke.php` on the atispro sandbox).
- Gate 1 passed 2026-10-14 for the locally installed community set (five sandboxes, 579 screens, `conformance/RESULTS-2026-10-14.md`); Pro modules excluded per ADR 0009.

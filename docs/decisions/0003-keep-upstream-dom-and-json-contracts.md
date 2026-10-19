# ADR 0003: Keep upstream DOM ids, classes and JSON contracts

Status: accepted, 2026-10-14. Source: ProcessWire Fork Review (2026-10-06).

## Context

Modules and hooks locate things by the ids, classes and endpoints upstream emits, not by theme name: `Inputfield`, `InputfieldContent`, `InputfieldHeader`, `InputfieldStateCollapsed`, `Inputfield_<name>`, `pw-modal`, `ui-widget`, `?render=JSON`, `?modal=1`, `renderInputfieldAjax`.

## Decision

Every one of those stays byte-compatible in Bridge markup and endpoints. New behaviour adds attributes and elements; it never renames or removes upstream ones.

## Consequences

- `docs/contract.md` carries the invariant list and is checked by the conformance suite.
- Our custom elements wrap upstream markup rather than replacing it.

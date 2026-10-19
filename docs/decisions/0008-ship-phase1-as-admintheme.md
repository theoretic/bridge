# ADR 0008: Phase 1 ships publicly as an ordinary AdminTheme module

Status: accepted, 2026-10-14. Source: ProcessWire Fork Review (2026-10-06).

## Context

The shell plus legacy bridge is useful on its own ("a native-component shell that still runs every existing field"), and the compatibility claim is only credible once module authors have tried it.

## Decision

`AdminThemeBridge` is published on GitHub and in the module directory at the end of phase 1, installable on any stock ProcessWire, before any core Inputfield or Process replacement exists.

## Consequences

- The theme must not depend on the Bridge bootstrap or on replacement modules.
- The component contract (`docs/contract.md`) is published with it so third parties can opt in.

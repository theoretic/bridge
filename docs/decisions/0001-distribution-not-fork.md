# ADR 0001: Distribution, not fork

Status: accepted, 2026-10-14. Source: ProcessWire Fork Review (2026-10-06).

## Context

The review weighed a hard fork, an overlay fork with build-time patches, and a distribution. Upstream ships weekly from one maintainer; a diverged `wire/` would mean a merge every week and a growing gap under every module's `Inputfield` base class.

## Decision

Bridge is a distribution: an unmodified upstream `wire/` as a dependency, replaced wholesale on upgrade, plus our own modules, runtime and bootstrap. Nothing is ever patched into `wire/`. The one hand-carried override that exists locally (a `_patches/` folder) is not continued.

## Consequences

- Upgrades are "replace `wire/`, run the conformance suite".
- Anything we need inside `wire/` is proposed upstream as a pull request (see `docs/upstream/`).
- Compatibility claims rest on public, hookable API only.

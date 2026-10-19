# ADR 0009: Pro modules postponed

Status: accepted, 2026-10-14. Source: owner decision 2026-10-14.

## Context

No ProFields (Table, Combo, RepeaterMatrix), FormBuilder or ListerPro license exists on this machine or on any client site. Pro modules are licensed per purchaser and per site, supported through the VIP board, and supported by the author only on his own admin themes. Obtaining them for a project whose admin he does not support is a legal and social question, not a technical one.

## Decision

Pro modules are out of the gate 1 criteria for now. No public text claims Pro compatibility until this decision is revisited. The legacy bridge is still built to the full upstream runtime contract, and open-source modules with the same patterns stand in: PageTableNext and FieldtypeMatrix (table and matrix editing), core Repeater and PageTable (nested AJAX fields), VersionControl (heavy Process module). `conformance/modules.txt` lists the Pro set with status `postponed` so the gap is visible in every run.

## Revisit when

Phase 1 is public and received; a licensee offers a test site; or upstream responds to the PRs in `docs/upstream/`. Then: buy, borrow, or declare Pro support out of scope.

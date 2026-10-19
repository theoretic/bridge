# ADR 0006: Own name, MIT for own code, MPL for derived files, ProcessWire namespace kept

Status: accepted, 2026-10-14. Source: ProcessWire Fork Review (2026-10-06), owner decisions 2026-10-14.

## Context

ProcessWire 3.x is MPL 2.0; MPL section 2.3 grants no trademark rights. The `ProcessWire\` PHP namespace is load-bearing for every module. Our own files may carry any license; files started from upstream code stay MPL 2.0 (file-level copyleft).

## Decision

- Working name "Bridge"; the final name is chosen after a trademark check, before any public announcement. Public wording is "based on ProcessWire".
- Original files are MIT (`LICENSE`). Files derived from upstream keep the MPL 2.0 header plus a modification note; `bootstrap/index.php` is the first such file.
- The PHP namespace stays `ProcessWire`.

## Consequences

- The repository mixes two licenses by file; each file's header is authoritative.
- Copyright holder on the MIT text: Alexei Tarasov.

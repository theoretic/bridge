# ADR 0002: No jQuery by default, legacy bridge on demand

Status: accepted, 2026-10-14. Source: ProcessWire Fork Review (2026-10-06).

## Context

The admin is the sum of every `Inputfield::render()` on the page. Core and third-party Inputfields ship markup and JavaScript written against jQuery, jQuery UI and `wire/templates-admin/scripts/inputfields.js`. Dropping that runtime breaks every module we did not write.

## Decision

The Bridge shell loads no jQuery. When a request renders an Inputfield that does not implement the component contract, the full legacy stack is loaded in upstream order with upstream globals (`$`, `jQuery`, `ProcessWire.config`, `Inputfields`, `WireTabs`) and the `reloaded` event. Detection happens server side (hook after `InputfieldWrapper::renderInputfield`) as an optimisation and client side (a `<pw-field>` seeing legacy content, including AJAX-loaded fields) as the guarantee.

## Consequences

- "Full compatibility" means every module runs unchanged on the runtime it was written for, inside the new shell.
- The bridge is a first-class deliverable with its own conformance gate (ADR 0007).

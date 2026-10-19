# ADR 0005: Shadow DOM only for our own components

Status: accepted, 2026-10-14. Source: ProcessWire Fork Review (2026-10-06).

## Context

Legacy scripts query the document directly (`$('#Inputfield_title')`, `$(document).on('reloaded', ...)`). Markup inside a shadow root is invisible to them.

## Decision

Legacy Inputfield markup always lives in light DOM. Shadow DOM is used only inside Bridge's own components, and never around slots that carry upstream or third-party markup.

## Consequences

- `<pw-field>` renders its chrome in shadow DOM and projects the field content as light-DOM children.
- Styling of legacy content comes from page-level CSS, as upstream does it.

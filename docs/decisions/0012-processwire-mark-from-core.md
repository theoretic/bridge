# ADR 0012: The masthead shows the ProcessWire mark from the installed core

Status: accepted, 2026-10-14. Source: owner decision 2026-10-14.

## Context

The masthead showed Bridge's own mark and the word "Bridge"; the owner prefers the ProcessWire
logo. ProcessWire's core is MPL 2.0, and MPL section 2.3 grants no rights in trademarks or logos,
so the logo file may be copied as code but the mark itself is not licensed. No published
ProcessWire trademark policy was found (2026-10-14); a 2012 forum thread advises third-party
modules not to use the logo in ways that suggest an official connection.

## Decision

- Default logo: the core's own `wire/modules/AdminTheme/AdminThemeUikit/themes/default/logo.svg`,
  read at runtime from the installed core and inlined unmodified (`fill="currentColor"` as shipped;
  only `role`/`aria-label` are added). Bridge's repository does not contain a copy.
- No product wordmark next to it. The footer keeps "Bridge, based on ProcessWire" (ADR 0006).
- The `logoURL` / `logoURLDark` settings still replace it with a site's own brand.
- If a future core moves the file, the masthead shows the text "ProcessWire".
- Bridge's own mark (`assets/logo.svg`) is removed.

## Consequences

- Inside a site's admin the mark identifies the software the site runs (nominative use), as the
  core themes do.
- Bridge's public presence (repository, module directory, announcements) does not use the mark.
  Before any public release, the trademark check of ADR 0006 includes asking the ProcessWire
  author whether the mark may appear in a third-party admin shell.

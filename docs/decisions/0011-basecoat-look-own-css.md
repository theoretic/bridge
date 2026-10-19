# ADR 0011: Basecoat UI look on the own token CSS, no Basecoat dependency

Status: accepted, 2026-10-14. Supersedes the "Boss is the design spec" clause of ADR 0010; the rest
of ADR 0010 (own token CSS, legacy jQuery UI skin, no other themes' assets) stands.

## Context

Two UI audit rounds after phase 1.6 felt slow, and the owner proposed switching the visual
foundation to Basecoat UI (shadcn-style, Tailwind-authored), keeping AdminThemeBoss as a visual
reference only.

The audit glitches came from four sources Basecoat does not touch, and one it does:

| Cause | Basecoat helps? |
|---|---|
| Upstream JS behaviour (main.js dropdown positioning, head-button copies, notices, nav timing) | no |
| Structural rules for ProcessWire classes (InputfieldHidden, button rows, file lists, tree carets) | no |
| jQuery UI widget skin (dialog, menu, datepicker, autocomplete) | no |
| `uk-*` classes emitted by third-party modules | no |
| Plain control visuals | partly |

Bridge never loaded Boss's Uikit (`_head.php` drops other themes' assets); the jQuery on admin
pages comes from ProcessWire core and modules.

Basecoat 1.0.2 (researched 2026-10-14, jsDelivr / GitHub):
- **Licence and maintenance:** MIT. One maintainer has made almost all commits, and no fixes have
  been merged since July 2026.
- **Size:** the precompiled `basecoat.cdn.min.css` is 21.8 kB gzip.
- **Tailwind reset:** the bundle includes the full Tailwind preflight, and Basecoat depends on it.
- **Cascade layers:** all its rules sit in layers, so every unlayered legacy stylesheet beats them.
- **Class names:** a class on every control (`.btn`, `.input`, `select.select`). Container
  styling (`.form`) was removed in 1.0. `@apply btn` on own selectors does not compile
  (issue #184).
- **Widget markup:** tabs, dropdown, popover and dialog need their own ARIA markup and JS. None of
  them matches WireTabs, `.pw-dropdown-menu`, `ul.pw-button-dropdown` or `.ui-dialog`.

## Decision

- Keep Bridge's own token CSS as the foundation. Do not ship Basecoat, Tailwind or a reset.
- **Look:** Basecoat's default "vega" style, hand-ported onto the selectors Bridge already
  styles. That means:
  - Sentence-case type, 14 px controls, weight 500/600.
  - Hairline borders, `--radius: .625rem`, shadcn shadows.
  - Popover menus, segmented tabs, outline/ghost buttons, bordered alerts, calendar datepicker,
    and a card login.
- **Colours:** AdminThemeBoss supplies them. The five variant presets and the custom hex set
  `--primary` (via `--pw-primary`). The dark scheme uses vega's dark neutrals.
- **Tokens:** use the shadcn names (`--background`, `--foreground`, `--card`, `--popover`,
  `--primary(-foreground)`, `--secondary`, `--muted(-foreground)`, `--accent`, `--destructive`,
  `--border`, `--input`, `--ring`, `--radius`, `--radius-sm/md/lg/xl`, `--shadow-xs/sm/md/lg`).
  This way tweakcn / shadcn themes map one to one. The `--pw-*` names of ADR 0010 stay as aliases.
- **Font:** Geist, Basecoat's default (OFL), self-hosted as two variable woff2 subsets (latin
  29 kB, cyrillic 15 kB, all weights) from `@fontsource-variable/geist` 5.3.0. The platform UI
  font is the fallback. Roboto Condensed is removed.
- **Phase 2:** Bridge-owned components, where Bridge controls the markup, may adopt real Basecoat
  markup and, if worthwhile, a compiled Basecoat subset scoped to them.

## Consequences

- No new dependency, no reset under legacy module CSS. The CSS budget goes from 11 to 12 kB gzip
  (11.3 kB used): the Geist `@font-face` rules plus headroom.
- **Conformance:** the change is CSS-only, so server markup is untouched and the gate digests do
  not move.
- **Look:** the admin looks like a shadcn application. Boss's uppercase condensed type and
  primary-tinted shadows are gone.
- **Upstream changes:** Basecoat changes are not picked up automatically. Visual updates are
  ported by hand when wanted.

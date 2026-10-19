# ADR 0010: Visual layer as own token-based CSS, AdminThemeBoss as the design spec

Status: accepted, 2026-10-14. Source: owner decisions 2026-10-14, phase 1.6 plan.

## Context

After gate 1 the theme worked everywhere but looked plain. The owner chose AdminThemeBoss (a
Uikit-based third-party theme installed on 21 local sites) as the visual reference, including its
settings, and asked for the "minimal, structurally clean source giving the minimal production
bundle" among three routes. Measured on 2026-10-14 (jsDelivr, gzip -9):

| Route | CSS gzip | JS gzip | Fit for upstream ProcessWire markup |
|---|---|---|---|
| AdminThemeBoss as is | ~355 kB minified UIkit rc.17 build, loaded on top of the stock 354 kB | UIkit JS 53 kB + icons 21 kB | styles uk-* markup Bridge does not emit |
| Franken UI 2.1.2 | 26.4 kB | 76.8 kB, required for dropdown/modal/tabs | deprecated 2026-06-11; partial uk-* compatibility |
| 0build 0.6.12 | 78.5 kB | 98 kB | z-* classes, one maintainer, pre-1.0 |
| Basecoat 1.0.2 | 12.1 kB base, 21.8 kB full | 0 required | own class names and ARIA structures; Tailwind preflight under every legacy module |

The Boss look itself reduces to about 40 tokens (one primary per variant, primary-tinted shadows,
Roboto Condensed with uppercase labels, 4-5 px radii, toggle switches, card login) and a dozen
component rules. Everything ProcessWire-specific (Inputfield wrappers, page tree, WireTabs, pager,
notices, jQuery UI widgets) needs hand-written CSS with any framework.

## Decision

- Own CSS on custom-property tokens, written against upstream class names (ADR 0003) and the
  theme's own frame. Source `runtime/src/styles/*.css`, one file per area, built by the existing
  Vite pipeline into `modules/AdminThemeBridge/assets/dist/theme.css` (flat, minified, committed).
  Budget 8 kB gzip, checked on every build by `runtime/scripts/check-css.mjs`; raised to 11 kB
  on 2026-10-14 after the UI audit, for the Uikit utility compat layer third-party modules need
  (`95-uikit-compat.css`, ~1.5 kB) and structural parity rules from Uikit's `pw-*.less` (~1 kB).
- Boss is the spec for values, not a dependency. No UIkit, Franken UI or Basecoat CSS ships.
- Roboto Condensed self-hosted (woff2, latin + cyrillic, 300/400/700, SIL OFL 1.1).
- Variants blue/vibrant/black/pink/green plus a custom primary (`data-pw-variant` and
  `--pw-primary` on `<html>`); dark scheme from the start (`data-pw-scheme`, setting plus a user
  toggle; legacy module CSS stays light).
- The jQuery UI skin (`wire/templates-admin/styles/JqueryUI/JqueryUI.css`) is part of the legacy
  stack: printed with it or loaded with it on demand, always before theme.css; native pages carry
  none of it.
- Class names the theme adds go on controls and content elements only, never on `li.Inputfield`,
  so the conformance suite's wrapper comparison stays meaningful.
- Assets of other admin themes are dropped from Bridge pages (AdminThemeBoss appends its full
  Uikit build on every admin request, whatever the current theme).

## Consequences

- One small stylesheet to maintain, no third-party CSS under legacy modules, nothing to upgrade.
- Visual parity with Boss is a manual target, checked by screenshot pairs (phase 1.6 M4).
- Uikit-specific module CSS (InputfieldTextTags, one InputfieldImage rule) loses its Uikit
  branch; covered case by case in `21-controls.css`.

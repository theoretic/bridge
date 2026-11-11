# ADR 0023: Appearance seams for extensions

Status: accepted, 2026-11-11; built in theme 0.30.0 (extension contract stays 0.2). Source: the
owner's brief for Bridge Customizer (2026-11-11), a site-wide appearance extension built outside
this repository, and his answers while planning it (2026-11-11).

## Context

Bridge Customizer sets the admin's look for a whole site: a palette for the light and the dark
scheme, an uploaded logo and favicon, the login screen's logo, background and heading, an admin
title, the radius, the label size and the control height. The theme already had Appearance
settings (`variant`, `primaryColor`, `colorScheme`, `logoURL`, `logoURLDark`, `maxWidth`), but no
seam through which an extension could supply any of them:

1. `renderLogo()`, `siteVariant()`, `sitePrimaryColor()`, `getColorScheme()` and `getMaxWidth()`
   read the stored settings directly. `getBrowserTitle()` overrides a core method that is not
   hookable. There was no favicon at all.
2. Extension stylesheets (`styles`) and slots print for signed-in users only, and the theme's
   style-order code moves a stray `<style>` in front of `theme.css`. The login screen could not be
   restyled by an extension.
3. Label size and control height were literal values in the stylesheets (`.875rem`, `36px`,
   `2.125rem`), not tokens or settings.
4. `init()` added the body classes `pw-variant-*` and `pw-scheme-*`. The theme and an extension
   both autoload on `template=admin`, and the order of their `init()` is not fixed, so a class
   computed there could disagree with `data-pw-variant` on `<html>`.

## Decision

1. **Four hookable methods, one printed style.** Nothing is renamed and no signature changes.
   - `___appearance()` returns the Appearance settings in effect (by default the stored ones,
     with `labelSize` and `controlHeight`). Every reader asks it on each call and validates what
     it gets as it does a stored value. It overrides the *site's* colour, so a user's own colour
     (`userColors`) still wins and "Site default" in the picker returns to the extension's. The
     theme's config screen shows and saves the stored values and notes each field an extension
     overrides. `isLoginScreen()` becomes a read, so a hook can answer otherwise on the login card.
   - `___tokenOverrides()` returns site-wide values for surface tokens in the groups `all`,
     `light` and `dark`. `tokenCss()` checks them (name on the surface, value out of a safe
     character set, at most 300 characters) and the theme prints one
     `<style data-pw-keep data-pw-tokens>` with the nonce after `fields.css`, in every layout,
     the login screen included. Selectors: `:root:root`; `:root:not([data-pw-scheme=dark]),body.light-theme`;
     `:root[data-pw-scheme=dark],body.dark-theme`. (0,2,0) beats the theme's declarations in any
     order, a light value cannot reach the dark scheme, and an element with its own
     `data-pw-scheme` (a preview pane) keeps the theme's colours. The `body` selectors were added
     during implementation (owner's decision): on a page with the UIkit layer, `uikit.css`
     declares the scheme colours again on `.light-theme`/`.dark-theme`, which the layer puts on
     `<body>`, and the root values did not reach the page.
   - `___adminTitle($place)` (`browser`, `masthead`, `login`) gives the admin's own name in the
     browser title, after the logo in the masthead and in the login card (`renderAdminTitle()`,
     `<span class='pw-admin-title'>`).
   - `___faviconUrl()`: when not empty, `<link rel='icon'>` after `<title>`.
   - The body classes are added at render time (`getBodyClass()`), not in `init()`.
2. **Label size and control height become theme settings and tokens.** Settings `labelSize`
   (12..20 px, default 14) and `controlHeight` (28..56 px, default 36); tokens `--pw-label-size`
   (`.875rem`) and `--pw-control-height` (`2.25rem`), in rem so the interface scale keeps
   working; a non-default value goes through the default of `tokenOverrides()`. A third token,
   `--pw-login-bg` (`var(--muted)`), is the login page's background. At 100 % scale every computed
   size stays as it was.
3. **The extension contract stays 0.2; the theme goes to 0.30.0.** Only entries were added to
   four surface lists (hooks 17 → 21, reads 14 → 19, settings 20 → 22, tokens 73 → 76), no
   manifest key and no surface key, as 0.28.0 added `navCacheKey` within 0.1. An extension that
   needs the seams declares `requires AdminThemeBridge>=0.30.0`; the compatibility checker
   reports a hook, read, setting or token an older surface lacks.
4. **CSP.** The token style carries the nonce like every `<style>` of `_head.php`; the favicon is
   a `<link rel='icon'>`, neither a script nor a style source; the title is escaped text.
5. **The login screen.** Extension stylesheets and slots stay signed-in only. Login branding is
   what the four hookables reach: logo (`appearance()` with `isLoginScreen()`), background
   (`--pw-login-bg` per scheme), heading (`adminTitle('login')`), favicon and the palette.

## Alternatives rejected

- **The extension prints its own `<style>`.** The `head` slot and `styles` print for signed-in
  users only, the style-order code moves a stray style in front of `theme.css`, and the nonce and
  the token check belong in the theme. One theme-printed style also keeps every site-wide value
  in one checked place.
- **Extension contract 0.3.** It would turn over every "contract 0.2" pin (the docs' title,
  section 11's name, the README, the scaffold's `^0.2`, about ten smoke lines) for no gain: no
  manifest key changes, and the compatibility checker already catches a missing entry.
- **Moving the Appearance settings out of the theme.** The owner kept them in the theme: a site
  without the extension keeps working as before, and an extension overrides them in effect,
  never in storage.

## Consequences

- An extension can brand the admin, the login screen included, without a stylesheet and without
  touching the theme's stored settings; uninstalling it returns to them.
- `tokenCss()` is the single gate for site-wide token values; a value it cannot prove safe
  (a `:` included, so a URL with a scheme) is dropped, and extensions use root-relative URLs.
- A site's own copy of `_head.php` prints neither the token style nor the favicon until it adds
  the two lines in `docs/extensions.md` section 13.
- At another interface scale an input's minimum height now scales as the buttons do (it was a
  fixed 36 px), and a button's height can differ by under 1 px.
- New tooling: `tools/sandbox-extension.php` puts an outside extension into a sandbox for its
  checks and takes it out again, since an installed third-party extension breaks the bundled
  set's smoke pins.

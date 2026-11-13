# Bridge public surface at 1.0

An inventory of everything the extension contract publishes, taken before AdminThemeBridge 1.0.0
froze it. For each entry: where it is defined, where it is documented, who uses it, and its
status for 1.x. The lists are `AdminThemeBridge::extensionSurface()` (the same as the built
`modules/AdminThemeBridge/assets/dist/extension-surface.json`, contract 1.0, contracts 0.1, 0.2,
1.0), followed by the client API that `docs/contract.md` section 4 documents beyond the `runtime`
list. The inventory was taken on contract 0.2; the rulings of "For the maintainer" (below) are
applied to the tables.

How to read the columns:

- **Defined**: `file:line`; paths without a directory prefix are under `modules/AdminThemeBridge/`.
- **Documented**: `docs/contract.md` (contract.md), `docs/extensions.md` (extensions.md),
  `docs/access-control.md`, `README.md`, with section numbers. Section 3 of extensions.md lists
  every entry and is not counted (its table of entries no other section describes is). ADRs are
  decision records: an entry named only there is marked "ADR … only".
- **Used by**: found by searching the repository and two third-party extensions,
  BridgeCustomizer and BridgeQuiet. Bundled modules (BridgeCsp, BridgeDemo, BridgeSample,
  BridgeAdminAccessControl) and the third-party ones are named; `tools` are the browser and
  contract checks under `tools/` and `conformance/`; "smoke" is `tests/smoke.php`; "docs
  example" is a code sample in the docs. The theme's own use is not listed. "none found" means
  what it says: a site or an unpublished module may still use it.
- **Status**: `stable` (kept for all of 1.x), or `candidate: internal` / `candidate: rename`
  with the reason in the last column. Candidates were proposals, decided before the contract was
  set to 1.0 (all ruled, see "For the maintainer"); none is left in the tables.

## Counts

| List | In `extensionSurface()` | Rows below |
|---|---|---|
| hooks | 21 | 21 |
| reads | 18 | 18 |
| settings | 22 | 22 |
| slots | 8 | 8 |
| tokens | 78 | 78 |
| events | 28 | 28 |
| runtime | 12 | 12 |

Total: 187 entries (182 on contract 0.2: one read taken off, four events and two tokens added).

## Hooks

Hookable methods of `AdminThemeBridge`, attached as `AdminThemeBridge::<name>`. "Defined" is the `___<name>()` method.

| Name | Defined | Documented | Used by | Status | Note |
|---|---|---|---|---|---|
| `install` | `AdminThemeBridge.module.php:565` | core's `Module` interface | none found | stable | Module lifecycle; on the list because the surface lists every `___` method of the class |
| `uninstall` | `AdminThemeBridge.module.php:577` | core's `Module` interface | none found | stable | as `install` |
| `nonce` | `lib/AdminThemeBridgeCsp.php:38` | README.md Content-Security-Policy; contract.md 2.1, 4.1; extensions.md 7 | BridgeCsp; BridgeCustomizer; tools (csp-check.js); smoke; docs example (contract.md 2.1) | stable |  |
| `moveFiles` | `lib/AdminThemeBridgeFiles.php:140` | contract.md 4.4 | smoke | stable |  |
| `moveFileAllowed` | `lib/AdminThemeBridgeFiles.php:308` | contract.md 4.4 | smoke | stable |  |
| `filesMoved` | `lib/AdminThemeBridgeFiles.php:321` | contract.md 4.4 | none found | stable |  |
| `historyEntry` | `lib/AdminThemeBridgeHistory.php:228` | contract.md 4.1 | smoke | stable |  |
| `nativeMap` | `lib/AdminThemeBridgeLegacy.php:316` | README.md For module authors; contract.md 3 | smoke; docs example (contract.md 3) | stable |  |
| `isNativeProcess` | `lib/AdminThemeBridgeLegacy.php:400` | contract.md 3 | smoke | stable |  |
| `isNativeInputfield` | `lib/AdminThemeBridgeLegacy.php:466` | contract.md 2, 3 | smoke | stable |  |
| `scriptNeeds` | `lib/AdminThemeBridgeLegacy.php:557` | contract.md 3 | smoke; docs example (contract.md 3) | stable |  |
| `renderBreadcrumbs` | `lib/AdminThemeBridgeShell.php:811` | extensions.md 2, extensions.md 3 (entries no other section describes) | docs example (extensions.md 2) | stable | its outer `nav.pw-breadcrumbs-nav` > `ul.pw-breadcrumbs` and when it is empty are documented |
| `sortableDataTable` | `lib/AdminThemeBridgeTables.php:95` | contract.md 4.4 | smoke | stable |  |
| `uikitReasons` | `lib/AdminThemeBridgeUikit.php:261` | contract.md 3.1 | none found | stable |  |
| `extensionSurface` | `lib/AdminThemeBridgeExtensions.php:400` | extensions.md 3, 8 | tools (extension-check.php, extension-compat.php); smoke | stable | a hook may add to the lists; the contract tests read the hooked result |
| `drawerNames` | `lib/AdminThemeBridgeDrawers.php:28` | extensions.md 4, 7 | BridgeAdminAccessControl; smoke | stable |  |
| `navCacheKey` | `lib/AdminThemeBridgeShell.php:617` | access-control.md Covered; contract.md 1; extensions.md 3, 7 | BridgeAdminAccessControl; smoke | stable |  |
| `tokenOverrides` | `lib/AdminThemeBridgeHead.php:103` | extensions.md 3, 13 | BridgeCustomizer; smoke; docs example (extensions.md 13) | stable |  |
| `appearance` | `lib/AdminThemeBridgeShell.php:61` | contract.md 4.0; extensions.md 3, 13 | BridgeCustomizer; smoke; docs example (extensions.md 13) | stable |  |
| `adminTitle` | `lib/AdminThemeBridgeShell.php:344` | contract.md 4.0; extensions.md 3, 13 | BridgeCustomizer; smoke; docs example (extensions.md 13) | stable |  |
| `faviconUrl` | `lib/AdminThemeBridgeShell.php:383` | contract.md 4.0; extensions.md 3, 13 | BridgeCustomizer; smoke; docs example (extensions.md 13) | stable |  |

## Reads

Public methods an extension may call (`reads` in its manifest). "Defined" is the method.

| Name | Defined | Documented | Used by | Status | Note |
|---|---|---|---|---|---|
| `useLegacyStack` | `lib/AdminThemeBridgeLegacy.php:516` | extensions.md 7 | BridgeCsp; smoke | stable |  |
| `componentInfo` | `lib/AdminThemeBridgeComponents.php:40` | extensions.md 9 | smoke | stable |  |
| `extensions` | `lib/AdminThemeBridgeExtensions.php:27` | extensions.md 2, 6 | BridgeCustomizer; tools (ci.sh, extension-check.php, sandbox-fixture.php); smoke | stable |  |
| `extensionInfo` | `lib/AdminThemeBridgeExtensions.php:96` | extensions.md 9 | tools (extension-check.php); smoke | stable |  |
| `extensionAllowed` | `lib/AdminThemeBridgeExtensions.php:190` | extensions.md 3 (entries no other section describes) | none found | stable |  |
| `extensionStyles` | `lib/AdminThemeBridgeExtensions.php:228` | extensions.md 2, 12 | smoke | stable |  |
| `cspNonce` | `lib/AdminThemeBridgeCsp.php:54` | contract.md 2.1 | smoke | stable |  |
| `nonceAttr` | `lib/AdminThemeBridgeCsp.php:68` | README.md For module authors; contract.md 2.1; extensions.md 7 | BridgeDemo; smoke; docs example (contract.md 2.1) | stable |  |
| `nonceScriptTag` | `lib/AdminThemeBridgeCsp.php:92` | extensions.md 3 (entries no other section describes) | smoke | stable | the `<script>` counterpart of `nonceAttr()` |
| `getVariant` | `lib/AdminThemeBridgeShell.php:18` | extensions.md 3 (entries no other section describes) | smoke | stable |  |
| `getColorScheme` | `lib/AdminThemeBridgeShell.php:41` | extensions.md 3 (entries no other section describes); ADR 0023 | smoke | stable |  |
| `shellLabel` | `lib/AdminThemeBridgeShell.php:559` | extensions.md 3 (entries no other section describes) | the shell templates (`_main.php`, `_masthead.php`, `_footer.php`), so a site's copy of them; smoke | stable | its keys are frozen: added, never renamed or removed in 1.x |
| `getHistorySteps` | `AdminThemeBridge.module.php:689` | extensions.md 3 (entries no other section describes) | smoke | stable | the `historySteps` setting clamped |
| `tokenCss` | `lib/AdminThemeBridgeHead.php:127` | contract.md 4.0; extensions.md 3, 13 | smoke | stable |  |
| `getLabelSize` | `lib/AdminThemeBridgeShell.php:919` | extensions.md 3 | BridgeCustomizer; smoke | stable |  |
| `getControlHeight` | `lib/AdminThemeBridgeShell.php:930` | extensions.md 3 | BridgeCustomizer; smoke | stable |  |
| `isLoginScreen` | `lib/AdminThemeBridgeShell.php:300` | extensions.md 3, 13 | BridgeCustomizer; smoke | stable |  |
| `renderAdminTitle` | `lib/AdminThemeBridgeShell.php:368` | extensions.md 3, 13 | smoke | stable |  |

## Settings

Theme settings an extension may read (`settings` in its manifest). "Defined" is the default in `__construct()`; every one is a field of the module's config screen.

| Setting | Defined | Config field | Documented | Used by | Status | Note |
|---|---|---|---|---|---|---|
| `legacyStack` | `AdminThemeBridge.module.php:528` | Legacy > Legacy script stack (jQuery, jQuery UI, inputfields.js, main.js) | contract.md 3; README (by its label) | none found | stable |  |
| `uikit` | `AdminThemeBridge.module.php:529` | Legacy > UIkit for modules written for AdminThemeUikit | contract.md 3.1 | smoke | stable |  |
| `maxWidth` | `AdminThemeBridge.module.php:530` | Appearance > Maximum content width (px), 0 for none | extensions.md 13 | smoke | stable |  |
| `variant` | `AdminThemeBridge.module.php:531` | Appearance > Colour | contract.md 4.0; extensions.md 13 | BridgeCustomizer; smoke; docs example (extensions.md 13) | stable |  |
| `primaryColor` | `AdminThemeBridge.module.php:532` | Appearance > Custom colour | extensions.md 13 | BridgeCustomizer; smoke; docs example (extensions.md 13) | stable |  |
| `colorScheme` | `AdminThemeBridge.module.php:533` | Appearance > Colour scheme | contract.md 4.1; extensions.md 13 | smoke | stable |  |
| `logoURL` | `AdminThemeBridge.module.php:534` | Appearance > Logo URL | extensions.md 13 | BridgeCustomizer; smoke; docs example (extensions.md 13) | stable |  |
| `logoURLDark` | `AdminThemeBridge.module.php:535` | Appearance > Logo URL for the dark scheme | extensions.md 13 | BridgeCustomizer; smoke | stable |  |
| `extendedBreadcrumbs` | `AdminThemeBridge.module.php:536` | Features > Extended breadcrumbs | extensions.md 3 (entries no other section describes) | smoke | stable |  |
| `pageTreeDrawer` | `AdminThemeBridge.module.php:537` | Features > Page tree on each page | README (by its label) | smoke | stable |  |
| `history` | `AdminThemeBridge.module.php:538` | Features > Show history | contract.md 4.1; install-live.md Checklist; README (by its label) | smoke | stable |  |
| `historySteps` | `AdminThemeBridge.module.php:539` | Features > History steps | README (by its label) | smoke | stable |  |
| `pageSaveInPlace` | `AdminThemeBridge.module.php:540` | Features > Save without reload | contract.md 4.3 | none found | stable |  |
| `pageAddSkipTemplate` | `AdminThemeBridge.module.php:541` | Features > Step 2 if template auto-selected | contract.md 4.4 | smoke | stable |  |
| `dangerWarn` | `AdminThemeBridge.module.php:542` | Features > Warn before risky actions | contract.md 4.2; README (by its label) | smoke | stable |  |
| `userColors` | `AdminThemeBridge.module.php:543` | Appearance > Users choose their own colour | extensions.md 13 | BridgeCustomizer; smoke | stable |  |
| `dataTableSortRows` | `AdminThemeBridge.module.php:544` | Features > Datatable sortable rows threshold | contract.md 4.4 | smoke | stable |  |
| `printScripts` | `AdminThemeBridge.module.php:545` | Legacy > Site scripts that never wait for the legacy stack | contract.md 3; README (by its label) | smoke | stable |  |
| `nativeOverrides` | `AdminThemeBridge.module.php:546` | Legacy > Native or legacy, per class | contract.md 3; README (by its label) | smoke | stable |  |
| `extensionDev` | `AdminThemeBridge.module.php:547` | Features > Extension development | extensions.md 9 | smoke | stable |  |
| `labelSize` | `AdminThemeBridge.module.php:548` | Appearance > Field label size (rem) | contract.md 4.0; extensions.md 3, 13 | BridgeCustomizer; smoke; docs example (extensions.md 13) | stable |  |
| `controlHeight` | `AdminThemeBridge.module.php:549` | Appearance > Control height (rem) | contract.md 4.0; extensions.md 3, 13 | BridgeCustomizer; smoke | stable |  |

## Slots

Shell regions an extension fills (`slots` in its manifest, `docs/extensions.md` 4). "Defined" is the slot's entry in `slotTags()`.

| Name | Defined | Documented | Used by | Status | Note |
|---|---|---|---|---|---|
| `head` | `lib/AdminThemeBridgeExtensions.php:262` | extensions.md 3, 4, 12 | tools (extension-check.js, extension-check.php, scaffold-extension.php); smoke | stable |  |
| `masthead` | `lib/AdminThemeBridgeExtensions.php:263` | extensions.md 3, 4, 13 | BridgeCustomizer; tools (scaffold-extension.php); smoke | stable |  |
| `masthead-right` | `lib/AdminThemeBridgeExtensions.php:264` | extensions.md 4, 7 | BridgeSample; tools (scaffold-extension.php); smoke | stable |  |
| `user-nav` | `lib/AdminThemeBridgeExtensions.php:265` | extensions.md 4, 7 | BridgeSample; tools (scaffold-extension.php); smoke | stable |  |
| `content-head-buttons` | `lib/AdminThemeBridgeExtensions.php:266` | extensions.md 4, 7 | BridgeSample; tools (scaffold-extension.php); smoke | stable |  |
| `footer` | `lib/AdminThemeBridgeExtensions.php:267` | extensions.md 4, 7 | BridgeSample; tools (extension-check.php, scaffold-extension.php); smoke | stable |  |
| `drawer` | `lib/AdminThemeBridgeExtensions.php:268` | extensions.md 4, 6, 7 | BridgeSample; tools (extension-check.js, extension-check.php, scaffold-extension.php); smoke | stable |  |
| `body` | `lib/AdminThemeBridgeExtensions.php:269` | extensions.md 3, 4, 7, 13 | BridgeSample; tools (extension-check.php, scaffold-extension.php); smoke | stable |  |

## Tokens

CSS custom properties an extension's stylesheets may read or set (`tokens` in its manifest). Names are promised, values are not. "Defined" is the first declaration in `runtime/src/styles/00-tokens.css`.

| Name | Defined | Documented | Used by | Status | Note |
|---|---|---|---|---|---|
| `--background` | `runtime/src/styles/00-tokens.css:18` | contract.md 4.0; extensions.md 13 | BridgeCustomizer; BridgeQuiet; smoke; docs example (extensions.md 13) | stable |  |
| `--foreground` | `runtime/src/styles/00-tokens.css:19` | contract.md 4.0 | BridgeCustomizer; BridgeQuiet; smoke | stable |  |
| `--card` | `runtime/src/styles/00-tokens.css:20` | contract.md 4.0 | BridgeCustomizer; smoke | stable |  |
| `--card-foreground` | `runtime/src/styles/00-tokens.css:21` | contract.md 4.0 | BridgeCustomizer | stable |  |
| `--popover` | `runtime/src/styles/00-tokens.css:22` | contract.md 4.0 | BridgeCustomizer | stable |  |
| `--popover-foreground` | `runtime/src/styles/00-tokens.css:23` | contract.md 4.0 | BridgeCustomizer | stable |  |
| `--primary` | `runtime/src/styles/00-tokens.css:121` | contract.md 4.0 | BridgeQuiet; smoke | stable |  |
| `--primary-foreground` | `runtime/src/styles/00-tokens.css:47` | contract.md 4.0 | none found | stable |  |
| `--secondary` | `runtime/src/styles/00-tokens.css:24` | contract.md 4.0 | BridgeCustomizer | stable |  |
| `--secondary-foreground` | `runtime/src/styles/00-tokens.css:25` | contract.md 4.0 | BridgeCustomizer; smoke | stable |  |
| `--muted` | `runtime/src/styles/00-tokens.css:26` | contract.md 4.0 | BridgeCustomizer; BridgeQuiet; smoke | stable |  |
| `--muted-foreground` | `runtime/src/styles/00-tokens.css:27` | contract.md 4.0; extensions.md 7, 10 | BridgeSample; BridgeCustomizer; BridgeQuiet; tools (scaffold-extension.php); smoke | stable |  |
| `--accent` | `runtime/src/styles/00-tokens.css:28` | contract.md 4.0 | BridgeCustomizer; smoke | stable |  |
| `--accent-foreground` | `runtime/src/styles/00-tokens.css:29` | contract.md 4.0 | BridgeCustomizer | stable |  |
| `--destructive` | `runtime/src/styles/00-tokens.css:30` | contract.md 4.0 | BridgeCustomizer; BridgeQuiet; smoke | stable |  |
| `--border` | `runtime/src/styles/00-tokens.css:31` | contract.md 4.0 | BridgeCustomizer; smoke | stable |  |
| `--input` | `runtime/src/styles/00-tokens.css:32` | contract.md 4.0 | BridgeCustomizer; BridgeQuiet; tools (a11y-check.js); smoke | stable |  |
| `--ring` | `runtime/src/styles/00-tokens.css:125` | contract.md 4.0; extensions.md 13 | BridgeQuiet; tools (screens-check.js); smoke | stable | contract.md 4.0 says `--ring-50` is internal (ruled 2026-11-13) |
| `--radius` | `runtime/src/styles/00-tokens.css:59` | contract.md 4.0; extensions.md 13 | BridgeCustomizer; smoke; docs example (extensions.md 13) | stable |  |
| `--radius-sm` | `runtime/src/styles/00-tokens.css:130` | contract.md 4.0 | smoke | stable |  |
| `--radius-md` | `runtime/src/styles/00-tokens.css:131` | contract.md 4.0 | BridgeQuiet; smoke | stable |  |
| `--radius-lg` | `runtime/src/styles/00-tokens.css:132` | contract.md 4.0 | none found | stable |  |
| `--radius-xl` | `runtime/src/styles/00-tokens.css:133` | contract.md 4.0 | BridgeCustomizer; smoke | stable |  |
| `--shadow-xs` | `runtime/src/styles/00-tokens.css:33` | contract.md 4.0 | none found | stable |  |
| `--shadow-sm` | `runtime/src/styles/00-tokens.css:34` | contract.md 4.0 | BridgeCustomizer; smoke | stable |  |
| `--shadow-md` | `runtime/src/styles/00-tokens.css:35` | contract.md 4.0 | none found | stable |  |
| `--shadow-lg` | `runtime/src/styles/00-tokens.css:36` | contract.md 4.0 | none found | stable |  |
| `--pw-primary` | `runtime/src/styles/00-tokens.css:50` | contract.md 4.0 | BridgeCustomizer; tools (a11y-check.js); smoke | stable |  |
| `--pw-primary-hover` | `runtime/src/styles/00-tokens.css:168` | contract.md 4.0; extensions.md 13 | none found | stable |  |
| `--pw-primary-bg` | `runtime/src/styles/00-tokens.css:171` | contract.md 4.0 | none found | stable |  |
| `--pw-primary-20` | `runtime/src/styles/00-tokens.css:170` | contract.md 4.0 | none found | stable |  |
| `--pw-on-primary` | `runtime/src/styles/00-tokens.css:166` | contract.md 4.0 | none found | stable |  |
| `--pw-bg` | `runtime/src/styles/00-tokens.css:140` | contract.md 4.0 | none found | stable |  |
| `--pw-surface` | `runtime/src/styles/00-tokens.css:141` | contract.md 4.0 | none found | stable |  |
| `--pw-surface-2` | `runtime/src/styles/00-tokens.css:142` | contract.md 4.0 | none found | stable |  |
| `--pw-line` | `runtime/src/styles/00-tokens.css:143` | contract.md 4.0 | smoke | stable |  |
| `--pw-text` | `runtime/src/styles/00-tokens.css:155` | contract.md 4.0 | none found | stable |  |
| `--pw-text-muted` | `runtime/src/styles/00-tokens.css:156` | contract.md 4.0 | none found | stable |  |
| `--pw-h1` | `runtime/src/styles/00-tokens.css:164` | contract.md 4.0 | BridgeCustomizer | stable |  |
| `--pw-input-bg` | `runtime/src/styles/00-tokens.css:45` | contract.md 4.0 | BridgeCustomizer; BridgeQuiet | stable |  |
| `--pw-input-border` | `runtime/src/styles/00-tokens.css:146` | contract.md 4.0 | BridgeQuiet; smoke | stable |  |
| `--pw-radius` | `runtime/src/styles/00-tokens.css:138` | contract.md 4.0 | none found | stable |  |
| `--pw-radius-m` | `runtime/src/styles/00-tokens.css:139` | contract.md 4.0 | none found | stable |  |
| `--pw-shadow-card` | `runtime/src/styles/00-tokens.css:180` | contract.md 4.0 | none found | stable |  |
| `--pw-shadow-dropdown` | `runtime/src/styles/00-tokens.css:181` | contract.md 4.0 | none found | stable |  |
| `--pw-font` | `runtime/src/styles/00-tokens.css:54` | contract.md 4.0 | BridgeQuiet | stable |  |
| `--pw-font-size` | `runtime/src/styles/00-tokens.css:55` | contract.md 4.0; extensions.md 12 | BridgeQuiet; smoke | stable |  |
| `--pw-line-height` | `runtime/src/styles/00-tokens.css:56` | contract.md 4.0; extensions.md 12 | BridgeQuiet; smoke | stable |  |
| `--pw-gutter` | `runtime/src/styles/00-tokens.css:66` | contract.md 4.0; extensions.md 12 | BridgeCustomizer; BridgeQuiet | stable |  |
| `--pw-field-pad` | `runtime/src/styles/00-tokens.css:64` | contract.md 4.0; extensions.md 12 | BridgeQuiet; smoke | stable |  |
| `--pw-field-pad-bottom` | `runtime/src/styles/00-tokens.css:65` | contract.md 4.0; extensions.md 12 | BridgeQuiet; smoke | stable |  |
| `--pw-z-notices` | `runtime/src/styles/00-tokens.css:148` | contract.md 4.0 | BridgeCustomizer | stable |  |
| `--pw-z-popup` | `runtime/src/styles/00-tokens.css:149` | contract.md 4.0 | smoke | stable |  |
| `--pw-z-masthead` | `runtime/src/styles/00-tokens.css:150` | contract.md 4.0 | none found | stable |  |
| `--pw-z-drawer` | `runtime/src/styles/00-tokens.css:151` | contract.md 4.0 | none found | stable |  |
| `--pw-z-dropdown` | `runtime/src/styles/00-tokens.css:152` | contract.md 4.0 | none found | stable |  |
| `--pw-z-picker` | `runtime/src/styles/00-tokens.css:153` | contract.md 4.0 | none found | stable |  |
| `--pw-z-overlay` | `runtime/src/styles/00-tokens.css:154` | contract.md 4.0 | none found | stable |  |
| `--pw-status-success-bg` | `runtime/src/styles/00-tokens.css:40` | contract.md 4.0 | none found | stable |  |
| `--pw-status-success-border` | `runtime/src/styles/00-tokens.css:40` | contract.md 4.0 | none found | stable |  |
| `--pw-status-success-fg` | `runtime/src/styles/00-tokens.css:40` | contract.md 4.0 | none found | stable |  |
| `--pw-status-success-icon` | `runtime/src/styles/00-tokens.css:40` | contract.md 4.0 | none found | stable |  |
| `--pw-status-warning-bg` | `runtime/src/styles/00-tokens.css:41` | contract.md 4.0 | none found | stable |  |
| `--pw-status-warning-border` | `runtime/src/styles/00-tokens.css:41` | contract.md 4.0 | none found | stable |  |
| `--pw-status-warning-fg` | `runtime/src/styles/00-tokens.css:41` | contract.md 4.0 | none found | stable |  |
| `--pw-status-warning-icon` | `runtime/src/styles/00-tokens.css:41` | contract.md 4.0 | none found | stable |  |
| `--pw-status-error-bg` | `runtime/src/styles/00-tokens.css:42` | contract.md 4.0 | none found | stable |  |
| `--pw-status-error-border` | `runtime/src/styles/00-tokens.css:42` | contract.md 4.0 | none found | stable |  |
| `--pw-status-error-fg` | `runtime/src/styles/00-tokens.css:42` | contract.md 4.0 | none found | stable |  |
| `--pw-status-error-icon` | `runtime/src/styles/00-tokens.css:42` | contract.md 4.0 | none found | stable |  |
| `--pw-success-bg` | `runtime/src/styles/00-tokens.css:175` | contract.md 4.0 | none found | stable |  |
| `--pw-warning-bg` | `runtime/src/styles/00-tokens.css:176` | contract.md 4.0 | none found | stable |  |
| `--pw-danger-bg` | `runtime/src/styles/00-tokens.css:177` | contract.md 4.0 | BridgeQuiet | stable |  |
| `--pw-label-size` | `runtime/src/styles/00-tokens.css:61` | contract.md 4.0; extensions.md 3, 13 | BridgeCustomizer; smoke | stable |  |
| `--pw-control-height` | `runtime/src/styles/00-tokens.css:62` | contract.md 4.0; extensions.md 3, 13 | BridgeCustomizer; smoke | stable |  |
| `--pw-login-bg` | `runtime/src/styles/00-tokens.css:179` | contract.md 4.0; extensions.md 3, 13 | BridgeCustomizer; smoke; docs example (extensions.md 13) | stable |  |
| `--pw-range-fill` | `runtime/src/styles/00-tokens.css:73` | contract.md 4.1 (`setupRangeFill()`); extensions.md 3 | none found | stable | added for 1.0 (ruled 2026-11-13); set by script on each `input[type=range]`, the declaration is the value where none was set |
| `--pw-branch-max` | `runtime/src/styles/00-tokens.css:74` | contract.md 4.1 (`setupTreeFit()`); extensions.md 3 | none found | stable | added for 1.0 (ruled 2026-11-13); set by script on the deepest open page-tree branch, the declaration is the value where none was set |

## Events

Bubbling DOM events (`CustomEvent`) an extension may listen for; it never dispatches them. "Defined" is a place the event is dispatched (sources under `runtime/src/`, `classic/` built to the theme's `scripts/`).

| Name | Defined | Documented | Used by | Status | Note |
|---|---|---|---|---|---|
| `pw-runtime-ready` | `runtime/src/index.ts:76` | contract.md 4.1, 4.2 | BridgeSample; tools (scaffold-extension.php) | stable |  |
| `pw-legacy-loaded` | `runtime/src/classic/main.js:1712` | contract.md 4.1, 4.2 | tools (native-check.js) | stable |  |
| `pw-legacy-handover` | `runtime/src/classic/main.js:1700` | contract.md 4.1 | none found | stable |  |
| `pw-uikit-loaded` | `runtime/src/classic/uikit-layer.js:80` | contract.md 4.1, 4.2 | none found | stable |  |
| `pw-component-loaded` | `runtime/src/components.ts:38` | contract.md 4.2 | none found | stable |  |
| `pw-component-failed` | `runtime/src/components.ts:45` | contract.md 4.2; extensions.md 5 | none found | stable |  |
| `pw-modal-opened` | `runtime/src/elements/pw-dialog.ts:170` | contract.md 4.2 | none found | stable |  |
| `pw-modal-closed` | `runtime/src/elements/pw-dialog.ts:131` | contract.md 4.2 | none found | stable |  |
| `pw-wiretabs-change` | `runtime/src/classic/wire-tabs.js:189` | contract.md 4.2, 4.4 | tools (page-edit-check.js) | stable |  |
| `pw-tab-focus` | `runtime/src/classic/main.js:549` | contract.md 4.1 | tools (drawers-check.js) | stable |  |
| `pw-drawer-open` | `runtime/src/classic/drawers.js:55` | contract.md 4.1; extensions.md 4 | tools (drawers-check.js) | stable |  |
| `pw-drawer-close` | `runtime/src/classic/drawers.js:220` | contract.md 4.1; extensions.md 4 | tools (drawers-check.js); smoke | stable |  |
| `pw-page-save` | `runtime/src/classic/page-save.js:160` | contract.md 4.3 | none found | stable |  |
| `pw-page-saved` | `runtime/src/classic/page-save.js:316` | contract.md 4.1, 4.3 | tools (autocomplete-check.js, form-save-check.js, image-file-check.js, +4); smoke | stable |  |
| `pw-form-save` | `runtime/src/classic/page-save.js:160` | contract.md 4.3 | none found | stable |  |
| `pw-form-saved` | `runtime/src/classic/page-save.js:274` | contract.md 4.3 | BridgeCustomizer; tools (acl-check.js, form-save-check.js) | stable |  |
| `pw-files-moved` | `runtime/src/fields/files-move.ts:413` | contract.md 4.2, 4.4 | tools (image-file-check.js) | stable |  |
| `pw-extension-loaded` | `runtime/src/extensions.ts:35` | contract.md 4.2; extensions.md 5, 6, 9 | tools (extension-check.js, extension-dev.js); smoke | stable |  |
| `pw-extensions-ready` | `runtime/src/extensions.ts:78` | contract.md 4.2; extensions.md 5, 6 | tools (extension-check.js); smoke | stable |  |
| `opened` | `runtime/src/inputfields/collapse.ts:77` | contract.md 4.2, 5 | none found | stable | upstream `inputfields.js` name, dispatched natively on pages without the legacy stack |
| `closed` | `runtime/src/inputfields/collapse.ts:86` | contract.md 4.2 | none found | stable | as `opened` |
| `reloaded` | `runtime/src/classic/main.js:1826` | contract.md 4.1, 4.2, 4.3, 4.4, 5 | tools (repeater-check.js) | stable | as `opened`; `detail.source` names the loader |
| `showIf` | `runtime/src/inputfields/dependencies.ts:187` | contract.md 4.2, 6 | BridgeDemo | stable | as `opened` |
| `changed` | `runtime/src/inputfields/forms.ts:44` | contract.md 4.2 | tools (native-check.js, setup-check.js); smoke | stable | as `opened` |
| `pw-scheme-change` | `runtime/src/classic/main.js:403` | contract.md 4.0, 4.1 | none found | stable | added for 1.0 (ruled 2026-11-13); `detail.scheme`, `detail.source` |
| `pw-variant-change` | `runtime/src/util/colors.ts:28` | contract.md 4.0 | smoke | stable | added for 1.0 (ruled 2026-11-13); `detail.variant`, `detail.color` |
| `pw-scale-change` | `runtime/src/classic/main.js:335` | contract.md 4.0 | none found | stable | added for 1.0 (ruled 2026-11-13); `detail.scale` |
| `pw-tabs-change` | `runtime/src/elements/pw-tabs.ts:87` | contract.md 4.2 | none found | stable | added for 1.0 (ruled 2026-11-13); `detail.id`, from `<pw-tabs>` |

## Runtime

Keys of `window.Bridge` (`runtime/src/index.ts`, built to `assets/dist/runtime.js`).

| Name | Defined | Documented | Used by | Status | Note |
|---|---|---|---|---|---|
| `contract` | `runtime/src/index.ts:31` | contract.md 4.2 | none found | stable |  |
| `version` | `runtime/src/index.ts:30` | contract.md 4.2 | none found | stable | also `detail.version` of `pw-runtime-ready` |
| `Inputfields` | `runtime/src/index.ts:32` | contract.md 4.1, 4.2 | tools (native-check.js) | stable |  |
| `components` | `runtime/src/index.ts:33` | contract.md 4.2; extensions.md 5 | none found | stable |  |
| `dialog` | `runtime/src/index.ts:40` | contract.md 4.1, 4.2, 4.4 | tools (a11y-check.js, image-file-check.js, image-select-check.js, +1) | stable |  |
| `legacy` | `runtime/src/index.ts:44` | contract.md 4.1, 4.2, 5 | tools (native-check.js) | stable |  |
| `tables` | `runtime/src/index.ts:48` | contract.md 4.4 | none found | stable |  |
| `pageTree` | `runtime/src/index.ts:53` | contract.md 4.1, 4.2, 4.4 | none found | stable |  |
| `sortable` | `runtime/src/index.ts:56` | contract.md 4.2 | tools (native-check.js); smoke | stable |  |
| `confirm` | `runtime/src/index.ts:59` | contract.md 4.2 | none found | stable |  |
| `guard` | `runtime/src/index.ts:60` | contract.md 4.2 | none found | stable |  |
| `extensions` | `runtime/src/index.ts:35` | extensions.md 2, 5, 6, 9 | BridgeSample; BridgeCustomizer; BridgeQuiet; tools (extension-check.js, extension-dev.js, scaffold-extension.php); smoke | stable |  |

## Client API beyond the runtime list

`docs/contract.md` section 4 documents members below the `runtime` keys and the theme script's
`ProcessWireAdminTheme`, which the surface does not list. They are part of the documented client
API, each with the arguments and options its row in `docs/contract.md` gives. Sources are under
`runtime/src/`; `classic/*.js` is built to the theme's `scripts/`.

### `ProcessWireAdminTheme` (theme script)

| Member | Defined | Documented | Used by | Status |
|---|---|---|---|---|
| `legacy.loaded` | `runtime/src/classic/main.js:1658` | contract.md 4.1 | tools (autocomplete-check.js, native-check.js) | stable |
| `legacy.load()` | `runtime/src/classic/main.js:1671` | contract.md 4.1 | tools (autocomplete-check.js, lister-check.js, native-check.js) | stable |
| `legacy.initElement(el)` | `runtime/src/classic/main.js:1814` | contract.md 4.1 | none found | stable |
| `legacy.observe()` | `runtime/src/classic/main.js:1869` | contract.md 4.1 | none found | stable |
| `legacy.needsStack(li)` | `runtime/src/classic/main.js:1838` | contract.md 4.1 | none found | stable |
| `legacy.loadStyle(url)` | `runtime/src/classic/main.js:1721` | contract.md 4.1 | none found | stable |
| `legacy.holdReady()` / `legacy.releaseReady()` | `runtime/src/classic/main.js:1754`, `:1767` | contract.md 4.1 | none found | stable |
| `legacy.later(fn)` | `runtime/src/classic/main.js:1782` | contract.md 4.2 (text) | smoke | stable |
| `upstream()` | `runtime/src/classic/main.js:158` | contract.md 4.1 | tools (native-check.js) | stable |
| `observe(fn)` | `runtime/src/classic/main.js:182` | contract.md 4.1 | none found | stable |
| `handover.bind(options)` / `handover.over` | `runtime/src/classic/main.js:207` | contract.md 4.1 | tools (autocomplete-check.js, lister-check.js) | stable |
| `scheme.setting()` / `scheme.cycle()` / `scheme.apply()` | `runtime/src/classic/main.js:375` | contract.md 4.1 | tools (scheme-scan.js) | stable |
| `editors` | `runtime/src/classic/main.js:670` | contract.md 4.1 | none found | stable |
| `uikit.loaded` / `uikit.load()` / `uikit.scan(el)` | `runtime/src/classic/uikit-layer.js:203` | contract.md 3.1, 4.1 | none found | stable |
| `setupRangeFill()` | `runtime/src/classic/main.js:565` | contract.md 4.1 | none found | stable |
| `setupTreeFit()` | `runtime/src/classic/main.js:605` | contract.md 4.1 | tools (drawers-check.js) | stable |
| `setupNoticeTimeout()` | `runtime/src/classic/main.js:865` | contract.md 4.1 | none found | stable |
| `removeNotices(el)` | `runtime/src/classic/main.js:851` | contract.md 4.1 | none found | stable |
| `tabFocusDelay` | `runtime/src/classic/main.js:538` | contract.md 4.1 | tools (drawers-check.js) | stable |
| `drawer.open(name)` / `close(name)` / `isOpen(name)` / `refreshTree()` / `refreshHistory()` | `runtime/src/classic/drawers.js:224` | contract.md 4.1 | tools (drawers-check.js) | stable |
| `copyButtonMenu(wrap, toggle, original)` | `runtime/src/classic/main.js:1636` | contract.md 4.1 | none found | stable |
| `WireTabs(target, options)` | `runtime/src/classic/wire-tabs.js:63` | contract.md 4.1, 4.4 | none found | stable |
| `pageEdit.init()` | `runtime/src/classic/page-edit.js:36` | contract.md 4.1, 4.4 | none found | stable |
| `setup.init()` / `screens.init()` | `runtime/src/classic/setup.js:809`, `screens.js:311` | contract.md 4.3 (text) | tools (setup-check.js) | stable |
| `setupStyleOrder()` | `runtime/src/classic/main.js:452` | contract.md 4.1 | none found | stable |
| `runScripts(rootOrScripts, {legacy, nonce})` | `runtime/src/classic/main.js:40` | contract.md 4.1 | none found | stable |
| `nonce()` | `runtime/src/classic/main.js:99` | contract.md 4.1 | none found | stable |
| `trusted` | `runtime/src/classic/main.js:111` | contract.md 4.1 | tools (native-check.js) | stable |
| `setCookie(name, value)` | `runtime/src/classic/main.js:145` | contract.md 4.1 | none found | stable |

### Globals on pages without the legacy stack

| Global | Defined | Documented | Used by | Status |
|---|---|---|---|---|
| `InputfieldSubmitDropdown` | `runtime/src/classic/main.js:1971` | contract.md 4.1 | smoke | stable |
| `Inputfields`, `Bridge`, `AdminDataTable` stand-ins | `runtime/src/classic/main.js:1926` | contract.md 4.1 | smoke; tools (setup-check.js) | stable |
| `window.Inputfields` facade: `native`, `inputfield`, `open`, `close`, `toggle`, `isCollapsed`, `hidden`, `focus`, `find`, `changed`, `name`, `label`, `reload`, `highlight`, `hashAction` | `runtime/src/inputfields/facade.ts:63` | contract.md 4.2 | smoke; tools (form-save-check.js, screens-check.js, setup-check.js) | stable |

### `window.Bridge` members

| Member | Defined | Documented | Used by | Status |
|---|---|---|---|---|
| `Bridge.Inputfields.init(root)`, `open`, `close`, `toggle`, `evaluate`, `recalcColumns`, `isCollapsed`, `hidden` | `runtime/src/inputfields/index.ts:34` | contract.md 4.2 | tools (native-check.js) | stable |
| `Bridge.components.load(url)`, `loadFrom(root)`, `loaded()` | `runtime/src/index.ts:33` | contract.md 4.2; extensions.md 5 | none found | stable |
| `Bridge.extensions.list()`, `loaded()`, `reload(name)` | `runtime/src/index.ts:35` | extensions.md 5 | BridgeSample; BridgeCustomizer; BridgeQuiet; tools (extension-check.js, extension-dev.js, scaffold-extension.php); smoke | stable |
| `Bridge.dialog.open(url, size, options)`, `close(abort?)` | `runtime/src/index.ts:41` | contract.md 4.2 | tools (image-file-check.js, image-select-check.js, setup-check.js) | stable |
| `Bridge.legacy.loaded()`, `load()` | `runtime/src/index.ts:44` | contract.md 4.2 | tools (native-check.js) | stable |
| `Bridge.tables.sort(table, column, dir)` | `runtime/src/index.ts:49` | contract.md 4.4 | none found | stable |
| `Bridge.pageTree(container)` | `runtime/src/index.ts:53` | contract.md 4.2 | none found | stable |
| `Bridge.sortable(list, options)` | `runtime/src/index.ts:56` | contract.md 4.2 | smoke; tools (native-check.js) | stable |
| `Bridge.confirm(opts, onOk?, onCancel?)` | `runtime/src/index.ts:59` | contract.md 4.2 | none found | stable |
| `Bridge.guard(opts, onOk?, onCancel?)` | `runtime/src/index.ts:60` | contract.md 4.2 | none found | stable |

## Not on the surface

Members a page can reach that neither the lists nor `docs/contract.md` publish. They are
internal: they may change or go in any release.

- `window.Bridge`: `init()`, `lightbox()`, `colors()`.
- `ProcessWireAdminTheme`: every member not in the table above, among them `init()`,
  `cssLength()`, `prefs`, `scale`, `confirm()`, `config()`, `flash()`, `loadRuntime()`, the
  `setup…()` functions not listed above, the navigation, dropdown and search helpers, and the
  objects other classic scripts add (`imageSelect`, `link`).
- Public methods of `AdminThemeBridge` missing from `reads` and `hooks`: the contract tests fail
  an extension that calls them (`docs/extensions.md` 1 and 6). Among them `themeAssetUrl($file)`
  (`lib/AdminThemeBridgeHead.php:211`), on `reads` until contract 0.2 and taken off for 1.0
  (ruled 2026-11-13): its argument is a path inside the theme, and the theme's file names are not
  part of the contract.
- CSS custom properties the theme declares that are not on `tokens` (`docs/extensions.md` 3),
  among them `--ring-50` (ruled internal 2026-11-13; `docs/contract.md` 4.0 says so).

## For the maintainer

The entries that needed a ruling before the contract was set to 1.0. Every other entry above is
`stable`.

**Ruled 2026-11-13, as recommended**, and applied in extension contract 1.0: `themeAssetUrl`
internal (off `reads`, the method stays); the nine public but undocumented entries `stable`, each
with a line in `docs/extensions.md` 3 (`version`: `docs/contract.md` 4.2); the four events and
`--pw-range-fill`, `--pw-branch-max` added to the lists; `--ring-50` internal, the sentence in
`docs/contract.md` 4.0 corrected. The tables below are the proposals as they were put.

### Candidates

| Entry | Proposal | Reason | Cost of keeping it for all of 1.x |
|---|---|---|---|
| read `themeAssetUrl($file)` | candidate: internal (ruled: internal) | Its argument is a path inside the theme (`assets/dist/theme.css`, `scripts/main.js`, …), and the theme's file names are not otherwise part of 1.0; no caller outside the theme but the smoke test | Every path a caller may have passed must keep resolving, which ties the built files' names and places to the contract |

### Public but undocumented

Proposed `stable`; each needs a line in `docs/contract.md` or `docs/extensions.md` before 1.0 if
kept. Ruled: stable, documented.

| Entry | What it is | Cost of keeping it for all of 1.x |
|---|---|---|
| hook `renderBreadcrumbs()` | The breadcrumb markup above the content (empty in modals, for guests, on the page tree, with fewer than two crumbs outside the page editor); the docs name it only as the example hook | Its return value becomes a contract: a hook after may parse or wrap that markup, so its outer element and classes stay |
| read `extensionAllowed($info)` | Whether the current user may have an extension (its `permission`, superusers always) | Low: the rule is the manifest's `permission` key, already documented |
| read `nonceScriptTag($openTag)` | Puts this request's CSP nonce on a `<script>` open tag that has none | Low: the same contract as `nonceAttr()` |
| read `getVariant()` | The colour preset in use (the user's own over the site's) | The preset names (`blue`, `vibrant`, `black`, `pink`, `green`, `custom`) are frozen; they are already documented as `data-pw-variant` values |
| read `getColorScheme()` | The colour scheme setting in effect, after `appearance()` (`auto`, `light`, `dark`); named only in ADR 0023 | Low: the three values |
| read `shellLabel($key)` | A translated label of the shell templates; the theme's own templates call it, so a site's copy of them does too | The key list (`lang`, `skip`, `menu`, `mainNav`, `search`, `home`, `pagination`, …) is frozen: keys may be added, none renamed or removed |
| read `getHistorySteps()` | The `historySteps` setting when it is 1 to 10000, else 100 | Low |
| setting `extendedBreadcrumbs` | Features > Extended breadcrumbs (on/off); documented by its config field only | Low |
| runtime `version` | The runtime's version string (also `detail.version` of `pw-runtime-ready`) | None beyond its type: a version string that changes every release |

### Documented, off the lists

Not entries of the seven lists, but documented as usable; 1.0 should either list them or say they
are not covered. Ruled: the events and `--pw-range-fill`, `--pw-branch-max` listed; `--ring-50`
not covered.

| Name | Where documented | What conflicts | Options |
|---|---|---|---|
| events `pw-scheme-change`, `pw-variant-change`, `pw-scale-change`, `pw-tabs-change` | contract.md 4.0, 4.1, 4.2 (dispatched by `runtime/src/classic/main.js:403`, `runtime/src/util/colors.ts:28`, `runtime/src/classic/main.js:335`, `runtime/src/elements/pw-tabs.ts:87`) | Documented for modules to listen to, missing from `events` | Add them to `events` (a surface addition), or keep them as documented client API outside the lists |
| custom property `--ring-50` | contract.md 4.0: "the name is kept for components" | extensions.md 3 calls it internal, and the contract tests fail a stylesheet that uses it (the built `theme.css` declares it) | Add it to `tokens`, or drop the sentence in contract.md 4.0 |
| custom properties `--pw-range-fill`, `--pw-branch-max` | contract.md 4.1 (`setupRangeFill()`, `setupTreeFit()`): set on elements for a component to use | Off `tokens`, so not covered by the rule in extensions.md 3; set by script, not declared in `theme.css`, so the contract tests do not catch them | Add them to `tokens`, or keep them covered only through the documented `setupRangeFill()` and `setupTreeFit()` rows |

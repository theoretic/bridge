# AdminThemeBridge

A ProcessWire admin theme built from native web components that still runs every existing
Inputfield and Process module. jQuery, jQuery UI and the rest of the classic admin stack load
only on the screens that need them, with the old globals and events, so jQuery-era modules keep
working unchanged.

This repository is the installable module only. It is generated from
[theoretic/bridge](https://github.com/theoretic/bridge), where the development happens. Issues,
documentation, the component contract, the changelog and the build sources are there.

## Requirements

ProcessWire 3.0.227 or later, PHP 8.1 or later.

## Install

1. Copy this folder to `site/modules/AdminThemeBridge/`, or install it from the modules
   directory (Modules > New).
2. Modules > Refresh, then install **Bridge**.
3. Select it under Profile > Admin Theme. Other users keep their theme.

On a live site, back up the database first and read
[docs/install-live.md](https://github.com/theoretic/bridge/blob/master/docs/install-live.md).

## License

MIT, see [LICENSE](LICENSE).

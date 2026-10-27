# Installing Bridge on a live site

Local sites get the theme through a junction and `tools/deploy-local.php`. A server gets a plain
copy and the same script, run as the web server user. The checklist below comes from the first
two live installs: atis.pro (2026-10-17), which went wrong in three separate ways, and testfly.me
(2026-10-18). Both are described after the checklist.

## Checklist

Before:
1. **Back up the database.**
2. **Check site modules that run inside a module cache rebuild.** A module whose `.config.php`
   calls `$modules->get()` on itself can loop until memory runs out on every Modules > Refresh
   and every install. StaticPages 0.6.3 did this; 0.6.4 fixes it. Update such modules first.
   Install the theme only once a plain Modules > Refresh completes.
3. **Check AdminThemeBoss.** With "activate for all users" on, Boss resets every user's admin theme
   to Uikit on each request, so nobody can select Bridge. `deploy-local.php` switches it off. An
   install from the admin only warns, and since 0.8.2 the profile refuses Bridge while the setting
   is on.
4. **Check site hooks on page saves.** Boss's reset is a user save at boot, before any template
   file runs (see [testfly.me](#what-went-wrong-on-testflyme) below). A `Pages::saved` hook that
   relies on the site's prepend file (an autoloader, constants, functions) fails there. Hooks
   should load what they need themselves.

Install:
1. Upload `modules/AdminThemeBridge/` to `site/modules/AdminThemeBridge/` as a plain copy, owned
   like the other site modules.
2. Copy the two tools somewhere the web server user can read; a home directory usually isn't
   (`Could not open input file`):
   ```bash
   install -m 644 deploy-local.php admin-theme-diag.php /tmp/
   ```
3. Install, rebuild the module cache in full, switch Boss's "all users" off and select the theme
   for one user:
   ```bash
   sudo -u www-data php /tmp/deploy-local.php /var/www/site/htdocs <username>
   ```
   Run it as the web server user, never as root, so files written while booting keep their owner.

Verify:
```bash
sudo -u www-data php /tmp/admin-theme-diag.php /var/www/site/htdocs <username>
```
Expect:
- `AdminThemeBridge … autoload='template=admin' flags=10`;
- `allusers = 0` (or Boss not installed);
- the user's `admin_theme` is `'AdminThemeBridge'`;
- `AdminThemeBridge cache stale: false`.

Then open the login page: its `<body>` class list must contain `AdminThemeBridge`.

Update to a newer version:
1. Upload the new copy over the old one.
2. Run Modules > Refresh and click **Apply** next to the version change.
3. Reload the admin.

Until the refresh, the footer and the module list keep showing the old version: the theme takes
`$this->version` from the module info cache, and only a refresh rebuilds it. A changed module
file is what lets that refresh through the file snapshot check. If the footer still shows the
old version after the refresh, PHP-FPM's opcache is serving the old file; reload PHP-FPM.

Undo: Profile > Admin Theme back to Uikit, then uninstall the module from its settings page.

Browser caching (0.9.11): the module's `.htaccess` gives its versioned files (`?v=` URLs) and its
hashed files (runtime chunks, icon font subsets) `Cache-Control: public, max-age=31536000,
immutable` on Apache with `mod_headers`. On nginx the same is one rule in the site's server block:

```nginx
location ~* /site/modules/AdminThemeBridge/.+\.(js|css|woff2|json)$ {
	if ($arg_v) { add_header Cache-Control "public, max-age=31536000, immutable"; }
}
```

## What went wrong on atis.pro

### 1. Memory exhausted during install

`Allowed memory size of 536870912 bytes exhausted (tried to allocate 40960 bytes)`.

- **Cause:** StaticPages 0.6.3, not Bridge. Its `.config.php` called
  `$modules->get('StaticPages')`. Every rebuild of the module info cache (an install, Modules >
  Refresh, `?reset=1`) loads each module's config file, so that `get()` started the rebuild again
  from inside itself.
- **Fix:** StaticPages 0.6.4 skips the call while `$modules->refreshing` is set.

### 2. The theme rendered without its set-up

The admin showed in Times New Roman, with no menu, no jQuery stack and no `AdminThemeBridge` body
class, for guests and logged-in users alike. The theme's CSS, JS and fonts all served fine.

What happened:
- The out-of-memory error struck in the rebuild at the end of the install
  (`ModulesInstaller.php:232`), after the `modules` row was written. That left the row with
  `flags=2` (autoload, no conditional) and **no entry for the theme in the module info cache**.
- The loader reads a module's `autoload` from that cache. With no entry it takes `true`
  (`ModulesLoader.php:569-570`), so `template=admin` was ignored and the theme was initialised at
  boot, before the page was known.
- At that point `AdminThemeFramework::init()` saw no logged-in user, and `useAsLogin` made the theme
  current (`setCurrent()`) for every request. The theme's own `init()` then returned before its
  set-up, because there was no page to check.
- A side effect: `$config->defaultAdminTheme` reads `AdminThemeBridge` in a CLI boot (`setCurrent()`
  writes it). It isn't a site setting.

Why Modules > Refresh didn't help:
- On 3.0.274, `Modules::refresh()` compares a snapshot of module file times and sizes and returns
  early when it matches (`Modules.php:2093-2099`).
- Installing changes no file, so every refresh after the failed install was a no-op.
- `touch site/modules/AdminThemeBridge/AdminThemeBridge.module.php` followed by a refresh repaired
  it.

Since 0.8.1 the theme handles this itself:
- when `init()` runs without a page, it sits the request out (`useAsLogin` off for that request);
- `ready()` saves an empty file snapshot and calls `refresh()`, which rebuilds the cache and flags,
  and logs `Loaded at boot: module info cache was stale, rebuilt it` to `admin-theme-bridge`;
- the first request shows the previous theme, every later one shows Bridge.

`admin-theme-diag.php` reports a repair made during its own boot.

`$modules->deleteCache('moduleFileSnapshot')` doesn't force the rebuild: it clears WireCache and
memory, but the snapshot lives in the `modules` table. Save an empty array instead, as
`refresh()` does itself.

### 3. The user could not select the theme

The production database predates the local switch-off, so AdminThemeBoss still had
"activate for all users" on. Every user's `admin_theme` read `AdminThemeUikit` again on each
request.

## What went wrong on testfly.me

Second live install, 2026-10-18. The install went through. Selecting Bridge in the profile
ended on `/backend/profile/` with:

```
Error: Class "SiteIndex" not found in testfly.me/htdocs/site/shared/hooks/pages.siteIndex.php:22
```

The chain:
1. ProcessProfile saved the user with `admin_theme = AdminThemeBridge` and redirected.
2. On the next request AdminThemeBoss ("activate for all users" on) found a user whose theme
   isn't Uikit. Its `init()` called `$user->setAndSave('admin_theme', 'AdminThemeUikit')`.
3. That save ran while modules were initialised, before any template file. On testfly the class
   autoloader for `site/shared/classes/` is registered by the prepend file
   (`templates/_shared/__prepend.php`), so it wasn't there yet.
4. The site's `Pages::saved` hook (`site/shared/hooks/pages.siteIndex.php`, included from
   `ready.php`) touched `\SiteIndex::TEMPLATES` and died.

Under Uikit nothing showed: Boss only saves a user whose theme isn't Uikit already.

Two separate faults, then:
- **The site's.** The hook needed a class it didn't load. testfly fixed this on 2026-10-14 (the
  hook now loads the class itself, commit 4d9591a), but the server still had the older copy. Any
  boot-time save would have hit it: Boss, a CLI script, another module's `init()`.
- **The setting.** Even with the hook fixed, Boss would have switched the user back to Uikit on
  every request. Bridge's install warning had said so, once.

Repair: upload the fixed hook, switch Boss's "activate for all users" off, select Bridge again.

Since 0.8.2, while that setting is on, the profile and user editors refuse Bridge
(`hookUserThemeSave()`):
- the user is saved with Uikit, so Boss finds nothing to reset and makes no boot-time save;
- an error names the setting to switch off.

## Not a problem

Firefox's `downloadable font: glyf: Glyph bbox was incorrect; adjusting` for
`fontawesome-webfont.woff2?v=4.7.0` shows on every ProcessWire admin. The font loads.

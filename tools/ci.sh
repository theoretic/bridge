#!/usr/bin/env bash
# Every check in one run (audit AR5): PHP lint, the runtime build (type checks of the TypeScript
# and of the classic scripts, the sink guard, the gzip budgets), the smoke test, the browser
# checks (the enforced CSP pass among them), the extension contract tests on the bundled
# extensions (0.27.0, docs/extensions.md 6 and 8) and the conformance suite (tools/gate1.sh). Stops at
# nothing: each step runs, and the
# summary lists the ones that failed.
#
# Usage (Git Bash):  PW=<playwright-core dir> bash tools/ci.sh [site:port]
#   site:port  the sandbox to test (default atispro:8089; tools/sandbox-site.sh makes it)
#   PW         a Playwright install (any project's node_modules/playwright-core); without it the
#              browser checks are skipped and reported as skipped
#   BROWSERS   default "chromium"; "chromium firefox" runs every browser check in both
#   SKIP       steps to leave out, space separated: lint build smoke browser extensions conformance
#   PHP        default D:/work/sites/modules/PHP-8.5/php
# The sandbox server must be running for the browser checks (gate1.sh starts one for its own run
# when none is). Do not expect PHP_CLI_SERVER_WORKERS to help: on Windows it does nothing (the
# server prints "forking is not supported on this platform"). A browser check may still fail now
# and then on "no console errors" (net::ERR_CONNECTION_REFUSED): the cause is a rare Windows
# connect error, 10055 (WSAENOBUFS), about one connection in thousands, which the browser reports
# as refused. The retry below covers it. Exit code: the number of failed steps.
#
# A browser check that fails runs once more: the output says so, the first run's log is kept as
# sandbox/ci-<check>-<browser>-first.log, a check that passes only the second time is listed in the
# summary (it does not fail the step), and a check that fails twice fails the step.
#
# Original work, MIT.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Windows paths for node and PHP (D:/..., not /d/...) under Git Bash
command -v cygpath > /dev/null && HERE="$(cygpath -m "$HERE")"
cd "$HERE" || exit 1
PHP="${PHP:-D:/work/sites/modules/PHP-8.5/php}"
SITE_PORT="${1:-atispro:8089}"
SITE="${SITE_PORT%%:*}"
PORT="${SITE_PORT##*:}"
SANDBOX="$HERE/sandbox/$SITE"
BROWSERS="${BROWSERS:-chromium}"
SKIP=" ${SKIP:-} "
# the bundled extensions, checked by tools/extension-check.php and .js
EXTENSIONS="BridgeCsp BridgeDemo BridgeSample BridgeAdminAccessControl"
# the browser checks, in the order they run: each needs only the sandbox and its fixture pages
CHECKS="native-check screens-check pagetree-check repeater-check image-file-check setup-check page-edit-check page-save-check lister-check form-save-check image-select-check a11y-check csp-check drawers-check autocomplete-check acl-check"

failed=()
retried=()
step() { echo; echo "== $1"; }
skip() { [[ "$SKIP" == *" $1 "* ]]; }
# browser_check <check> <browser> <extra flag or empty> <log>
browser_check() { MSYS_NO_PATHCONV=1 node "tools/$1.js" "$PW" "$2" $3 > "$4" 2>&1; }

if ! skip lint; then
	step "PHP lint"
	bad=0
	while IFS= read -r f; do
		"$PHP" -l "$f" > /dev/null 2>&1 || { echo "   $f"; bad=$((bad + 1)); }
	done < <(git ls-files '*.php')
	echo "   files with errors: $bad"
	[ "$bad" -eq 0 ] || failed+=("lint")
fi

if ! skip build; then
	step "runtime build (tsc, classic tsc, sinks, vite, budgets)"
	if (cd runtime && npm run build > "$HERE/sandbox/ci-build.log" 2>&1); then
		grep -E "^(theme\.css|runtime\.js|classic scripts|check-sinks)" sandbox/ci-build.log | sed 's/^/   /'
	else
		grep -E "error|over" sandbox/ci-build.log | head -20 | sed 's/^/   /'
		failed+=("build")
	fi
fi

if ! skip smoke; then
	step "smoke test ($SITE)"
	if "$PHP" tests/smoke.php "$SANDBOX" > sandbox/ci-smoke.log 2>&1; then
		tail -1 sandbox/ci-smoke.log | sed 's/^/   /'
	else
		grep -E "^FAIL|FAILED" sandbox/ci-smoke.log | head -20 | sed 's/^/   /'
		failed+=("smoke")
	fi
fi

if ! skip browser; then
	step "browser checks ($BROWSERS)"
	if [ -z "${PW:-}" ]; then
		echo "   skipped: set PW to a playwright-core directory"
	elif ! curl -s --max-time 20 "http://localhost:$PORT/" > /dev/null 2>&1; then
		echo "   no server on :$PORT (serve the sandbox, see CLAUDE.md or tools/router.php)"
		failed+=("browser")
	else
		# the fixture pages' ids from the sandbox itself
		eval "$("$PHP" tools/lib/sandbox-ids.php "$SANDBOX" | grep -E '^[A-Z_]+=[0-9]+$')"
		export NATIVE_ID="${NATIVE_ID:-}" FIXTURE_ID="${FIXTURE_ID:-}" PARENT_ID="${PARENT_ID:-}" TREE_ID="${TREE_ID:-}" NESTING_ID="${NESTING_ID:-}" AUTO_ID="${AUTO_ID:-}" CUSTOM_MENU_ID="${CUSTOM_MENU_ID:-}" ADD_TEMPLATE_ID="${ADD_TEMPLATE_ID:-}"
		# MSYS_NO_PATHCONV only for node: exported, it hands /dev/null to curl.exe literally
		export SANDBOX PHP
		export PW_STATE="${PW_STATE:-$HERE/sandbox/pw-state.json}"
		bfail=0
		for browser in $BROWSERS; do
			for t in $CHECKS; do
				extra=""
				[ "$t" = native-check ] && extra="--gate"
				# the policy enforced on the native screens (ADR 0020), report only elsewhere
				[ "$t" = csp-check ] && extra="--enforce"
				log="sandbox/ci-$t-$browser.log"
				first="sandbox/ci-$t-$browser-first.log"
				rm -f "$first"
				if browser_check "$t" "$browser" "$extra" "$log"; then
					echo "   ok    $t ($browser)"
				else
					cp "$log" "$first"
					echo "   RETRY $t ($browser): failed, running it once more (first run: $first)"
					if browser_check "$t" "$browser" "$extra" "$log"; then
						echo "   ok on retry  $t ($browser): failed once, passed the second time"
						retried+=("$t ($browser): $first")
					else
						echo "   FAIL  $t ($browser), twice: $log (first run: $first)"
						bfail=$((bfail + 1))
					fi
				fi
			done
		done
		[ "$bfail" -eq 0 ] || failed+=("browser")
	fi
fi

if ! skip extensions; then
	step "extensions (${EXTENSIONS// /, })"
	efail=0
	if "$PHP" tools/extension-compat.php > sandbox/ci-extension-compat.log 2>&1; then
		echo "   ok    extension-compat.php: $(tail -1 sandbox/ci-extension-compat.log)"
	else
		echo "   FAIL  extension-compat.php: sandbox/ci-extension-compat.log"
		efail=$((efail + 1))
	fi
	if ! curl -s --max-time 20 "http://localhost:$PORT/" > /dev/null 2>&1; then
		echo "   no server on :$PORT (serve the sandbox, see CLAUDE.md or tools/router.php)"
		efail=$((efail + 1))
	else
		# each extension-check.php run signs in as `bridge`; ProcessWire's login throttle makes the
		# n-th attempt of a name within 60 s wait (n - 1) * 5 s after the one before
		n=0
		for m in $EXTENSIONS; do
			[ "$n" -gt 0 ] && sleep $((n * 5 + 1))
			n=$((n + 1))
			if "$PHP" tools/extension-check.php "$SANDBOX" "$m" --base="http://localhost:$PORT" > "sandbox/ci-extension-check-$m.log" 2>&1; then
				echo "   ok    extension-check.php $m"
			else
				echo "   FAIL  extension-check.php $m: sandbox/ci-extension-check-$m.log"
				efail=$((efail + 1))
			fi
		done
		# the next sign-in as `bridge` (extension-check.js without a saved login, the conformance
		# runner) is the (n + 1)-th within 60 s
		sleep $((n * 5 + 1))
		if [ -z "${PW:-}" ]; then
			echo "   skipped: extension-check.js (set PW to a playwright-core directory)"
		else
			export SANDBOX PHP
			export PW_STATE="${PW_STATE:-$HERE/sandbox/pw-state.json}"
			for browser in $BROWSERS; do
				for m in $EXTENSIONS; do
					if MSYS_NO_PATHCONV=1 node tools/extension-check.js "$PW" "$browser" "$m" > "sandbox/ci-extension-check-$m-$browser.log" 2>&1; then
						echo "   ok    extension-check.js $m ($browser)"
					else
						echo "   FAIL  extension-check.js $m ($browser): sandbox/ci-extension-check-$m-$browser.log"
						efail=$((efail + 1))
					fi
				done
			done
		fi
	fi
	[ "$efail" -eq 0 ] || failed+=("extensions")
fi

if ! skip conformance; then
	step "conformance ($SITE_PORT)"
	bash tools/gate1.sh "$SITE_PORT" | tail -3 | sed 's/^/   /'
	[ "${PIPESTATUS[0]}" -eq 0 ] || failed+=("conformance")
fi

echo
if [ ${#retried[@]} -gt 0 ]; then
	echo "ci: passed ONLY ON RETRY (failed once, an intermittent failure to look at):"
	for r in "${retried[@]}"; do echo "   $r"; done
fi
if [ ${#failed[@]} -eq 0 ]; then
	if [ ${#retried[@]} -gt 0 ]; then
		echo "ci: all steps passed, ${#retried[@]} browser check(s) only on retry"
	else
		echo "ci: all steps passed"
	fi
else
	echo "ci: failed: ${failed[*]}"
fi
exit ${#failed[@]}

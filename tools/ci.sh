#!/usr/bin/env bash
# Every check in one run (audit AR5): PHP lint, the runtime build (type checks of the TypeScript
# and of the classic scripts, the sink guard, the gzip budgets), the smoke test, the browser
# checks (the enforced CSP pass among them) and the conformance suite (tools/gate1.sh). Stops at
# nothing: each step runs, and the
# summary lists the ones that failed.
#
# Usage (Git Bash):  PW=<playwright-core dir> bash tools/ci.sh [site:port]
#   site:port  the sandbox to test (default atispro:8089; tools/sandbox-site.sh makes it)
#   PW         a Playwright install (any project's node_modules/playwright-core); without it the
#              browser checks are skipped and reported as skipped
#   BROWSERS   default "chromium"; "chromium firefox" runs every browser check in both
#   SKIP       steps to leave out, space separated: lint build smoke browser conformance
#   PHP        default D:/work/sites/modules/PHP-8.5/php
# The sandbox server must be running for the browser checks (gate1.sh starts one for its own run
# when none is). Exit code: the number of failed steps.
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
# the browser checks, in the order they run: each needs only the sandbox and its fixture pages
CHECKS="native-check screens-check pagetree-check repeater-check image-file-check setup-check page-edit-check page-save-check lister-check form-save-check image-select-check a11y-check csp-check drawers-check"

failed=()
step() { echo; echo "== $1"; }
skip() { [[ "$SKIP" == *" $1 "* ]]; }

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
		export NATIVE_ID="${NATIVE_ID:-}" FIXTURE_ID="${FIXTURE_ID:-}" PARENT_ID="${PARENT_ID:-}" TREE_ID="${TREE_ID:-}" NESTING_ID="${NESTING_ID:-}"
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
				if MSYS_NO_PATHCONV=1 node "tools/$t.js" "$PW" "$browser" $extra > "sandbox/ci-$t-$browser.log" 2>&1; then
					echo "   ok    $t ($browser)"
				else
					echo "   FAIL  $t ($browser): sandbox/ci-$t-$browser.log"
					bfail=$((bfail + 1))
				fi
			done
		done
		[ "$bfail" -eq 0 ] || failed+=("browser")
	fi
fi

if ! skip conformance; then
	step "conformance ($SITE_PORT)"
	bash tools/gate1.sh "$SITE_PORT" | tail -3 | sed 's/^/   /'
	[ "${PIPESTATUS[0]}" -eq 0 ] || failed+=("conformance")
fi

echo
if [ ${#failed[@]} -eq 0 ]; then
	echo "ci: all steps passed"
else
	echo "ci: failed: ${failed[*]}"
fi
exit ${#failed[@]}

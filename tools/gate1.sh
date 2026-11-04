#!/usr/bin/env bash
# Gate 1 runner: serves every sandbox on its port, runs the conformance suite against each, and
# writes sandbox/gate1-<site>.txt (report) and sandbox/gate1-<site>.json (digests).
#
# Usage (Git Bash):  bash tools/gate1.sh [site:port ...]
#   default set: atispro:8089 davinci:8090 ofsla:8091 livingston:8092 paraavis:8093 tandem-chegem:8094 testfly:8095 sla.events:8096 txm:8097
# A sandbox must exist (tools/sandbox-site.sh <site> <port>). Servers started here are stopped at
# the end; a server already listening on the port is reused and left running.
# Exit code: the number of sites whose run failed (conformance exit code not 0), 0 when all pass
# (audit BG9: the gate used to end with 0 whatever it found).
# UIKIT_STRICT=1 passes --uikit-strict to run.php: a screen that loads the UIkit layer and is not
# in conformance/uikit-allow.txt fails its site.
set -uo pipefail

HERE="$(cygpath -m "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)")"
PHP="/d/work/sites/modules/PHP-8.5/php"
SITES=("$@")
[ ${#SITES[@]} -gt 0 ] || SITES=(atispro:8089 davinci:8090 ofsla:8091 livingston:8092 paraavis:8093 tandem-chegem:8094 testfly:8095 sla.events:8096 txm:8097)

# a PHP response of any status: the server is up (a 404 or a login redirect is a running server).
# The body goes to the pipe, not to -o /dev/null: with MSYS_NO_PATHCONV=1 (the Playwright tools'
# prefix) curl.exe gets that path literally, fails, and the server looked down
up() { curl -s -w '\n%{http_code}' --max-time 20 "http://localhost:$1/" 2>/dev/null | tail -n 1 | grep -q '^[1-5][0-9][0-9]$'; }

case_ok() { [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]] && [[ "$2" =~ ^[0-9]+$ ]]; }

STRICT=()
[ "${UIKIT_STRICT:-}" = 1 ] && STRICT=(--uikit-strict)

started=()
failed=0
for entry in "${SITES[@]}"; do
	site="${entry%%:*}"; port="${entry##*:}"
	case_ok "$site" "$port" || { echo "== $entry: not <site>:<port>"; failed=$((failed + 1)); continue; }
	[ -f "$HERE/sandbox/$site/index.php" ] || { echo "== $site: no sandbox, skipped"; continue; }
	if up "$port"; then
		echo "== $site: server already on :$port"
	else
		# PHP_CLI_SERVER_WORKERS: php -S is single-threaded by default and refuses a parallel
		# request for a static file (net::ERR_CONNECTION_REFUSED in the browser checks)
		PHP_CLI_SERVER_WORKERS=4 "$PHP" -S "localhost:$port" -t "$HERE/sandbox/$site" "$HERE/tools/router.php" > "$HERE/sandbox/server-$site.log" 2>&1 &
		started+=($!)
		for _ in $(seq 1 20); do up "$port" && break; sleep 0.5; done
		up "$port" || { echo "== $site: server on :$port did not come up"; failed=$((failed + 1)); continue; }
		echo "== $site: server started on :$port (pid $!)"
	fi
	if "$PHP" "$HERE/conformance/run.php" "$HERE/sandbox/$site" --base="http://localhost:$port" --json="$HERE/sandbox/gate1-$site.json" "${STRICT[@]}" > "$HERE/sandbox/gate1-$site.txt" 2>&1; then
		status=ok
	else
		status=FAILED
		failed=$((failed + 1))
	fi
	grep -E "^[0-9]+ screens:|^FAIL no screen|^[0-9]+ screens load the UIkit layer" "$HERE/sandbox/gate1-$site.txt" || tail -1 "$HERE/sandbox/gate1-$site.txt"
	echo "   $status, FAIL lines: $(grep -c '^FAIL' "$HERE/sandbox/gate1-$site.txt")"
done

for pid in "${started[@]:-}"; do
	[ -n "$pid" ] && kill "$pid" 2>/dev/null
done
echo "reports: sandbox/gate1-<site>.txt"
echo "sites failed: $failed"
exit "$failed"

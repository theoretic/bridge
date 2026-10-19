#!/usr/bin/env bash
# Gate 1 runner: serves every sandbox on its port, runs the conformance suite against each, and
# writes sandbox/gate1-<site>.txt (report) and sandbox/gate1-<site>.json (digests).
#
# Usage (Git Bash):  bash tools/gate1.sh [site:port ...]
#   default set: atispro:8089 davinci:8090 ofsla:8091 livingston:8092 paraavis:8093 tandem-chegem:8094 testfly:8095 sla.events:8096 txm:8097
# A sandbox must exist (tools/sandbox-site.sh <site> <port>). Servers started here are stopped at
# the end; a server already listening on the port is reused and left running.
set -uo pipefail

HERE="$(cygpath -m "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)")"
PHP="/d/work/sites/modules/PHP-8.5/php"
SITES=("$@")
[ ${#SITES[@]} -gt 0 ] || SITES=(atispro:8089 davinci:8090 ofsla:8091 livingston:8092 paraavis:8093 tandem-chegem:8094 testfly:8095 sla.events:8096 txm:8097)

started=()
for entry in "${SITES[@]}"; do
	site="${entry%%:*}"; port="${entry##*:}"
	[ -f "$HERE/sandbox/$site/index.php" ] || { echo "== $site: no sandbox, skipped"; continue; }
	if curl -s -o /dev/null "http://localhost:$port/"; then
		echo "== $site: server already on :$port"
	else
		"$PHP" -S "localhost:$port" -t "$HERE/sandbox/$site" "$HERE/tools/router.php" > "$HERE/sandbox/server-$site.log" 2>&1 &
		started+=($!)
		sleep 1
		echo "== $site: server started on :$port (pid $!)"
	fi
	"$PHP" "$HERE/conformance/run.php" "$HERE/sandbox/$site" --base="http://localhost:$port" --json="$HERE/sandbox/gate1-$site.json" > "$HERE/sandbox/gate1-$site.txt" 2>&1
	tail -2 "$HERE/sandbox/gate1-$site.txt" | head -1
	grep -c "^FAIL" "$HERE/sandbox/gate1-$site.txt" | sed 's/^/   FAIL lines: /'
done

for pid in "${started[@]:-}"; do
	[ -n "$pid" ] && kill "$pid" 2>/dev/null
done
echo "reports: sandbox/gate1-<site>.txt"
